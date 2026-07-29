"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

const SPECS = [
  { label: "Enforcement point", value: "Pre-forward" },
  { label: "Freeze propagation", value: "Next request" },
  { label: "Overspend bound", value: "≤ 1 call" },
  { label: "Budget scope", value: "Per agent / mo" },
  { label: "Warning / cutoff", value: "80% / 100%" },
  { label: "Dashboard refresh", value: "Every 3s" },
  { label: "Providers", value: "OpenAI · Anthropic" },
  { label: "Control plane", value: "Redis fast-path" },
] as const;

export function TechnicalReadoutSection() {
  return (
    <ScrollReveal>
      <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
        <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
          <h2 className="mk-display-sm mb-11">
            Enforced at the request boundary, not after the bill.
          </h2>
          <div
            className="mx-auto grid max-w-[1080px] grid-cols-2 border-t border-l md:grid-cols-4"
            style={{ borderColor: "var(--mk-line)" }}
          >
            {SPECS.map((spec) => (
              <div
                key={spec.label}
                className="border-r border-b px-5 py-6"
                style={{ borderColor: "var(--mk-line)" }}
              >
                <div className="mk-label mb-3.5 text-[13px]" style={{ color: "var(--faint)" }}>
                  {spec.label}
                </div>
                <div className="mk-display-sm text-[clamp(22px,2.4vw,30px)]">
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
