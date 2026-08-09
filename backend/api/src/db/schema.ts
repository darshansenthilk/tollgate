import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
  boolean,
  primaryKey,
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

export const dashboardMemberRoleEnum = pgEnum("dashboard_member_role", [
  "observer",
  "helper",
  "manager",
  "moderator",
  "admin",
]);

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
     * Assignable permission tier, defaulted to the lowest (observer) on every
     * add. Assignment + display only for now — no route reads this to gate
     * anything (see PLAN.md's D2); it exists so the host-only PATCH endpoint
     * and the share dialog's dropdown have somewhere to write and read.
     */
    role: dashboardMemberRoleEnum("role").notNull().default("observer"),
  },
  (table) => [
    // Adding the same person twice is a no-op, not a second row — the routes
    // rely on this to make POST /v1/dashboards/:id/members idempotent via
    // ON CONFLICT DO NOTHING.
    uniqueIndex("dashboard_members_dashboard_user_unique").on(table.dashboardId, table.userId),
  ],
);

/**
 * Per-role, per-action toggle for the 6 dashboard actions a host can delegate
 * (PLAN.md's "role-permission delegation") — one row per (dashboard, role,
 * action) combination that's ever actually been set. A combination with NO
 * row is "not yet configured", and every enforcement check treats that
 * identically to enabled=false: an unconfigured role starts with no
 * permissions, matching dashboardMembers.role's own "observer, no
 * permissions" default above.
 *
 * Scoped by dashboardId (not just role) so two dashboards' Observer rows are
 * independent — a host delegating create-agent to Observers on one dashboard
 * doesn't touch any other dashboard they host.
 */
export const dashboardRolePermissions = pgTable(
  "dashboard_role_permissions",
  {
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id),
    role: dashboardMemberRoleEnum("role").notNull(),
    action: dashboardPermissionActionEnum("action").notNull(),
    enabled: boolean("enabled").notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.dashboardId, table.role, table.action] })],
);
