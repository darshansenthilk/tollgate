"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { TollgateLogo } from "@/components/marketing/tollgate-logo";
import { WaitlistForm } from "@/components/marketing/waitlist-form";

const PRODUCT_LINKS = [
  { href: "#how", label: "Mechanism" },
  { href: "#demo", label: "Live demo" },
  { href: "#access", label: "Request access" },
];

export function AccessCtaSection() {
  return (
    <>
      <ScrollReveal>
        <section
          id="access"
          className="border-b"
          style={{
            borderColor: "rgba(255,255,255,.07)",
            backgroundImage:
              "radial-gradient(circle at 1px 1px, rgba(255,255,255,.045) 1px, transparent 0)",
            backgroundSize: "26px 26px",
          }}
        >
          <div className="mx-auto max-w-[1200px] px-5 py-[clamp(56px,14vw,88px)] sm:px-8">
            <div className="mb-6 font-mono text-xs tracking-[0.2em] text-brand">
              [ REQUEST ACCESS ]
            </div>
            <h2 className="mb-8 max-w-[20ch] font-heading text-[clamp(28px,3.6vw,44px)] leading-[1.04] font-semibold tracking-[-0.02em]">
              Put a meter on your agents.
            </h2>
            <WaitlistForm />
          </div>
        </section>
      </ScrollReveal>

      <ScrollReveal>
        <footer className="mx-auto max-w-[1200px] px-5 py-[clamp(36px,9vw,56px)] sm:px-8">
          <div className="mb-11 flex flex-wrap items-start justify-between gap-8">
            <div>
              <div className="mb-3 flex items-center gap-2.5">
                <TollgateLogo className="size-[19px]" />
                <span className="font-heading text-base font-semibold tracking-[0.02em]">
                  TOLLGATE
                </span>
              </div>
              <p className="max-w-[34ch] text-sm" style={{ color: "var(--dim)" }}>
                Budget guardrails and a kill switch for AI agents.
              </p>
            </div>
            <div className="flex flex-wrap gap-14">
              <div className="flex flex-col gap-2.5">
                <span
                  className="font-mono text-[11px] tracking-[0.14em]"
                  style={{ color: "var(--faint)" }}
                >
                  PRODUCT
                </span>
                {PRODUCT_LINKS.map((link) => (
                  <a key={link.href} href={link.href} className="text-sm" style={{ color: "#cfcfc9" }}>
                    {link.label}
                  </a>
                ))}
              </div>
              <div className="flex flex-col gap-2.5">
                <span
                  className="font-mono text-[11px] tracking-[0.14em]"
                  style={{ color: "var(--faint)" }}
                >
                  SUPPORTS
                </span>
                <span className="text-sm" style={{ color: "#cfcfc9" }}>
                  OpenAI
                </span>
                <span className="text-sm" style={{ color: "#cfcfc9" }}>
                  Anthropic
                </span>
              </div>
            </div>
          </div>
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t pt-6"
            style={{ borderColor: "rgba(255,255,255,.07)" }}
          >
            <span className="font-mono text-[11px] tracking-[0.12em]" style={{ color: "var(--faint)" }}>
              CONTROL PLANE FOR AGENT SPEND
            </span>
            <span className="font-mono text-[11px] tracking-[0.12em]" style={{ color: "var(--faint)" }}>
              © 2026 TOLLGATE
            </span>
          </div>
        </footer>
      </ScrollReveal>
    </>
  );
}
