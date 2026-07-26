"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

export function WhyNowSection() {
  return (
    <ScrollReveal>
      <section className="border-b" style={{ borderColor: "rgba(255,255,255,.07)" }}>
        <div className="mx-auto max-w-[1200px] px-5 py-[clamp(48px,12vw,80px)] sm:px-8">
          <div className="mb-7 font-mono text-xs tracking-[0.2em] text-brand">[ WHY NOW ]</div>
          <h2 className="mb-6 max-w-[24ch] font-heading text-[clamp(30px,4.6vw,58px)] leading-[1.03] font-semibold tracking-[-0.025em]">
            Agents evolve fast. Spend control has to be faster.
          </h2>
          <p
            className="max-w-[60ch] text-[clamp(17px,2vw,21px)] leading-[1.55]"
            style={{ color: "var(--muted-ink)" }}
          >
            As agents get more autonomy and bigger budgets, this gets more expensive to ignore
            every month. API gateways became the default control layer for infrastructure
            traffic. Agent spend needs the same layer —{" "}
            <span style={{ color: "var(--ink)" }}>inevitability, not novelty.</span>
          </p>
        </div>
      </section>
    </ScrollReveal>
  );
}
