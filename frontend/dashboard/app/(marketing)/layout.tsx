/**
 * Route-group layout — scopes the dual-glow ambient background to the
 * marketing page only. The dashboard (app/agents, app/status) keeps
 * globals.css's single warm glow on `body`; this div's opaque
 * background-color paints over it for everything nested here.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="marketing-ambient-bg min-h-screen">{children}</div>;
}
