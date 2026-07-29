/**
 * Route-group layout — scopes the dual-glow ambient background to the
 * marketing page only. The dashboard (app/agents, app/status) keeps
 * globals.css's single warm glow on `body`; this div's opaque
 * background-color paints over it for everything nested here.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // min-h-[100dvh], not min-h-screen: `vh` counts the mobile Safari address
  // bar as viewport, so the ambient background stops short of the fold as the
  // bar collapses on scroll.
  return <div className="marketing-ambient-bg min-h-[100dvh]">{children}</div>;
}
