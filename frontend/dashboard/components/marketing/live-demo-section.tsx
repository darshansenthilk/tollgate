"use client";

import { ScrollReveal } from "@/components/marketing/scroll-reveal";
import { AgentDashboard } from "@/components/agent-dashboard";
import { useAgentSimulator } from "@/lib/demo-simulator";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LiveDemoSection() {
  const sim = useAgentSimulator();
  const pickerItems = sim.agents.map((a) => ({ value: a.id, label: a.name }));
  const latestLog = sim.log[0] ?? null;

  return (
    <ScrollReveal>
      <section id="demo" className="border-b" style={{ borderColor: "rgba(255,255,255,.07)" }}>
        <div className="mx-auto max-w-[1200px] px-5 py-[clamp(48px,12vw,80px)] sm:px-8">
          <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2.5">
            <div className="font-mono text-xs tracking-[0.2em] text-brand">[ LIVE ]</div>
            <span
              className="inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[11px] tracking-[0.12em]"
              style={{ borderColor: "rgba(255,255,255,.11)", color: "var(--dim)" }}
            >
              <span className="size-1.5 rounded-full bg-brand" />
              ACTUAL DASHBOARD UI
            </span>
          </div>
          <h2 className="mb-2 max-w-[20ch] font-heading text-[clamp(28px,3.8vw,46px)] leading-[1.02] font-semibold tracking-[-0.02em]">
            This is the real dashboard.
          </h2>
          <p className="mb-7 max-w-[62ch] text-base leading-[1.6]" style={{ color: "var(--muted-ink)" }}>
            Not a mockup — the actual Agent Dashboard component, wired to a simulated data feed so
            you can drive it yourself.
          </p>

          {/* Demo feed controls — explicitly not part of the app UI. */}
          <div
            className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-dashed p-3.5"
            style={{ borderColor: "rgba(255,255,255,.16)" }}
          >
            <span
              className="font-mono text-[10.5px] tracking-[0.14em] uppercase"
              style={{ color: "var(--faint)" }}
            >
              [ demo feed ]
            </span>
            <Select
              items={pickerItems}
              value={sim.runningId}
              onValueChange={(value) => sim.setRunningId(value)}
            >
              <SelectTrigger className="h-8 w-44 font-mono text-xs">
                <SelectValue placeholder="Pick an agent" />
              </SelectTrigger>
              <SelectContent>
                {pickerItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant={sim.running ? "outline" : "brandOutline"}
              onClick={sim.toggleTraffic}
              disabled={sim.runningId === null}
            >
              {sim.running ? "Stop traffic" : "Start traffic"}
            </Button>
            <span
              className="ml-auto truncate font-mono text-[11.5px]"
              style={{ color: "var(--dim)" }}
            >
              {sim.log.length} req{sim.log.length === 1 ? "" : "s"} / 0.65s
              {latestLog !== null && ` → ${latestLog}`}
            </span>
          </div>

          {/* The real dashboard component — not a recreation. Capped and
              centered at 920px per the design spec; attentionAlertsPosition
              is "absolute" so the over-budget popup stays inside this panel
              instead of floating over the whole marketing page (the one
              deliberate containment deviation the design calls out). */}
          <div className="relative mx-auto max-w-[920px]">
            <AgentDashboard
              agents={sim.agents}
              actions={sim.actions}
              // No-ops: sim.actions already patch the simulator's own agents
              // state directly (there's no separate network round trip to
              // react to here, unlike the real page's poll-then-patch flow).
              onCreated={() => {}}
              onStatusChange={() => {}}
              onUpdated={() => {}}
              onDeleted={() => {}}
              attentionAlertsPosition="absolute"
            />
          </div>
        </div>
      </section>
    </ScrollReveal>
  );
}
