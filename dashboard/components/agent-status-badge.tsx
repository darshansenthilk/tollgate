import type { AgentStatus } from "@tollgate/shared";
import { Badge } from "@/components/ui/badge";

/**
 * One entry per AgentStatus (@tollgate/shared) — five states, kept in sync
 * with the freeze lifecycle documented on that type: active, pending,
 * soft_frozen, hard_frozen, archived.
 */
const STATUS_STYLE: Record<AgentStatus, { label: string; color: string }> = {
  active: { label: "Active", color: "var(--ok)" },
  pending: { label: "Pending", color: "var(--amber)" },
  soft_frozen: { label: "Soft frozen", color: "var(--amber)" },
  hard_frozen: { label: "Hard frozen", color: "var(--err)" },
  archived: { label: "Archived", color: "var(--muted-foreground)" },
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const { label, color } = STATUS_STYLE[status];
  return (
    <Badge
      variant="outline"
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
