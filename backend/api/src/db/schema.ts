import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
  index,
  jsonb,
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
  "denied_tool",
  // Operator decisions on a blocked tool call, written by the api rather than
  // the proxy — see @tollgate/shared SpendDecision for why they share this
  // table with the proxy's own verdicts.
  "approval_granted",
  "approval_denied",
]);

export const toolApprovalStatusEnum = pgEnum("tool_approval_status", [
  "pending",
  "approved",
  "denied",
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
  /** Tool/function names the proxy blocks from ever reaching the agent in a
   *  response — see @tollgate/shared Policy.blockedTools's doc comment. This
   *  one IS enforced (backend/proxy/src/routes/proxy.ts), unlike
   *  rate_limit_rpm/endpoint_allowlist above. */
  blockedTools: text("blocked_tools").array(),
  /** Prepended to every request this agent sends — see @tollgate/shared
   *  Policy.systemPrompt's doc comment. */
  systemPrompt: text("system_prompt"),
  /** Tools this agent's requests advertise to the model — see @tollgate/shared
   *  Policy.toolDefinitions's doc comment. Untyped jsonb (not `.$type<>()`)
   *  to match this file's existing convention of not importing @tollgate/
   *  shared's types — validation lives in routes/agents.ts, same as every
   *  other policy field here. */
  toolDefinitions: jsonb("tool_definitions"),
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
    /** Which of the org's stored BYOK keys (org_upstream_keys) this agent's
     *  traffic bills to. Real FK (unlike org_id) since both tables live in
     *  this schema — mirrors policyId just above. Null means "no specific
     *  key chosen": the proxy's vault then goes straight to the deployment's
     *  env fallback rather than guessing among an org's several stored keys
     *  for this provider — see backend/proxy/src/lib/vault.ts's doc comment. */
    upstreamKeyId: uuid("upstream_key_id").references(() => orgUpstreamKeys.id, {
      onDelete: "set null",
    }),
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
// Org upstream keys (BYOK)
//
// An org's own OpenAI/Anthropic key, so their agents' upstream usage bills to
// their provider account rather than Tollgate's shared deployment key.
//
// SECURITY NOTE — this is deliberately NOT the treatment agents.token_hash
// gets. A token hash is one-way (SHA-256) because auth only ever needs an
// equality check. An upstream key must be replayed verbatim to OpenAI/Anthropic
// on every proxied request, so it's encrypted (reversible, AES-256-GCM) rather
// than hashed. The encryption key lives in VAULT_ENCRYPTION_KEY on the server;
// a database dump alone therefore doesn't yield usable provider keys.
// ---------------------------------------------------------------------------

export const orgUpstreamKeys = pgTable(
  "org_upstream_keys",
  {
    id: uuid("id").primaryKey(),
    /** Same plain-text, non-FK org reference the other tables use — see the
     *  module doc comment. Always stamped from the session, never client input. */
    orgId: text("org_id").notNull(),
    /** ADAPTER slug ("openai" / "claude"), matching what the proxy routes on
     *  and what *_UPSTREAM_KEY env vars are named for — NOT the "chatgpt"
     *  assistant label agents carry. See @tollgate/shared UPSTREAM_PROVIDERS. */
    providerSlug: text("provider_slug").notNull(),
    /** Org-chosen display name ("Prod", "Jane's personal key") distinguishing
     *  multiple keys for the same provider — see the unique index below. */
    label: text("label").notNull().default("Default"),
    /** AES-256-GCM ciphertext + its iv and auth tag, all base64. Split into
     *  columns rather than one packed string so the AEAD parts stay legible
     *  (and a missing tag is a schema error, not a parse error at decrypt).
     *
     *  Holds a JSON object of every SECRET field the provider needs
     *  ({"accessKeyId":…,"secretAccessKey":…}) — or, for rows written before
     *  structured credentials, the bare API key string. The proxy's vault
     *  reads both (see its parseSecrets); there's deliberately no migration
     *  re-encrypting old rows, because only the running service holds
     *  VAULT_ENCRYPTION_KEY and SQL therefore can't. */
    encryptedKey: text("encrypted_key").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    /** NON-secret credential fields, as plain JSON ({"region":"us-east-1"},
     *  {"resourceName":"my-company"}). Deliberately unencrypted: these are
     *  hostnames and regions that appear in every request URL anyway, and
     *  storing them readable lets the dashboard show which resource a key
     *  points at. Null for providers that need nothing but a key. */
    config: text("config"),
    /** Non-secret display hint ("sk-…7mQ4") so the dashboard can show which key
     *  is configured without the plaintext ever being recoverable. */
    keyHint: text("key_hint").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // An org can store several keys per provider now (multi-key BYOK), each
    // distinguished by label — saving under an existing label replaces that
    // row (rotate), a new label adds a new row. Agents pick one by id
    // (agents.upstream_key_id) rather than the proxy guessing among them.
    uniqueIndex("org_upstream_keys_org_provider_label_unique").on(
      table.orgId,
      table.providerSlug,
      table.label,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Spend events
//
// Column set and order match backend/proxy/src/lib/spend-log.ts's INSERT exactly.
// created_at is deliberately NOT in that INSERT's column list — the proxy
// relies entirely on this table's default now() for it.
// ---------------------------------------------------------------------------

export const spendEvents = pgTable(
  "spend_events",
  {
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
   * What the provider reported actually serving, and the token split. Distinct
   * from agents.model, which is only the descriptive label an agent was created
   * with and is never enforced — this is ground truth from the response. Null
   * on denied requests (nothing ran) and when a response carried no parseable
   * usage. Read by the dashboard's activity log.
   */
  model: text("model"),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  /**
   * Always server-generated randomly today (proxy never accepts/forwards a
   * client-supplied idempotency key) — unique so at least accidental
   * duplicate inserts of the same event would fail loud, though retries
   * currently aren't deduplicated at the application level.
   */
  idempotencyKey: uuid("idempotency_key").notNull().unique(),
  latencyMs: integer("latency_ms"),
  upstreamStatus: integer("upstream_status"),
  /**
   * The request body this event was forwarded with, so the activity log can
   * show what an agent actually asked for — not just that it asked.
   *
   * CONTAINS REAL PROMPT CONTENT, and unlike the Redis current-prompt key
   * (backend/proxy/src/lib/current-prompt.ts, ~2min TTL) this one PERSISTS.
   * Whatever an agent sends — customer records, personal data — lands here and
   * stays until something deletes it. Truncated to a bounded length by the
   * proxy (see spend-log.ts's PROMPT_MAX_CHARS) so one huge request can't bloat
   * the table, but truncation is not redaction. A deployment with real user
   * data in its prompts wants a retention policy on this column.
   *
   * Null for denials raised before anything was forwarded, and for the
   * operator-decision rows the api writes.
   */
  prompt: text("prompt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Serves the two per-agent reads (GET /v1/agents/:id/activity and the
    // suggestions route's per-agent sample) directly: equality on agent_id,
    // then already-sorted by created_at, so LIMIT stops early instead of
    // sorting the agent's whole history. Added once this table started
    // carrying prompt text on every row (see the column's doc comment) —
    // wider rows make the sequential-scan-plus-sort this replaces cost more
    // per row, not just more rows.
    index("spend_events_agent_created_idx").on(table.agentId, table.createdAt.desc()),
    // Serves GET /v1/activity — the org-wide feed, which has no agent_id
    // filter of its own (it joins out to agents for the org scope). An
    // index scan walking created_at backward lets that join stop at LIMIT
    // rows instead of sorting every event the org's agents ever produced.
    index("spend_events_created_idx").on(table.createdAt.desc()),
  ],
);

// ---------------------------------------------------------------------------
// Tool approval requests
//
// Raised by the PROXY when its tool gate blocks a call (see
// backend/proxy/src/routes/proxy.ts), resolved from the dashboard through the
// api. The two writers are deliberately split: the proxy only ever inserts
// pending rows and never resolves one, so an agent can't approve itself.
//
// Approving does NOT edit policies.blocked_tools — it writes a TTL'd Redis
// grant (see @tollgate/shared toolGrantKey) that lets the agent's retry
// through once. The blocklist stays the standing policy; a grant is the
// temporary exception to it.
// ---------------------------------------------------------------------------

export const toolApprovalRequests = pgTable(
  "tool_approval_requests",
  {
    id: uuid("id").primaryKey(),
    /** Same plain-text, non-FK org reference the other app tables use. The
     *  proxy reads it off the authenticated agent, never from client input. */
    orgId: text("org_id").notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    /** Tool/function name exactly as the provider named it in the response. */
    toolName: text("tool_name").notNull(),
    status: toolApprovalStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Both null while pending; set together when an operator resolves it. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** Better Auth user id as plain text, same decoupling as org_id. */
    resolvedBy: text("resolved_by"),
  },
  (table) => [
    // One pending row per (agent, tool): an agent retrying a blocked call in a
    // loop must not flood the operator's queue with identical requests. The
    // proxy's insert is ON CONFLICT DO NOTHING against this index. Partial, so
    // resolved rows stay as history and a later re-request can open a new one.
    uniqueIndex("tool_approval_requests_pending_unique")
      .on(table.agentId, table.toolName)
      .where(sql`${table.status} = 'pending'`),
  ],
);

// ---------------------------------------------------------------------------
// Dashboards
//
// A dashboard is OWNED by an org (same plain-text, non-FK org_id every app
// table uses), but WHICH dashboard you're currently looking at is yours alone —
// once a dashboard is shared with several members, each of them needs to be
// able to have a different one open at the same time. Hence two tables:
// ownership on `dashboards`, selection on `active_dashboards`, one row per user.
// ---------------------------------------------------------------------------

export const dashboards = pgTable("dashboards", {
  id: uuid("id").primaryKey(),
  /** Stamped from the session's active org, never client input — see the module
   *  doc comment. */
  orgId: text("org_id").notNull(),
  /** Length-capped at 50 by the dashboards routes — both writers, POST (create)
   *  and PATCH (rename), go through one shared validator — not by the column. No
   *  uniqueness constraint within an org (unlike agents.name) — duplicate
   *  dashboard names are allowed for now. */
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activeDashboards = pgTable("active_dashboards", {
  /** Better Auth's user id as plain text, deliberately NOT an FK to the
   *  auth-managed `user` table — same decoupling as org_id above. */
  userId: text("user_id").primaryKey(),
  /** A real FK here (both sides are app-owned tables): cascading the delete
   *  keeps a selection from outliving the dashboard it points at. */
  dashboardId: uuid("dashboard_id")
    .notNull()
    .references(() => dashboards.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
