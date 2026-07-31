/**
 * Route-group layout — scopes the dual-glow ambient background to the
 * marketing page only. The dashboard (app/agents, app/status) keeps
 * globals.css's single warm glow on `body`; this div's opaque
 * background-color paints over it for everything nested here.
 *
 * The "dark" class here is deliberate, not a leftover: the dashboard now has
 * a real light/dark toggle (see components/theme-toggle.tsx), but the
 * marketing page is the public brand face and stays dark regardless of
 * whatever theme a signed-in visitor picked for the dashboard. Every flat
 * custom token (--mk-ground, --bg, --ink, etc.) has a light value in :root
 * now that light mode exists — re-applying .dark on this wrapper
 * re-establishes the dark values for this whole subtree via normal CSS
 * custom-property inheritance, no matter what class <html> carries above it.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // min-h-[100dvh], not min-h-screen: `vh` counts the mobile Safari address
  // bar as viewport, so the ambient background stops short of the fold as the
  // bar collapses on scroll.
  return <div className="dark marketing-ambient-bg min-h-[100dvh]">{children}</div>;
}
