"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * The landing page's one nav — main-nav.tsx hides itself on "/" (see its
 * NO_NAV_ROUTES) so this is the only nav rendered here. A floating pill
 * ("Dynamic Island" shape) instead of the previous full-width sticky bar:
 * fixed, centred, clear of both edges, laid out left to right as
 * Name | Get started | See it live | Dashboard Panel | Sign in + Sign out
 * (or email + Sign out, once signed in) — same account-cluster shape as
 * main-nav.tsx's.
 *
 * Get started / See it live / Dashboard Panel are plain white text
 * (.mk-nav-link) — no pill. Sign in keeps the solid pill (.mk-btn-primary)
 * as the one real call to action in the bar.
 *
 * "Dashboard Panel" is always present, not conditional on sign-in — /agents
 * itself is what decides whether a signed-out visitor gets bounced to
 * sign-in; the island doesn't gate it.
 */
const PRIMARY = "mk-btn mk-btn-primary mk-btn-compact whitespace-nowrap";
const COMPACT = "mk-btn mk-btn-compact whitespace-nowrap";

export function StickyNav() {
  const router = useRouter();
  const { data: sessionData } = authClient.useSession();
  const email = sessionData?.user?.email ?? null;

  async function handleSignOut() {
    await authClient.signOut();
    router.push("/sign-in");
    router.refresh();
  }

  return (
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

      <a href="#contact" className="mk-nav-link">
        Get started
      </a>
      <a href="#demo" className="mk-nav-link">
        See it live
      </a>
      <a href="/agents" className="mk-nav-link">
        Dashboard Panel
      </a>

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
        <a href="/sign-in" className={PRIMARY}>
          Sign in
        </a>
      )}
    </nav>
  );
}
