import type { AgentStatus } from "@tollgate/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Exact shape returned by GET /v1/agents (api/src/routes/agents.ts). */
export interface AgentListItem {
  id: string;
  name: string;
  providerSlug: string;
  status: AgentStatus;
  maxBudgetCents: number | null;
  currentMonthSpendCents: number;
}

/** Exact shape returned by POST /v1/agents — token is present ONLY here. */
export interface CreateAgentResponse {
  id: string;
  name: string;
  providerSlug: string;
  status: AgentStatus;
  maxBudgetCents: number | null;
  token: string;
}

export interface CreateAgentInput {
  name: string;
  providerSlug: string;
  maxBudgetCents: number | null;
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
    const code =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as Record<string, unknown>)["error"])
        : null;
    throw new ApiError(code ?? `request failed (${res.status})`, res.status, code);
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

export function freezeAgent(
  id: string,
  mode: "soft" | "hard",
): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}/freeze`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

export function unfreezeAgent(id: string): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}/unfreeze`, {
    method: "POST",
  });
}
