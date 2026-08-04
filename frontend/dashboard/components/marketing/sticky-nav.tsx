"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

/**
 * The landing page's one nav — main-nav.tsx hides itself on "/" (see its
 * NO_NAV_ROUTES) so this is the only nav rendered here. A floating pill
 * ("Dynamic Island" shape) instead of the previous full-width sticky bar:
 * fixed, centred, clear of both edges.
 *
 * Link set DELIBERATELY MIRRORS access-cta-section.tsx's footer "Product"
 * column (same href/label pairs, same order) rather than its own curated
 * subset — previously this nav carried only "See it live" / "Talk to us" and
 * an explicit comment said self-serve signup was intentionally not called
 * out anywhere on the page. That's been reversed: "Self-host it" (→
 * /get-started) now has equal billing with the sales-assisted "Talk to us"
 * path, on purpose, not as an oversight. If the footer's column changes,
 * update both places — there's no shared constant (yet) because the footer's
 * item shape (heading + links) doesn't match this flat list, and one file
 * importing a slice of the other's data for two names felt like more
 * indirection than the duplication it would save.
 *
 * All hrefs are absolute ("/#demo", not "#demo") — this nav is also rendered
 * on /security and /get-started (main-nav.tsx's NO_NAV_ROUTES excludes all
 * three), where a bare hash would resolve against whichever page is current
 * instead of returning to the landing page's sections.
 *
 * "Dashboard Panel" (→ /agents) only appears once signed in — a signed-out
 * visitor has nowhere useful to land there (middleware would just bounce
 * them to /sign-in), so the link stays hidden until `email` is non-null.
 */
const NAV_LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#demo", label: "Live demo" },
  { href: "/security", label: "Security" },
  { href: "/get-started", label: "Self-host it" },
  { href: "/#contact", label: "Talk to us" },
];

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
      <a href="/" className="mk-nav-logo flex shrink-0 items-center pr-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- tiny fixed-size
            wordmark; next/image's overhead isn't worth it here. The SVG
            itself spells out "tollgate.", so it's the sole label here — no
            adjacent text span. */}
        <img src="/logo.svg" alt="Tollgate" className="h-[13.33px] w-auto shrink-0" />
      </a>

      <div className="mk-island-sep" aria-hidden />

      {NAV_LINKS.map((link) => (
        <a key={link.href} href={link.href} className="mk-nav-link">
          {link.label}
        </a>
      ))}
      {email !== null && (
        <a href="/agents" className="mk-nav-link">
          Dashboard Panel
        </a>
      )}

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
