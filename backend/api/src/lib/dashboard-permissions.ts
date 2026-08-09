import { and, eq } from "drizzle-orm";
import { DASHBOARD_PERMISSION_ACTIONS, type DashboardMemberRole, type DashboardPermissionAction } from "@tollgate/shared";
import { db } from "../db/client.js";
import { dashboardMembers, dashboardRolePermissions } from "../db/schema.js";

/**
 * Whether `userId` may perform `action` on a dashboard that resolveDashboardId
 * (or agents.ts's findAgent) already confirmed they can REACH. Reaching a
 * dashboard and being permitted to act on it are now different questions —
 * this answers the second one, for the 6 actions PLAN.md gates.
 *
 * `dashboardOrgId` is the dashboard's OWN org, `callerOrgId` the caller's own
 * active org (see resolveDashboardId's DashboardScopeResult doc for why those
 * can differ for a shared caller). When they're the SAME org, the caller is
 * either the dashboard's creator or one of their org-mates, and gets the same
 * full-parity bypass the dashboard already gave them before this feature
 * existed — dashboard_members rows have never governed same-org access, only
 * cross-org share grants have (see schema.ts's dashboardMembers doc comment).
 * Only a cross-org caller, who reached this dashboard through an explicit
 * dashboard_members grant, is ever actually gated by a role's toggles.
 */
export async function canPerformDashboardAction(
  dashboardId: string,
  dashboardOrgId: string,
  callerOrgId: string,
  userId: string,
  action: DashboardPermissionAction,
): Promise<boolean> {
  if (dashboardOrgId === callerOrgId) return true;

  const [member] = await db
    .select({ role: dashboardMembers.role })
    .from(dashboardMembers)
    .where(and(eq(dashboardMembers.dashboardId, dashboardId), eq(dashboardMembers.userId, userId)));

  // dashboardAccessible's cross-org branch is an EXISTS on this exact row, so
  // reaching here with no row would mean the scope check that got us this far
  // already disagreed with this query — defend with the safe default (no
  // permissions) rather than assume it can't happen.
  const role: DashboardMemberRole = member?.role ?? "observer";

  const [permission] = await db
    .select({ enabled: dashboardRolePermissions.enabled })
    .from(dashboardRolePermissions)
    .where(
      and(
        eq(dashboardRolePermissions.dashboardId, dashboardId),
        eq(dashboardRolePermissions.role, role),
        eq(dashboardRolePermissions.action, action),
      ),
    );

  return permission?.enabled ?? false;
}

/** Every gated action's current on/off state for one (dashboard, role) pair —
 *  the delegate-permissions popup's GET/PATCH response shape. A combination
 *  with no row defaults to false, same as canPerformDashboardAction above. */
export async function fetchRolePermissions(
  dashboardId: string,
  role: DashboardMemberRole,
): Promise<Record<DashboardPermissionAction, boolean>> {
  const rows = await db
    .select({ action: dashboardRolePermissions.action, enabled: dashboardRolePermissions.enabled })
    .from(dashboardRolePermissions)
    .where(
      and(eq(dashboardRolePermissions.dashboardId, dashboardId), eq(dashboardRolePermissions.role, role)),
    );

  const byAction = new Map(rows.map((row) => [row.action, row.enabled]));
  const result = {} as Record<DashboardPermissionAction, boolean>;
  for (const action of DASHBOARD_PERMISSION_ACTIONS) {
    result[action] = byAction.get(action) ?? false;
  }
  return result;
}
