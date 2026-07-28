/**
 * @tollgate/shared — domain types shared across proxy, api, and dashboard.
 *
 * Types only for now; business logic lands in later milestones.
 */

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Guarantee tier per provider integration:
 * - enforced:  cost known/reservable pre-request → hard budget guarantee
 * - metered:   cost derived post-response → bounded overshoot
 * - monitored: no reliable per-request cost → detection + freeze only
 */
export type GuaranteeTier = "enforced" | "metered" | "monitored";

/** What the proxy does if enforcement state (Redis) is unreachable. */
export type FailMode = "fail_closed" | "fail_open_degraded";

export interface Provider {
  id: string;
  /** Stable slug used in proxy routes, e.g. "openai" → /openai/* */
  slug: string;
  name: string;
  /** Upstream base URL requests are forwarded to. */
  baseUrl: string;
  tier: GuaranteeTier;
  /** Default fail behavior; payments-class providers should be fail_closed. */
  defaultFailMode: FailMode;
  createdAt: string;
}

/**
 * Cost derived from an upstream response.
 * - costCents:          settled cost, metered from the response (fractional cents ok)
 * - estimatedCostCents: optional pre-request reservation, for enforced-tier providers
 *
 * Kept in cents (USD) to match Policy/SpendEvent; the proxy converts to integer
 * micro-cents before touching the Redis counter (see proxy budget layer).
 */
export interface ProviderCost {
  costCents: number;
  estimatedCostCents?: number;
  /**
   * Token counts metered from the response, when the provider reports them
   * (e.g. OpenAI's usage.prompt_tokens/completion_tokens). Optional — an
   * adapter that can't report tokens simply omits these, and the hot path
   * skips the token counter update rather than guessing. Independent of
   * costCents: a response can report tokens without a known price (or vice
   * versa in a future adapter).
   */
  promptTokens?: number;
  completionTokens?: number;
  /**
   * The model the provider actually reports having served, as opposed to the
   * descriptive `model` label an agent was created with (which the proxy never
   * enforces). Recorded on the spend_events audit row so the activity log shows
   * what really ran.
   */
  model?: string;
}

/**
 * The seam the proxy hot path forwards through. The route handler
 * (token auth → budget check → forward → meter → settle) only ever calls these
 * methods on whichever adapter matches the request's provider slug — it never
 * names a concrete provider. Adding a provider = one new adapter object in the
 * registry, zero route changes.
 */
export interface ProviderAdapter {
  /** Stable slug used in proxy routes, e.g. "openai" → POST /openai/*. */
  slug: string;
  /** Upstream base URL requests are forwarded to. */
  baseUrl: string;
  /** Auth headers for the upstream, built from the vaulted upstream key. */
  buildAuthHeaders: (upstreamKey: string) => Record<string, string>;
  /** Turn the proxied sub-path (the "*" segment) into a full upstream URL. */
  buildUpstreamUrl: (path: string) => string;
  /**
   * Meter an upstream response into a settled cost.
   *
   * Takes the RAW body text, not pre-parsed JSON, because a streamed response
   * ("stream": true) is an SSE transcript rather than a JSON document — the
   * adapter has to decide how to read it. Handing adapters parsed JSON is what
   * previously made every streamed request meter as $0.
   */
  parseCost: (rawBody: string) => ProviderCost;
  /**
   * Optionally rewrite the client's request body before it's forwarded, so the
   * provider actually reports the usage this proxy needs to meter. OpenAI needs
   * an explicit opt-in for usage on streamed responses; Anthropic always
   * reports it, so its adapter omits this. Return the body unchanged when
   * nothing is needed.
   */
  prepareRequestBody?: (requestBody: unknown) => unknown;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ModelPrice {
  /** Cents per 1M input (prompt) tokens. */
  inputCentsPerMTok: number;
  /** Cents per 1M output (completion) tokens. */
  outputCentsPerMTok: number;
}

/**
 * OpenAI's real chat-completions pricing — the single source of truth,
 * imported by proxy/src/adapters/openai.ts (which meters real traffic) and
 * the dashboard's marketing-page demo simulator (which never calls OpenAI,
 * but stays correct if these numbers change instead of drifting from a
 * hardcoded copy).
 */
export const OPENAI_PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { inputCentsPerMTok: 250, outputCentsPerMTok: 1000 },
  "gpt-4o-mini": { inputCentsPerMTok: 15, outputCentsPerMTok: 60 },
};

