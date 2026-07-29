"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

const ENFORCEMENT_POINTS = [
  "Per-agent token, never a shared key",
  "Hard monthly budget per agent",
  "Budget checked before the request forwards",
  "Assistant gate — a ChatGPT token can't call Claude",
];

const CONTROL_POINTS = [
  "Freeze one agent, not the whole fleet",
  "Redis fast-path — the next request sees it",
  "No restart, no key rotation, no downtime",
  "Every request logged for audit",
];

function PlusList({ items }: { items: string[] }) {
  return (
    <div className="flex flex-col gap-3">
      {items.map((item) => (
        <div key={item} className="flex gap-2.5 text-[15px]" style={{ color: "#cfcfc9" }}>
          <span className="font-mono text-brand">+</span>
          {item}
        </div>
      ))}
    </div>
  );
}

export function CapabilitySection() {
  return (
    <ScrollReveal>
      <section className="border-b" style={{ borderColor: "rgba(255,255,255,.07)" }}>
        <div className="mx-auto max-w-[1200px] px-5 py-[clamp(48px,12vw,80px)] sm:px-8">
          <div className="mb-5 font-mono text-xs tracking-[0.2em] text-brand">[ CAPABILITY ]</div>
          <h2 className="mb-12 max-w-[22ch] font-heading text-[clamp(26px,3.4vw,40px)] leading-[1.05] font-semibold tracking-[-0.02em]">
            Built around the failures a pulled API key can&apos;t fix.
          </h2>

          {/* Enforcement */}
          <div
            className="mb-12 flex flex-wrap items-center gap-10 border-b pb-12"
            style={{ borderColor: "#26262a" }}
          >
            <div className="min-w-[280px] flex-[1_1_380px]">
              <div className="mb-3 font-mono text-[11px] tracking-[0.16em]" style={{ color: "var(--faint)" }}>
                [ TOLLGATE · ENFORCEMENT ]
              </div>
              <h3 className="mb-5 font-heading text-[28px] font-semibold tracking-[-0.02em]">
                Checked before forward.
              </h3>
              <PlusList items={ENFORCEMENT_POINTS} />
            </div>

            {/* agent → Tollgate → provider diagram */}
            <div className="flex min-w-[280px] flex-[2_1_420px] flex-wrap items-stretch gap-3">
              <div className="glass min-w-[150px] flex-1 p-4">
                <div className="mb-3 font-mono text-[10.5px] tracking-[0.12em]" style={{ color: "var(--faint)" }}>
                  AGENTS
                </div>
                <div className="flex flex-col gap-1.5 font-mono text-[11px]" style={{ color: "var(--muted-ink)" }}>
                  <div className="border px-2.5 py-1.5" style={{ borderColor: "rgba(255,255,255,.11)" }}>
                    tok_checkout
                  </div>
                  <div className="border px-2.5 py-1.5" style={{ borderColor: "rgba(255,255,255,.11)" }}>
                    tok_research
                  </div>
                </div>
              </div>
              <div className="flex items-center font-mono" style={{ color: "var(--faint)" }}>
                →
              </div>
              <div
                className="min-w-[170px] flex-[1.2] rounded-2xl border p-4"
                style={{
                  borderColor: "var(--brand)",
                  background: "rgba(255,255,255,.055)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.09), 0 12px 36px rgba(0,0,0,.4)",
                  backdropFilter: "blur(18px) saturate(160%)",
                  WebkitBackdropFilter: "blur(18px) saturate(160%)",
                }}
              >
                <div className="mb-3 flex items-center gap-1.5">
                  <div className="size-2.5 bg-brand" />
                  <div className="font-heading text-[13px] font-semibold">Tollgate</div>
                </div>
                <div
                  className="mb-2.5 border px-2.5 py-1.5 font-mono text-[10.5px]"
                  style={{ borderColor: "rgba(255,255,255,.11)", color: "#cfcfc9" }}
                >
                  check budget → decide
                </div>
                <div className="flex flex-col gap-1.5 font-mono text-[10.5px]">
                  <div style={{ color: "var(--ok)" }}>● within → 200 forward</div>
                  <div className="text-brand">● over → 403 blocked</div>
                </div>
              </div>
              <div className="flex items-center font-mono" style={{ color: "var(--faint)" }}>
                →
              </div>
              <div className="glass min-w-[150px] flex-1 p-4">
                <div className="mb-3 font-mono text-[10.5px] tracking-[0.12em]" style={{ color: "var(--faint)" }}>
                  PROVIDERS
                </div>
                <div className="flex flex-col gap-1.5 font-mono text-[11px]" style={{ color: "var(--muted-ink)" }}>
                  <div className="border px-2.5 py-1.5" style={{ borderColor: "rgba(255,255,255,.11)" }}>
                    api.openai.com
                  </div>
                  <div className="border px-2.5 py-1.5" style={{ borderColor: "rgba(255,255,255,.11)" }}>
                    api.anthropic.com
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Control — visual leads on desktop, text leads on mobile */}
          <div className="flex flex-wrap-reverse items-center gap-10">
            <div className="glass min-w-[260px] flex-[1_1_320px] p-[18px] font-mono text-[12.5px]">
              <div className="mb-3.5 text-[11px] tracking-[0.14em]" style={{ color: "var(--faint)" }}>
                [ FREEZE EVENT ]
              </div>
              <div className="leading-loose" style={{ color: "var(--dim)" }}>
                <div>
                  <span style={{ color: "var(--faint)" }}>→</span> operator: freeze agent-scraper
                </div>
                <div>
                  <span style={{ color: "var(--faint)" }}>→</span> redis flag set{" "}
                  <span style={{ color: "var(--ok)" }}>ok</span>{" "}
                  <span style={{ color: "var(--faint)" }}>· 0ms</span>
                </div>
                <div>
                  <span style={{ color: "var(--faint)" }}>→</span> next request{" "}
                  <span className="text-brand">403 agent_frozen</span>
                </div>
                <div style={{ color: "var(--faint)" }}>&nbsp;&nbsp;&nbsp;no restart · no propagation delay</div>
              </div>
            </div>
            <div className="min-w-[280px] flex-[1_1_380px]">
              <div className="mb-3 font-mono text-[11px] tracking-[0.16em]" style={{ color: "var(--faint)" }}>
                [ TOLLGATE · CONTROL ]
              </div>
              <h3 className="mb-5 font-heading text-[28px] font-semibold tracking-[-0.02em]">
                Freeze at the speed of a bad loop.
              </h3>
              <PlusList items={CONTROL_POINTS} />
            </div>
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
