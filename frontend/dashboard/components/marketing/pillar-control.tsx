"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

/** Mirrors selection-toolbar.tsx's soft/hard freeze and the dashboard's
 *  batch selection mode — not aspirational copy. */
const CONTROLS = [
  {
    title: "One agent, or a batch",
    body: "Select any number of agents and freeze them together. The rest of the fleet keeps running on its own tokens.",
  },
  {
    title: "Soft or hard",
    body: "A soft freeze lets in-flight work finish. A hard freeze denies the next request outright. Both are one click.",
  },
  {
    title: "No restart, no rotation",
    body: "Freezing flips a Redis flag the proxy already reads. There is no deploy, no key rotation, and no downtime for anything else.",
  },
];

export function PillarControl() {
  return (
    <ScrollReveal>
      <section id="how" className="border-b" style={{ borderColor: "var(--mk-line)" }}>
        <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
          <h2 className="mk-display-sm mb-6">Stop one agent without stopping the fleet.</h2>
          <p
            className="mb-14 max-w-[58ch] text-[16px] leading-[24px]"
            style={{ color: "var(--muted-ink)" }}
          >
            Pulling a shared API key takes down every agent using it. Tollgate freezes the one that
            is misbehaving, and the next request it sends comes back denied.
          </p>

          {/* Three equal columns above, one centred panel below — a centred
              band needs an odd/symmetric arrangement, not the previous 7/5
              text-beside-panel split. */}
          <div className="mx-auto mb-12 grid max-w-[1080px] grid-cols-1 gap-x-5 gap-y-10 sm:grid-cols-3">
            {CONTROLS.map((c) => (
              <div key={c.title}>
                <h3 className="mk-display-xs mb-2">{c.title}</h3>
                <p
                  className="mx-auto max-w-[34ch] text-[16px] leading-[24px]"
                  style={{ color: "var(--muted-ink)" }}
                >
                  {c.body}
                </p>
              </div>
            ))}
          </div>

          <div className="mx-auto max-w-[520px]">
            <div className="glass p-[18px] font-mono text-[12.5px]">
              <div className="mk-label mb-3.5 text-[12px]" style={{ color: "var(--faint)" }}>
                Freeze event
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
                  <span style={{ color: "var(--err)" }}>403 agent_frozen</span>
                </div>
                <div style={{ color: "var(--faint)" }}>
                  &nbsp;&nbsp;&nbsp;no restart · no propagation delay
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
