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
      <section id="demo" className="border-b" style={{ borderColor: "var(--mk-line)" }}>
        <div className="mk-centered mx-auto max-w-[1400px] px-6 mk-section sm:px-8 lg:px-12">
          <h2 className="mk-display-sm mb-6">Drive the real dashboard.</h2>
          <p
            className="mb-10 max-w-[58ch] text-[16px] leading-[24px]"
            style={{ color: "var(--muted-ink)" }}
          >
            Not a mockup or a video. This is the same Agent Dashboard component the product ships,
            running against a simulated traffic feed. Start the traffic and watch a budget fill.
          </p>

          {/* Demo feed controls — explicitly not part of the app UI. */}
          <div
            className="mb-6 flex flex-wrap items-center justify-center gap-3 rounded-lg border border-dashed p-3.5"
            style={{ borderColor: "var(--mk-line)" }}
          >
            <span className="mk-label text-[13px]" style={{ color: "var(--faint)" }}>
              Demo feed
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
            {/* default, not brandOutline: matches create-agent-dialog.tsx's
                own trigger now — coral isn't the generic emphasised-action
                outline on the dashboard either. */}
            <Button
              type="button"
              size="sm"
              variant={sim.running ? "outline" : "default"}
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
          {/* overflow-x-auto contains the dashboard's own min-widths (its
              header button row and table don't wrap below ~520px) inside this
              panel. Without it that overflow escaped to the document and made
              the whole marketing page scroll sideways on phones. Fixed here
              rather than in AgentDashboard, which the real app also renders. */}
          <div className="relative mx-auto max-w-[920px] overflow-x-auto">
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
