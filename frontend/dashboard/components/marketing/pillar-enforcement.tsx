"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

/**
 * Pillar 1 of 3. Every pillar block on the reference is the same unit: a
 * 56px/450 left-aligned h2 with a capped measure, a short lead paragraph,
 * then the block's own visual on the 12-column grid.
 */
export function PillarEnforcement() {
  return (
    <ScrollReveal>
      <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
        <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
          <h2 className="mk-display-sm mb-6">
            Every agent gets its own token and its own ceiling.
          </h2>
          <p
            className="mb-14 max-w-[58ch] text-[16px] leading-[24px]"
            style={{ color: "var(--muted-ink)" }}
          >
            Agents call Tollgate instead of calling OpenAI or Anthropic directly. Every request is
            checked against that agent&apos;s budget before a dollar leaves. Overspend is prevented,
            not reported back to you a month later.
          </p>

          {/* Symmetric 6/6 instead of the previous 5/7. An asymmetric split
              reads as deliberate when the band is left-aligned; under a
              centred band it just looks off-centre. */}
          {/* items-stretch (the default) so both panels share the row's
              height — items-start left the shorter terminal floating with a
              ragged bottom edge next to the taller readout. */}
          <div className="mx-auto grid max-w-[1080px] grid-cols-1 gap-x-5 gap-y-10 lg:grid-cols-2">
            {/* Static illustration of the real gate (proxy.ts's budget check);
                row labels mirror the dashboard table's own columns. */}
            <div className="glass flex flex-col p-[18px] font-mono">
              <div
                className="mk-label mb-4 flex items-center justify-between text-[12px]"
                style={{ color: "var(--faint)" }}
              >
                Request inspected
                <span
                  className="inline-flex items-center gap-1.5"
                  style={{ color: "var(--muted-ink)" }}
                >
                  <span
                    className="size-1.5 animate-[tg-blink_1.6s_infinite] rounded-full"
                    style={{ background: "var(--ok)" }}
                  />
                  Live
                </span>
              </div>
              <div
                className="mk-inset mb-4 px-[11px] py-2.5 text-[12.5px]"
                style={{ color: "var(--mk-ink)" }}
              >
                POST /openai/v1/chat/completions
              </div>
              <div className="flex flex-col gap-[11px] text-xs" style={{ color: "var(--muted-ink)" }}>
                {[
                  ["agent", "checkout-bot"],
                  ["assistant", "openai"],
                  ["model", "gpt-4o"],
                  ["tokens", "18,204"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span style={{ color: "var(--mk-ink)" }}>{v}</span>
                  </div>
                ))}
                <div>
                  <div className="mb-1.5 flex justify-between">
                    <span>spend / budget</span>
                    <span style={{ color: "var(--mk-ink)" }}>$0.18 / $0.30</span>
                  </div>
                  {/* 60% → green, matching the dashboard's own bar: green
                      under 80%, amber 80–100%, red at or over budget. */}
                  <div
                    className="h-1 overflow-hidden rounded-full"
                    style={{ background: "rgba(255,255,255,.1)" }}
                  >
                    <div className="h-full w-[60%] rounded-full" style={{ background: "var(--ok)" }} />
                  </div>
                </div>
              </div>
              {/* mt-auto pins the verdict to the panel's bottom edge, so it
                  lines up with the other panel's own summary block however
                  the shared row height lands. */}
              <div
                className="mt-auto flex items-center justify-between border-t pt-3.5"
                style={{ borderColor: "var(--mk-line)" }}
              >
                <span className="text-[15px] font-medium" style={{ color: "var(--ok)" }}>
                  Forwarded
                </span>
                <span className="text-[11px]" style={{ color: "var(--faint)" }}>
                  checked before forward · 3ms
                </span>
              </div>
            </div>

            {/* What a shared key looks like with no gate in front of it. */}
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
              <div className="flex flex-1 flex-col p-4 leading-[1.95]" style={{ color: "var(--dim)" }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i}>
                    <span style={{ color: "var(--faint)" }}>→</span> POST /v1/chat/completions{" "}
                    <span style={{ color: "var(--ok)" }}>200</span>{" "}
                    <span style={{ color: "var(--faint)" }}>1,024 tok</span>
                  </div>
                ))}
                <div style={{ color: "var(--faint)" }}>&nbsp;&nbsp;&nbsp;… retry loop ×3,000</div>
                <div
                  className="mt-auto border-t pt-3"
                  style={{ borderColor: "var(--mk-line)", color: "var(--mk-ink)" }}
                >
                  spent&nbsp;&nbsp;
                  <span className="font-medium" style={{ color: "var(--err)" }}>
                    $3,912
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
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
