"use client";

import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { LINKS } from "@/components/nav-links";

/**
 * Dashboard-wide nav — one floating island (components/marketing/sticky-nav.tsx's
 * glass-pill shape), holding the wordmark, a middle link cluster, and the
 * account cluster together, left to right.
 *
 * The middle cluster is one of two things depending on route:
 *  - Everywhere except /sign-in: the four dashboard routes (LINKS), each
 *    reusing .mk-nav-link plus .mk-nav-link-current on whichever matches
 *    the current route (coral, steady rather than only on hover) — these
 *    four ARE the page you're on among siblings.
 *  - On /sign-in specifically: the same two links the landing page's nav
 *    shows (See it live, Talk to us) instead — a signed-out visitor here
 *    isn't on any of the four dashboard routes yet, so showing them as
 *    live navigation targets doesn't make sense; the landing page's own
 *    anchors do.
 * No pill, no scroll-tracking, no custom centring for either — just
 * `pathname === link.href` for the dashboard-route case.
 *
 * The account cluster (email + Sign out, or the Sign in pill) is
 * unconditional — same on every route this nav renders on, /sign-in
 * included.
 */

// /sign-up and /enroll-2fa (the post-sign-up 2FA opt-in, PLAN.md §5,
// one-time onboarding) stay excluded, and "/" and "/security" keep using
// their own merged nav (components/marketing/sticky-nav.tsx) instead of
// this one — both live in the (marketing) route group.
const NO_NAV_ROUTES = new Set(["/sign-up", "/enroll-2fa", "/", "/security"]);
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

        {pathname === "/sign-in" ? (
          <>
            <a href="/#demo" className="mk-nav-link">
              See it live
            </a>
            <a href="/#contact" className="mk-nav-link">
              Talk to us
            </a>
          </>
        ) : (
          LINKS.map((link) => {
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
          })
        )}

        <div className="mk-island-sep" aria-hidden />

        {email !== null ? (
          <>
            <span className="shrink-0 px-1 text-[13px] lowercase" style={{ color: "var(--muted-ink)" }}>
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
      </nav>

      {/* Clears the fixed island above (it's out of document flow, so
          without this the page content underneath would start right at the
          top of the viewport). Height covers its max top offset (20px) plus
          its own height (~44px) with margin to spare. */}
      <div aria-hidden style={{ height: 96 }} />
    </>
  );
}
