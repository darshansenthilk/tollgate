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
  boolean,
  primaryKey,
  foreignKey,
  unique,
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

/**
 * There is deliberately NO dashboard_member_role enum here anymore. Roles are
 * rows in dashboard_roles below — a host creates and deletes them at runtime,
 * which an enum cannot express (0017 dropped the type). ACTIONS stayed an enum
 * for the reason @tollgate/shared's "Dashboard permissions" section gives.
 */
export const dashboardPermissionActionEnum = pgEnum("dashboard_permission_action", [
  "createAgent",
  "updateAgent",
  "freezeAgent",
  "unfreezeAgent",
  "deleteAgent",
  "addDashboardMember",
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
    /**
     * Which dashboard this agent lives in. Dashboards are independent of one
     * another: an agent belongs to exactly one, and every read path filters on
     * this so adding an agent to one dashboard doesn't change any other.
     *
     * A real FK (both sides are app-owned tables), deliberately with NO cascade
     * and no `onDelete` at all — the default NO ACTION means Postgres REFUSES to
     * hard-delete a dashboard that still has agents. Cascading would silently
     * destroy live, spendable agent tokens; blocking is the recoverable default.
     *
     * DELETING A DASHBOARD IS NOW BUILT, and it picked the policy this comment
     * used to leave open: DELETE /v1/dashboards/:id SOFT-deletes the dashboard
     * (dashboards.archived_at) and ARCHIVES every agent in it, revoking their
     * tokens in both mechanisms (status='archived' + the Redis freeze key). Soft
     * rather than hard because this FK — plus spend_events.agent_id — means a
     * real DELETE would have to destroy billing history to succeed.
     *
     * The cost of that choice, and the reason routes/agents.ts guards what it
     * guards: A SOFT DELETE FORFEITS THIS FK'S PROTECTION. `UPDATE dashboards
     * SET archived_at` doesn't touch the primary key, so it takes FOR NO KEY
     * UPDATE, which does NOT conflict with the FOR KEY SHARE a child insert's FK
     * check takes — both statements simply succeed. The parent row always
     * exists, so the FK is reduced to checking something that is now always
     * true. Every protection this FK used to give has to be rebuilt in the
     * application: see findAgent's dashboard join (routes/agents.ts) and POST
     * /v1/agents' conditional INSERT … WHERE EXISTS.
     *
     * NOT NULL, so an agent can never be orphaned into invisibility: a row this
     * filter can't match would vanish from every dashboard while its token still
     * worked at the proxy. Redundant with orgId (a dashboard already carries an
     * org), which is intentional — org scoping stays the isolation boundary and
     * is checked independently, so a bug here can't become a cross-account leak.
     */
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id),
    /** Unique per DASHBOARD among non-archived agents only — see the partial
     *  index below. DELETE /v1/agents/:id archives rather than hard-deletes, so
     *  a deleted agent's old name must be free to reuse. */
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
    /**
     * Null (default) means this agent's traffic is proxied through Tollgate's
     * own hot path, same as every agent before this column existed. A non-null
     * value means the opposite: this agent runs entirely on someone else's
     * infrastructure (Anthropic Managed Agents, Salesforce Agentforce) that
     * Tollgate cannot put itself in the request path of — confirmed directly
     * against a real Managed Agents account that no model-endpoint override
     * exists there. Governance for these agents comes from two OTHER
     * mechanisms instead: the MCP gateway (routes/mcp.ts, gates real-time tool
     * calls) and a periodic usage poller (per-platform connector, writes real
     * spend_events rows). Plain text + an app-level allowlist, not a pgEnum —
     * same reasoning as providerSlug just above: a new platform shouldn't cost
     * a migration.
     */
    hostPlatform: text("host_platform"),
    /**
     * Which real downstream MCP server this agent's TOOL calls forward to,
     * once the MCP gateway sits in front of them — the mcpTargetKeyId
     * equivalent of upstreamKeyId, but for tool-call traffic rather than LLM
     * traffic. Points at an org_upstream_keys row with providerSlug
     * "mcp-downstream" (serverUrl + optional authToken). Unrelated to
     * upstreamKeyId, which stays unused for an externally-hosted agent (it
     * has no proxied LLM traffic to bill).
     */
    mcpTargetKeyId: uuid("mcp_target_key_id").references(() => orgUpstreamKeys.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial unique index: a name is unique PER DASHBOARD among agents that
    // AREN'T archived. Scoped to non-archived so a soft-deleted agent's name
    // frees up for reuse.
    //
    // This was (org_id, name) until dashboards became independent. Per-dashboard
    // is the weaker constraint and it's the point of the feature: two dashboards
    // in the same org can each have a "support-bot" without knowing about each
    // other. Cross-ORG uniqueness is not lost by weakening it — a dashboard
    // belongs to exactly one org, so distinct dashboards never span orgs.
    uniqueIndex("agents_dashboard_name_unique_when_not_archived")
      .on(table.dashboardId, table.name)
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
// External platform links — one table per platform (Anthropic Managed Agents,
// Salesforce Agentforce), not one shared/generic table. Each platform's real
// API shape is different enough (Anthropic: API-key + workspace + session id;
// Salesforce: org id + agent id, no session concept) that a shared table would
// need a bag of platform-specific nullable columns anyway — three concrete
// columns per platform is the smaller, more honest thing.
//
// Both are 1:1 with an agent (onDelete: cascade — unlike every FK on `agents`
// itself, these tables ARE the agent's own external-platform config, not
// billing history or something another row depends on, so there's nothing
// protective to lose by letting them disappear with their agent).
// ---------------------------------------------------------------------------

export const anthropicManagedAgentLinks = pgTable("anthropic_managed_agent_links", {
  id: uuid("id").primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .unique()
    .references(() => agents.id, { onDelete: "cascade" }),
  /** Same plain-text, non-FK org reference every other table uses. */
  orgId: text("org_id").notNull(),
  /** Which stored "anthropic-admin" credential (backend/shared's
   *  UPSTREAM_PROVIDERS) the poller decrypts to authenticate the usage-report
   *  and session-budget calls. An org can save more than one Admin key (the
   *  upstream-keys screen allows multiple labeled keys per provider), so this
   *  must name a specific row rather than assuming "the org's only key". */
  upstreamKeyId: uuid("upstream_key_id").references(() => orgUpstreamKeys.id, {
    onDelete: "set null",
  }),
  /** Filters Anthropic's Usage & Cost Admin API's usage_report to just this
   *  agent's traffic — one Anthropic API key per Tollgate agent is how
   *  per-agent attribution works, since Anthropic's own report is grouped by
   *  api_key_id/workspace_id, not by anything Tollgate-specific. */
  anthropicApiKeyId: text("anthropic_api_key_id").notNull(),
  /** Optional additional filter dimension — null when the org doesn't
   *  separate Managed Agents traffic into its own workspace. */
  anthropicWorkspaceId: text("anthropic_workspace_id"),
  /** The Managed Agents session this agent is currently bound to, if known —
   *  what a future setBudget() call (native budget delegation) would target.
   *  Null until either discovered via GET /v1/sessions or entered manually. */
  currentSessionId: text("current_session_id"),
  /** Watermark so the usage poller re-fetches only what's new since last run,
   *  not the org's entire history every time. Null until the first poll. */
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const salesforceAgentforceLinks = pgTable("salesforce_agentforce_links", {
  id: uuid("id").primaryKey(),
  agentId: uuid("agent_id")
    .notNull()
    .unique()
    .references(() => agents.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull(),
  /** The Salesforce org this agent lives in — Salesforce's DigitalWallet
   *  object is queried per-org, not globally. */
  salesforceOrgId: text("salesforce_org_id").notNull(),
  /** The Agentforce agent id within that Salesforce org, for attributing
   *  DigitalWallet consumption to this specific Tollgate agent. */
  agentforceAgentId: text("agentforce_agent_id").notNull(),
  lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  /**
   * Better Auth user id of whoever created this dashboard — the "host" for
   * dashboard sharing (dashboard_members below). Plain text, deliberately not
   * an FK to Better Auth's `user` table, same decoupling as active_dashboards.
   * user_id: the app/proxy tables stay independent of the auth-managed ones.
   *
   * Nullable at the column level even though the migration backfills every
   * pre-existing row (to whichever member holds the org's "owner" role) — kept
   * loose rather than NOT NULL for the same reason archived_at is nullable
   * rather than enforced: nothing above the database should rely on a
   * constraint here to stay correct.
   */
  createdBy: text("created_by"),
  /**
   * Soft delete. Null means live; a timestamp means DELETE /v1/dashboards/:id
   * swept it and every route must behave as though the row is gone.
   *
   * Soft rather than hard because it isn't a choice: agents.dashboard_id is NOT
   * NULL with no ON DELETE action, so Postgres refuses to delete a dashboard
   * owning any agent row (archived ones included), and spend_events.agent_id
   * blocks hard-deleting those agents in turn. A hard delete would mean
   * destroying billing history. The rule the whole feature is built to keep is
   * "a soft delete for billing history, but it looks like an actual deletion to
   * the user" — so nothing above this table may read, write, or resurrect an
   * archived dashboard or its agents.
   *
   * Nullable and never enforced by the column, so a manual
   * `UPDATE dashboards SET archived_at = NULL` un-deletes one. There is
   * deliberately no UI for that.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const activeDashboards = pgTable("active_dashboards", {
  /** Better Auth's user id as plain text, deliberately NOT an FK to the
   *  auth-managed `user` table — same decoupling as org_id above. */
  userId: text("user_id").primaryKey(),
  /** A real FK here (both sides are app-owned tables): cascading the delete
   *  keeps a selection from outliving the dashboard it points at.
   *
   *  THE CASCADE DOES NOT FIRE FOR A SOFT DELETE. `dashboards.archived_at` is an
   *  UPDATE, not a DELETE, so a swept dashboard leaves every selection row
   *  pointing at it. DELETE /v1/dashboards/:id therefore resolves these rows
   *  itself — re-pointing every user holding the deleted dashboard at the org's
   *  oldest survivor, and only deleting the rows when nothing survives. Every
   *  read of this table also has to filter on `dashboards.archived_at IS NULL`,
   *  or the app keeps acting like the dead dashboard is open. */
  dashboardId: uuid("dashboard_id")
    .notNull()
    .references(() => dashboards.id, { onDelete: "cascade" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The roles a dashboard's host can assign to its members — DATA, not an enum,
 * which is the whole point: a host creates and deletes these from the
 * permissions popup at runtime, so they cannot be a pgEnum or a TS union (see
 * @tollgate/shared's "Dashboard permissions" section for the actions/roles
 * asymmetry).
 *
 * PER DASHBOARD, matching how dashboard_role_permissions was already scoped:
 * two dashboards' Observer rows are independent, and creating "Editor" on one
 * dashboard creates it on no other, not even another one the same host owns.
 *
 * No `onDelete` on dashboard_id, same reasoning as dashboard_members below:
 * dashboards are only ever soft-deleted, so there's no delete event to cascade
 * from. Roles on an archived dashboard are inert rather than cleaned up.
 */
export const dashboardRoles = pgTable(
  "dashboard_roles",
  {
    id: uuid("id").primaryKey(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id),
    /** Length-capped at 30 by the dashboards routes (parseRoleNameBody), not by
     *  the column — same split as dashboards.name. Unique per dashboard
     *  CASE-INSENSITIVELY; see the index below. */
    name: text("name").notNull(),
    /**
     * Exactly one row per dashboard carries this, seeded as "Observer" when the
     * dashboard is created (and by 0017 for every pre-existing dashboard,
     * archived ones included). It earns its keep twice: POST .../members
     * resolves it to decide which role a newly added member gets — a
     * per-dashboard uuid can't be a static column default the way 'observer'
     * was — and DELETE .../roles/:roleId refuses on it. Keyed off this flag
     * rather than the literal name "Observer", which is display copy a future
     * rename feature could change; the flag is the invariant.
     */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Case-insensitive, per dashboard: "Editor", "editor" and "EDITOR" are one
    // name, not three. The create route checks this too, but the index is what
    // makes a race between two concurrent creates impossible rather than
    // merely unlikely — and it's also what stops a second "observer" in any
    // casing from ever shadowing the seeded default role.
    uniqueIndex("dashboard_roles_dashboard_lower_name_unique").on(
      table.dashboardId,
      sql`lower(${table.name})`,
    ),
    // A real UNIQUE CONSTRAINT (not just a unique index) because it is the
    // TARGET of dashboard_members' composite FK below — Postgres will only
    // accept a constraint there. Redundant-looking (id is already the PK) and
    // deliberately so: it's what lets that FK carry dashboard_id along.
    unique("dashboard_roles_id_dashboard_unique").on(table.id, table.dashboardId),
  ],
);

/**
 * Grants ONE user access to a dashboard outside the normal org-ownership path
 * (see the section comment above) — the "shared with me" half of dashboard
 * sharing. `dashboards.createdBy` is the host; a row here is a guest, added by
 * email from the share dialog on /agents.
 *
 * No `onDelete` action on dashboard_id, unlike active_dashboards' CASCADE:
 * dashboards are only ever soft-deleted (archived_at), never hard-deleted, so
 * there is no delete event for a cascade to fire on. A membership row for an
 * archived dashboard is inert (every dashboard-scoped route filters on
 * archived_at IS NULL) rather than cleaned up, the same way agents.ts leaves
 * archived agent rows in place instead of removing them.
 */
export const dashboardMembers = pgTable(
  "dashboard_members",
  {
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id),
    /** Better Auth user id, plain text — same decoupling as active_dashboards
     *  above and dashboards.createdBy. */
    userId: text("user_id").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Which dashboard_roles row this member holds. NOT NULL with no column
     * default: a per-dashboard uuid can't be a static default the way the old
     * 'observer' enum value was, so POST .../members resolves the dashboard's
     * is_default role and inserts it explicitly. NOT NULL rather than "NULL
     * means the default role" — otherwise there'd be two spellings of one
     * state and every read would have to handle both.
     *
     * The FK is declared in the composite form below, NOT here.
     */
    roleId: uuid("role_id").notNull(),
  },
  (table) => [
    // Adding the same person twice is a no-op, not a second row — the routes
    // rely on this to make POST /v1/dashboards/:id/members idempotent via
    // ON CONFLICT DO NOTHING.
    uniqueIndex("dashboard_members_dashboard_user_unique").on(table.dashboardId, table.userId),
    // COMPOSITE, carrying dashboard_id along with role_id, so Postgres itself
    // makes "member of dashboard A holding a role belonging to dashboard B"
    // unrepresentable rather than leaving it to the route's own check. This is
    // an authorization table; the codebase decides these in SQL where SQL can
    // decide them (see selectDashboardIfLive). Targets dashboard_roles'
    // (id, dashboard_id) UNIQUE constraint above.
    //
    // DELIBERATELY NO onDelete ACTION — do NOT "tidy" this into a cascade.
    // The default NO ACTION is precisely what makes Postgres REFUSE to delete
    // a role somebody still holds, which is the real guarantee behind DELETE
    // .../roles/:roleId's friendly "N account(s) currently have it" 400: that
    // count is the explanation, this omission is the enforcement. A cascade
    // here would silently strip people's roles (and violate the NOT NULL
    // above); SET NULL would too.
    foreignKey({
      columns: [table.roleId, table.dashboardId],
      foreignColumns: [dashboardRoles.id, dashboardRoles.dashboardId],
      name: "dashboard_members_role_id_dashboard_id_fk",
    }),
  ],
);

/**
 * Per-role, per-action toggle for the 6 dashboard actions a host can delegate
 * (PLAN.md's "role-permission delegation") — one row per (role, action)
 * combination that's ever actually been set. A combination with NO row is "not
 * yet configured", and every enforcement check treats that identically to
 * enabled=false: a newly created role therefore starts with every toggle off,
 * strictly no more privileged than an unconfigured Observer.
 *
 * NO dashboard_id column of its own: role_id already determines the dashboard
 * via dashboard_roles.dashboard_id, and a second copy could disagree with it —
 * the same hazard the composite FK above closes, but with no equivalent
 * constraint available here. Dashboard scoping lives in exactly one place.
 */
export const dashboardRolePermissions = pgTable(
  "dashboard_role_permissions",
  {
    /**
     * ON DELETE CASCADE, unlike dashboard_members.role_id's deliberate
     * omission — and the asymmetry is the design. These rows are pure
     * configuration with no audit value, and a role anyone actually holds
     * can't be deleted at all, so this cascade can only ever sweep the toggles
     * of a role nobody holds. That's what makes deleting a role a real
     * DELETE rather than the soft delete `dashboards` is stuck with.
     */
    roleId: uuid("role_id")
      .notNull()
      .references(() => dashboardRoles.id, { onDelete: "cascade" }),
    action: dashboardPermissionActionEnum("action").notNull(),
    enabled: boolean("enabled").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.action] })],
);
