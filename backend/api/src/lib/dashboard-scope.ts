import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { dashboards } from "../db/schema.js";

/**
 * Resolving "which dashboard is this request about", shared by every route that
 * scopes its data to one.
 *
 * Dashboards are independent of each other, so /v1/agents and /v1/activity are
 * both answers to "what's in dashboard X" rather than "what's in my org". X
 * arrives as client input, which makes this the authorization check for it —
 * hence the org scoping below, and hence one implementation instead of three.
 *
 * routes/dashboards.ts previously carried a local copy of UUID_RE with a comment
 * saying to lift it into a shared guard "if a third route needs it". This is
 * that guard; all three now import from here.
 */

/**
 * `dashboards.id` is a uuid column, so a malformed id reaches Postgres as a cast
 * error (22P02) rather than zero rows — and with no setErrorHandler registered,
 * Fastify would answer 500 with the driver's raw message instead of the 404
 * these routes promise. Screening the shape first also keeps "not a dashboard
 * id" and "not your dashboard" indistinguishable, which is the point of 404ing.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DashboardScopeResult =
  | { ok: true; dashboardId: string }
  | { ok: false; error: "dashboard_id_required" | "dashboard_not_found" };

/**
 * Validates a caller-supplied dashboard id against the caller's own org.
 *
 * The two failure modes are deliberately different: an ABSENT id is the caller
 * forgetting a required parameter (400 — tell them plainly), while a present but
 * unusable id is 404 whether it's malformed, nonexistent, or simply someone
 * else's. Collapsing those three into one answer is what stops this endpoint
 * being used to probe which dashboard ids exist — the same non-leaking
 * convention routes/agents.ts uses for agent ids.
 *
 * A SOFT-DELETED dashboard joins that 404 set (archived_at IS NOT NULL). This
 * one predicate is the sole gate for GET /v1/agents, POST /v1/agents and
 * GET /v1/activity, so it is what makes a deleted dashboard's agents and
 * activity unreachable — and `dashboard_not_found` is exactly the signal the
 * frontend's gone-paths key on. It is NOT sufficient for POST /v1/agents,
 * though: that route runs this check at statement 1 of several, and a delete
 * committing in the gap would still let the insert through. See the conditional
 * INSERT … WHERE EXISTS in routes/agents.ts for the half this can't cover.
 */
export async function resolveDashboardId(
  raw: unknown,
  orgId: string,
): Promise<DashboardScopeResult> {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, error: "dashboard_id_required" };
  }
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    return { ok: false, error: "dashboard_not_found" };
  }

  const rows = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    // The org check IS the authorization: another org's dashboard resolves to
    // nothing here, so its agents are unreachable no matter what id is sent.
    // The archived_at check is the same idea applied to time rather than
    // ownership: a deleted dashboard resolves to nothing either.
    .where(
      and(
        eq(dashboards.id, raw),
        eq(dashboards.orgId, orgId),
        isNull(dashboards.archivedAt),
      ),
    );

  if (rows[0] === undefined) return { ok: false, error: "dashboard_not_found" };
  return { ok: true, dashboardId: rows[0].id };
}
