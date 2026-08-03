import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { activeDashboards, dashboards } from "../db/schema.js";

/**
 * Dashboards: the org-owned containers `/dashboards` lists as tiles, plus the
 * per-user record of which one is currently open (see the schema.ts section
 * comment for why ownership and selection live in separate tables).
 *
 * Every route is gated by the requireAuth preHandler (index.ts), which 401s
 * anonymous callers and stamps req.activeOrgId / req.authUser — so the `!`
 * below is safe, and org scoping (cross-account isolation) hangs off
 * activeOrgId, never client input. Same pattern as routes/agents.ts.
 */

/** Wire shape for a dashboard, shared by all five routes (every one of them
 *  builds it through toJson below, so a new field can't miss an endpoint). */
interface DashboardJson {
  id: string;
  name: string;
  createdAt: string;
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

/**
 * `dashboards.id` is a uuid column, so a malformed id reaches Postgres as a
 * cast error (22P02) rather than zero rows — and with no setErrorHandler
 * registered, Fastify would answer 500 with the driver's message instead of the
 * 404 this route promises. Screening the shape first keeps "not a dashboard id"
 * and "not your dashboard" indistinguishable, which is the whole point of 404ing
 * here. routes/agents.ts has the same gap on its own :id routes; worth lifting
 * this into a shared guard (or a params schema) if a third route needs it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toJson(row: { id: string; name: string; createdAt: Date }): DashboardJson {
  return { id: row.id, name: row.name, createdAt: row.createdAt.toISOString() };
}

/** Point the caller's single active_dashboards row at `dashboardId`, creating
 *  it on first selection. One row per user, so the upsert targets user_id. */
async function setActiveDashboard(userId: string, dashboardId: string): Promise<void> {
  await db
    .insert(activeDashboards)
    .values({ userId, dashboardId })
    .onConflictDoUpdate({
      target: activeDashboards.userId,
      set: { dashboardId, updatedAt: new Date() },
    });
}

export function registerDashboardRoutes(app: FastifyInstance): void {
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
    // /agents afterwards, which reads this selection back.
    await setActiveDashboard(req.authUser!.id, created.id);

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
      })
      .from(dashboards)
      // Scoped to the caller's org so one account never sees another's
      // dashboards. Creation order, so tiles append rather than reshuffle (DE7).
      .where(eq(dashboards.orgId, orgId))
      .orderBy(asc(dashboards.createdAt));

    return rows.map(toJson);
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
      .where(and(eq(activeDashboards.userId, req.authUser!.id), eq(dashboards.orgId, orgId)));

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
      // route). Returning the updated row means no follow-up read.
      const updated = await db
        .update(dashboards)
        .set({ name: parsed.name })
        .where(and(eq(dashboards.id, req.params.id), eq(dashboards.orgId, orgId)))
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
      // one — 404 rather than 403, the same non-leaking convention agents.ts uses.
      .where(and(eq(dashboards.id, req.params.id), eq(dashboards.orgId, orgId)));

    const dashboard = rows[0];
    if (dashboard === undefined) {
      reply.code(404);
      return { error: "dashboard_not_found" };
    }

    await setActiveDashboard(req.authUser!.id, dashboard.id);

    return toJson(dashboard);
  });
}
