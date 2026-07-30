"use client";

import { useEffect, useRef, useState } from "react";
import { useInViewContinuous } from "@/lib/use-in-view";

const TARGET_PCT = 60;
const TARGET_SPEND = 0.18;
const TARGET_TOKENS = 18204;
const BUDGET = "$0.30";
const FILL_MS = 1600;
const HOLD_MS = 2400;
const RESET_GAP_MS = 500;

const ROWS = [
  ["agent", "checkout-bot"],
  ["assistant", "openai"],
  ["model", "gpt-4o"],
] as const;

/**
 * Animates the "Request inspected" panel through a full check cycle —
 * spend and token count count up, the budget bar fills to 60%, then
 * "Forwarded" appears — holds, resets, and repeats. Replaces what used to
 * be a static illustration of a single already-decided request.
 *
 * Driven by requestAnimationFrame rather than TerminalTypewriter's
 * per-character timeouts, since this animates numbers/a bar width rather
 * than text. Pauses (and rewinds to the start of a fresh cycle) when
 * scrolled out of view via useInViewContinuous; prefers-reduced-motion
 * renders the settled end state (bar full, verdict shown) with no motion,
 * since that hook always reports `inView: false` in that mode.
 */
export function RequestInspectorPanel() {
  const { ref, inView, reducedMotion } = useInViewContinuous<HTMLDivElement>(0.2);
  const [pct, setPct] = useState(0);
  const [forwarded, setForwarded] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!inView) {
      setPct(0);
      setForwarded(false);
      startRef.current = null;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
      return;
    }

    function runFill(ts: number) {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / FILL_MS);
      setPct(t * TARGET_PCT);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(runFill);
        return;
      }
      setForwarded(true);
      timeoutRef.current = setTimeout(() => {
        setForwarded(false);
        setPct(0);
        startRef.current = null;
        timeoutRef.current = setTimeout(() => {
          rafRef.current = requestAnimationFrame(runFill);
        }, RESET_GAP_MS);
      }, HOLD_MS);
    }
    rafRef.current = requestAnimationFrame(runFill);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, [inView]);

  const shownPct = reducedMotion ? TARGET_PCT : pct;
  const shownForwarded = reducedMotion || forwarded;
  const fraction = shownPct / TARGET_PCT;
  const spend = `$${(fraction * TARGET_SPEND).toFixed(2)}`;
  const tokens = Math.round(fraction * TARGET_TOKENS).toLocaleString("en-US");

  return (
    <div ref={ref} className="glass flex flex-col p-[18px] font-mono">
      <div
        className="mk-label mb-4 flex items-center justify-between text-[12px]"
        style={{ color: "var(--faint)" }}
      >
        Request inspected
        <span className="inline-flex items-center gap-1.5" style={{ color: "var(--muted-ink)" }}>
          <span
            className="size-1.5 animate-[tg-blink_1.6s_infinite] rounded-full"
            style={{ background: "var(--ok)" }}
          />
          Live
        </span>
      </div>
      <div className="mk-inset mb-4 px-[11px] py-2.5 text-[12.5px]" style={{ color: "var(--mk-ink)" }}>
        POST /openai/v1/chat/completions
      </div>
      <div className="flex flex-col gap-[11px] text-xs" style={{ color: "var(--muted-ink)" }}>
        {ROWS.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span>{k}</span>
            <span style={{ color: "var(--mk-ink)" }}>{v}</span>
          </div>
        ))}
        <div key="tokens" className="flex justify-between">
          <span>tokens</span>
          <span style={{ color: "var(--mk-ink)" }}>{tokens}</span>
        </div>
        <div>
          <div className="mb-1.5 flex justify-between">
            <span>spend / budget</span>
            <span style={{ color: "var(--mk-ink)" }}>
              {spend} / {BUDGET}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,.1)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${shownPct}%`,
                background: "var(--ok)",
                transition: reducedMotion ? undefined : "width 60ms linear",
              }}
            />
          </div>
        </div>
      </div>
      <div
        className="mt-auto flex items-center justify-between border-t pt-3.5"
        style={{ borderColor: "var(--mk-line)" }}
      >
        <span
          className="text-[15px] font-medium"
          style={{ color: shownForwarded ? "var(--ok)" : "var(--faint)" }}
        >
          {shownForwarded ? "Forwarded" : "Checking…"}
        </span>
        <span className="text-[11px]" style={{ color: "var(--faint)" }}>
          {shownForwarded ? "checked before forward · 3ms" : " "}
        </span>
      </div>
    </div>
  );
}
