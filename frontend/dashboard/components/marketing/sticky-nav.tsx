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
 * the same primary-CTA recipe as the hero/contact buttons (see
 * hero-section.tsx), just with a permanent (not hover-only) shadow and a
 * sentence-case bold sans instead of those buttons' mono/uppercase style.
 */
const NAV_BUTTON_CLASSES = "mk-btn mk-btn-primary !h-8 !px-4 !text-[13px]";

export function StickyNav() {
  const { data: sessionData } = authClient.useSession();
  const signedIn = sessionData?.user != null;

  return (
    <nav
      className="sticky top-0 z-20 border-b backdrop-blur-[22px] backdrop-saturate-150"
      style={{ borderColor: "var(--mk-line)", background: "rgba(0,0,0,.6)" }}
    >
      <div className="flex items-center justify-between px-5 py-4 sm:px-8 lg:px-12">
        <a href="/" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size
              decorative mark; next/image's overhead isn't worth it here. */}
          <img
            src="/logo.svg"
            alt=""
            aria-hidden
            className="size-5 shrink-0 rounded-sm"
          />
          <span className="text-[15px] font-medium" style={{ color: "var(--mk-ink)" }}>
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
