"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { RequestInspectorPanel } from "@/components/marketing/request-inspector-panel";
import { SharedKeyPanel } from "@/components/marketing/shared-key-panel";

/**
 * Pillar 1 of 3. Every pillar block on the reference is the same unit: a
 * 56px/450 left-aligned h2 with a capped measure, a short lead paragraph,
 * then the block's own visual on the 12-column grid.
 *
 * Both panels below are live (request-inspector-panel.tsx,
 * shared-key-panel.tsx) instead of the static illustration this section
 * used to render — see those files for what each animates and why. The
 * section itself still fades up on scroll (ScrollReveal), independent of
 * those panels' own animation triggers.
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

          {/* Symmetric 6/6. items-stretch (the default) so both panels share
              the row's height. */}
          <div className="mx-auto grid max-w-[1080px] grid-cols-1 gap-x-5 gap-y-10 lg:grid-cols-2">
            <RequestInspectorPanel />
            <SharedKeyPanel />
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
