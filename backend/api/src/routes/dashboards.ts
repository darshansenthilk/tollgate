import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import { freezeKey } from "@tollgate/shared";
import { db } from "../db/client.js";
import { activeDashboards, agents, dashboards } from "../db/schema.js";
// The shape guard this file used to define locally, now shared with
// routes/agents.ts and routes/activity.ts — see lib/dashboard-scope.ts for why a
// malformed uuid has to be screened before it reaches Postgres.
import { UUID_RE } from "../lib/dashboard-scope.js";

/**
 * Dashboards: the org-owned containers `/dashboards` lists as tiles, plus the
 * per-user record of which one is currently open (see the schema.ts section
 * comment for why ownership and selection live in separate tables).
 *
 * Every route is gated by the requireAuth preHandler (index.ts), which 401s
 * anonymous callers and stamps req.activeOrgId / req.authUser — so the `!`
 * below is safe, and org scoping (cross-account isolation) hangs off
 * activeOrgId, never client input. Same pattern as routes/agents.ts.
 *
 * DELETING IS A SOFT DELETE (dashboards.archived_at), because agents.dashboard_id
 * is NOT NULL with no ON DELETE action and spend_events.agent_id blocks removing
 * those agents — a hard delete would have to destroy billing history. The rule
 * that follows from that, and that every route below implements, is: "a soft
 * delete for billing history, but it looks like an actual deletion to the user."
 * So EVERY route here carries `archived_at IS NULL`. Missing it on any one of
 * them resurrects the dashboard by a different door — the list re-renders the
 * tile, `active` keeps the app open on a dead dashboard (the ON DELETE CASCADE
 * on active_dashboards does NOT fire for an UPDATE), rename 200s on an invisible
 * row, and select re-creates the selection the delete just cleaned up.
 */

/** Wire shape for a dashboard, shared by all six routes (every one of them
 *  builds it through toJson below, so a new field can't miss an endpoint). */
interface DashboardJson {
  id: string;
  name: string;
  createdAt: string;
}

/** GET /v1/dashboards only: the tile grid needs the counts to decide which
 *  delete confirmation to show, and it can't get them by calling listAgents()
 *  once per tile — that's an N+1 against a 300 req/min limit with 3s polls
 *  already running. Kept as a richer shape on the ONE route that needs it
 *  rather than widened into toJson, which all six routes share. */
interface DashboardListJson extends DashboardJson {
  /** Non-archived agents: active + pending + soft_frozen + hard_frozen. This is
   *  the number the user is shown, and `0` is what skips the confirm dialog
   *  entirely — a dashboard whose agents were each deleted individually reads as
   *  empty, which to the user it is. NEVER read 0 as "a hard delete would
   *  succeed": those archived rows still hold the FK. */
  agentCount: number;
  /** The subset that can still spend — the exact complement of the proxy's
   *  FROZEN_STATUSES (backend/proxy/src/routes/proxy.ts). Frozen agents get the
   *  plain warning because they're already inert; this is what escalates the
   *  copy to "deleting revokes their tokens". */
  liveAgentCount: number;
}

const MAX_NAME_LENGTH = 50;

type NameParseResult =
  | { ok: true; name: string }
  | { ok: false; error: "invalid_body" | "dashboard_name_too_long" };

/** Shared by POST (create) and PATCH (rename) so one cap governs both — a name
 *  the create route rejects can't sneak in through a later edit. The dialogs'
 *  maxLength={50} is a convenience, not a boundary. */
function parseNameBody(body: unknown): NameParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const rec = body as Record<string, unknown>;

  const raw = rec["name"];
  if (typeof raw !== "string") return { ok: false, error: "invalid_body" };

  const name = raw.trim();
  if (name === "") return { ok: false, error: "invalid_body" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: "dashboard_name_too_long" };

  return { ok: true, name };
}

