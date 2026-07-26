"use client";

import { TollgateLogo } from "@/components/marketing/tollgate-logo";
import { authClient } from "@/lib/auth-client";

/**
 * The marketing page's own bespoke nav — separate from components/main-nav.tsx,
 * which hides itself here (see ROUTES_WITHOUT_NAV). Existing users still need a
 * way back into the product: signed out shows Sign in + Request access;
 * signed in swaps both for a straight link to the real dashboard.
 */
export function StickyNav() {
  const { data: sessionData } = authClient.useSession();
  const signedIn = sessionData?.user != null;

  return (
    <nav
      className="sticky top-0 z-20 border-b backdrop-blur-[22px] backdrop-saturate-150"
      style={{ borderColor: "rgba(255,255,255,.07)", background: "rgba(18,18,24,.5)" }}
    >
      <div className="mx-auto flex max-w-[1200px] items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex items-center gap-2.5">
          <TollgateLogo className="size-5" />
          <span className="font-heading text-base font-semibold tracking-[0.02em]">TOLLGATE</span>
        </div>
        <div className="flex items-center gap-4">
          {signedIn ? (
            <a
              href="/agents"
              className="glass rounded-xl px-4 py-2.5 font-mono text-xs tracking-[0.12em] whitespace-nowrap uppercase transition-colors hover:bg-white/10"
            >
              Agent Dashboard
            </a>
          ) : (
            <>
              <a
                href="/sign-in"
                className="font-mono text-xs tracking-[0.12em] whitespace-nowrap uppercase transition-colors hover:text-brand"
                style={{ color: "var(--muted-ink)" }}
              >
                Sign in
              </a>
              <a
                href="#access"
                className="glass rounded-xl px-4 py-2.5 font-mono text-xs tracking-[0.12em] whitespace-nowrap uppercase transition-colors hover:bg-white/10"
              >
                Request access
              </a>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
