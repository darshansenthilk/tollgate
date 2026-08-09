// Slice 5 (claude-docs/PLANS.md, D9): deliberately a plain SERVER component
// rather than a "use client" layout — same bundler-safety reasoning as
// app/dashboards/page.tsx's own comment about the RSC-manifest bug that once
// broke /dashboards. Owns the <main> max-w-5xl shell that used to live in
// ManageDashboards directly; both /dashboards and /dashboards/shared now
// share it.
//
// DashboardsNav itself no longer renders here — it sits below each page's
// own subtitle (manage-dashboards.tsx, shared-dashboards.tsx) instead, which
// this layout has no visibility into (children is opaque JSX), so each page
// renders its own copy right after its <header>.
export default function DashboardsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <main className="mx-auto max-w-5xl px-6 py-12">{children}</main>;
}
