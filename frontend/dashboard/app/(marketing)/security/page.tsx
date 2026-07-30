import type { Metadata } from "next";
import { StickyNav } from "@/components/marketing/sticky-nav";
import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { AccessCtaSection } from "@/components/marketing/access-cta-section";
import type { TermLine } from "@/components/marketing/terminal-typewriter";

export const metadata: Metadata = {
  title: "Security — Tollgate",
  description:
    "How Tollgate actually handles your OpenAI and Anthropic keys: what's encrypted, what's hashed, what fails closed, and what we haven't audited yet.",
};

/**
 * The trust page linked from the footer's "Security" link and mentioned
 * whenever a prospect asks "why should I hand you my API key." Every claim
 * here is traceable to a real file in backend/proxy/src/lib — this is
 * deliberately NOT "bank-grade security" marketing copy. See the closing
 * "What we haven't done yet" block for the honesty this trades on: no SOC 2
 * or third-party pentest exists yet, and the page says so rather than
 * implying otherwise.
 */
const POINTS: { title: string; lead: string; panel: TermLine[] }[] = [
  {
    title: "Agents never hold your provider key.",
    lead: "Each agent authenticates to Tollgate with a token Tollgate issues — never your real OpenAI or Anthropic key. The real key lives in Tollgate's vault and is only resolved server-side, at the moment a request is about to forward upstream.",
    panel: [
      [
        { text: "agent → ", color: "var(--faint)" },
        { text: "Authorization: Bearer tg_live_8f2…" },
      ],
      [
        { text: "tollgate → ", color: "var(--faint)" },
        { text: "resolves agent, looks up vault" },
      ],
      [
        { text: "tollgate → openai → ", color: "var(--faint)" },
        { text: "forwards with the real key", color: "var(--ok)" },
      ],
      [{ text: "   the real key is never returned to the agent", color: "var(--faint)" }],
    ],
  },
  {
    title: "Encrypted at rest, verified on every use.",
    lead: "Stored provider keys are encrypted with AES-256-GCM, an authenticated cipher. A wrong encryption key or a tampered ciphertext fails the authenticity check outright — there's no silent fallback to a shared or default key if a stored one can't be verified.",
    panel: [
      [{ text: "→ ", color: "var(--faint)" }, { text: "decrypt org key" }],
      [
        { text: "→ ", color: "var(--faint)" },
        { text: "auth tag mismatch", color: "var(--err)" },
      ],
      [
        { text: "→ ", color: "var(--faint)" },
        { text: "502 upstream_key_unavailable", color: "var(--err)" },
      ],
      [{ text: "   fails closed — never falls back to another key", color: "var(--faint)" }],
    ],
  },
  {
    title: "Agent tokens are hashed, not stored.",
    lead: "The token an agent authenticates with is SHA-256 hashed before it's ever written down. Tollgate looks agents up by that hash — the raw token isn't kept anywhere on our side once it's issued.",
    panel: [
      [{ text: "→ ", color: "var(--faint)" }, { text: "token issued, shown once" }],
      [
        { text: "→ ", color: "var(--faint)" },
        { text: "stored: sha256(token)" },
      ],
      [{ text: "   raw token: never persisted", color: "var(--faint)" }],
    ],
  },
];

export default function SecurityPage() {
  return (
    <>
      <StickyNav />

      <ScrollReveal>
        <header className="mk-rule border-b">
          <div className="mk-centered mx-auto max-w-[1400px] px-6 pt-[clamp(88px,11vw,144px)] pb-[clamp(56px,8vw,96px)] sm:px-8 lg:px-12">
            <h1 className="mk-display mb-6">How your keys are actually handled.</h1>
            <p
              className="mx-auto max-w-[56ch] text-[16px] leading-[24px]"
              style={{ color: "var(--muted-ink)" }}
            >
              Not a policy document — this is what the code does. Everything below is enforced in
              the request path, not promised in a PDF.
            </p>
          </div>
        </header>
      </ScrollReveal>

      {POINTS.map((point) => (
        <ScrollReveal key={point.title}>
          <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
            <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
              <h2 className="mk-display-sm mb-6">{point.title}</h2>
              <p
                className="mb-10 max-w-[58ch] text-[16px] leading-[24px]"
                style={{ color: "var(--muted-ink)" }}
              >
                {point.lead}
              </p>
              <div className="mx-auto max-w-[520px]">
                <div
                  className="glass p-[18px] text-left font-mono text-[12.5px] leading-loose"
                  style={{ color: "var(--dim)" }}
                >
                  {point.panel.map((line, i) => (
                    <div key={i}>
                      {line.map((seg, j) => (
                        <span key={j} style={seg.color !== undefined ? { color: seg.color } : undefined}>
                          {seg.text}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </ScrollReveal>
      ))}

      <ScrollReveal>
        <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
          <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
            <h2 className="mk-display-sm mb-6">Budget is checked before the request leaves.</h2>
            <p className="mx-auto max-w-[58ch] text-[16px] leading-[24px]" style={{ color: "var(--muted-ink)" }}>
              The spend ceiling is compared against the current month&apos;s usage before a request
              forwards — not reconciled against an invoice afterward. Overspend is bounded by
              exactly one in-flight call, never a billing cycle.
            </p>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
          <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
            <h2 className="mk-display-sm mb-6">Freezing takes effect on the very next request.</h2>
            <p className="mx-auto max-w-[58ch] text-[16px] leading-[24px]" style={{ color: "var(--muted-ink)" }}>
              Freezing an agent flips one flag the proxy already reads on every request — no
              redeploy, no key rotation, no propagation delay to wait out.
            </p>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
          <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
            <h2 className="mk-display-sm mb-6">
              Every request is logged — including the ones we deny.
            </h2>
            <p className="mx-auto max-w-[58ch] text-[16px] leading-[24px]" style={{ color: "var(--muted-ink)" }}>
              Denied requests — a frozen agent, an exhausted budget — are recorded in the same
              audit log as allowed ones. If something is hammering a dead token or grinding
              against a budget, that shows up too, not just the traffic that got through.
            </p>
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <section className="border-b" style={{ borderColor: "var(--mk-line)" }}>
          <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
            <h2 className="mk-display-sm mb-6">What we haven&apos;t done yet.</h2>
            <p className="mx-auto max-w-[58ch] text-[16px] leading-[24px]" style={{ color: "var(--muted-ink)" }}>
              We&apos;re early — there&apos;s no SOC 2 report or third-party penetration test to
              point to yet, and we&apos;d rather say that plainly than imply otherwise. Everything
              above is true of the code running today; a formal audit is the next milestone, not a
              finished one. If your org can&apos;t take on that risk yet, self-hosting puts your
              keys on your own infrastructure instead of ours — send a note below.
            </p>
          </div>
        </section>
      </ScrollReveal>

      <AccessCtaSection />
    </>
  );
}
