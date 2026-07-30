"use client";

import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { LINKS } from "@/components/nav-links";

/**
 * Dashboard-wide nav — one floating island (components/marketing/sticky-nav.tsx's
 * glass-pill shape), holding the wordmark, the four route links, and the
 * account cluster together, left to right.
 *
 * The route links reuse .mk-nav-link — the exact same class, spacing (the
 * island's own `gap`), and coral hover the landing page's Get started/See it
 * live/Dashboard Panel already use — plus one addition: whichever link
 * matches the current route also gets .mk-nav-link-current (coral, steady
 * rather than only on hover), since these four ARE the page you're on among
 * siblings, unlike the landing page's equal-weight action links. No pill,
 * no scroll-tracking, no custom centring — just `pathname === link.href`.
 */

// /sign-in keeps this nav (a signed-out visitor still gets a way back to
// the four dashboard routes without needing to already be authenticated),
// but suppresses its own account cluster — see the render below. /sign-up
// and /enroll-2fa (the post-sign-up 2FA opt-in, PLAN.md §5, one-time
// onboarding) stay excluded, and "/" keeps using its own merged nav
// (components/marketing/sticky-nav.tsx) instead of this one.
const NO_NAV_ROUTES = new Set(["/sign-up", "/enroll-2fa", "/"]);
const COMPACT = "mk-btn mk-btn-compact whitespace-nowrap";

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: sessionData } = authClient.useSession();

  if (NO_NAV_ROUTES.has(pathname)) return null;

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  const email = sessionData?.user?.email ?? null;

  return (
    <>
      <nav className="mk-island" aria-label="Primary">
        <a href="/" className="mk-nav-logo flex shrink-0 items-center gap-2 pr-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size
              decorative mark; next/image's overhead isn't worth it here. */}
          <img src="/logo.svg" alt="" aria-hidden className="size-5 shrink-0 rounded-sm" />
          <span className="text-[15px] font-medium whitespace-nowrap" style={{ color: "var(--mk-ink)" }}>
            Tollgate
          </span>
        </a>

        <div className="mk-island-sep" aria-hidden />

        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <a
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={active ? "mk-nav-link mk-nav-link-current" : "mk-nav-link"}
            >
              {link.label}
            </a>
          );
        })}

        {/* No account cluster at all on /sign-in itself: middleware already
            redirects a signed-in visitor away from this route, so email
            would never render here — only the "Sign in" pill would, which
            is redundant on the page that already is the sign-in form. */}
        {pathname !== "/sign-in" && (
          <>
            <div className="mk-island-sep" aria-hidden />

            {email !== null ? (
              <>
                <span
                  className="shrink-0 px-1 text-[13px] lowercase"
                  style={{ color: "var(--muted-ink)" }}
                >
                  {email}
                </span>
                <button type="button" onClick={handleSignOut} className={`${COMPACT} mk-btn-secondary`}>
                  Sign out
                </button>
              </>
            ) : (
              <a href="/sign-in" className={`${COMPACT} mk-btn-primary`}>
                Sign in
              </a>
            )}
          </>
        )}
      </nav>

      {/* Clears the fixed island above (it's out of document flow, so
          without this the page content underneath would start right at the
          top of the viewport). Height covers its max top offset (20px) plus
          its own height (~44px) with margin to spare. */}
      <div aria-hidden style={{ height: 96 }} />
    </>
  );
}
