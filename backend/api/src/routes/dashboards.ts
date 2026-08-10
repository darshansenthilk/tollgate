import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import {
  DASHBOARD_MEMBER_ROLE_RANK,
  DASHBOARD_PERMISSION_ACTIONS,
  freezeKey,
  type DashboardMemberRole,
  type DashboardPermissionAction,
} from "@tollgate/shared";
import { db } from "../db/client.js";
import { activeDashboards, agents, dashboardMembers, dashboardRolePermissions, dashboards } from "../db/schema.js";
// The shape guard this file used to define locally, now shared with
// routes/agents.ts and routes/activity.ts — see lib/dashboard-scope.ts for why a
// malformed uuid has to be screened before it reaches Postgres.
import { dashboardAccessible, resolveDashboardId, UUID_RE } from "../lib/dashboard-scope.js";
import { canPerformDashboardAction, fetchRolePermissions } from "../lib/dashboard-permissions.js";
import { auth } from "../lib/auth.js";

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

/** DASHBOARD_MEMBER_ROLE_RANK's keys are exactly the 5 valid roles — reusing
 *  it here means the wire-validation set can't drift from @tollgate/shared's
 *  own union. */
function isDashboardMemberRole(value: unknown): value is DashboardMemberRole {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(DASHBOARD_MEMBER_ROLE_RANK, value)
  );
}

/** DASHBOARD_PERMISSION_ACTIONS is exactly the 6 gated actions — reusing it
 *  here means the wire-validation set can't drift from @tollgate/shared's own
 *  list, same reasoning as isDashboardMemberRole above. */
function isDashboardPermissionAction(value: unknown): value is DashboardPermissionAction {
  return typeof value === "string" && (DASHBOARD_PERMISSION_ACTIONS as readonly string[]).includes(value);
}

type PermissionsParseResult =
  | { ok: true; permissions: Partial<Record<DashboardPermissionAction, boolean>> }
  | { ok: false };

/** Accepts a partial toggle set ({ permissions: { createAgent: true, ... } })
 *  so the popup can save a single flipped switch without resending all 6. */
function parsePermissionsBody(body: unknown): PermissionsParseResult {
  if (typeof body !== "object" || body === null) return { ok: false };
  const raw = (body as Record<string, unknown>)["permissions"];
  if (typeof raw !== "object" || raw === null) return { ok: false };

  const out: Partial<Record<DashboardPermissionAction, boolean>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isDashboardPermissionAction(key) || typeof value !== "boolean") return { ok: false };
    out[key] = value;
  }
  if (Object.keys(out).length === 0) return { ok: false };
  return { ok: true, permissions: out };
}

/** A member/host entry in the share dialog's list. */
interface DashboardUserJson {
  id: string;
  email: string;
}

/**
 * Reaches into Better Auth's own `user` table, which isn't declared in this
 * package's drizzle schema (Better Auth owns and migrates it itself — see
 * db/auth-migrate.ts). `auth.$context` is the same adapter lib/auth.ts's own
 * databaseHooks use (there it arrives as `ctx.context.adapter`; called from a
 * route instead of a hook, it's `(await auth.$context).adapter`), kept to
 * Better Auth's own query API rather than a raw SQL join against a table this
 * package doesn't own the shape of.
 */
async function findUserByEmail(email: string): Promise<DashboardUserJson | null> {
  const ctx = await auth.$context;
  // select: ["id", "email"] both narrows the query and is what keeps the rest
  // of the Better Auth user row (name, image, twoFactorEnabled, ...) from
  // leaking into a dashboard-sharing response — the return type alone doesn't
  // enforce that, the adapter would otherwise hand back the full row.
  return ctx.adapter.findOne<DashboardUserJson>({
    model: "user",
    where: [{ field: "email", value: email }],
    select: ["id", "email"],
  });
}

async function findUserById(id: string): Promise<DashboardUserJson | null> {
  const ctx = await auth.$context;
  return ctx.adapter.findOne<DashboardUserJson>({
    model: "user",
    where: [{ field: "id", value: id }],
    select: ["id", "email"],
  });
}

/**
 * Batched form of findUserById for the member list, which otherwise resolves
 * one row per member via N separate adapter round trips. `limit` is passed
 * explicitly — the adapter's default `findMany` limit is meant for
 * open-ended listing, not "return exactly the ids I asked for".
 */
