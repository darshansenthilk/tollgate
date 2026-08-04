import type { AgentStatus } from "@tollgate/shared";
import type {
  AgentListItem,
  CreateAgentResponse,
  UpdateAgentResponse,
} from "@/lib/api";

/**
 * Pure "how does the agents array change" functions, extracted so both the
 * real dashboard (patching state from real api responses) and the marketing
 * page's demo simulator (patching state from simulated ones) apply identical
 * logic — the shape of the response is the same either way.
 */

export function applyCreated(
  prev: AgentListItem[],
  created: CreateAgentResponse,
): AgentListItem[] {
  const item: AgentListItem = {
    id: created.id,
    name: created.name,
    providerSlug: created.providerSlug,
    model: created.model,
    status: created.status,
    maxBudgetCents: created.maxBudgetCents,
    currentMonthSpendCents: 0,
    currentMonthTokens: 0,
    currentPrompt: null,
    upstreamKeyId: created.upstreamKeyId,
    systemPrompt: created.systemPrompt,
    blockedTools: created.blockedTools,
    toolDefinitions: created.toolDefinitions,
  };
  return [item, ...prev];
}

export function applyStatusChange(
  prev: AgentListItem[],
  id: string,
  status: AgentStatus,
): AgentListItem[] {
  return prev.map((a) => (a.id === id ? { ...a, status } : a));
}

/** PATCH /v1/agents/:id returns the committed row, so swap it straight in
 *  rather than waiting for the next poll. */
export function applyUpdated(
  prev: AgentListItem[],
  updated: UpdateAgentResponse,
): AgentListItem[] {
  return prev.map((a) =>
    a.id === updated.id
      ? {
          ...a,
          name: updated.name,
          providerSlug: updated.providerSlug,
          model: updated.model,
          status: updated.status,
          maxBudgetCents: updated.maxBudgetCents,
          upstreamKeyId: updated.upstreamKeyId,
          systemPrompt: updated.systemPrompt,
          blockedTools: updated.blockedTools,
          toolDefinitions: updated.toolDefinitions,
        }
      : a,
  );
}

export function applyDeleted(prev: AgentListItem[], ids: string[]): AgentListItem[] {
  const idSet = new Set(ids);
  return prev.filter((a) => !idSet.has(a.id));
}
