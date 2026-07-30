"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useInViewContinuous } from "@/lib/use-in-view";

export interface TermSegment {
  text: string;
  color?: string;
}
export type TermLine = TermSegment[];

interface TerminalTypewriterProps {
  lines: TermLine[];
  className?: string;
  style?: CSSProperties;
  /** ms per character. */
  speed?: number;
  /** ms pause between one line finishing and the next starting. */
  lineGap?: number;
  /** ms the fully-typed transcript holds before the loop restarts. */
  holdAtEnd?: number;
}

function sliceSegments(segs: TermLine, count: number): TermLine {
  let remaining = count;
  return segs.map((seg) => {
    const take = Math.max(0, Math.min(seg.text.length, remaining));
    remaining -= take;
    return { ...seg, text: seg.text.slice(0, take) };
  });
}

/**
 * Types a small terminal transcript out line by line, then holds the full
 * result and loops — the "script actually running" feel for the freeze-event
 * and hero panels (replacing what used to be static pre-filled text).
 *
 * Pauses whenever scrolled out of view and always restarts from line 0 on
 * return (useInViewContinuous) rather than resuming mid-line, since a
 * loop that resumes on a stale half-typed line reads as broken. Untyped
 * lines are still rendered (full text, `visibility: hidden`) so the panel's
 * height never jumps as lines reveal.
 */
export function TerminalTypewriter({
  lines,
  className,
  style,
  speed = 14,
  lineGap = 450,
  holdAtEnd = 2600,
}: TerminalTypewriterProps) {
  const { ref, inView, reducedMotion } = useInViewContinuous<HTMLDivElement>(0.15);
  const [lineIndex, setLineIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [phase, setPhase] = useState<"typing" | "line-gap" | "hold">("typing");

  useEffect(() => {
    if (!inView) {
      setLineIndex(0);
      setCharCount(0);
      setPhase("typing");
    }
  }, [inView]);

  const currentLine = lines[lineIndex];
  const lineLength = currentLine?.reduce((n, s) => n + s.text.length, 0) ?? 0;

  useEffect(() => {
    if (!inView || reducedMotion) return;

    if (phase === "typing") {
      if (charCount < lineLength) {
        const id = setTimeout(() => setCharCount((c) => c + 1), speed);
        return () => clearTimeout(id);
      }
      setPhase(lineIndex < lines.length - 1 ? "line-gap" : "hold");
      return;
    }

    if (phase === "line-gap") {
      const id = setTimeout(() => {
        setLineIndex((i) => i + 1);
        setCharCount(0);
        setPhase("typing");
      }, lineGap);
      return () => clearTimeout(id);
    }

    // phase === "hold"
    const id = setTimeout(() => {
      setLineIndex(0);
      setCharCount(0);
      setPhase("typing");
    }, holdAtEnd);
    return () => clearTimeout(id);
  }, [inView, reducedMotion, phase, charCount, lineLength, lineIndex, lines.length, speed, lineGap, holdAtEnd]);

  const transcript = lines.map((line) => line.map((s) => s.text).join("")).join("\n");

  return (
    <div ref={ref} className={className} style={style}>
      <span className="sr-only">{transcript}</span>
      <div aria-hidden="true">
        {lines.map((line, i) => {
          const isCurrent = i === lineIndex;
          const isPast = i < lineIndex;
          const isFuture = i > lineIndex;

          let shown: TermLine = line;
          let showCursor = false;
          if (!reducedMotion) {
            if (isCurrent && phase === "typing") {
              shown = sliceSegments(line, charCount);
              showCursor = true;
            }
            // isPast, or isCurrent-but-done: full line, no slicing needed.
          }

          return (
            <div
              key={i}
              className="whitespace-pre-wrap"
              style={isFuture && !reducedMotion ? { visibility: "hidden" } : undefined}
            >
              {shown.map((seg, j) => (
                <span key={j} style={seg.color !== undefined ? { color: seg.color } : undefined}>
                  {seg.text}
                </span>
              ))}
              {showCursor && <span className="mk-type-cursor" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