function toJson(row: { id: string; name: string; createdAt: Date }): DashboardJson {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

/**
 * Point the caller's single active_dashboards row at `dashboardId`, creating it
 * on first selection. One row per user, so the upsert targets user_id. Returns
 * false when the dashboard isn't the caller org's, or is soft-deleted — which
 * makes this the authorization check as well as the write.
 *
 * WHY THIS IS ONE STATEMENT WITH A ROW LOCK, and not the read-then-upsert it
 * replaced. Soft delete took away the protection the FK used to give: a real
 * `DELETE FROM dashboards` would have made a concurrent selection queue behind
 * it and then fail, but `UPDATE dashboards SET archived_at` doesn't touch the
 * primary key, so it takes FOR NO KEY UPDATE — which does NOT conflict with the
 * FOR KEY SHARE this insert's FK check takes. Both statements simply succeed,
 * and the selection row the delete transaction just cleaned up comes straight
 * back, pointing at a dashboard no screen can reach.
 *
 * Collapsing the check and the write into one statement isn't enough on its own:
 * under READ COMMITTED the sub-SELECT would read its snapshot without blocking
 * on the uncommitted UPDATE and still see archived_at IS NULL. The explicit
 * `FOR SHARE` is what closes it — it DOES conflict with FOR NO KEY UPDATE, so a
 * concurrent delete makes this wait, and Postgres then re-evaluates the
 * predicate against the committed row version and finds no live dashboard. The
 * race is decided in SQL, which is the only place left that can decide it.
 */
async function selectDashboardIfLive(
  userId: string,
  dashboardId: string,
  orgId: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    with live as materialized (
      select "id"
      from "dashboards"
      where "id" = ${dashboardId}::uuid
        and "org_id" = ${orgId}
        and "archived_at" is null
      for share
    )
    insert into "active_dashboards" ("user_id", "dashboard_id", "updated_at")
    select ${userId}, live."id", now() from live
    on conflict ("user_id") do update
      set "dashboard_id" = excluded."dashboard_id", "updated_at" = now()
    returning "dashboard_id"
  `);

  return (result.rowCount ?? 0) > 0;
}

/** Takes Redis for one reason: DELETE revokes every agent in the dashboard, and
 *  revocation is two mechanisms (Postgres status + the Redis freeze key), the
 *  same pair routes/agents.ts sets. Doing only the Postgres half would leave the
 *  proxy's fast path disagreeing with its own database. */
export function registerDashboardRoutes(app: FastifyInstance, redis: Redis): void {
  app.post<{ Body: unknown }>("/v1/dashboards", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const parsed = parseNameBody(req.body);
    if (!parsed.ok) {
      reply.code(400);
      return parsed.error === "dashboard_name_too_long"
        ? {
            error: "dashboard_name_too_long",
            message: `A dashboard name can be at most ${MAX_NAME_LENGTH} characters.`,
          }
        : { error: "invalid_body" };
    }

    const created = { id: randomUUID(), name: parsed.name, createdAt: new Date() };
    await db.insert(dashboards).values({ ...created, orgId });

    // Creating a dashboard opens it (DE11) — the frontend navigates straight to
    // /agents afterwards, which reads this selection back. The row we just
    // inserted is live by construction, so the helper's false branch is
    // unreachable here; it's shared with the select route, which needs it.
    await selectDashboardIfLive(req.authUser!.id, created.id, orgId);

    reply.code(201);
    return toJson(created);
  });

  app.get("/v1/dashboards", async (req) => {
    const orgId = req.activeOrgId!;
    const rows = await db
      .select({
        id: dashboards.id,
        name: dashboards.name,
        createdAt: dashboards.createdAt,
        // One grouped left join rather than a per-tile listAgents() from the
        // client — see DashboardListJson. The join carries the non-archived
        // filter (not the WHERE clause) so a dashboard holding only archived
        // agents still returns its row, with a count of 0.
        agentCount: sql<number>`count(${agents.id})`.mapWith(Number),
        liveAgentCount: sql<number>`count(${agents.id}) filter (where ${agents.status} in ('active', 'pending'))`.mapWith(
          Number,
        ),
      })
      .from(dashboards)
      .leftJoin(
        agents,
        and(eq(agents.dashboardId, dashboards.id), ne(agents.status, "archived")),
      )
      // Scoped to the caller's org so one account never sees another's
      // dashboards, and to live ones so a deleted tile doesn't reappear on the
      // next load. Creation order, so tiles append rather than reshuffle (DE7);
      // the id tiebreak makes that order total, so "the oldest surviving
      // dashboard" the delete route re-points to is provably the leftmost tile.
      .where(and(eq(dashboards.orgId, orgId), isNull(dashboards.archivedAt)))
      .groupBy(dashboards.id, dashboards.name, dashboards.createdAt)
      .orderBy(asc(dashboards.createdAt), asc(dashboards.id));

    return rows.map(
      (row): DashboardListJson => ({
        ...toJson(row),
        agentCount: row.agentCount,
        liveAgentCount: row.liveAgentCount,
      }),
    );
  });

  app.get("/v1/dashboards/active", async (req) => {
    const orgId = req.activeOrgId!;
    const rows = await db
      .select({
        id: dashboards.id,
        name: dashboards.name,
        createdAt: dashboards.createdAt,
      })
      .from(activeDashboards)
      .innerJoin(dashboards, eq(dashboards.id, activeDashboards.dashboardId))
      // The org check matters as much as the user check: a selection made before
      // the user's active org changed would otherwise surface another org's
      // dashboard. Reading as "none selected" is the safe answer.
      //
      // archived_at matters for a subtler reason: active_dashboards.dashboard_id
      // has ON DELETE CASCADE, but a soft delete is an UPDATE, so the cascade
      // never fires. Without this predicate a stale selection row keeps the
      // whole app open on a dashboard that no longer exists. The delete route
      // re-points these rows, so this filter is the second line of defence, not
      // the first.
      .where(
        and(
          eq(activeDashboards.userId, req.authUser!.id),
          eq(dashboards.orgId, orgId),
          isNull(dashboards.archivedAt),
        ),
      );

    const row = rows[0];
    // Wrapped in an object because a Fastify handler can't return a bare null.
    return { dashboard: row === undefined ? null : toJson(row) };
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/v1/dashboards/:id",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      if (!UUID_RE.test(req.params.id)) {
        reply.code(404);
        return { error: "dashboard_not_found" };
      }

      // Validate before the org lookup so a malformed body can't be used to
      // probe which dashboard ids exist — a bad name 400s either way.
      const parsed = parseNameBody(req.body);
      if (!parsed.ok) {
        reply.code(400);
        return parsed.error === "dashboard_name_too_long"
          ? {
              error: "dashboard_name_too_long",
              message: `A dashboard name can be at most ${MAX_NAME_LENGTH} characters.`,
            }
          : { error: "invalid_body" };
      }

      // Org-scoped UPDATE: the where clause is the authorization check, so
      // another org's id updates zero rows and reads as 404 (see the select
      // route). Returning the updated row means no follow-up read. archived_at
      // joins that where clause for the same reason — otherwise a stale tab
      // renames a dashboard nobody can see and gets a 200 for it.
      const updated = await db
        .update(dashboards)
        .set({ name: parsed.name })
        .where(
          and(
            eq(dashboards.id, req.params.id),
            eq(dashboards.orgId, orgId),
            isNull(dashboards.archivedAt),
          ),
        )
        .returning({
          id: dashboards.id,
          name: dashboards.name,
          createdAt: dashboards.createdAt,
        });

      const dashboard = updated[0];
      if (dashboard === undefined) {
        reply.code(404);
        return { error: "dashboard_not_found" };
      }

      return toJson(dashboard);
    },
  );

  app.post<{ Params: { id: string } }>("/v1/dashboards/:id/select", async (req, reply) => {
    const orgId = req.activeOrgId!;
    if (!UUID_RE.test(req.params.id)) {
      reply.code(404);
      return { error: "dashboard_not_found" };
    }

    const rows = await db
      .select({
        id: dashboards.id,
        name: dashboards.name,
        createdAt: dashboards.createdAt,
      })
      .from(dashboards)
      // Org-scoped, so another org's id is indistinguishable from a nonexistent
      // one — 404 rather than 403, the same non-leaking convention agents.ts
      // uses. A soft-deleted dashboard is indistinguishable from both.
      .where(
        and(
          eq(dashboards.id, req.params.id),
          eq(dashboards.orgId, orgId),
          isNull(dashboards.archivedAt),
        ),
      );

    const dashboard = rows[0];
    if (dashboard === undefined) {
      reply.code(404);
      return { error: "dashboard_not_found" };
    }

    // This read was only for the response body. The upsert re-checks org and
    // archived_at under a row lock and IS the authorization, so a delete landing
    // in the gap between the two loses: it 404s here rather than re-creating the
    // selection row the delete transaction just resolved.
    if (!(await selectDashboardIfLive(req.authUser!.id, dashboard.id, orgId))) {
      reply.code(404);
      return { error: "dashboard_not_found" };
    }

    return toJson(dashboard);
  });

  /**
   * Soft-delete a dashboard, archiving every agent in it.
   *
   * Body-less like every other DELETE in the api: the confirm dialog's
   * type-the-name gate is a UI speed bump and is deliberately NOT sent here.
   * Dashboard names are non-unique by design, so a name proves the user read
   * *a* name, not that they targeted the right row — the id stays the authority.
   *
   * Returns JSON rather than 204 because the dashboard's `request()` helper
   * always calls res.json(): a 204 would throw a SyntaxError AFTER a delete that
   * already committed, and paint "Request failed" over a success.
   */
  app.delete<{ Params: { id: string } }>("/v1/dashboards/:id", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const userId = req.authUser!.id;
    if (!UUID_RE.test(req.params.id)) {
      reply.code(404);
      return { error: "dashboard_not_found" };
    }

    // One transaction, because a half-applied delete is the exact failure the
    // invariant forbids: a swept dashboard whose agents still hold live tokens.
    //
    // TRANSACTION TRAP: selectDashboardIfLive and resolveDashboardId both close
    // over the module-level `db`, so calling either in here would silently run
    // OUTSIDE this transaction. Everything below is inlined on `tx` for that
    // reason — don't refactor it back out into a helper that takes no tx.
    const result = await db.transaction(async (tx) => {
      // Claiming the row and authorizing are the same statement. `archived_at IS
      // NULL` also makes a repeat delete match zero rows, which is what turns a
      // double-click or a two-tab race into a plain 404 (no new status code
      // needed) — and the FOR NO KEY UPDATE this takes is what a concurrent
      // create or select then has to queue behind.
      const swept = await tx
        .update(dashboards)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(dashboards.id, req.params.id),
            eq(dashboards.orgId, orgId),
            isNull(dashboards.archivedAt),
          ),
        )
        .returning({ id: dashboards.id, name: dashboards.name });

      const dashboard = swept[0];
      if (dashboard === undefined) return null;

      // Revocation, mechanism 1 of 2. Postgres is the authority: the proxy's
      // FROZEN_STATUSES includes "archived", so this alone kills every token in
      // the dashboard on its very next request. Scoped to non-archived rows so
      // the returned ids are the ones that actually changed — agents deleted
      // individually already have their Redis key set by DELETE /v1/agents/:id.
      //
      // DELIBERATELY NOT also filtered on org_id, unlike GET /v1/agents and
      // /v1/activity, which keep it as defence in depth. Those are READS, where
      // the safe failure is to return too little. This is a REVOCATION, where
      // the safe failure is to archive too much: an agent row whose org_id
      // somehow disagreed with its dashboard's would be skipped by that filter
      // and left holding a working token inside a deleted dashboard — the exact
      // outcome this whole feature exists to prevent. Don't "restore" it.
      const archivedAgents = await tx
        .update(agents)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(agents.dashboardId, dashboard.id), ne(agents.status, "archived")))
        .returning({ id: agents.id });

      // Selection is PER USER, so this is not just the caller's problem: every
      // member of the org who had this dashboard open needs moving, or they land
      // on "you have no dashboards" while the org still has plenty. Re-point
      // when something survives, delete only when nothing does — one rule
      // covering both halves of "the active one and the last one can both go".
      const survivors = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(and(eq(dashboards.orgId, orgId), isNull(dashboards.archivedAt)))
        // Same total order as the tile grid above, so the survivor everyone
        // lands on is the leftmost tile they can see.
        .orderBy(asc(dashboards.createdAt), asc(dashboards.id))
        .limit(1);

      const survivor = survivors[0];
      if (survivor === undefined) {
        await tx.delete(activeDashboards).where(eq(activeDashboards.dashboardId, dashboard.id));
      } else {
        await tx
          .update(activeDashboards)
          .set({ dashboardId: survivor.id, updatedAt: new Date() })
          .where(eq(activeDashboards.dashboardId, dashboard.id));
      }

      // The CALLER's resulting selection, read back rather than assumed: a
      // caller who had a different dashboard open keeps it, and only someone who
      // was actually looking at the deleted one moves to the survivor. Same
      // join, org check and archived filter as GET /v1/dashboards/active.
      const active = await tx
        .select({
          id: dashboards.id,
          name: dashboards.name,
          createdAt: dashboards.createdAt,
        })
        .from(activeDashboards)
        .innerJoin(dashboards, eq(dashboards.id, activeDashboards.dashboardId))
        .where(
          and(
            eq(activeDashboards.userId, userId),
            eq(dashboards.orgId, orgId),
            isNull(dashboards.archivedAt),
          ),
        );

      return {
        id: dashboard.id,
        name: dashboard.name,
        archivedAgentIds: archivedAgents.map((row) => row.id),
        activeDashboard: active[0] === undefined ? null : toJson(active[0]),
      };
    });

    if (result === null) {
      reply.code(404);
      return { error: "dashboard_not_found" };
    }

    // Revocation, mechanism 2 of 2 — the Redis fast-path flag, mirroring what
    // DELETE /v1/agents/:id does per agent. AFTER the commit and deliberately
    // best-effort: Postgres already denies these agents, so a Redis blip must
    // not 500 a delete that has already happened and can't be retried.
    await Promise.all(
      result.archivedAgentIds.map((agentId) =>
        redis.set(freezeKey(agentId), "1").catch((err: unknown) => {
          req.log.warn({ err, agentId }, "failed to set freeze key for archived agent");
        }),
      ),
    );

    return {
      id: result.id,
      name: result.name,
      archivedAgentCount: result.archivedAgentIds.length,
      activeDashboard: result.activeDashboard,
    };
  });
}
