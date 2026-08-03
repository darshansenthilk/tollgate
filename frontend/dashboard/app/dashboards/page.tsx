import { ManageDashboards } from "@/components/manage-dashboards";

// Deliberately a SERVER component that renders one client component, rather
// than a "use client" page like /agents. Next 15.5's RSC bundler fails to emit
// a client-manifest entry for this particular page when the page module itself
// is the client boundary and imports both CreateDashboardDialog and
// DashboardTile — `next build` then dies prerendering /dashboards with
// "Could not find the module app/dashboards/page.tsx#default in the React
// Client Manifest" (it calls itself a bundler bug, and neither component is at
// fault: each builds fine alone, and so does a bare ui/dialog alongside
// DashboardTile). Keeping the boundary one level down in ManageDashboards
// sidesteps it without giving up static prerendering of the route shell.
export default function ManageDashboardsPage() {
  return <ManageDashboards />;
}
