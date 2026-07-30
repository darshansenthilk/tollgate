"use client";

import { useEffect, useRef, useState } from "react";

/**
 * True once the element has entered the viewport; stays true forever after
 * (no re-arm on scrolling back up) — for one-shot reveals like typing text.
 * prefers-reduced-motion: reports true immediately, no observer.
 */
export function useInViewOnce<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reduced);
    if (reduced) {
      setInView(true);
      return;
    }
    const node = ref.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView, reducedMotion };
}

/**
 * Live in/out-of-view state, for loops that should pause off-screen and
 * restart from the top when scrolled back to (unlike useInViewOnce's
 * reveal-once). prefers-reduced-motion: always reports `inView: false`, so
 * callers render their static end-state instead of animating.
 */
export function useInViewContinuous<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReducedMotion(reduced);
    if (reduced) return;
    const node = ref.current;
    if (node === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? false),
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView: reducedMotion ? false : inView, reducedMotion };
}
