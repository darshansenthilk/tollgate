"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
}

/**
 * Fades a section up into view (opacity 0→1, translateY 26px→0, 800ms
 * cubic-bezier(.22,.61,.36,1)) — IntersectionObserver-backed, four rules that
 * must hold exactly (see design_handoff_landing_page/README.md's "Scroll
 * reveal" section):
 *   1. Reveal only on scroll-DOWN entry.
 *   2. An element scrolled past above stays revealed — scrolling back up
 *      never hides or replays it.
 *   3. An element that exits BELOW the viewport re-arms, so scrolling back
 *      down to it replays the fade.
 *   4. prefers-reduced-motion: reduce → everything visible, no transition.
 *
 * Direction is tracked via a scroll listener (not recomputed inside the
 * IO callback, which can fire after the triggering scroll already moved the
 * page) — rule 3's "exited below" check is `boundingClientRect.top > 0`,
 * distinguishing "left via the bottom" (re-arm) from "left via the top"
 * (stay revealed), exactly as the README specifies.
 *
 * Starting mid-page (a #hash link, or the browser restoring scroll position)
 * is a case the four rules don't cover on their own: sections above the
 * starting point never got a down-scroll entry to reveal from, and since
 * reveals are deliberately down-only, scrolling up to them afterward
 * wouldn't reveal them either — they'd stay invisible forever. Fixed with a
 * direct getBoundingClientRect() check right on mount (before the observer
 * is even created): anything already visible or already scrolled past
 * above reveals immediately. This deliberately does NOT lean on
 * IntersectionObserver's "initial callback" for that check — confirmed
 * live that it doesn't reliably fire for a target that starts (and stays)
 * outside the viewport, which is exactly the case that needed covering.
 *
 * That mount-time check has its own race, though: on a hard refresh deep
 * into the page, this effect can run BEFORE the browser has applied its own
 * scroll-position restoration — at that instant window.scrollY still reads
 * 0, so every section computes as "far below," including ones that will
 * end up above the restored fold a moment later. Once restoration lands
 * (an instant jump, not a scroll gesture), a section that was never
 * intersecting before the jump and isn't intersecting after it either never
 * fires the IntersectionObserver callback at all — nothing ever corrects
 * the wrong initial verdict, so it stays invisible even though it's now
 * above where the user is scrolled to. Fixed by re-running the exact same
 * check a couple of animation frames later, by which point restoration has
 * always landed in every engine tested; the first check still keeps the
 * common case (no restoration race) instant with no flash.
 */
export function ScrollReveal({ children, className }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const directionRef = useRef<"down" | "up">("down");
  const prevScrollYRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      setRevealed(true);
      return;
    }

    const node = ref.current;
    if (node === null) return;

    prevScrollYRef.current = window.scrollY;
    function handleScroll() {
      const y = window.scrollY;
      directionRef.current = y >= prevScrollYRef.current ? "down" : "up";
      prevScrollYRef.current = y;
    }
    window.addEventListener("scroll", handleScroll, { passive: true });

    // Mid-page start: reveal immediately anything already visible or already
    // scrolled past above (top < viewport height covers both) — see the doc
    // comment above for why this can't wait on the observer.
    function checkAlreadyPastFold() {
      if (node !== null && node.getBoundingClientRect().top < window.innerHeight) {
        setRevealed(true);
      }
    }
    checkAlreadyPastFold();
    // Second pass, deferred past the browser's own scroll-restoration jump
    // on a hard refresh — see the doc comment above. A no-op (setRevealed
    // is already true) for every case that didn't need it.
    const rafId1 = requestAnimationFrame(() => {
      const rafId2 = requestAnimationFrame(checkAlreadyPastFold);
      rafIdRef.current = rafId2;
    });
    rafIdRef.current = rafId1;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry === undefined) return;
        if (entry.isIntersecting) {
          if (directionRef.current === "down") setRevealed(true);
        } else if (entry.boundingClientRect.top > 0) {
          // Exited via the bottom (scrolled up away from it) — re-arm.
          // Exiting via the top (scrolled down past it) falls through and
          // stays revealed.
          setRevealed(false);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(node);

    return () => {
      window.removeEventListener("scroll", handleScroll);
      observer.disconnect();
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      data-reveal={revealed}
      className={cn(
        "transition-[opacity,transform] duration-[800ms] [transition-timing-function:cubic-bezier(0.22,0.61,0.36,1)] motion-reduce:transition-none motion-reduce:opacity-100 motion-reduce:translate-y-0",
        revealed ? "translate-y-0 opacity-100" : "translate-y-[26px] opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
