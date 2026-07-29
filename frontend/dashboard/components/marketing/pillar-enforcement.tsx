"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

export function ProblemSection() {
  return (
    <ScrollReveal>
      <section className="border-b" style={{ borderColor: "rgba(255,255,255,.07)" }}>
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-10 px-5 py-[clamp(48px,12vw,80px)] sm:px-8">
          <div className="min-w-[280px] flex-[1_1_420px]">
            <div className="mb-6 font-mono text-xs tracking-[0.2em] text-brand">
              [ THE PROBLEM ]
            </div>
            <p
              className="mb-8 max-w-[54ch] text-[17px] leading-[1.6]"
              style={{ color: "var(--muted-ink)" }}
            >
              A bad loop, a prompt injection, or broken retry logic can burn thousands of dollars
              before a human notices. The only fix today is manually pulling an API key — which
              usually takes down every agent sharing it, not just the bad one.
            </p>
            <h2 className="max-w-[16ch] font-heading text-[clamp(26px,3.4vw,40px)] leading-[1.06] font-semibold tracking-[-0.02em]">
              Spend runs away at machine speed. Fixes run at human speed.
            </h2>
          </div>

          {/* Illustrative terminal — the failure mode described above, not
              live data. */}
          <div className="glass min-w-[280px] flex-[1_1_380px] overflow-hidden font-mono text-[12.5px]">
            <div
              className="flex items-center gap-2 border-b px-3.5 py-2.5"
              style={{ borderColor: "#26262a" }}
            >
              <span className="size-2.5 rounded-full bg-brand" />
              <span className="text-[11.5px]" style={{ color: "var(--muted-ink)" }}>
                agent-scraper · shared key sk-…4f2
              </span>
            </div>
            <div className="p-4 leading-[1.95]" style={{ color: "var(--dim)" }}>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <span style={{ color: "var(--faint)" }}>→</span> POST /v1/chat/completions{" "}
                  <span style={{ color: "var(--ok)" }}>200</span>{" "}
                  <span style={{ color: "var(--faint)" }}>1,024 tok</span>
                </div>
              ))}
              <div style={{ color: "var(--faint)" }}>&nbsp;&nbsp;&nbsp;… retry loop ×3,000</div>
              <div
                className="mt-3 border-t pt-3"
                style={{ borderColor: "#26262a", color: "#cfcfc9" }}
              >
                spent&nbsp;&nbsp;<span className="font-medium text-brand">$3,912</span>
              </div>
              <div style={{ color: "#cfcfc9" }}>
                budget&nbsp;<span style={{ color: "var(--faint)" }}>none</span>
              </div>
              <div style={{ color: "#cfcfc9" }}>
                alert&nbsp;&nbsp;<span style={{ color: "var(--faint)" }}>none</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
