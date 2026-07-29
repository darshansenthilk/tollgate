"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

/**
 * Hero, laid out on the reference's own shape: left-aligned h1 with a capped
 * measure, two pill CTAs, then a row of three short supporting lines. No
 * eyebrow — the reference has no label above any section heading.
 */
const SUPPORTING = [
  "For every agent to hold its own token and its own monthly ceiling, never a shared key.",
  "To check spend before each request forwards to OpenAI or Anthropic, not after the invoice.",
  "Frozen the moment a loop runs away — one agent, or a batch, never the whole fleet.",
];

export function HeroSection() {
  return (
    <ScrollReveal>
      <header className="mk-rule border-b">
        {/* The hero is the tallest band on the reference; here it was coming
            out ~250px shorter than the pillars below it, which made the page
            open weakly. Padding raised so it leads on size, not just type. */}
        <div className="mk-centered mx-auto max-w-[1400px] px-6 pt-[clamp(96px,13vw,176px)] pb-[clamp(72px,9vw,128px)] sm:px-8 lg:px-12">
          <h1 className="mk-display mb-8 max-w-[18ch]">
            Kill your agents before they kill your budget.
          </h1>
          <div className="mb-14 flex flex-wrap justify-center gap-3">
            <a href="/sign-up" className="mk-btn mk-btn-primary">
              Get started
            </a>
            <a href="#demo" className="mk-btn mk-btn-secondary">
              See it live
            </a>
          </div>
          <div className="grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-3">
            {SUPPORTING.map((line) => (
              <p
                key={line}
                className="max-w-[38ch] text-[16px] leading-[24px]"
                style={{ color: "var(--muted-ink)" }}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      </header>
    </ScrollReveal>
  );
}
