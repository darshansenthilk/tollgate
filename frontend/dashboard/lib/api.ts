import type { AgentStatus } from "@tollgate/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Exact shape returned by GET /v1/agents (backend/api/src/routes/agents.ts). */
export interface AgentListItem {
  id: string;
  name: string;
  providerSlug: string;
  model: string | null;
  status: AgentStatus;
  maxBudgetCents: number | null;
  currentMonthSpendCents: number;
}

/** Exact shape returned by POST /v1/agents — token is present ONLY here. */
export interface CreateAgentResponse {
  id: string;
  name: string;
  providerSlug: string;
  model: string | null;
  status: AgentStatus;
  maxBudgetCents: number | null;
  token: string;
}

export interface CreateAgentInput {
  name: string;
  providerSlug: string;
  maxBudgetCents: number | null;
  model: string | null;
}

/** Shared shape of POST .../freeze, POST .../unfreeze, PATCH .../policy. */
export interface AgentMutationResponse {
  id: string;
  status?: AgentStatus;
  maxBudgetCents?: number | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Fallback copy for error codes the api doesn't attach a human `message` to
 * (e.g. backend/api/src/routes/agents.ts's `agent_not_found`/`invalid_body`).
 * `agent_name_taken` isn't listed here because that route already sends a
 * ready-to-display message (`An agent named "X" already exists`) — preferred
 * below over this table.
 */
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  invalid_provider_slug: "That provider isn't supported.",
  agent_not_found: "That agent no longer exists.",
  agent_has_no_policy: "This agent has no budget policy to update.",
  invalid_body: "That request wasn't valid — check the fields and try again.",
  missing_token: "Paste the agent's token to continue.",
  invalid_token: "That token doesn't match this agent.",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Fastify's JSON body parser rejects an empty body when content-type is
    // application/json (FST_ERR_CTP_EMPTY_JSON_BODY) — only body-less unfreeze
    // hits this, so only set the header when there's actually a body to send.
    headers: init?.body === undefined ? init?.headers : { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
  });

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const rec = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
    const code = rec !== null && "error" in rec ? String(rec["error"]) : null;
    const serverMessage = rec !== null && typeof rec["message"] === "string" ? rec["message"] : null;
    const message =
      serverMessage ??
      (code !== null ? FRIENDLY_ERROR_MESSAGES[code] : undefined) ??
      code ??
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status, code);
  }

  return res.json() as Promise<T>;
}

export function listAgents(): Promise<AgentListItem[]> {
  return request<AgentListItem[]>("/v1/agents");
}

export function createAgent(input: CreateAgentInput): Promise<CreateAgentResponse> {
  return request<CreateAgentResponse>("/v1/agents", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAgentPolicy(
  id: string,
  maxBudgetCents: number | null,
): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}/policy`, {
    method: "PATCH",
    body: JSON.stringify({ maxBudgetCents }),
  });
}

/**
 * `token` is sent as `Authorization: Bearer <token>` and checked by
 * backend/api/src/routes/agents.ts's freeze handler against the agent's own
 * token hash — a missing or mismatched token gets a 401 (missing_token /
 * invalid_token).
 */
export function freezeAgent(
  id: string,
  mode: "soft" | "hard",
  token: string,
): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}/freeze`, {
    method: "POST",
    body: JSON.stringify({ mode }),
    headers: { authorization: `Bearer ${token}` },
  });
}

/** See freezeAgent's doc comment — same token enforcement applies here. */
export function unfreezeAgent(id: string, token: string): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}/unfreeze`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Archives the agent (backend/api/src/routes/agents.ts sets status to
 * "archived" and revokes it via the same Redis freeze flag other status
 * transitions use) — not a hard row delete, consistent with the "archived"
 * AgentStatus semantics.
 */
export function deleteAgent(id: string): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}`, {
    method: "DELETE",
  });
}
