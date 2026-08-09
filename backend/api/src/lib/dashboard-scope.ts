import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../db/client.js";
import { dashboardMembers, dashboards } from "../db/schema.js";

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
  | {
      ok: true;
      dashboardId: string;
      /** The dashboard's OWN org — its host's org, not necessarily the
       *  caller's. A shared (cross-org) caller can resolve a dashboard whose
       *  orgId differs from their own req.activeOrgId, and callers that then
       *  need to stamp or check an org (creating an agent, validating a BYOK
       *  key) must use THIS value, not the caller's, or they'd scope against
       *  the wrong org's data. */
      orgId: string;
    }
  | { ok: false; error: "dashboard_id_required" | "dashboard_not_found" };

/**
 * "Can `userId` reach this dashboard row" — true for the org that owns it
 * (the host's org) OR for anyone explicitly granted access via
 * dashboard_members (PLAN.md's dashboard sharing: deliberately cross-org, see
 * its D1). This is the ONE place that predicate is spelled out; every
 * dashboard-scoped route builds its authorization check by AND-ing this with
 * `isNull(dashboards.archivedAt)` rather than repeating the OR EXISTS inline,
 * so a shared user gets identical treatment everywhere by construction —
 * getting this one fragment right matters more than getting any single call
 * site right.
 *
 * Callers still keep `eq(dashboards.orgId, orgId)` OUT of their own `and()` —
 * this fragment already covers the org-match branch internally, so adding it
 * again outside would just be redundant, not stricter.
 */
export function dashboardAccessible(orgId: string, userId: string): SQL {
  return sql`(${dashboards.orgId} = ${orgId} or exists (
    select 1 from ${dashboardMembers}
    where ${dashboardMembers.dashboardId} = ${dashboards.id}
      and ${dashboardMembers.userId} = ${userId}
  ))`;
}

/**
 * Validates a caller-supplied dashboard id against the caller's own org OR an
 * explicit share grant (see dashboardAccessible above).
 *
 * The two failure modes are deliberately different: an ABSENT id is the caller
 * forgetting a required parameter (400 — tell them plainly), while a present but
 * unusable id is 404 whether it's malformed, nonexistent, or simply someone
 * else's org's with no share grant. Collapsing those three into one answer is
 * what stops this endpoint being used to probe which dashboard ids exist — the
 * same non-leaking convention routes/agents.ts uses for agent ids.
 *
 * A SOFT-DELETED dashboard joins that 404 set (archived_at IS NOT NULL) for a
 * shared user exactly as it does for the host — sharing doesn't create a
 * second door into a dashboard the invariant says is gone. This one predicate
 * is the sole gate for GET /v1/agents, POST /v1/agents and GET /v1/activity,
 * so it is what makes a deleted dashboard's agents and activity unreachable —
 * and `dashboard_not_found` is exactly the signal the frontend's gone-paths
 * key on. It is NOT sufficient for POST /v1/agents, though: that route runs
 * this check at statement 1 of several, and a delete committing in the gap
 * would still let the insert through. See the conditional INSERT … WHERE
 * EXISTS in routes/agents.ts for the half this can't cover.
 */
export async function resolveDashboardId(
  raw: unknown,
  orgId: string,
  userId: string,
): Promise<DashboardScopeResult> {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: false, error: "dashboard_id_required" };
  }
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    return { ok: false, error: "dashboard_not_found" };
  }

  const rows = await db
    .select({ id: dashboards.id, orgId: dashboards.orgId })
    .from(dashboards)
    .where(
      and(
        eq(dashboards.id, raw),
        dashboardAccessible(orgId, userId),
        isNull(dashboards.archivedAt),
      ),
    );

  if (rows[0] === undefined) return { ok: false, error: "dashboard_not_found" };
  return { ok: true, dashboardId: rows[0].id, orgId: rows[0].orgId };
}
