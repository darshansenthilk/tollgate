"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useInViewOnce } from "@/lib/use-in-view";

interface TypedTextProps {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  style?: CSSProperties;
  /** ms per character. */
  speed?: number;
  /** ms to wait, once in view, before the first character types — lets
   *  several TypedText siblings type in a visible sequence instead of all
   *  starting together (they usually enter the viewport within the same
   *  observer tick). */
  startDelay?: number;
}

/**
 * Types `text` out one character at a time once scrolled into view, in
 * place of the old whole-block fade-up (scroll-reveal.tsx, removed).
 * Reveal-once: never retypes on scrolling back up, matching that
 * component's rule 2.
 *
 * The full string is always in the DOM for screen readers rather than
 * relying on the mid-type partial text: an sr-only twin holds the complete
 * string throughout, and the animated span (which a screen reader would
 * otherwise read half-typed) is aria-hidden until typing finishes, at which
 * point the roles swap so the visible text becomes the one exposed to
 * assistive tech and the twin drops out.
 */
export function TypedText({
  text,
  as: Tag = "span",
  className,
  style,
  speed = 16,
  startDelay = 0,
}: TypedTextProps) {
  const { ref, inView, reducedMotion } = useInViewOnce<HTMLElement>(0.2);
  const [count, setCount] = useState(0);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!inView || reducedMotion) return;
    const id = setTimeout(() => setTyping(true), startDelay);
    return () => clearTimeout(id);
  }, [inView, reducedMotion, startDelay]);

  useEffect(() => {
    if (!typing || count >= text.length) return;
    const id = setTimeout(() => setCount((c) => c + 1), speed);
    return () => clearTimeout(id);
  }, [typing, count, text, speed]);

  const done = reducedMotion || count >= text.length;
  const shown = reducedMotion ? text : text.slice(0, count);

  return (
    <Tag
      ref={(node) => {
        ref.current = node;
      }}
      className={className}
      style={style}
    >
      <span aria-hidden={!done}>
        {shown}
        {typing && !done && <span className="mk-type-cursor" aria-hidden="true" />}
      </span>
      {!done && <span className="sr-only">{text}</span>}
    </Tag>
  );
}
