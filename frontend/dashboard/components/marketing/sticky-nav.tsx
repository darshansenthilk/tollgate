"use client";

import { authClient } from "@/lib/auth-client";

/**
 * The landing page's one navbar — components/main-nav.tsx hides itself on "/"
 * (see its NO_NAV_ROUTES) so this is the only nav rendered here. Signed out:
 * "Sign in". Signed in: a single "Dashboard Panel" link into the real
 * dashboard — deliberately not the dashboard nav's own links/labels
 * (Agent Dashboard / System status / Settings / Sign out from main-nav.tsx),
 * which stay specific to the authenticated app shell.
 *
 * Both buttons share one solid-fill treatment: bg-brand + near-black text is
 * the same primary-CTA recipe as the hero/waitlist buttons (see
 * hero-section.tsx), just with a permanent (not hover-only) shadow and a
 * sentence-case bold sans instead of those buttons' mono/uppercase style.
 */
const NAV_BUTTON_CLASSES =
  "rounded-xl bg-brand px-4 py-2.5 font-sans text-xs font-bold whitespace-nowrap text-[#0b0b0d] shadow-[0_10px_30px_rgba(0,0,0,0.35),0_6px_16px_rgba(255,74,61,0.3)] transition-[background-color,box-shadow] hover:bg-[#ff5f53] hover:shadow-[0_12px_34px_rgba(0,0,0,0.4),0_8px_20px_rgba(255,74,61,0.4)]";

export function StickyNav() {
  const { data: sessionData } = authClient.useSession();
  const signedIn = sessionData?.user != null;

  return (
    <nav
      className="sticky top-0 z-20 border-b backdrop-blur-[22px] backdrop-saturate-150"
      style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(18,18,24,.5)" }}
    >
      <div className="flex items-center justify-between px-5 py-4 sm:px-8">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size
              decorative mark; next/image's overhead isn't worth it here. */}
          <img
            src="/logo.svg"
            alt=""
            aria-hidden
            className="size-5 shrink-0 rounded-sm"
          />
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-foreground/90">
            Tollgate
          </span>
        </a>
        <div className="flex items-center gap-4">
          {signedIn ? (
            <a href="/agents" className={NAV_BUTTON_CLASSES}>
              Dashboard Panel
            </a>
          ) : (
            <a href="/sign-in" className={NAV_BUTTON_CLASSES}>
              Sign in
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
