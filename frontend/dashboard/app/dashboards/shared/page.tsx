import { SharedDashboards } from "@/components/shared-dashboards";

// Server component delegating to one client(-shaped) component — same
// pattern as app/dashboards/page.tsx, for the same RSC-manifest-bug-safety
// reason (see that file's comment), kept consistent with its sibling even
// though SharedDashboards is simple enough it may not need "use client" at
// all (claude-docs/PLANS.md, Slice 5, task 4 note).
export default function SharedDashboardsPage() {
  return <SharedDashboards />;
}
