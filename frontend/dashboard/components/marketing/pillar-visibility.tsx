"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

/** Columns and status wording are the activity log's real ones, in its own
 *  order — see activity-log.tsx (When / Agent / Assistant / Model / Status /
 *  Tokens / Cost, with an "Allowed" badge on --ok and denials on --err). */
const LOG_COLUMNS = ["When", "Agent", "Assistant", "Model", "Status", "Tokens", "Cost"] as const;

const LOG_ROWS = [
  ["14:02:11", "checkout-bot", "openai", "gpt-4o", "Allowed", "1,204", "$0.011"],
  ["14:02:09", "research-bot", "anthropic", "claude-sonnet-4", "Allowed", "8,410", "$0.084"],
  ["14:02:04", "agent-scraper", "openai", "gpt-4o", "Over budget", "—", "—"],
  ["14:01:58", "checkout-bot", "openai", "gpt-4o", "Allowed", "912", "$0.009"],
] as const;

export function PillarVisibility() {
  return (
    <ScrollReveal>
      <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
        <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
          <h2 className="mk-display-sm mb-6">
            Know what every agent spent, and what it was denied.
          </h2>
          <p
            className="mb-14 max-w-[58ch] text-[16px] leading-[24px]"
            style={{ color: "var(--muted-ink)" }}
          >
            Cost is metered from the provider&apos;s own usage numbers, not estimated. Every
            request lands in an audit log with the agent, assistant, model, token count, and what
            it cost — including the ones that were turned away.
          </p>

          <div className="glass mx-auto max-w-[1080px] overflow-x-auto">
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
                {LOG_ROWS.map((row, i) => (
                  <tr key={row[0]} style={{ color: "var(--muted-ink)" }}>
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className="px-4 py-3"
                        style={{
                          borderBottom:
                            i < LOG_ROWS.length - 1 ? "1px solid var(--mk-line)" : undefined,
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
        </div>
      </section>
    </ScrollReveal>
  );
}
