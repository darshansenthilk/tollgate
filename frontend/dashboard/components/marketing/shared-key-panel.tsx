"use client";

import { useEffect, useState } from "react";
import { useInViewContinuous } from "@/lib/use-in-view";
import { TerminalTypewriter, type TermLine } from "@/components/marketing/terminal-typewriter";

const REQUEST_LINE: TermLine = [
  { text: "→ ", color: "var(--faint)" },
  { text: "POST /v1/chat/completions " },
  { text: "200", color: "var(--ok)" },
  { text: " 1,024 tok", color: "var(--faint)" },
];
const LINES: TermLine[] = [REQUEST_LINE, REQUEST_LINE, REQUEST_LINE];

const START_RETRIES = 3000;
const START_SPEND = 3912;
const TICK_MS = 700;

/**
 * The counterpart to request-inspector-panel.tsx: what a shared, un-metered
 * key looks like with no gate in front of it. The retry count and spend
 * figure tick upward continuously (not a reset loop like the request
 * inspector's calm cycle) while in view — deliberately a runaway that never
 * settles, contrasted against the other panel's stable, resolving one.
 */
export function SharedKeyPanel() {
  const { ref, inView, reducedMotion } = useInViewContinuous<HTMLDivElement>(0.2);
  const [retries, setRetries] = useState(START_RETRIES);
  const [spend, setSpend] = useState(START_SPEND);

  useEffect(() => {
    if (!inView) {
      setRetries(START_RETRIES);
      setSpend(START_SPEND);
      return;
    }
    const id = setInterval(() => {
      setRetries((r) => r + 3);
      setSpend((s) => s + 4);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [inView]);

  const shownRetries = reducedMotion ? START_RETRIES : retries;
  const shownSpend = reducedMotion ? START_SPEND : spend;

  return (
    <div className="glass flex flex-col overflow-hidden font-mono text-[12.5px]">
      <div
        className="flex items-center gap-2 border-b px-3.5 py-2.5"
        style={{ borderColor: "var(--mk-line)" }}
      >
        <span className="size-2.5 rounded-full" style={{ background: "var(--err)" }} />
        <span className="text-[11.5px]" style={{ color: "var(--muted-ink)" }}>
          agent-scraper · shared key sk-…4f2
        </span>
      </div>
      <div ref={ref} className="flex flex-1 flex-col p-4 leading-[1.95]" style={{ color: "var(--dim)" }}>
        <TerminalTypewriter lines={LINES} speed={10} lineGap={220} holdAtEnd={900} />
        <div style={{ color: "var(--faint)" }}>
          &nbsp;&nbsp;&nbsp;… retry loop ×{shownRetries.toLocaleString("en-US")}
        </div>
        <div
          className="mt-auto border-t pt-3"
          style={{ borderColor: "var(--mk-line)", color: "var(--mk-ink)" }}
        >
          spent&nbsp;&nbsp;
          <span className="font-medium" style={{ color: "var(--err)" }}>
            ${shownSpend.toLocaleString("en-US")}
          </span>
        </div>
        <div style={{ color: "var(--mk-ink)" }}>
          budget&nbsp;<span style={{ color: "var(--faint)" }}>none</span>
        </div>
        <div style={{ color: "var(--mk-ink)" }}>
          alert&nbsp;&nbsp;<span style={{ color: "var(--faint)" }}>none</span>
        </div>
      </div>
    </div>
  );
}
