"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

const STEPS = [
  {
    num: "01",
    title: "Per-agent token & budget",
    body: "Every agent gets its own token and a hard budget. No shared keys — freezing one never takes down the rest.",
  },
  {
    num: "02",
    title: "Checked before forward",
    body: "Every request is checked against that budget before it's forwarded. Overspend is prevented, not reported after the fact.",
  },
  {
    num: "03",
    title: "Instant freeze",
    body: "Freeze any agent from a live dashboard via a Redis fast-path flag. No restart, no propagation delay — the next request is denied.",
  },
  {
    num: "04",
    title: "Metered & logged",
    body: "Real cost is metered from the upstream usage and written to an audit log. Spend is live from Redis, the same counter enforcement reads.",
  },
] as const;

/** The primary section — deliberately the largest, per the design spec. */
export function MechanismSection() {
  return (
    <ScrollReveal>
      <section
        id="how"
        className="border-b"
        style={{
          borderColor: "rgba(255,255,255,.07)",
          backgroundImage: "radial-gradient(60% 50% at 50% 0%, rgba(255,74,61,.035), transparent 65%)",
        }}
      >
        <div className="mx-auto max-w-[1200px] px-5 pt-[clamp(64px,16vw,132px)] pb-[clamp(56px,14vw,128px)] sm:px-8">
          <div
            className="mb-7 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 font-mono text-[13px] tracking-[0.22em] whitespace-nowrap text-brand"
            style={{ borderColor: "rgba(255,74,61,.35)", background: "rgba(255,74,61,.1)" }}
          >
            [ THE MECHANISM ]
          </div>
          <h2 className="mb-5 max-w-[18ch] font-heading text-[clamp(38px,5.6vw,68px)] leading-[1] font-semibold tracking-[-0.025em]">
            One proxy. The whole spend kill chain.
          </h2>
          <p className="mb-16 max-w-[62ch] text-[19px] leading-[1.6]" style={{ color: "var(--muted-ink)" }}>
            Agents call Tollgate instead of the LLM providers directly. Every request runs the
            same pipeline before a dollar leaves for OpenAI or Anthropic.
          </p>
          <div
            className="rounded-[22px] border px-4 sm:px-9"
            style={{
              borderColor: "rgba(255,74,61,.25)",
              background: "rgba(255,255,255,.045)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.09), 0 20px 60px rgba(0,0,0,.45)",
              backdropFilter: "blur(18px) saturate(160%)",
              WebkitBackdropFilter: "blur(18px) saturate(160%)",
            }}
          >
            {STEPS.map((step, i) => (
              <div
                key={step.num}
                className="flex flex-wrap items-baseline gap-x-8 gap-y-2 py-8"
                style={i < STEPS.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,.09)" } : undefined}
              >
                <div className="flex-none font-mono text-[17px] font-medium text-brand">{step.num}</div>
                <h3 className="flex-[1_1_220px] font-heading text-[clamp(22px,4vw,28px)] leading-[1.15] font-semibold tracking-[-0.015em]">
                  {step.title}
                </h3>
                <p className="flex-[2_1_260px] text-base leading-[1.65]" style={{ color: "#b7b7ae" }}>
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
