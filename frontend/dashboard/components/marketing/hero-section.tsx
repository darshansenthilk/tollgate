"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { TypedText } from "@/components/marketing/typed-text";
import { TerminalTypewriter, type TermLine } from "@/components/marketing/terminal-typewriter";

/**
 * Hero: left column is headline + CTA, right column is the boot-sequence
 * terminal, side by side and vertically centered on each other — the
 * reference's own hero split, replacing the previous single centered
 * column. Deliberately opts out of .mk-centered (every other section stays
 * on that shared centered band; this is the one section built as a
 * two-column layout instead).
 *
 * The whole section still fades up on scroll (ScrollReveal, unchanged). On
 * top of that, the h1 also types itself out (typed-text.tsx) and the boot
 * sequence actually runs (terminal-typewriter.tsx) — both trigger
 * independently of the section's own fade.
 */
const HEADLINE = "Kill your agents before they kill your budget.";

const SUPPORTING = [
  "For every agent to hold its own token and its own monthly ceiling, never a shared key.",
  "To check spend before each request forwards to OpenAI or Anthropic, not after the invoice.",
  "Frozen the moment a loop runs away — one agent, or a batch, never the whole fleet.",
];

/** A boot sequence typed and "compiled" on load, looping (terminal-typewriter.tsx). */
const TERMINAL_LINES: TermLine[] = [
  [{ text: "$ ", color: "var(--faint)" }, { text: "tollgate init checkout-bot" }],
  [
    { text: "→ ", color: "var(--faint)" },
    { text: "issuing per-agent token · $30/mo ceiling" },
  ],
  [{ text: "→ ", color: "var(--faint)" }, { text: "compiling budget policy…" }],
  [
    { text: "✓ ", color: "var(--ok)" },
    { text: "ready — request boundary armed", color: "var(--ok)" },
  ],
];

export function HeroSection() {
  return (
    <ScrollReveal>
      <header className="mk-rule border-b">
        {/* The hero is the tallest band on the reference; here it was coming
            out ~250px shorter than the pillars below it, which made the page
            open weakly. Padding raised so it leads on size, not just type. */}
        <div className="mx-auto max-w-[1400px] px-6 pt-[clamp(96px,13vw,176px)] pb-[clamp(72px,9vw,128px)] sm:px-8 lg:px-12">
          <div className="grid grid-cols-1 items-center gap-x-12 gap-y-12 lg:grid-cols-2">
            <div>
              <TypedText as="h1" text={HEADLINE} className="mk-display max-w-[15ch]" speed={22} />
            </div>

            <div className="glass overflow-hidden font-mono text-[12.5px]">
              <div
                className="flex items-center gap-1.5 border-b px-3.5 py-2.5"
                style={{ borderColor: "var(--mk-line)" }}
              >
                <span className="size-2.5 rounded-full" style={{ background: "var(--err)" }} />
                <span className="size-2.5 rounded-full" style={{ background: "var(--amber)" }} />
                <span className="size-2.5 rounded-full" style={{ background: "var(--ok)" }} />
                <span className="ml-1.5 text-[11.5px]" style={{ color: "var(--muted-ink)" }}>
                  tollgate — checkout-bot
                </span>
              </div>
              <TerminalTypewriter
                lines={TERMINAL_LINES}
                className="p-4 leading-loose"
                style={{ color: "var(--dim)" }}
              />
            </div>
          </div>

          <div className="mt-14 grid grid-cols-1 gap-x-5 gap-y-6 md:grid-cols-3">
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