async function findUsersByIds(ids: string[]): Promise<DashboardUserJson[]> {
  if (ids.length === 0) return [];
  const ctx = await auth.$context;
  return ctx.adapter.findMany<DashboardUserJson>({
    model: "user",
    where: [{ field: "id", operator: "in", value: ids }],
    select: ["id", "email"],
    limit: ids.length,
  });
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
  // The "org_id" = ... OR EXISTS(...) clause mirrors dashboardAccessible
  // (lib/dashboard-scope.ts) by hand, same reason routes/agents.ts's create
  // route does — this is raw SQL for the FOR SHARE lock above, not something
  // that can go through the drizzle query builder. Keep the two in sync if the
  // sharing predicate ever changes.
  const result = await db.execute(sql`
    with live as materialized (
      select "id"
      from "dashboards"
      where "id" = ${dashboardId}::uuid
        and (
          "org_id" = ${orgId}
          or exists (
            select 1 from "dashboard_members"
            where "dashboard_id" = "dashboards"."id" and "user_id" = ${userId}
          )
        )
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
    await db.insert(dashboards).values({ ...created, orgId, createdBy: req.authUser!.id });

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
      // dashboardAccessible, not a plain org check: a selection can now
      // legitimately point at a dashboard outside the caller's own org (PLAN.md's
      // dashboard sharing) — but it still has to be one they can actually reach,
      // so a selection that's gone stale (their access was revoked, or their org
      // changed) still reads as "none selected", the safe answer.
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
          dashboardAccessible(orgId, req.authUser!.id),
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

      // Host-only, same resolveDashboardId -> createdBy === caller gate as the
      // member-role/permissions routes below — renaming isn't one of the 6
      // delegatable actions (@tollgate/shared's DASHBOARD_PERMISSION_ACTIONS
      // doc comment), so it stays a hard host check rather than a toggle, same
      // as removing a member. Checked before parseNameBody for the same
      // "unauthorized caller learns nothing about their payload" reason those
      // routes give.
      const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
      if (!scope.ok) {
        reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
        return { error: scope.error };
      }

      const [dashboardRow] = await db
        .select({ createdBy: dashboards.createdBy })
        .from(dashboards)
        .where(eq(dashboards.id, scope.dashboardId));

      if (dashboardRow?.createdBy !== req.authUser!.id) {
        reply.code(403);
        return {
          error: "dashboard_host_required",
          message: "Only this dashboard's host can rename it.",
        };
      }

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

      // archived_at joins the where clause so a stale tab can't rename a
      // dashboard that was deleted in the gap between the checks above and
      // here. Returning the updated row means no follow-up read.
      const updated = await db
        .update(dashboards)
        .set({ name: parsed.name })
        .where(and(eq(dashboards.id, scope.dashboardId), isNull(dashboards.archivedAt)))
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
      // dashboardAccessible, not a plain org check — an id the caller has no
      // reach into (another org's, no share grant) is indistinguishable from a
      // nonexistent one — 404 rather than 403, the same non-leaking convention
      // agents.ts uses. A soft-deleted dashboard is indistinguishable from both.
      .where(
        and(
          eq(dashboards.id, req.params.id),
          dashboardAccessible(orgId, req.authUser!.id),
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

    // Host-only, same resolveDashboardId -> createdBy === caller gate as the
    // member-role/permissions/rename routes — deleting isn't one of the 6
    // delegatable actions (@tollgate/shared's DASHBOARD_PERMISSION_ACTIONS doc
    // comment), so a shared caller (any role, even one with every toggle
    // enabled) can never trigger it. createdBy is immutable once a dashboard
    // exists, so checking it here rather than inside the transaction below
    // can't race: there's no window where this passes and the row's host
    // subsequently changes.
    const scope = await resolveDashboardId(req.params.id, orgId, userId);
    if (!scope.ok) {
      reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
      return { error: scope.error };
    }

    const [hostRow] = await db
      .select({ createdBy: dashboards.createdBy })
      .from(dashboards)
      .where(eq(dashboards.id, scope.dashboardId));

    if (hostRow?.createdBy !== userId) {
      reply.code(403);
      return {
        error: "dashboard_host_required",
        message: "Only this dashboard's host can delete it.",
      };
    }

    // One transaction, because a half-applied delete is the exact failure the
    // invariant forbids: a swept dashboard whose agents still hold live tokens.
    //
    // TRANSACTION TRAP: selectDashboardIfLive and resolveDashboardId both close
    // over the module-level `db`, so calling either in here would silently run
    // OUTSIDE this transaction. Everything below is inlined on `tx` for that
    // reason — don't refactor it back out into a helper that takes no tx.
    const result = await db.transaction(async (tx) => {
      // The host check above already authorized this delete; this statement's
      // job is just to atomically claim the row. `archived_at IS NULL` makes a
      // repeat delete match zero rows, which is what turns a double-click or a
      // two-tab race into a plain 404 (no new status code needed) — and the
      // FOR NO KEY UPDATE this takes is what a concurrent create or select then
      // has to queue behind.
      const swept = await tx
        .update(dashboards)
        .set({ archivedAt: new Date() })
        .where(and(eq(dashboards.id, scope.dashboardId), isNull(dashboards.archivedAt)))
        .returning({ id: dashboards.id, name: dashboards.name, orgId: dashboards.orgId });

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
      //
      // dashboard.orgId (the DELETED dashboard's own org), not the caller's
      // orgId — a shared (cross-org) caller deleting this dashboard must still
      // re-point the HOST org's own members to a survivor in THAT org, not
      // search the caller's unrelated org. A guest whose own active dashboard
      // was this one gets re-pointed too (the update below isn't org-filtered),
      // and if that lands them on a dashboard they in turn can't reach,
      // GET /v1/dashboards/active's own dashboardAccessible check hides it and
      // they read as "none selected" — safe, if not perfectly tailored to them.
      const survivors = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(and(eq(dashboards.orgId, dashboard.orgId), isNull(dashboards.archivedAt)))
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
      // join, dashboardAccessible check and archived filter as
      // GET /v1/dashboards/active.
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
            dashboardAccessible(orgId, userId),
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

  /**
   * The share dialog's list: who created this dashboard, plus everyone it's
   * been shared with. Gated by resolveDashboardId, which already carries the
   * cross-org dashboardAccessible check — anyone who can already reach this
   * dashboard (the host's own org, or an explicit dashboard_members grant)
   * can see who else has access.
   */
  app.get<{ Params: { id: string } }>("/v1/dashboards/:id/members", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
    if (!scope.ok) {
      reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
      return { error: scope.error };
    }

    // Neither query depends on the other's result, so they run concurrently
    // rather than as two sequential round trips.
    const [[row], memberRows] = await Promise.all([
      db
        .select({ createdBy: dashboards.createdBy })
        .from(dashboards)
        .where(eq(dashboards.id, scope.dashboardId)),
      db
        .select({
          userId: dashboardMembers.userId,
          addedAt: dashboardMembers.addedAt,
          role: dashboardMembers.role,
        })
        .from(dashboardMembers)
        .where(eq(dashboardMembers.dashboardId, scope.dashboardId))
        .orderBy(asc(dashboardMembers.addedAt)),
    ]);

    const [host, memberUsers] = await Promise.all([
      row?.createdBy != null ? findUserById(row.createdBy) : Promise.resolve(null),
      findUsersByIds(memberRows.map((m) => m.userId)),
    ]);

    // One batched lookup instead of one per member, then re-joined back onto
    // memberRows so the addedAt ordering above is preserved (a Map/array from
    // the batched call carries no ordering guarantee of its own).
    const usersById = new Map(memberUsers.map((u) => [u.id, u]));
    const members = memberRows
      .map((m) => {
        const user = usersById.get(m.userId);
        return user === undefined
          ? null
          : { ...user, addedAt: m.addedAt.toISOString(), role: m.role };
      })
      .filter((m) => m !== null);

    return { host, members };
  });

  /**
   * Grants one user access to this dashboard by email — the "add" half of the
   * share dialog. Looks the email up against Better Auth's own user table
   * (see findUserByEmail's doc comment): there's no email-sending integration
   * in this codebase, so an email with no account 404s rather than queuing an
   * invite. Idempotent: adding the same person twice is a 200, not a 409 —
   * matches this api's existing taste for "a repeat of an already-true action
   * succeeds" (see DELETE /v1/dashboards/:id's own repeat-delete-is-success
   * rule above).
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/v1/dashboards/:id/members",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
      if (!scope.ok) {
        reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
        return { error: scope.error };
      }

      // The 6th gated action (PLAN.md) — a cross-org member with
      // addDashboardMember switched off on their role can't invite anyone
      // else in. scope.orgId is the dashboard's own org; a same-org caller
      // (the host or their org-mate) always bypasses, matching the full
      // parity this route already gave them before per-role gating existed.
      if (
        !(await canPerformDashboardAction(
          scope.dashboardId,
          scope.orgId,
          orgId,
          req.authUser!.id,
          "addDashboardMember",
        ))
      ) {
        reply.code(403);
        return {
          error: "dashboard_permission_denied",
          message: "Your role doesn't allow adding members to this dashboard.",
        };
      }

      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : null;
      const rawEmail = body?.["email"];
      if (typeof rawEmail !== "string" || rawEmail.trim() === "") {
        reply.code(400);
        return { error: "invalid_body" };
      }

      // Better Auth lowercases every email at sign-up (its sign-up route calls
      // email.toLowerCase() before storing), so a lookup that doesn't do the
      // same falsely 404s a real account typed or pasted with any uppercase.
      const target = await findUserByEmail(rawEmail.trim().toLowerCase());
      if (target === null) {
        reply.code(404);
        return {
          error: "dashboard_member_user_not_found",
          message: "No Tollgate account found with that email.",
        };
      }

      const [dashboardRow] = await db
        .select({ createdBy: dashboards.createdBy })
        .from(dashboards)
        .where(eq(dashboards.id, scope.dashboardId));

      // The host already has full access via dashboardAccessible's org branch,
      // so inserting them into dashboard_members would be a second, redundant
      // grant — and unlike a repeat add of a real guest, the unique index
      // can't catch it (this would be their FIRST row, not a conflicting
      // one). Left unguarded, it duplicates the host in this same list AND
      // makes their own dashboard wrongly appear on their own
      // /dashboards/shared page (that route has no reason to exclude its own
      // createdBy from a membership-scoped query).
      if (dashboardRow?.createdBy === target.id) {
        reply.code(400);
        return {
          error: "dashboard_member_is_host",
          message: "You cannot add your own account to a dashboard.",
        };
      }

      // ON CONFLICT DO NOTHING makes a repeat add a no-op rather than a unique-
      // index violation. RETURNING covers the common, non-conflicting insert
      // in one round trip; a conflicting insert returns no row (Postgres
      // doesn't emit RETURNING for a row ON CONFLICT DO NOTHING skipped), so
      // the idempotent-repeat-add path falls back to a follow-up select.
      const [inserted] = await db
        .insert(dashboardMembers)
        .values({ dashboardId: scope.dashboardId, userId: target.id })
        .onConflictDoNothing({
          target: [dashboardMembers.dashboardId, dashboardMembers.userId],
        })
        .returning({ addedAt: dashboardMembers.addedAt, role: dashboardMembers.role });

      let addedAt = inserted?.addedAt;
      // Re-added via the idempotent-repeat-add path below, not read from the
      // conflicting insert — so this has to be the row's CURRENT role, not the
      // 'observer' default, in case the host already reassigned it before this
      // repeat add.
      let role = inserted?.role;
      if (addedAt === undefined || role === undefined) {
        const [existing] = await db
          .select({ addedAt: dashboardMembers.addedAt, role: dashboardMembers.role })
          .from(dashboardMembers)
          .where(
            and(
              eq(dashboardMembers.dashboardId, scope.dashboardId),
              eq(dashboardMembers.userId, target.id),
            ),
          );
        addedAt = existing?.addedAt ?? new Date();
        role = existing?.role ?? "observer";
      }

      reply.code(201);
      return { ...target, addedAt: addedAt.toISOString(), role };
    },
  );

  /**
   * Reassigns a member's role — host-only. This is a NEW authorization check,
   * not an extension of dashboardAccessible: every other route in this file
   * deliberately treats host and member as equal (see that predicate's doc
   * comment), but only the host may change who has which role. resolveDashboardId
   * still runs first so a non-host member (or org-mate) gets the same
   * dashboard_not_found 404 as anyone else for a dashboard they can't reach at
   * all — the host check below is a second, narrower gate on top of it, checked
   * before the role value so an unauthorized caller learns nothing about
   * whether their payload would otherwise have been valid.
   *
   * The host is never a dashboard_members row (see schema.ts), so PATCHing the
   * host's own id updates zero rows and falls into the same 404 branch as a
   * userId that was never a member — no separate "that's the host" check is
   * needed the way POST's add-by-email route needs one, because there the host
   * doesn't exist as a candidate row to accidentally match in the first place.
   */
  app.patch<{ Params: { id: string; userId: string }; Body: unknown }>(
    "/v1/dashboards/:id/members/:userId",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
      if (!scope.ok) {
        reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
        return { error: scope.error };
      }

      const [dashboardRow] = await db
        .select({ createdBy: dashboards.createdBy })
        .from(dashboards)
        .where(eq(dashboards.id, scope.dashboardId));

      if (dashboardRow?.createdBy !== req.authUser!.id) {
        reply.code(403);
        return {
          error: "dashboard_host_required",
          message: "Only this dashboard's host can change a member's role.",
        };
      }

      const body =
        typeof req.body === "object" && req.body !== null
          ? (req.body as Record<string, unknown>)
          : null;
      const rawRole = body?.["role"];
      if (!isDashboardMemberRole(rawRole)) {
        reply.code(400);
        return {
          error: "invalid_dashboard_member_role",
          message: "That's not a role this dashboard recognizes.",
        };
      }

      const [updated] = await db
        .update(dashboardMembers)
        .set({ role: rawRole })
        .where(
          and(
            eq(dashboardMembers.dashboardId, scope.dashboardId),
            eq(dashboardMembers.userId, req.params.userId),
          ),
        )
        .returning({ role: dashboardMembers.role });

      if (updated === undefined) {
        reply.code(404);
        return { error: "dashboard_member_not_found" };
      }

      return { userId: req.params.userId, role: updated.role };
    },
  );

  /**
   * The role-permission delegation popup's data source — host-only, same
   * resolveDashboardId -> createdBy === caller gate as the role/removal
   * routes above. Accepts any DashboardMemberRole, not just Observer — the
   * dropdown only offers Observer this round (PLAN.md's scope), but there's
   * no reason to reject Helper/Manager/Moderator/Admin at the api layer just
   * because the UI doesn't expose them yet.
   */
  app.get<{ Params: { id: string; role: string } }>(
    "/v1/dashboards/:id/permissions/:role",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
      if (!scope.ok) {
        reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
        return { error: scope.error };
      }

      const [dashboardRow] = await db
        .select({ createdBy: dashboards.createdBy })
        .from(dashboards)
        .where(eq(dashboards.id, scope.dashboardId));

      if (dashboardRow?.createdBy !== req.authUser!.id) {
        reply.code(403);
        return {
          error: "dashboard_host_required",
          message: "Only this dashboard's host can view role permissions.",
        };
      }

      if (!isDashboardMemberRole(req.params.role)) {
        reply.code(400);
        return {
          error: "invalid_dashboard_member_role",
          message: "That's not a role this dashboard recognizes.",
        };
      }

      const permissions = await fetchRolePermissions(scope.dashboardId, req.params.role);
      return { role: req.params.role, permissions };
    },
  );

  /**
   * Sets one or more of a role's 6 action toggles in a single call — the
   * delegation popup's save. Same host-only gate and any-role acceptance as
   * the GET above; the host check runs before the role/body are even parsed
   * so an unauthorized caller learns nothing about whether their payload
   * would otherwise have been valid, same ordering as the role-PATCH route.
   */
  app.patch<{ Params: { id: string; role: string }; Body: unknown }>(
    "/v1/dashboards/:id/permissions/:role",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
      if (!scope.ok) {
        reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
        return { error: scope.error };
      }

      const [dashboardRow] = await db
        .select({ createdBy: dashboards.createdBy })
        .from(dashboards)
        .where(eq(dashboards.id, scope.dashboardId));

      if (dashboardRow?.createdBy !== req.authUser!.id) {
        reply.code(403);
        return {
          error: "dashboard_host_required",
          message: "Only this dashboard's host can change role permissions.",
        };
      }

      if (!isDashboardMemberRole(req.params.role)) {
        reply.code(400);
        return {
          error: "invalid_dashboard_member_role",
          message: "That's not a role this dashboard recognizes.",
        };
      }

      const parsed = parsePermissionsBody(req.body);
      if (!parsed.ok) {
        reply.code(400);
        return { error: "invalid_body" };
      }

      const role = req.params.role;
      // Each (dashboardId, role, action) upsert targets a distinct row, so
      // these can run concurrently rather than as a sequential round trip per
      // toggle — at most 6 of them, and none conflicts with another.
      await Promise.all(
        Object.entries(parsed.permissions).map(([action, enabled]) =>
          db
            .insert(dashboardRolePermissions)
            .values({ dashboardId: scope.dashboardId, role, action: action as DashboardPermissionAction, enabled })
            .onConflictDoUpdate({
              target: [
                dashboardRolePermissions.dashboardId,
                dashboardRolePermissions.role,
                dashboardRolePermissions.action,
              ],
              set: { enabled },
            }),
        ),
      );

      const permissions = await fetchRolePermissions(scope.dashboardId, role);
      return { role, permissions };
    },
  );

  /**
   * Removes a member's access — host-only, same gate as the role PATCH above
   * (resolveDashboardId for scope/404, then createdBy === caller for 403,
   * before any further logic — see that route's doc comment for why the
   * ordering matters). A hard DELETE, not a soft one: unlike dashboards
   * itself, nothing references dashboard_members by FK (no agents, no
   * spend_events), so there's no billing history a hard delete could
   * destroy. That also means re-adding the same person later
   * (POST .../members, unchanged) inserts a genuinely fresh row — their role
   * resets to the schema default (observer) rather than remembering
   * whatever tier they held before removal.
   *
   * Same "the host is never a dashboard_members row" fact the PATCH route's
   * doc comment notes: there's no separate "can't remove the host" check
   * needed, because a userId equal to the host's id was never a candidate
   * row to begin with — it just falls into the same 404 as any other id
   * that was never a member.
   */
  app.delete<{ Params: { id: string; userId: string } }>(
    "/v1/dashboards/:id/members/:userId",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
      if (!scope.ok) {
        reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
        return { error: scope.error };
      }

      const [dashboardRow] = await db
        .select({ createdBy: dashboards.createdBy })
        .from(dashboards)
        .where(eq(dashboards.id, scope.dashboardId));

      if (dashboardRow?.createdBy !== req.authUser!.id) {
        reply.code(403);
        return {
          error: "dashboard_host_required",
          message: "Only this dashboard's host can remove a member.",
        };
      }

      const deleted = await db
        .delete(dashboardMembers)
        .where(
          and(
            eq(dashboardMembers.dashboardId, scope.dashboardId),
            eq(dashboardMembers.userId, req.params.userId),
          ),
        )
        .returning({ userId: dashboardMembers.userId });

      if (deleted.length === 0) {
        reply.code(404);
        return { error: "dashboard_member_not_found" };
      }

      return { userId: req.params.userId };
    },
  );

  /**
   * "What can I personally do here" — deliberately NOT host-gated, unlike GET
   * .../permissions/:role above (which reveals a specific ROLE's full
   * configuration and stays reserved for the host managing it). Any caller who
   * can already reach this dashboard is entitled to know their own standing on
   * it; this is what lets the frontend hide/disable actions a restricted
   * Observer's role doesn't currently allow, rather than only relying on the
   * 403 from actually trying (PLAN.md's frontend work).
   */
  app.get<{ Params: { id: string } }>("/v1/dashboards/:id/my-permissions", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const scope = await resolveDashboardId(req.params.id, orgId, req.authUser!.id);
    if (!scope.ok) {
      reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
      return { error: scope.error };
    }

    const entries = await Promise.all(
      DASHBOARD_PERMISSION_ACTIONS.map(
        async (action) =>
          [
            action,
            await canPerformDashboardAction(
              scope.dashboardId,
              scope.orgId,
              orgId,
              req.authUser!.id,
              action,
            ),
          ] as const,
      ),
    );

    return { permissions: Object.fromEntries(entries) as Record<DashboardPermissionAction, boolean> };
  });

  /**
   * Dashboards shared WITH the caller — the data source for /dashboards/shared
   * (claude-docs/PLANS.md's slice 5 left this page a static stub for exactly
   * this route to fill in later). Scoped by dashboard_members.user_id, not by
   * org: sharing is deliberately cross-org (see PLAN.md's D1), so this is a
   * different query shape from GET /v1/dashboards, not a variant of it.
   */
  app.get("/v1/dashboards/shared", async (req) => {
    const userId = req.authUser!.id;
    const rows = await db
      .select({
        id: dashboards.id,
        name: dashboards.name,
        createdAt: dashboards.createdAt,
        agentCount: sql<number>`count(${agents.id})`.mapWith(Number),
        liveAgentCount: sql<number>`count(${agents.id}) filter (where ${agents.status} in ('active', 'pending'))`.mapWith(
          Number,
        ),
      })
      .from(dashboardMembers)
      .innerJoin(
        dashboards,
        and(eq(dashboards.id, dashboardMembers.dashboardId), isNull(dashboards.archivedAt)),
      )
      .leftJoin(
        agents,
        and(eq(agents.dashboardId, dashboards.id), ne(agents.status, "archived")),
      )
      .where(eq(dashboardMembers.userId, userId))
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
}
