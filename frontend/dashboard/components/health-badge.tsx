"use client";

import { Badge } from "@/components/ui/badge";

/**
 * Service health chip for the System status page — the health-domain analogue
 * of AgentStatusBadge, built the same way (an outline Badge tinted from a
 * functional status token via color-mix). Brand coral is deliberately NOT used
 * here: health is functional status, so it stays on the green/amber/red trio,
 * per the palette rule in globals.css.
 *
 * "use client" is required because Badge calls a hook (useRender) and this
 * badge is rendered by the server-component status page — the directive makes
 * it a client leaf across that boundary. `state` is a plain string, so it
 * crosses the boundary cleanly.
 */
export type HealthState = "up" | "degraded" | "down";

const HEALTH_STYLE: Record<HealthState, { label: string; color: string }> = {
  up: { label: "UP", color: "var(--ok)" },
  degraded: { label: "DEGRADED", color: "var(--amber)" },
  down: { label: "DOWN", color: "var(--err)" },
};

export function HealthBadge({ state }: { state: HealthState }) {
  const { label, color } = HEALTH_STYLE[state];
  return (
    <Badge
      variant="outline"
      className="font-mono"
      style={{
        color,
        borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`,
      }}
    >
      {label}
    </Badge>
  );
}
