import { DashboardsNav } from "@/components/dashboards-nav";

/**
 * Slice 5 (claude-docs/PLANS.md, D7): a deliberate UI stub. `dashboards` has
 * no per-user owner/creator column, so there is no data-model concept of
 * "shared with me" to query yet — this always renders the empty state, with
 * no fetch, no loading branch, and no error branch. When dashboard_members +
 * permission tiers land (PLANS.md candidate 2), this component is where the
 * real fetch and populated-grid branches get added.
 */
export function SharedDashboards() {
  return (
    <div>
      <header className="mb-6 pl-4 text-left">
        <h1 className="text-[2.1rem] font-medium tracking-[-0.02em]">
          Shared Dashboards
        </h1>
        <p className="text-sm text-muted-foreground">
          Dashboards other members have shared with you.
        </p>
      </header>

      {/* Below the subtitle, not above the header — mb-6 pl-4 mirrors the
          header's own spacing/indent, same placement as manage-dashboards.tsx. */}
      <div className="mb-6 pl-4">
        <DashboardsNav />
      </div>

      {/* pl-4 matches the header's own pl-4 above so this lines up under the
          subtitle, rather than the div's unindented left edge. */}
      <p className="pl-4 text-sm" style={{ color: "var(--muted-foreground)" }}>
        No dashboards have been shared with you yet.
      </p>
    </div>
  );
}
