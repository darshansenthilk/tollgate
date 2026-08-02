import type { AgentStatus } from "@tollgate/shared";
import { authClient } from "./auth-client";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const PROXY_URL = process.env.NEXT_PUBLIC_PROXY_URL ?? "http://localhost:8080";

/**
 * Handles a 401 from any /v1/* call by actually signing out — not just
 * navigating to /sign-in — before redirecting.
 *
 * The bug this fixes: middleware.ts's route gate is deliberately "optimistic"
 * (checks only whether the session COOKIE is present, not whether the
 * session it names is still valid server-side — see its own doc comment for
 * why). A stale-but-present cookie (expired, revoked, or otherwise rejected
 * by the api) used to produce an infinite redirect loop: a 401 here sent the
 * browser to /sign-in via a bare `window.location.href`, but the cookie was
 * still sitting in the browser, so middleware's own
 * `if (sessionCookie && isAuthPage) redirect("/agents")` bounced it straight
 * back — landing back on this same 401, forever, with no backoff between
 * cycles (confirmed live: a freshly-restarted, empty-bucket rate limiter was
 * exhausted within under a second of the loop starting).
 *
 * Calling signOut() first actually clears the cookie server-side, so by the
 * time /sign-in loads, middleware correctly finds no cookie and lets the
 * page render instead of bouncing it away again. `handling401` guards
 * against a burst of concurrent 401s (e.g. several in-flight requests
 * failing around the same moment) each independently kicking off their own
 * sign-out + redirect.
 */
let handling401 = false;
async function handleUnauthorized(): Promise<void> {
  if (handling401) return;
  handling401 = true;
  try {
    await authClient.signOut();
  } catch {
    // Best-effort — staying on a page that will keep 401ing is worse than
    // redirecting with a session that failed to sign out cleanly.
  } finally {
    window.location.href = "/sign-in";
  }
}

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
  /** Which stored BYOK key (see UpstreamKey.id) this agent forwards with, if
   *  any. null means no specific key chosen — the proxy falls straight
   *  through to the deployment's shared key. See backend/proxy/src/lib/vault.ts. */
  upstreamKeyId: string | null;
}

/** Exact shape returned by POST /v1/agents — token is present ONLY here. */
export interface CreateAgentResponse {
  id: string;
  name: string;
  providerSlug: string;
  model: string | null;
  status: AgentStatus;
  maxBudgetCents: number | null;
  upstreamKeyId: string | null;
  token: string;
}

export interface CreateAgentInput {
  name: string;
  providerSlug: string;
  maxBudgetCents: number | null;
  model: string | null;
  upstreamKeyId?: string | null;
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
  upstreamKeyId?: string | null;
}

/** Exact shape returned by PATCH /v1/agents/:id — a committed agent row, no token. */
export interface UpdateAgentResponse {
  id: string;
  name: string;
  providerSlug: string;
  model: string | null;
  status: AgentStatus;
  maxBudgetCents: number | null;
  upstreamKeyId: string | null;
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
  upstream_key_not_found: "That key no longer exists.",
  invalid_upstream_key: "That key isn't valid for this agent's provider.",
  upstream_credential_incomplete:
    "This provider key is missing something it needs — re-save it in Settings.",
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
    // A 401 means the session is missing/expired. Sign out (clears the
    // cookie) then bounce to sign-in, rather than surfacing a raw error into
    // the table — see handleUnauthorized's doc comment for why this has to
    // actually sign out, not just navigate.
    if (res.status === 401 && typeof window !== "undefined") {
      void handleUnauthorized();
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
 * One stored BYOK key. Deliberately has no field for the key itself — the api
 * never returns a stored key (write-once-reveal-never, same as agent tokens);
 * `keyHint` is a non-secret display fragment like "sk-…7mQ4". `label` is the
 * org-chosen name ("Prod", "Jane's key") that distinguishes it from any other
 * key stored for the same provider — an org can have several.
 */
export interface UpstreamKey {
  id: string;
  label: string;
  keyHint: string;
  /** Non-secret credential fields only (an Azure resource name, a Bedrock
   *  region) so the UI can show which resource a key points at. Secrets are
   *  never returned by any route — see the api's upstream-keys module doc. */
  config: Record<string, string>;
  updatedAt: string;
}

export interface UpstreamKeyProvider {
  slug: string;
  label: string;
  keys: UpstreamKey[];
}

export interface UpstreamKeysResponse {
  /** False when the deployment can't store keys at all (no VAULT_ENCRYPTION_KEY
   *  on the api), so the UI can explain a save failure that isn't the user's. */
  vaultConfigured: boolean;
  providers: UpstreamKeyProvider[];
}

export function listUpstreamKeys(): Promise<UpstreamKeysResponse> {
  return request<UpstreamKeysResponse>("/v1/upstream-keys");
}

/**
 * Adds a new key for a provider, or rotates the existing one if `label`
 * matches an already-saved key for that provider. The api verifies it against
 * the real provider BEFORE storing, so a rejected key throws an ApiError whose
 * message is the provider's own reason — surface it verbatim. Omitting
 * `label` saves under "Default", for callers that don't need to distinguish
 * multiple keys.
 */
export function saveUpstreamKey(
  providerSlug: string,
  /** Keyed by CredentialField.name — a single { apiKey } for most providers,
   *  or several for Azure/Bedrock. See @tollgate/shared's UPSTREAM_PROVIDERS. */
  fields: Record<string, string>,
  label?: string,
): Promise<{
  id: string;
  providerSlug: string;
  label: string;
  keyHint: string;
  config: Record<string, string>;
  updatedAt: string;
}> {
  return request("/v1/upstream-keys", {
    method: "POST",
    body: JSON.stringify({ providerSlug, fields, label }),
  });
}

/** Removes one stored key by id. Any agent assigned to it falls back to the
 *  deployment's shared key on its next request. */
export function deleteUpstreamKey(id: string): Promise<{ id: string; deleted: boolean }> {
  return request(`/v1/upstream-keys/${id}`, { method: "DELETE" });
}

/**
 * One row of the activity log: a single request an agent made, allowed or
 * denied. `model` is what the provider reported actually serving, which can
 * differ from the agent's descriptive model label (the proxy doesn't enforce
 * that label). Null for denials, since nothing ran.
 */
export interface ActivityEvent {
  id: string;
  agentId: string;
  agentName: string;
  /** Assistant label the agent was created with ("chatgpt" / "claude"). */
  assistant: string;
  model: string | null;
  endpoint: string;
  decision: "allowed" | "denied_budget" | "denied_rate" | "denied_endpoint" | "denied_frozen";
  costCents: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  upstreamStatus: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export function listActivity(limit = 100): Promise<ActivityEvent[]> {
  return request<ActivityEvent[]>(`/v1/activity?limit=${limit}`);
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
