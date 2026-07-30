"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { ActivityLogPanel } from "@/components/marketing/activity-log-panel";

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

          <ActivityLogPanel />
        </div>
      </section>
    </ScrollReveal>
  );
}
