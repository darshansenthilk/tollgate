import type { AgentStatus } from "@tollgate/shared";

/** The statuses that mean "this agent is stopped" — the backend still models
 *  soft vs. hard separately, but the UI treats both as one stopped state (see
 *  the AgentStatus doc comment in backend/shared/src/index.ts). */
export const STOPPED_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "soft_frozen",
  "hard_frozen",
]);

export function isStopped(status: AgentStatus): boolean {
  return STOPPED_STATUSES.has(status);
}
