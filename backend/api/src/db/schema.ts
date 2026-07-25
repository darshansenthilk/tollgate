import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Organizations are owned by Better Auth (the org plugin's `organization`
 * table, created by db/auth-migrate.ts — see backend/api/src/lib/auth.ts).
 * Agents and policies carry the owning org's id as plain `text` — deliberately
 * NOT a hard FK, so the app/proxy tables stay decoupled from the auth-managed
 * tables. Isolation is enforced in application code: every management-plane
 * query is scoped to the caller's active org (see routes/agents.ts +
 * lib/require-auth.ts). org_id is always stamped from the session, never from
 * client input.
 */

// ---------------------------------------------------------------------------
// Enums — mirror the string unions in @tollgate/shared exactly.
// ---------------------------------------------------------------------------

export const agentStatusEnum = pgEnum("agent_status", [
  "active",
  "pending",
  "soft_frozen",
  "hard_frozen",
  "archived",
]);

export const budgetWindowEnum = pgEnum("budget_window", [
  "daily",
  "weekly",
  "monthly",
]);

export const failModeEnum = pgEnum("fail_mode", [
  "fail_closed",
  "fail_open_degraded",
]);

export const spendDecisionEnum = pgEnum("spend_decision", [
  "allowed",
  "denied_budget",
  "denied_rate",
  "denied_endpoint",
  "denied_frozen",
]);

// ---------------------------------------------------------------------------
// Policies
//
// One policy row per agent in this milestone (no shared/template policies
// yet — see @tollgate/shared Policy docstring for the eventual model). Only
// max_budget_cents is exercised by the proxy hot path
// (backend/proxy/src/lib/agents.ts); the rest of the columns mirror the full shared
// Policy type so the api/dashboard have somewhere to land later.
// ---------------------------------------------------------------------------

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  /** Not collected by POST /v1/agents yet; defaulted to maxBudgetCents at creation. */
  budgetCents: integer("budget_cents").notNull(),
  /**
   * Decorative in this milestone: the proxy's spend counter is always
   * monthly-keyed (backend/proxy/src/lib/budget.ts currentMonth()), regardless of
   * this value. Kept so the column exists once window-aware enforcement
   * ships.
   */
  budgetWindow: budgetWindowEnum("budget_window").notNull().default("monthly"),
  rateLimitRpm: integer("rate_limit_rpm"),
  endpointAllowlist: text("endpoint_allowlist").array(),
  failMode: failModeEnum("fail_mode").notNull().default("fail_closed"),
  /** The actual enforcement ceiling the proxy reads (policies.max_budget_cents). */
  maxBudgetCents: integer("max_budget_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey(),
    orgId: text("org_id").notNull(),
    /** Unique per org among non-archived agents only — see the partial index
     *  below. DELETE /v1/agents/:id archives rather than hard-deletes, so a
     *  deleted agent's old name must be free to reuse. */
    name: text("name").notNull(),
    /** Descriptive only — see @tollgate/shared Agent.providerSlug doc comment. */
    providerSlug: text("provider_slug").notNull(),
    /** Descriptive only, same as providerSlug — not enforced by the proxy.
     *  Nullable: optional at creation, and existing rows predate this column. */
    model: text("model"),
    status: agentStatusEnum("status").notNull().default("active"),
    policyId: uuid("policy_id").references(() => policies.id),
    /**
     * SHA-256 hex digest of the raw token (backend/proxy/src/lib/agents.ts hashToken).
     * Never present in the shared Agent type or any api response — like a
     * password hash, it's a DB-only secret-adjacent field. Unique because it's
     * an exact-match auth lookup key.
     */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial unique index: a name is unique PER ORG among agents that AREN'T
    // archived. Scoped by org so two accounts can each have a "checkout-bot";
    // scoped to non-archived so a soft-deleted agent's name frees up for reuse.
    uniqueIndex("agents_org_name_unique_when_not_archived")
      .on(table.orgId, table.name)
      .where(sql`${table.status} != 'archived'`),
  ],
);

// ---------------------------------------------------------------------------
// Spend events
//
// Column set and order match backend/proxy/src/lib/spend-log.ts's INSERT exactly.
// created_at is deliberately NOT in that INSERT's column list — the proxy
// relies entirely on this table's default now() for it.
// ---------------------------------------------------------------------------

export const spendEvents = pgTable("spend_events", {
  id: uuid("id").primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agents.id),
  /** Adapter slug (e.g. "openai") — not a foreign key, no providers table yet. */
  providerId: text("provider_id").notNull(),
  endpoint: text("endpoint").notNull(),
  method: text("method").notNull(),
  /**
   * Fractional USD cents (e.g. 0.045), NOT micro-cents — only the Redis
   * spend:{agent_id}:{month} counter is micro-cents-scaled. numeric so
   * sub-cent costs aren't rounded away.
   */
  estimatedCostCents: numeric("estimated_cost_cents", { precision: 14, scale: 6 }),
  actualCostCents: numeric("actual_cost_cents", { precision: 14, scale: 6 }),
  decision: spendDecisionEnum("decision").notNull(),
  /**
   * Always server-generated randomly today (proxy never accepts/forwards a
   * client-supplied idempotency key) — unique so at least accidental
   * duplicate inserts of the same event would fail loud, though retries
   * currently aren't deduplicated at the application level.
   */
  idempotencyKey: uuid("idempotency_key").notNull().unique(),
  latencyMs: integer("latency_ms"),
  upstreamStatus: integer("upstream_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
