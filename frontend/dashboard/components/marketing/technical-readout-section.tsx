"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

const SPECS = [
  { label: "Enforcement point", value: "Pre-forward" },
  { label: "Freeze propagation", value: "Next request" },
  { label: "Overspend bound", value: "≤ 1 call" },
  { label: "Budget scope", value: "Per agent / mo" },
  { label: "Providers", value: "OpenAI · Anthropic" },
  { label: "Control plane", value: "Redis fast-path" },
] as const;

export function TechnicalReadoutSection() {
  return (
    <ScrollReveal>
      <section className="border-b" style={{ borderColor: "rgba(255,255,255,.07)" }}>
        <div className="mx-auto max-w-[1200px] px-5 py-[clamp(48px,12vw,80px)] sm:px-8">
          <div className="mb-5 font-mono text-xs tracking-[0.2em] text-brand">
            [ TECHNICAL READOUT ]
          </div>
          <h2 className="mb-11 max-w-[20ch] font-heading text-[clamp(26px,3.4vw,40px)] leading-[1.05] font-semibold tracking-[-0.02em]">
            Enforced at the request boundary. Not after the bill.
          </h2>
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] border-t border-l"
            style={{ borderColor: "#26262a" }}
          >
            {SPECS.map((spec) => (
              <div
                key={spec.label}
                className="border-r border-b px-5 py-6"
                style={{ borderColor: "#26262a" }}
              >
                <div
                  className="mb-3.5 font-mono text-[11px] tracking-[0.12em] uppercase"
                  style={{ color: "var(--faint)" }}
                >
                  {spec.label}
                </div>
                <div className="font-heading text-[clamp(22px,2.4vw,30px)] font-semibold tracking-[-0.01em]">
                  {spec.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
