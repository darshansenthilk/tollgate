import type { AgentStatus } from "@tollgate/shared";
import { Badge } from "@/components/ui/badge";

/**
 * One entry per AgentStatus (@tollgate/shared) — five states, kept in sync
 * with the freeze lifecycle documented on that type: active, pending,
 * soft_frozen, hard_frozen, archived. The backend still models soft vs. hard
 * freeze separately, but the dashboard no longer distinguishes them in the
 * UI — both display as "Stopped".
 */
const STATUS_STYLE: Record<AgentStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--ok)" },
  pending: { label: "Pending", color: "var(--amber)" },
  soft_frozen: { label: "Stopped", color: "var(--err)" },
  hard_frozen: { label: "Stopped", color: "var(--err)" },
  archived: { label: "Archived", color: "var(--muted-foreground)" },
};

interface AgentStatusBadgeProps {
  status: AgentStatus;
  /** True when the agent is over budget and not already stopped/archived —
   *  overrides the "Active" pill with "Flagged" without touching the
   *  persisted AgentStatus (flagged is derived, not a backend column; see
   *  lib/agent-budget.ts's isOverBudget). */
  flagged?: boolean;
}

export function AgentStatusBadge({ status, flagged = false }: AgentStatusBadgeProps) {
  const { label, color } =
    flagged && status === "active" ? { label: "Flagged", color: "var(--err)" } : STATUS_STYLE[status];
  return (
    <Badge
      variant="outline"
      style={{
        color,
        borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)`,
      }}
    >
      {/* Leading dot reuses the status colour, so all five states get one for
          free — currentColor, no extra mapping. */}
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </Badge>
  );
}
