"use client";

import { useEffect, useRef, useState } from "react";
import { useInViewContinuous } from "@/lib/use-in-view";

const LOG_COLUMNS = ["When", "Agent", "Assistant", "Model", "Status", "Tokens", "Cost"] as const;

const INITIAL_ROWS: readonly (readonly string[])[] = [
  ["14:02:11", "checkout-bot", "openai", "gpt-4o", "Allowed", "1,204", "$0.011"],
  ["14:02:09", "research-bot", "anthropic", "claude-sonnet-4", "Allowed", "8,410", "$0.084"],
  ["14:02:04", "agent-scraper", "openai", "gpt-4o", "Over budget", "—", "—"],
  ["14:01:58", "checkout-bot", "openai", "gpt-4o", "Allowed", "912", "$0.009"],
];

/** Rotation of candidate rows the live tail cycles through — everything but
 *  the "When" column, which is generated fresh on insert. */
const POOL: readonly (readonly string[])[] = [
  ["checkout-bot", "openai", "gpt-4o", "Allowed", "1,088", "$0.010"],
  ["research-bot", "anthropic", "claude-sonnet-4", "Allowed", "6,220", "$0.062"],
  ["support-bot", "openai", "gpt-4o-mini", "Allowed", "512", "$0.005"],
  ["agent-scraper", "openai", "gpt-4o", "Over budget", "—", "—"],
  ["checkout-bot", "openai", "gpt-4o", "Allowed", "1,340", "$0.013"],
  ["research-bot", "anthropic", "claude-sonnet-4", "Allowed", "9,015", "$0.090"],
  ["support-bot", "openai", "gpt-4o-mini", "Allowed", "488", "$0.004"],
];

const MAX_ROWS = 4;
const MIN_INSERT_MS = 500;
const MAX_INSERT_MS = 1500;

function randomInsertDelay(): number {
  return MIN_INSERT_MS + Math.random() * (MAX_INSERT_MS - MIN_INSERT_MS);
}

function addSeconds(time: string, deltaSec: number): string {
  const [h, m, s] = time.split(":").map(Number);
  const total = h * 3600 + m * 60 + s + deltaSec;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * Live-tailing version of the "Know what every agent spent" table — a new
 * row appears every 0.5-1.5s (randomized per insert, not a fixed cadence)
 * while the panel is in view (oldest dropped, table height fixed at
 * MAX_ROWS), instead of the static 4-row snapshot it used to render.
 * Pauses when scrolled out of view (useInViewContinuous) and resumes —
 * doesn't reset — since a live tail that rewinds on re-entry reads as
 * fake. prefers-reduced-motion: stays on INITIAL_ROWS forever, since that
 * hook always reports `inView: false` in that mode.
 *
 * Each row is keyed by its own generated timestamp, so React mounts a new
 * <tr> per insert rather than mutating an existing one — that's what makes
 * .mk-row-in (globals.css) replay only on the newest row and never on rows
 * just reflowing down the table.
 *
 * A recursive setTimeout (re-armed with a fresh random delay each cycle)
 * rather than setInterval, since setInterval can't vary its own period.
 */
export function ActivityLogPanel() {
  const { ref, inView } = useInViewContinuous<HTMLDivElement>(0.15);
  const [rows, setRows] = useState<readonly (readonly string[])[]>(INITIAL_ROWS);
  const poolIndexRef = useRef(0);

  useEffect(() => {
    if (!inView) return;
    let id: ReturnType<typeof setTimeout>;

    function insertRow() {
      setRows((prev) => {
        const top = prev[0];
        const candidate = POOL[poolIndexRef.current % POOL.length];
        poolIndexRef.current += 1;
        const delta = 2 + Math.floor(Math.random() * 4);
        const when = top !== undefined ? addSeconds(top[0], delta) : "14:02:11";
        const row = candidate !== undefined ? [when, ...candidate] : prev[0]!;
        return [row, ...prev].slice(0, MAX_ROWS);
      });
      id = setTimeout(insertRow, randomInsertDelay());
    }
    id = setTimeout(insertRow, randomInsertDelay());

    return () => clearTimeout(id);
  }, [inView]);

  return (
    <div ref={ref} className="glass mx-auto max-w-[1080px] overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse font-mono text-[12.5px]">
        <thead>
          <tr style={{ color: "var(--faint)" }}>
            {LOG_COLUMNS.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b px-4 py-3 text-left font-normal"
                style={{ borderColor: "var(--mk-line)" }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row[0]} className="mk-row-in" style={{ color: "var(--muted-ink)" }}>
              {row.map((cell, j) => (
                <td
                  key={j}
                  className="px-4 py-3"
                  style={{
                    borderBottom: i < rows.length - 1 ? "1px solid var(--mk-line)" : undefined,
                    color:
                      j === 4
                        ? cell === "Allowed"
                          ? "var(--ok)"
                          : "var(--err)"
                        : j === 1
                          ? "var(--mk-ink)"
                          : undefined,
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