/** Anthropic's real Messages API pricing — same reuse as OPENAI_PRICES. */
export const CLAUDE_PRICES: Record<string, ModelPrice> = {
  "claude-3-5-sonnet-20241022": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-3-5-haiku-20241022": { inputCentsPerMTok: 80, outputCentsPerMTok: 400 },
  "claude-3-opus-20240229": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
};

// ---------------------------------------------------------------------------
// Upstream provider keys (BYOK)
//
// An org can supply its OWN OpenAI/Anthropic key so upstream usage bills to
// their provider account instead of Tollgate's. Everything here is pure format
// and naming convention — the actual AES-256-GCM encrypt/decrypt lives in the
// backends (this file is bundled into the browser dashboard, so no node:crypto).
// ---------------------------------------------------------------------------

/**
 * Providers an org can bring their own key for, keyed by ADAPTER slug — the
 * same vocabulary backend/proxy/src/adapters/registry.ts routes on and that
 * the *_UPSTREAM_KEY env vars use, NOT the "chatgpt"/"claude" assistant labels
 * agents are created with (see registry.ts's assistantAdapterSlugs for why the
 * two differ). The label here is the user-facing name for the dashboard.
 */
export const UPSTREAM_PROVIDERS = [
  { slug: "openai", label: "OpenAI (ChatGPT)" },
  { slug: "claude", label: "Anthropic (Claude)" },
] as const;

export type UpstreamProviderSlug = (typeof UPSTREAM_PROVIDERS)[number]["slug"];

export function isUpstreamProviderSlug(value: string): value is UpstreamProviderSlug {
  return UPSTREAM_PROVIDERS.some((p) => p.slug === value);
}

/**
 * Env var holding Tollgate's own shared key for a provider, e.g.
 * "openai" -> OPENAI_UPSTREAM_KEY. This is the deployment-wide fallback used
 * for orgs that haven't configured BYOK; see backend/proxy/src/lib/vault.ts.
 */
export function upstreamKeyEnvVar(slug: string): string {
  return `${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_UPSTREAM_KEY`;
}

/**
 * At-rest storage format for a BYOK key. Deliberately NOT the one-way SHA-256
 * treatment agent tokens get (backend/api/src/lib/tokens.ts): the proxy must
 * hand the real plaintext key to OpenAI/Anthropic on every forwarded request,
 * so this has to be reversible. AES-256-GCM (an AEAD) — hence an iv and an
 * auth tag alongside the ciphertext, all base64. The encryption key itself
 * lives in VAULT_ENCRYPTION_KEY on the server, never in the database.
 */
