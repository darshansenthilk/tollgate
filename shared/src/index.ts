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
