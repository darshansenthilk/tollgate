"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { LINKS } from "@/components/nav-links";

/**
 * Dashboard-wide nav — one floating island (components/marketing/sticky-nav.tsx's
 * glass-pill shape), holding the wordmark, the route carousel, and the
 * account cluster together, left to right.
 *
 * The wordmark and the email/Sign out cluster are plain siblings of the tab
 * carousel, not inside it — they can never end up under the carousel's
 * pill, and the carousel's own scroll (see below) never touches them.
 *
 * The carousel has a fixed centre point (the middle of the three visible
 * slots); the four route labels scroll underneath it. No pill or
 * background marks that centre — same "plain text, no pill" treatment as
 * the landing page's nav — but unlike the landing page's equal-weight
 * action links, these four labels ARE the same page's route among
 * siblings, so whichever one is currently centred still needs to read as
 * "this is where you are": it turns brand-coloured (.mk-tab-current) while
 * the others stay plain white. Native CSS scroll snap
 * (`scroll-snap-type: x mandatory` on .mk-tabs) handles the "settle
 * smoothly onto the nearest label" motion; there's no JS-driven snap
 * animation to get right or wrong.
 *
 * Scrolling never navigates — it only changes which label is centred and
 * therefore coloured. Navigation happens exactly the way clicking any link
 * normally does: each label is a real `<a href>`.
 */

const NO_NAV_ROUTES = new Set(["/sign-in", "/sign-up", "/enroll-2fa", "/"]);
const COMPACT = "mk-btn mk-btn-compact whitespace-nowrap";

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: sessionData } = authClient.useSession();

  const hidden = NO_NAV_ROUTES.has(pathname);

  const scrollRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const rafId = useRef<number | null>(null);
  const mountedRef = useRef(false);

  const [centerIndex, setCenterIndex] = useState(() =>
    Math.max(0, LINKS.findIndex((l) => l.href === pathname)),
  );

  /** Which label is currently nearest the strip's fixed centre point —
   *  pure geometry, used to decide which single label gets recoloured to
   *  the brand colour. */
  const findNearestIndex = useCallback((): number => {
    const container = scrollRef.current;
    if (container === null) return 0;
    const containerCenter = container.getBoundingClientRect().left + container.clientWidth / 2;
    let nearest = 0;
    let nearestDist = Infinity;
    tabRefs.current.forEach((el, i) => {
      if (el === null) return;
      const r = el.getBoundingClientRect();
      const dist = Math.abs(r.left + r.width / 2 - containerCenter);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = i;
      }
    });
    return nearest;
  }, []);

  // Scrolls the given label to the strip's centre. Instant on first mount
  // (arriving at a page shouldn't animate its own nav into place), smooth
  // afterwards, and instant either way under reduced motion.
  const centerTab = useCallback((index: number, opts?: { instant?: boolean }) => {
    const container = scrollRef.current;
    const el = tabRefs.current[index];
    if (container === null || el === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const left = el.offsetLeft + el.offsetWidth / 2 - container.clientWidth / 2;
    container.scrollTo({ left, behavior: opts?.instant === true || reduce ? "auto" : "smooth" });
  }, []);

  // Live-tracks which label is centred while the strip is moving —
  // dragging, wheel/trackpad, momentum, and the browser's own native
  // snap-settle after any of those (scroll-snap-type on .mk-tabs already
  // handles the actual snap motion; this just follows along visually).
  // Purely cosmetic: it never navigates, so there's nothing to debounce or
  // settle here beyond the rAF throttle.
  useEffect(() => {
    const container = scrollRef.current;
    if (hidden || container === null) return;

    function onScroll() {
      if (rafId.current !== null) return;
      rafId.current = requestAnimationFrame(() => {
        rafId.current = null;
        setCenterIndex(findNearestIndex());
      });
    }

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    };
  }, [hidden, findNearestIndex]);

  // Keeps the active route's label centred: on first mount, and whenever
  // the route changes from outside the carousel (a direct link click, the
  // browser back/forward buttons).
  useEffect(() => {
    if (hidden) return;
    const idx = LINKS.findIndex((l) => l.href === pathname);
    if (idx === -1) return;
    centerTab(idx, { instant: !mountedRef.current });
    setCenterIndex(idx);
    mountedRef.current = true;
  }, [pathname, hidden, centerTab]);

  if (hidden) return null;

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

        <div className="mk-tabs-viewport">
          <div ref={scrollRef} className="mk-tabs">
            {LINKS.map((link, i) => {
              const current = i === centerIndex;
              return (
                <a
                  key={link.href}
                  href={link.href}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  aria-current={pathname === link.href ? "page" : undefined}
                  className={current ? "mk-tab mk-tab-current" : "mk-tab"}
                >
                  {link.label}
                </a>
              );
            })}
          </div>
        </div>

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
