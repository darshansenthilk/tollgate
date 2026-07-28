import type { AgentStatus } from "@tollgate/shared";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const PROXY_URL = process.env.NEXT_PUBLIC_PROXY_URL ?? "http://localhost:8080";

/** Exact shape returned by GET /v1/agents (backend/api/src/routes/agents.ts). */
export interface AgentListItem {
  id: string;
  name: string;
  providerSlug: string;
  model: string | null;
  status: AgentStatus;
  maxBudgetCents: number | null;
  currentMonthSpendCents: number;
  /** Summed prompt+completion tokens metered this month — read live from the
   *  same Redis counter pattern as currentMonthSpendCents. */
  currentMonthTokens: number;
  /** Transient: the agent's most recent in-flight request body, kept in
   *  Redis for ~2 minutes by the proxy, never persisted to Postgres. null
   *  once nothing has run recently (or the TTL has lapsed). */
  currentPrompt: string | null;
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

/**
 * Partial update for PATCH /v1/agents/:id. Every field is optional and an
 * omitted key means "leave alone", so only genuinely-changed fields should be
 * sent. `providerSlug` is deliberately absent: the api rejects any attempt to
 * change it (provider_slug_immutable) because it's the proxy's authorization
 * boundary for which upstream an agent's token can reach.
 */
export interface UpdateAgentInput {
  name?: string;
  model?: string | null;
  maxBudgetCents?: number | null;
}

/** Exact shape returned by PATCH /v1/agents/:id — a committed agent row, no token. */
export interface UpdateAgentResponse {
  id: string;
  name: string;
  providerSlug: string;
  model: string | null;
  status: AgentStatus;
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

/**
 * Fallback copy for error codes the api doesn't attach a human `message` to
 * (e.g. backend/api/src/routes/agents.ts's `agent_not_found`/`invalid_body`).
 * `agent_name_taken` isn't listed here because that route already sends a
 * ready-to-display message (`An agent named "X" already exists`) — preferred
 * below over this table.
 */
const FRIENDLY_ERROR_MESSAGES: Record<string, string> = {
  invalid_provider_slug: "That provider isn't supported.",
  provider_slug_immutable: "An agent's assistant can't be changed after it's created.",
  agent_not_found: "That agent no longer exists.",
  agent_has_no_policy: "This agent has no budget policy to update.",
  invalid_body: "That request wasn't valid — check the fields and try again.",
  missing_token: "Paste the agent's token to continue.",
  invalid_token: "That token doesn't match this agent.",
  upstream_key_not_found: "No key is saved for that provider.",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    // Fastify's JSON body parser rejects an empty body when content-type is
    // application/json (FST_ERR_CTP_EMPTY_JSON_BODY) — only body-less unfreeze
    // hits this, so only set the header when there's actually a body to send.
    headers: init?.body === undefined ? init?.headers : { "content-type": "application/json", ...init?.headers },
    cache: "no-store",
    // Carry the Better Auth session cookie cross-origin (dashboard :3000 -> api
    // :4000). The api gates every /v1/* route on this session; without it every
    // call is 401.
    credentials: "include",
  });

  if (!res.ok) {
    // A 401 means the session is missing/expired. Bounce to sign-in rather than
    // surfacing a raw error into the table. (The middleware also guards routes,
    // but this covers a session that lapses mid-session.)
    if (res.status === 401 && typeof window !== "undefined") {
      window.location.href = "/sign-in";
    }
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

/**
 * One provider's BYOK status. Deliberately has no field for the key itself —
 * the api never returns a stored key (write-once-reveal-never, same as agent
 * tokens); `keyHint` is a non-secret display fragment like "sk-…7mQ4".
 */
export interface UpstreamKeyStatus {
  slug: string;
  label: string;
  isSet: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  /** Whether Tollgate's own shared key covers this provider when the org
   *  hasn't set one — i.e. whether "Not set" still works or is actually broken. */
  fallbackAvailable: boolean;
}

export interface UpstreamKeysResponse {
  /** False when the deployment can't store keys at all (no VAULT_ENCRYPTION_KEY
   *  on the api), so the UI can explain a save failure that isn't the user's. */
  vaultConfigured: boolean;
  providers: UpstreamKeyStatus[];
}

export function listUpstreamKeys(): Promise<UpstreamKeysResponse> {
  return request<UpstreamKeysResponse>("/v1/upstream-keys");
}

/**
 * Saves (or rotates) this org's own provider key. The api verifies it against
 * the real provider BEFORE storing, so a rejected key throws an ApiError whose
 * message is the provider's own reason — surface it verbatim.
 */
export function saveUpstreamKey(
  providerSlug: string,
  key: string,
): Promise<{ slug: string; isSet: boolean; keyHint: string; updatedAt: string }> {
  return request("/v1/upstream-keys", {
    method: "PUT",
    body: JSON.stringify({ providerSlug, key }),
  });
}

/** Removes this org's key, reverting to whatever the deployment fallback is. */
export function deleteUpstreamKey(providerSlug: string): Promise<{ slug: string; isSet: boolean }> {
  return request(`/v1/upstream-keys/${providerSlug}`, { method: "DELETE" });
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

/**
 * Edits an existing agent in place — keeps its id, token, and accumulated
 * spend. Send only the fields that actually changed; see UpdateAgentInput.
 */
export function updateAgent(
  id: string,
  input: UpdateAgentInput,
): Promise<UpdateAgentResponse> {
  return request<UpdateAgentResponse>(`/v1/agents/${id}`, {
    method: "PATCH",
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
 * Stop (soft-freeze) an agent. Authorized by the caller's session + org
 * membership — the api gates /v1/* and scopes to the active org, so no per-agent
 * token is needed anymore. An agent in another org (or a missing one) returns
 * 404.
 */
export function freezeAgent(id: string, mode: "soft" | "hard"): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}/freeze`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

/** Resume (unfreeze) an agent — same session + org authorization as freezeAgent. */
export function unfreezeAgent(id: string): Promise<AgentMutationResponse> {
  return request<AgentMutationResponse>(`/v1/agents/${id}/unfreeze`, {
    method: "POST",
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
