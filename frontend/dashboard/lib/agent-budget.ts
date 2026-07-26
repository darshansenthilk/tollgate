import type { AgentListItem } from "@/lib/api";

/** Fraction of budget spent. null = unlimited (no bar/percent shown). */
export function spendFraction(spend: number, max: number | null): number | null {
  if (max === null) return null;
  if (max <= 0) return 1; // zero budget = permanently at the ceiling
  return spend / max;
}

/** Single source of truth for "over budget" — derived, not a persisted
 *  status (there's no backend column for it). Used by the flagged-first
 *  sort, the Flagged status badge, and the attention-alert transition
 *  detection alike. */
export function isOverBudget(agent: AgentListItem): boolean {
  return (spendFraction(agent.currentMonthSpendCents, agent.maxBudgetCents) ?? 0) >= 1;
}
