"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";

export function HeroSection() {
  return (
    <ScrollReveal>
      <header
        className="relative overflow-hidden border-b"
        style={{
          borderColor: "rgba(255,255,255,.07)",
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(255,255,255,.045) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }}
      >
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-10 px-5 pt-[clamp(56px,14vw,88px)] pb-[clamp(40px,8vw,64px)] sm:px-8">
          <div className="min-w-[280px] flex-[1_1_460px]">
            <div className="mb-7 font-mono text-xs tracking-[0.2em] text-brand">
              [ AGENT SPEND CONTROL ]
            </div>
            <h1 className="mb-6 font-heading text-[clamp(42px,6.4vw,86px)] leading-[0.98] font-semibold tracking-[-0.03em]">
              Budget guardrails and a kill switch for AI agents.
            </h1>
            <p
              className="mb-9 max-w-[52ch] text-[clamp(16px,1.9vw,20px)] leading-[1.55]"
              style={{ color: "var(--muted-ink)" }}
            >
              AI agents are being handed real spending power — their own API access to OpenAI and
              Anthropic, acting autonomously, unattended. Nobody&apos;s watching the meter.
            </p>
            <div className="flex flex-wrap gap-3">
              <a
                href="/sign-up"
                className="rounded-xl bg-brand px-[22px] py-3.5 font-mono text-[13px] font-medium tracking-[0.1em] text-[#0b0b0d] uppercase transition-[background-color,box-shadow] hover:bg-[#ff5f53] hover:shadow-[0_8px_26px_rgba(255,74,61,0.175)]"
              >
                Get started
              </a>
              <a
                href="#demo"
                className="glass rounded-xl px-[22px] py-3.5 font-mono text-[13px] font-medium tracking-[0.1em] uppercase transition-colors hover:bg-white/10"
              >
                See it live ↓
              </a>
            </div>
          </div>

          {/* Telemetry readout — a static illustration of the real gate
              (proxy.ts's budget check), not wired to any live data. */}
          <div className="relative min-w-[260px] max-w-[420px] flex-[1_1_340px] p-[22px]">
            <div className="absolute top-0 left-0 size-5 border-t-2 border-l-2 border-brand" />
            <div className="absolute top-0 right-0 size-5 border-t-2 border-r-2 border-brand" />
            <div className="absolute bottom-0 left-0 size-5 border-b-2 border-l-2 border-brand" />
            <div className="absolute right-0 bottom-0 size-5 border-r-2 border-b-2 border-brand" />
            <div className="glass p-[18px] font-mono">
              <div className="mb-4 flex items-center justify-between text-[11px] tracking-[0.14em] text-brand">
                [ REQUEST · INSPECTED ]
                <span
                  className="inline-flex items-center gap-1.5"
                  style={{ color: "var(--muted-ink)" }}
                >
                  <span
                    className="size-1.5 animate-[tg-blink_1.6s_infinite] rounded-full"
                    style={{ background: "var(--ok)" }}
                  />
                  LIVE
                </span>
              </div>
              <div
                className="mb-4 border px-[11px] py-2.5 text-[12.5px]"
                style={{ borderColor: "rgba(255,255,255,.11)", background: "#0b0b0d", color: "#cfcfc9" }}
              >
                POST /openai/v1/chat/completions
              </div>
              <div className="flex flex-col gap-[11px] text-xs" style={{ color: "var(--muted-ink)" }}>
                <div className="flex justify-between">
                  <span>token</span>
                  <span style={{ color: "#cfcfc9" }}>tok_checkout····</span>
                </div>
                <div className="flex justify-between">
                  <span>model</span>
                  <span style={{ color: "#cfcfc9" }}>gpt-4o</span>
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between">
                    <span>budget</span>
                    <span style={{ color: "#cfcfc9" }}>$0.18 / $0.30</span>
                  </div>
                  <div
                    className="h-1 border"
                    style={{ borderColor: "rgba(255,255,255,.11)", background: "#0b0b0d" }}
                  >
                    <div className="h-full w-[60%]" style={{ background: "var(--ok)" }} />
                  </div>
                </div>
              </div>
              <div
                className="mt-4 flex items-center justify-between border-t pt-3.5"
                style={{ borderColor: "#26262a" }}
              >
                <span
                  className="font-heading text-xl font-semibold tracking-[0.02em]"
                  style={{ color: "var(--ok)" }}
                >
                  FORWARD
                </span>
                <span className="text-[11px]" style={{ color: "var(--faint)" }}>
                  checked before forward · 3ms
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1200px] items-center justify-between px-5 pb-[30px] sm:px-8">
          <span className="font-mono text-[11px] tracking-[0.16em]" style={{ color: "var(--faint)" }}>
            [ FOR OPENAI &amp; ANTHROPIC API TRAFFIC ]
          </span>
          <span className="font-mono text-[11px] tracking-[0.16em]" style={{ color: "var(--faint)" }}>
            SCROLL ↓
          </span>
        </div>
      </header>
    </ScrollReveal>
  );
}
