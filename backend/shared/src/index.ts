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
  /** Meter an upstream response body into a settled cost. */
  parseCost: (responseBody: unknown) => ProviderCost;
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
