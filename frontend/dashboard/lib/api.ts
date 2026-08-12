import type { AgentStatus, ToolDefinition, DashboardPermissionAction } from "@tollgate/shared";
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
  /** Prepended to every request this agent sends — see @tollgate/shared
   *  Policy.systemPrompt's doc comment. null = nothing injected. */
  systemPrompt: string | null;
  /** Tool/function names the proxy blocks from this agent's responses — see
   *  @tollgate/shared Policy.blockedTools's doc comment. null = nothing blocked. */
  blockedTools: string[] | null;
  /** Tools injected into every outgoing request across all providers — see
   *  @tollgate/shared ToolDefinition's doc comment. null = nothing configured
   *  (the calling app's own tools, if any, pass through unchanged). */
  toolDefinitions: ToolDefinition[] | null;
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
  systemPrompt: string | null;
  blockedTools: string[] | null;
  toolDefinitions: ToolDefinition[] | null;
  token: string;
}

export interface CreateAgentInput {
  name: string;
  providerSlug: string;
  maxBudgetCents: number | null;
  model: string | null;
  upstreamKeyId?: string | null;
  systemPrompt: string | null;
  blockedTools: string[] | null;
  toolDefinitions: ToolDefinition[] | null;
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
  systemPrompt?: string | null;
  blockedTools?: string[] | null;
  toolDefinitions?: ToolDefinition[] | null;
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
  systemPrompt: string | null;
  blockedTools: string[] | null;
  toolDefinitions: ToolDefinition[] | null;
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
  dashboard_id_immutable: "An agent can't be moved to a different dashboard.",
  agent_not_found: "That agent no longer exists.",
  dashboard_not_found: "That dashboard no longer exists.",
  // Only reachable from a client bug — every caller sends the active dashboard's
  // id — so it reads as "reload" rather than asking the user to supply anything.
  dashboard_id_required: "Couldn't tell which dashboard this is. Try reloading.",
  agent_has_no_policy: "This agent has no budget policy to update.",
  invalid_body: "That request wasn't valid — check the fields and try again.",
  missing_token: "Paste the agent's token to continue.",
  invalid_token: "That token doesn't match this agent.",
  upstream_key_not_found: "That key no longer exists.",
  approval_request_not_found: "That request was already handled.",
  local_llm_unavailable:
    "The local model isn't responding — check the Ollama service on your deployment.",
  install_wizard_unavailable: "The install-wizard assistant isn't available right now.",
  invalid_upstream_key: "That key isn't valid for this agent's provider.",
  upstream_credential_incomplete:
    "This provider key is missing something it needs — re-save it in Settings.",
  dashboard_member_user_not_found: "No Tollgate account found with that email.",
  dashboard_member_is_self: "You cannot add yourself to this dashboard.",
  dashboard_member_is_host: "You cannot add an account that is already in this dashboard.",
  dashboard_member_already_exists: "You cannot add an account that is already in this dashboard.",
  dashboard_member_not_found: "That person no longer has access to this dashboard.",
  dashboard_host_required: "Only this dashboard's host can do that.",
  // Answered for a role id that isn't this dashboard's (another dashboard's,
  // malformed, or already deleted) — the api deliberately can't tell those
  // apart, so neither can this copy. The three role REFUSALS
  // (dashboard_role_name_exists / _too_long / _is_default / _in_use /
  // _limit_reached) all arrive with a server `message` and so need no entry
  // here — dashboard_role_in_use's especially, since its whole payload is the
  // account count the api composed into the sentence.
  dashboard_role_not_found: "That role no longer exists on this dashboard.",
  dashboard_permission_denied: "Your role on this dashboard doesn't allow that.",
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

/** Which sign-in methods this deployment offers. SSO is present only on
 *  self-hosted builds that configured an IdP — see the api's
 *  routes/auth-capabilities.ts and lib/sso.ts. */
export interface AuthCapabilities {
  emailPassword: boolean;
  sso: { enabled: false } | { enabled: true; providerId: string; label: string };
}

/**
 * Deliberately does NOT go through request().
 *
 * Two reasons, both about where this is called from — the signed-out sign-in
 * page:
 *  1. request() treats a 401 as "session expired" and fires signOut() + a
 *     redirect to /sign-in. From /sign-in itself that is a redirect back to
 *     the same page, i.e. exactly the loop shape that was a real production
 *     bug here before (see handleUnauthorized's doc comment). This endpoint is
 *     public and shouldn't 401, but routing it through machinery that reacts
 *     that way to an unexpected status is a trap not worth leaving armed.
 *  2. It must never block sign-in. If the api is unreachable or older than
 *     this dashboard (no such route ⇒ 404), the honest answer is "no SSO" and
 *     a working email+password form — not a thrown error on the login screen.
 *     Hence the swallowed failure and the conservative fallback.
 */
export async function getAuthCapabilities(): Promise<AuthCapabilities> {
  const fallback: AuthCapabilities = { emailPassword: true, sso: { enabled: false } };
  try {
    const res = await fetch(`${API_URL}/v1/auth/capabilities`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as AuthCapabilities;
  } catch {
    return fallback;
  }
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
  decision:
    | "allowed"
    | "denied_budget"
    | "denied_rate"
    | "denied_endpoint"
    | "denied_frozen"
    | "denied_tool"
    // Operator decisions on a blocked tool call, written by the api rather
    // than the proxy — see @tollgate/shared SpendDecision.
    | "approval_granted"
    | "approval_denied";
  costCents: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  upstreamStatus: number | null;
  latencyMs: number | null;
  /** The request body this event was forwarded with, so a row can be opened to
   *  see what the agent actually asked. Null when nothing was forwarded (a
   *  denial caught before the upstream call) and on operator-decision rows. */
  prompt: string | null;
  createdAt: string;
}

/**
 * Activity for ONE dashboard. `dashboardId` is required by the api — dashboards
 * are independent, and an org-wide feed would name agents from dashboards the
 * caller isn't looking at.
 */
export function listActivity(dashboardId: string, limit = 100): Promise<ActivityEvent[]> {
  return request<ActivityEvent[]>(
    `/v1/activity?limit=${limit}&dashboardId=${encodeURIComponent(dashboardId)}`,
  );
}

/**
 * One blocked tool call awaiting a human decision, from GET /v1/approvals —
 * pending rows only, so this list IS the operator's queue.
 */
export interface ApprovalRequest {
  id: string;
  agentId: string;
  agentName: string;
  toolName: string;
  status: "pending";
  createdAt: string;
}

export interface ApprovalResolution {
  id: string;
  status: "approved" | "denied";
}

export function listApprovals(): Promise<ApprovalRequest[]> {
  return request<ApprovalRequest[]>("/v1/approvals");
}

/**
 * Lets the agent's NEXT attempt at this tool through, once. Deliberately not
 * a policy edit — the tool stays on the agent's blocklist, so a later call
 * raises a fresh request. See backend/api/src/routes/approvals.ts.
 */
export function approveRequest(id: string): Promise<ApprovalResolution> {
  return request<ApprovalResolution>(`/v1/approvals/${id}/approve`, { method: "POST" });
}

/** Closes the queue entry without granting anything. The agent trying again
 *  re-raises a new request rather than being permanently silenced. */
export function denyRequest(id: string): Promise<ApprovalResolution> {
  return request<ApprovalResolution>(`/v1/approvals/${id}/deny`, { method: "POST" });
}

/**
 * A drafted agent configuration from the deployment's own local model. Every
 * field is a SUGGESTION that pre-fills the create form — nothing is created
 * until the operator reviews it and submits. See backend/api/src/routes/
 * agent-draft.ts.
 */
export interface AgentDraft {
  name: string | null;
  systemPrompt: string | null;
  blockedTools: string[];
  maxBudgetCents: number | null;
}

/** Whether a local model is configured AND pulled. False on a deployment that
 *  never started the optional Ollama service, which is the expected case —
 *  the dialog hides the wizard rather than offering a failing button. */
export function isDraftAvailable(): Promise<{ available: boolean }> {
  return request<{ available: boolean }>("/v1/agents/draft/availability");
}

/**
 * A token-waste finding: the static block an agent re-sends on every request.
 * Advisory only — see backend/api/src/routes/suggestions.ts.
 */
export interface PromptSuggestion {
  agentId: string;
  agentName: string;
  sample: string;
  repeatedTokens: number;
  /** 0..1 share of sampled requests carrying the block. */
  frequency: number;
  position: "prefix" | "suffix";
  sampledRequests: number;
  /** Null when the model has no known price — reported as unknown, never as
   *  zero, since "this costs nothing" would be the wrong conclusion. */
  wasteCents: number | null;
}

export function listSuggestions(): Promise<PromptSuggestion[]> {
  return request<PromptSuggestion[]>("/v1/suggestions");
}

export function draftAgent(description: string): Promise<AgentDraft> {
  return request<AgentDraft>("/v1/agents/draft", {
    method: "POST",
    body: JSON.stringify({ description }),
  });
}

/**
 * The public marketing site's install-wizard assistant (/get-started) — a
 * hosted model, unlike draftAgent's local one, since a pre-install visitor
 * has no Tollgate backend of their own to run a local model against yet. See
 * backend/api/src/lib/install-wizard-assistant.ts.
 */
export function isInstallWizardAvailable(): Promise<{ available: boolean }> {
  return request<{ available: boolean }>("/v1/install-wizard/availability");
}

export function askInstallWizard(question: string): Promise<{ answer: string }> {
  return request<{ answer: string }>("/v1/install-wizard/ask", {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

/** Agents in ONE dashboard. Required, not optional: an omitted id used to mean
 *  "every agent in the org", which is what made every dashboard show the same
 *  list. The api rejects the call rather than falling back to that. */
export function listAgents(dashboardId: string): Promise<AgentListItem[]> {
  return request<AgentListItem[]>(
    `/v1/agents?dashboardId=${encodeURIComponent(dashboardId)}`,
  );
}

/**
 * Creates an agent inside `dashboardId`.
 *
 * The dashboard is a separate argument rather than a field on CreateAgentInput
 * because that type is also implemented by the marketing page's demo simulator
 * (via AgentDashboardActions), which has no dashboard concept at all. Keeping it
 * out of the input shape is what lets the shared AgentDashboard component and the
 * demo stay untouched by this feature — /agents supplies the id by wrapping this
 * function instead.
 */
export function createAgent(
  input: CreateAgentInput,
  dashboardId: string,
): Promise<CreateAgentResponse> {
  return request<CreateAgentResponse>("/v1/agents", {
    method: "POST",
    body: JSON.stringify({ ...input, dashboardId }),
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

/** Exact shape returned by every /v1/dashboards route (backend/api/src/routes/dashboards.ts). */
export interface Dashboard {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * What GET /v1/dashboards adds on top of Dashboard. Only the list route carries
 * the counts — the api keeps them off the shared shape rather than widening
 * every dashboard response — and the delete confirmation can't be built without
 * them: the alternative is one listAgents() per tile, an N+1 against a
 * 300 req/min limit with 3s polls already running.
 */
export interface DashboardListItem extends Dashboard {
  /** Non-archived agents (active + pending + soft_frozen + hard_frozen). What
   *  the confirmation shows, and `0` is what skips the confirmation entirely.
   *  It does NOT mean the dashboard is empty in the database — agents deleted
   *  one by one leave archived rows behind that this count excludes. */
  agentCount: number;
  /** The subset that can still spend. Non-zero is what escalates the copy from
   *  "this dashboard has N agents" to "deleting revokes their tokens". */
  liveAgentCount: number;
}

/** Every dashboard in the caller's active org, in creation order. */
export function listDashboards(): Promise<DashboardListItem[]> {
  return request<DashboardListItem[]>("/v1/dashboards");
}

/**
 * Creates a dashboard and — server-side — makes it the caller's active one, so
 * callers can navigate straight to /agents without a follow-up selectDashboard.
 */
export function createDashboard(name: string): Promise<Dashboard> {
  return request<Dashboard>("/v1/dashboards", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/**
 * The dashboard this user currently has open, or null if they've never selected
 * one — the empty-state signal /agents branches on. The api wraps the value in a
 * `{ dashboard }` envelope because a Fastify handler can't return a bare null
 * body; unwrap it here so callers only deal with `Dashboard | null`.
 */
export async function getActiveDashboard(): Promise<Dashboard | null> {
  const { dashboard } = await request<{ dashboard: Dashboard | null }>("/v1/dashboards/active");
  return dashboard;
}

/**
 * Renames a dashboard in place — it keeps its id, so whoever has it selected
 * stays on it and just sees the new name. Same 50-character cap the create
 * route enforces.
 */
export function renameDashboard(id: string, name: string): Promise<Dashboard> {
  return request<Dashboard>(`/v1/dashboards/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/**
 * Switches the caller's active dashboard. Scoped to the active org by the api,
 * so another org's (or a deleted) dashboard comes back as dashboard_not_found.
 */
export function selectDashboard(id: string): Promise<Dashboard> {
  return request<Dashboard>(`/v1/dashboards/${id}/select`, {
    method: "POST",
  });
}

/** What DELETE /v1/dashboards/:id answers with. Not a 204: request() always
 *  calls res.json(), so an empty body would throw a SyntaxError *after* a
 *  delete that already committed and paint "Request failed" over a success. */
export interface DeleteDashboardResponse {
  id: string;
  name: string;
  /** How many agents the delete just revoked — the ones that were still live
   *  in it, not the ones already archived. */
  archivedAgentCount: number;
  /** The caller's selection AFTER the delete: the org's oldest surviving
   *  dashboard if they had the deleted one open, whatever they already had open
   *  if not, and null only when nothing survives. Returned so the grid can move
   *  the active ring without a follow-up fetch. */
  activeDashboard: Dashboard | null;
}

/**
 * Deletes a dashboard and revokes every agent token inside it.
 *
 * Soft-deletes server-side (spend_events and their FK chain have to survive for
 * billing) but nothing in the app can reach it afterwards — the id 404s from
 * every route, including the dashboard's own agents. Body-less: the
 * type-the-name step in the confirmation is a UI speed bump and is deliberately
 * not sent, since dashboard names aren't unique and so prove nothing about
 * which row was meant. A repeat delete answers 404, which callers should read
 * as "already gone" rather than as a failure.
 */
export function deleteDashboard(id: string): Promise<DeleteDashboardResponse> {
  return request<DeleteDashboardResponse>(`/v1/dashboards/${id}`, {
    method: "DELETE",
  });
}

/** One person with access to a dashboard — the host, or someone added to it. */
export interface DashboardUser {
  id: string;
  email: string;
}

/**
 * One assignable role on a dashboard. A ROW now, not a compile-time union —
 * the host creates and deletes these from the permissions popup — so it's
 * addressed everywhere by `id`, never by name (see the api's own
 * DashboardRoleJson). Only the 6 ACTIONS stayed compile-time; see
 * @tollgate/shared's "Dashboard permissions" section for the asymmetry.
 */
export interface DashboardRole {
  id: string;
  name: string;
  /** The seeded "Observer" every dashboard is born with — what a new member is
   *  assigned, and the one role that can never be deleted. Exactly one role per
   *  dashboard carries it. */
  isDefault: boolean;
}

/** A DashboardUser plus when they were added and their role — only added
 *  members carry either, not the host (the host isn't a dashboard_members
 *  row; see schema.ts). The role arrives inline as { id, name } so a member row
 *  can be labelled without the separate roles fetch having succeeded. */
export interface DashboardMember extends DashboardUser {
  addedAt: string;
  role: Pick<DashboardRole, "id" | "name">;
}

/** What GET /v1/dashboards/:id/members answers with — the share dialog's list. */
export interface DashboardMembersResponse {
  /** Whoever created the dashboard. Can be null for a dashboard whose org had
   *  no "owner"-role member to backfill onto at migration time — the dialog
   *  should treat that as "unknown host", not throw. */
  host: DashboardUser | null;
  members: DashboardMember[];
}

/** The share dialog's list of who currently has access. */
export function listDashboardMembers(dashboardId: string): Promise<DashboardMembersResponse> {
  return request<DashboardMembersResponse>(`/v1/dashboards/${dashboardId}/members`);
}

/**
 * Grants one user access to a dashboard by email, on the dashboard's default
 * (Observer) role. 404s as dashboard_member_user_not_found when the email has
 * no Tollgate account — there's no email-sending integration in this app, so
 * that's a dead end for now rather than a pending invite. Adding someone who
 * already has access is a 400 (dashboard_member_already_exists, or
 * dashboard_member_is_host for the host's own address), NOT the idempotent
 * success it used to be.
 */
export function addDashboardMember(dashboardId: string, email: string): Promise<DashboardMember> {
  return request<DashboardMember>(`/v1/dashboards/${dashboardId}/members`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** What PATCH /v1/dashboards/:id/members/:userId answers with — just enough
 *  to patch the one row that changed in local state, not a full DashboardMember
 *  (the api doesn't re-look-up the target's email for this). */
export interface UpdateDashboardMemberRoleResponse {
  userId: string;
  role: Pick<DashboardRole, "id" | "name">;
}

/**
 * Reassigns a member's role, by role id. Host-only — the api 403s as
 * dashboard_host_required for any other caller, including another member.
 * Never called for the host's own row, which has no role to change (see
 * DashboardMember's doc comment). A role id that isn't this dashboard's 404s
 * as dashboard_role_not_found rather than 403ing, so it can't be used to probe
 * which role ids exist.
 */
export function updateDashboardMemberRole(
  dashboardId: string,
  userId: string,
  roleId: string,
): Promise<UpdateDashboardMemberRoleResponse> {
  return request<UpdateDashboardMemberRoleResponse>(
    `/v1/dashboards/${dashboardId}/members/${userId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ roleId }),
    },
  );
}

/** What DELETE /v1/dashboards/:id/members/:userId answers with — just the
 *  removed id, echoed back rather than left as an empty body (request()
 *  always calls res.json(); see DeleteDashboardResponse's own doc comment). */
export interface RemoveDashboardMemberResponse {
  userId: string;
}

/**
 * Removes a member's access — host-only, mirrors updateDashboardMemberRole.
 * The api 403s as dashboard_host_required for any other caller. Re-adding
 * the same person later (addDashboardMember) inserts a fresh row, so their
 * role resets to the dashboard's default (Observer) rather than remembering
 * whatever role they held before removal.
 */
export function removeDashboardMember(
  dashboardId: string,
  userId: string,
): Promise<RemoveDashboardMemberResponse> {
  return request<RemoveDashboardMemberResponse>(
    `/v1/dashboards/${dashboardId}/members/${userId}`,
    {
      method: "DELETE",
    },
  );
}

/** Dashboards shared WITH the caller (they're in dashboard_members, not the
 *  host) — the data source for /dashboards/shared. Cross-org by design: see
 *  PLAN.md's D1. */
export function listSharedDashboards(): Promise<DashboardListItem[]> {
  return request<DashboardListItem[]>("/v1/dashboards/shared");
}

/**
 * Every role on a dashboard, default first then creation order — the option
 * list for BOTH dialogs. Deliberately NOT host-only on the api: a member
 * already sees role names on every row of the share dialog, so host-gating it
 * would break that dialog for exactly the people it exists to show.
 */
export function listDashboardRoles(dashboardId: string): Promise<DashboardRole[]> {
  return request<DashboardRole[]>(`/v1/dashboards/${dashboardId}/roles`);
}

/**
 * Host-only: creates a role, with every permission toggle off. 400s on a
 * duplicate name (dashboard_role_name_exists) — CASE-INSENSITIVELY, so
 * "editor" collides with an existing "Editor", and no role can be called
 * "Observer" in any casing — on an over-cap name (dashboard_role_name_too_long)
 * and once the dashboard is full (dashboard_role_limit_reached).
 */
export function createDashboardRole(dashboardId: string, name: string): Promise<DashboardRole> {
  return request<DashboardRole>(`/v1/dashboards/${dashboardId}/roles`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** What DELETE /v1/dashboards/:id/roles/:roleId answers with — the id echoed
 *  back rather than an empty body, since request() always calls res.json()
 *  (see DeleteDashboardResponse's own doc comment). */
export interface DeleteDashboardRoleResponse {
  id: string;
}

/**
 * Host-only: deletes a role and its permission toggles.
 *
 * Two refusals, both 400 and both carrying the copy to show verbatim:
 *  - `dashboard_role_is_default` — the Observer role can never be deleted, and
 *    this is checked FIRST, so it's the answer even when nobody holds it.
 *  - `dashboard_role_in_use` — somebody currently has this role. THE COUNT OF
 *    HOLDERS ARRIVES INSIDE err.message ("…because 2 accounts currently have
 *    it.") and nowhere else: there is no memberCount field, and deliberately
 *    no list of who, so the caller must render the message rather than
 *    composing its own sentence.
 *
 * A repeat delete answers 404, which callers should read as "already gone",
 * the same convention deleteDashboard uses.
 */
export function deleteDashboardRole(
  dashboardId: string,
  roleId: string,
): Promise<DeleteDashboardRoleResponse> {
  return request<DeleteDashboardRoleResponse>(`/v1/dashboards/${dashboardId}/roles/${roleId}`, {
    method: "DELETE",
  });
}

/** What GET/PATCH /v1/dashboards/:id/permissions/:roleId answer with — every
 *  gated action's current on/off state for that role. Keyed by role ID, not
 *  name: roles are rows now (see DashboardRole). */
export interface DashboardRolePermissions {
  roleId: string;
  permissions: Record<DashboardPermissionAction, boolean>;
}

/** Host-only: the role-permission delegation popup's data source. A role id
 *  that isn't this dashboard's 404s as dashboard_role_not_found. */
export function getDashboardRolePermissions(
  dashboardId: string,
  roleId: string,
): Promise<DashboardRolePermissions> {
  return request<DashboardRolePermissions>(`/v1/dashboards/${dashboardId}/permissions/${roleId}`);
}

/**
 * Host-only: flips one or more of a role's action toggles in a single call.
 * Only the changed keys need to be sent — the api leaves any action not
 * present in `permissions` untouched. Returns the full resulting toggle set,
 * same shape as getDashboardRolePermissions, so the popup can just replace
 * its local state with the response.
 */
export function setDashboardRolePermissions(
  dashboardId: string,
  roleId: string,
  permissions: Partial<Record<DashboardPermissionAction, boolean>>,
): Promise<DashboardRolePermissions> {
  return request<DashboardRolePermissions>(`/v1/dashboards/${dashboardId}/permissions/${roleId}`, {
    method: "PATCH",
    body: JSON.stringify({ permissions }),
  });
}

/**
 * The caller's OWN standing on this dashboard — unlike
 * getDashboardRolePermissions above, not host-only: anyone who can reach the
 * dashboard can ask what they personally may do on it. Lets the dashboard
 * hide/disable actions a restricted Observer's role doesn't currently allow,
 * rather than only relying on the 403 from actually trying. `isHost` covers
 * the two host-only affordances (rename, the permissions popup itself) that
 * aren't part of `permissions` because they're not delegatable actions.
 */
export function getMyDashboardPermissions(
  dashboardId: string,
): Promise<{ isHost: boolean; permissions: Record<DashboardPermissionAction, boolean> }> {
  return request(`/v1/dashboards/${dashboardId}/my-permissions`);
}