export interface UpstreamKeyCiphertext {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Non-secret display hint stored alongside the ciphertext ("sk-…7mQ4"), so the
 * dashboard can show *which* key is set without the plaintext ever being
 * readable again. Never enough to reconstruct the key.
 */
export function maskUpstreamKey(key: string): string {
  const trimmed = key.trim();
  const tail = trimmed.slice(-4);
  const prefix = trimmed.startsWith("sk-ant-")
    ? "sk-ant-"
    : trimmed.startsWith("sk-")
      ? "sk-"
      : "";
  return `${prefix}…${tail}`;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * Freeze lifecycle:
 * - active:      requests evaluated normally
 * - pending:     low-confidence anomaly — running, awaiting operator review
 * - soft_frozen: new operations denied; in-flight + completion ops drain (SIGTERM)
 * - hard_frozen: total revocation (SIGKILL)
 * - archived:    retired; token revoked
 */
export type AgentStatus =
  | "active"
  | "pending"
  | "soft_frozen"
  | "hard_frozen"
  | "archived";

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  /** Descriptive only: which provider this agent was provisioned to call.
   *  Not enforced by the proxy — a token still authenticates against any
   *  provider slug the registry knows. */
  providerSlug: string;
  status: AgentStatus;
  /** Policy this agent inherits from (templates/inheritance model). */
  policyId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type BudgetWindow = "daily" | "weekly" | "monthly";

/**
 * Policy is data, not deployment: rows in Postgres, hot copies in Redis,
 * mutable at runtime through the api service.
 */
export interface Policy {
  id: string;
  orgId: string;
  name: string;
  /** Budget in USD cents to avoid float drift. */
  budgetCents: number;
  budgetWindow: BudgetWindow;
  /** Requests per minute; null = unlimited. */
  rateLimitRpm: number | null;
  /** Upstream endpoint allowlist (proxy-emulated scoping); null = all. */
  endpointAllowlist: string[] | null;
  failMode: FailMode;
  /** Ceiling-on-ceiling: max budget a sub-admin may set under this policy. */
  maxBudgetCents: number | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// SpendEvent
// ---------------------------------------------------------------------------

export type SpendDecision =
  | "allowed"
  | "denied_budget"
  | "denied_rate"
  | "denied_endpoint"
  | "denied_frozen";

/** One governed request — the immutable audit-log unit. */
export interface SpendEvent {
  id: string;
  agentId: string;
  providerId: string;
  endpoint: string;
  method: string;
  /** Estimated cost reserved pre-request (credit-card-hold model). */
  estimatedCostCents: number | null;
  /** Settled cost once the response is metered; null while in flight. */
  actualCostCents: number | null;
  decision: SpendDecision;
  /** Generated if the agent didn't supply one; freeze-reconciliation key. */
  idempotencyKey: string;
  latencyMs: number | null;
  upstreamStatus: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Enforcement keys (Redis)
// ---------------------------------------------------------------------------

/**
 * Pure key/unit helpers shared by proxy (enforcement) and api (freeze +
 * dashboard reads) so both services derive identical Redis keys. No Node-only
 * APIs here — this file is also pulled into the (browser-side) dashboard.
 */

/**
 * Money is carried as cents (fractional) at the provider seam, but the Redis
 * spend counter is an integer bumped with an atomic INCRBY. We store
 * micro-cents (cents × 1e6): fine-grained enough that a sub-cent request never
 * rounds to zero, and still a plain integer. Only the Redis counter uses this
 * scale — spend_events rows store plain fractional cents.
 */
export const MICROCENTS_PER_CENT = 1_000_000;

export function centsToMicroCents(cents: number): number {
  return Math.round(cents * MICROCENTS_PER_CENT);
}

export function microCentsToCents(microCents: number): number {
  return microCents / MICROCENTS_PER_CENT;
}

/** UTC year-month, e.g. "2026-07", used to scope the monthly spend counter. */
export function currentMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Redis key for an agent's spend in a given month: spend:{agent_id}:{month}. */
export function spendKey(agentId: string, month: string): string {
  return `spend:${agentId}:${month}`;
}

/**
 * Redis key for an agent's LLM token usage (prompt + completion, summed) in a
 * given month: tokens:{agent_id}:{month}. A separate counter from spend —
 * money and token count are metered independently, since a provider adapter
 * can report one without the other (see ProviderCost).
 */
export function tokenKey(agentId: string, month: string): string {
  return `tokens:${agentId}:${month}`;
}

/**
 * Redis key for an agent's current in-flight request body: transient
 * "what's happening right now" state for the dashboard sidebar. Written by
 * the proxy with a short TTL before forwarding, and never persisted to
 * Postgres — this is the one place in the system that holds prompt text at
 * all, and only briefly.
 */
export function currentPromptKey(agentId: string): string {
  return `current_prompt:${agentId}`;
}

/**
 * Redis key for the freeze fast-path: set (any value) while an agent is
 * soft/hard frozen, deleted on unfreeze. Postgres `agents.status` remains the
 * system of record and is still checked on every request; this key is an
 * additional, redundant check the api's freeze/unfreeze endpoints update in
 * lockstep, so enforcement doesn't depend on Postgres replication/visibility
 * alone.
 */
export function freezeKey(agentId: string): string {
  return `frozen:${agentId}`;
}

// ---------------------------------------------------------------------------
// Proof-of-life contracts (used by /health on proxy + api and the dashboard)
// ---------------------------------------------------------------------------

export type DependencyState = "ok" | "error";

export interface DependencyHealth {
  state: DependencyState;
  latencyMs: number;
  detail?: string;
}

export interface HealthReport {
  service: "proxy" | "api";
  ok: boolean;
  uptimeSec: number;
  timestamp: string;
  redis: DependencyHealth;
  postgres: DependencyHealth;
}
