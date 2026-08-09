import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import {
  currentMonth,
  spendKey,
  tokenKey,
  currentPromptKey,
  freezeKey,
  microCentsToCents,
  ASSISTANT_ADAPTER_SLUGS,
  type AgentStatus,
} from "@tollgate/shared";
import { db } from "../db/client.js";
import { agents, dashboards, policies, orgUpstreamKeys } from "../db/schema.js";
import { dashboardAccessible, resolveDashboardId, UUID_RE } from "../lib/dashboard-scope.js";
import { canPerformDashboardAction } from "../lib/dashboard-permissions.js";
import { hashToken, generateToken } from "../lib/tokens.js";

interface CreateAgentBody {
  name: string;
  providerSlug: string;
  maxBudgetCents: number | null;
  model: string | null;
  upstreamKeyId: string | null;
  /** Which dashboard the agent is created in. Carried as raw `unknown` because
   *  validating it needs a database round-trip against the caller's org — see
   *  resolveDashboardId, which the route calls before touching anything else. */
  dashboardId: unknown;
}

/**
 * Agent creation is restricted to the app names the dashboard's dropdown
 * offers. Keep in sync with the frontend's PROVIDERS options if that list
 * changes.
 */
const ALLOWED_PROVIDER_SLUGS = new Set(["claude", "chatgpt", "gemini", "azure", "bedrock"]);

function parseCreateBody(body: unknown): CreateAgentBody | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;

  const name = rec["name"];
  const providerSlug = rec["providerSlug"];
  const maxBudgetCentsRaw = rec["maxBudgetCents"];
  const modelRaw = rec["model"];
  const upstreamKeyIdRaw = rec["upstreamKeyId"];

  if (typeof name !== "string" || name.trim() === "") return null;
  if (typeof providerSlug !== "string" || providerSlug.trim() === "") return null;

  let maxBudgetCents: number | null;
  if (maxBudgetCentsRaw === undefined || maxBudgetCentsRaw === null) {
    maxBudgetCents = null;
  } else if (typeof maxBudgetCentsRaw === "number" && maxBudgetCentsRaw >= 0) {
    maxBudgetCents = maxBudgetCentsRaw;
  } else {
    return null;
  }

  let model: string | null;
  if (modelRaw === undefined || modelRaw === null) {
    model = null;
  } else if (typeof modelRaw === "string" && modelRaw.trim() !== "") {
    model = modelRaw;
  } else {
    return null;
  }

  let upstreamKeyId: string | null;
  if (upstreamKeyIdRaw === undefined || upstreamKeyIdRaw === null) {
    upstreamKeyId = null;
  } else if (typeof upstreamKeyIdRaw === "string" && upstreamKeyIdRaw.trim() !== "") {
    upstreamKeyId = upstreamKeyIdRaw;
  } else {
    return null;
  }

  return {
    name,
    providerSlug,
    maxBudgetCents,
    model,
    upstreamKeyId,
    dashboardId: rec["dashboardId"],
  };
}

/**
 * An agent may only be pointed at a stored BYOK key that (a) belongs to the
 * caller's own org and (b) was saved for the ADAPTER this agent's assistant
 * label maps to — see @tollgate/shared's ASSISTANT_ADAPTER_SLUGS doc comment
 * for why those two vocabularies differ. Without this check an agent could be
 * silently assigned a key for the wrong provider, which the proxy would then
 * hand to an upstream it was never meant for.
 */
async function upstreamKeyBelongsToProvider(
  upstreamKeyId: string,
  orgId: string,
  assistantProviderSlug: string,
): Promise<boolean> {
  const adapterSlug = ASSISTANT_ADAPTER_SLUGS[assistantProviderSlug];
  if (adapterSlug === undefined) return false;

  const rows = await db
    .select({ id: orgUpstreamKeys.id })
    .from(orgUpstreamKeys)
    .where(
      and(
        eq(orgUpstreamKeys.id, upstreamKeyId),
        eq(orgUpstreamKeys.orgId, orgId),
        eq(orgUpstreamKeys.providerSlug, adapterSlug),
      ),
    );
  return rows.length > 0;
}

/** Partial update from PATCH /v1/agents/:id. Every field is optional; an
 *  absent key means "leave alone", which is why this can't reuse
 *  parseCreateBody — there, absent and null both mean null. */
interface UpdateAgentBody {
  name?: string;
  model?: string | null;
  maxBudgetCents?: number | null;
  upstreamKeyId?: string | null;
}

type UpdateParseResult =
  | { ok: true; body: UpdateAgentBody }
  | { ok: false; error: "invalid_body" | "provider_slug_immutable" | "dashboard_id_immutable" };

function parseUpdateBody(body: unknown): UpdateParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const rec = body as Record<string, unknown>;

  // providerSlug is the proxy's authorization boundary (the assistant gate in
  // backend/proxy/src/routes/proxy.ts decides which upstream an agent's token
  // may reach). Editing it would silently repoint a live token at a different
  // vendor, so reject the attempt loudly instead of ignoring the field.
  if ("providerSlug" in rec) return { ok: false, error: "provider_slug_immutable" };

  // Moving an agent between dashboards isn't built. Rejecting the field loudly
  // beats the alternative this parser would otherwise fall into — ignoring the
  // unknown key, then 400ing "invalid_body" for an empty patch, which reads like
  // a malformed request rather than an unsupported one.
  if ("dashboardId" in rec) return { ok: false, error: "dashboard_id_immutable" };

  const out: UpdateAgentBody = {};

  if ("name" in rec) {
    const name = rec["name"];
    if (typeof name !== "string" || name.trim() === "") return { ok: false, error: "invalid_body" };
    out.name = name.trim();
  }

  if ("model" in rec) {
    const model = rec["model"];
    if (model === null) out.model = null;
    else if (typeof model === "string" && model.trim() !== "") out.model = model;
    else return { ok: false, error: "invalid_body" };
  }

  if ("maxBudgetCents" in rec) {
    const raw = rec["maxBudgetCents"];
    if (raw === null) out.maxBudgetCents = null;
    else if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) out.maxBudgetCents = raw;
    else return { ok: false, error: "invalid_body" };
  }

  if ("upstreamKeyId" in rec) {
    const raw = rec["upstreamKeyId"];
    if (raw === null) out.upstreamKeyId = null;
    else if (typeof raw === "string" && raw.trim() !== "") out.upstreamKeyId = raw;
    else return { ok: false, error: "invalid_body" };
  }

  // An empty patch is a caller mistake, not a no-op success.
  if (Object.keys(out).length === 0) return { ok: false, error: "invalid_body" };

  return { ok: true, body: out };
}

function parsePolicyBody(body: unknown): { maxBudgetCents: number | null } | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;
  if (!("maxBudgetCents" in rec)) return null;

  const raw = rec["maxBudgetCents"];
  if (raw === null) return { maxBudgetCents: null };
  if (typeof raw !== "number" || raw < 0) return null;
  return { maxBudgetCents: raw };
}

function parseFreezeBody(body: unknown): { mode: "soft" | "hard" } | null {
  if (typeof body !== "object" || body === null) return null;
  const mode = (body as Record<string, unknown>)["mode"];
  if (mode !== "soft" && mode !== "hard") return null;
  return { mode };
}

/**
 * Shared lookup for the policy/freeze/unfreeze/delete/update routes. Scoped to
 * dashboardAccessible (the caller's own org, OR an explicit dashboard_members
 * share grant — see PLAN.md's dashboard sharing): an id belonging to a
 * dashboard the caller can't reach resolves to null (-> 404), so cross-account
 * isolation is enforced right here rather than in each handler. Also returns
 * the dashboard's OWN org (dashboardOrgId) — a shared caller's req.activeOrgId
 * is NOT that org, so anything downstream that needs to check or stamp an org
 * (upstreamKeyBelongsToProvider) has to use dashboardOrgId, not the caller's.
 *
 * IT ALSO REFUSES GONE AGENTS, and that guard lives here rather than in each
 * route on purpose: it is what stops the entire family of mutations from
 * resurrecting an agent the app has already revoked. The one that mattered most
 * is POST /v1/agents/:id/unfreeze, which sets status='active' AND deletes the
 * Redis freeze key — i.e. undoes BOTH revocation mechanisms — and would have
 * handed back a live, spendable token inside a dashboard no screen can reach,
 * effective on the proxy's very next request. Deleting a dashboard is only
 * really a revocation if unfreeze can't take it back.
 *
 * "Gone" is TWO conditions, and they are different sets — both are needed:
 *   - the agent's own status is 'archived' — an ordinary DELETE /v1/agents/:id,
 *     whose dashboard is still perfectly alive;
 *   - the agent's DASHBOARD is soft-deleted — which can hold an agent that is
 *     still 'active', because the create-race window below can insert one.
 * Neither condition implies the other, so checking only one leaves a live token
 * reachable. The realistic trigger isn't malice: a second tab keeps rendering
 * the deleted dashboard's agent table, and every row action in it still posts.
 *
 * The uuid screen is here for the same why-repeat-it reason. `agents.id` is a
 * uuid column, so a malformed id reaches Postgres as a 22P02 cast error, and
 * with no setErrorHandler registered anywhere in the api that surfaces as a 500
 * carrying the raw driver message. Screening the shape turns all five callers'
 * malformed ids into the 404 they already document.
 */
async function findAgent(
  id: string,
  orgId: string,
  userId: string,
): Promise<{
  id: string;
  policyId: string | null;
  status: AgentStatus;
  providerSlug: string;
  dashboardId: string;
  dashboardOrgId: string;
} | null> {
  if (!UUID_RE.test(id)) return null;

  const rows = await db
    .select({
      id: agents.id,
      policyId: agents.policyId,
      // Retained for the response/branching in the routes; the archived case can
      // no longer reach them, since the where clause below excludes it.
      status: agents.status,
      providerSlug: agents.providerSlug,
      // Needed by PATCH's rename clash check, which is scoped to the agent's own
      // dashboard now that names are unique per dashboard rather than per org.
      dashboardId: agents.dashboardId,
      dashboardOrgId: dashboards.orgId,
    })
    .from(agents)
    // The join is the second of the two conditions above — findAgent never
    // looked at the dashboard before, which is exactly how unfreeze could reach
    // into a deleted one. It's also what dashboardAccessible checks against, so
    // a shared caller resolves this exactly like an org-owning one does.
    .innerJoin(dashboards, eq(dashboards.id, agents.dashboardId))
    .where(
      and(
        eq(agents.id, id),
        dashboardAccessible(orgId, userId),
        ne(agents.status, "archived"),
        isNull(dashboards.archivedAt),
      ),
    );

  return rows[0] ?? null;
}

/**
 * Every route here is gated by the requireAuth preHandler (see index.ts), which
 * 401s anonymous callers and stamps req.activeOrgId. The `!` on req.activeOrgId
 * below is safe for that reason: a handler never runs without it.
 */
export function registerAgentRoutes(app: FastifyInstance, redis: Redis): void {
  app.post<{ Body: unknown }>("/v1/agents", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const body = parseCreateBody(req.body);
    if (body === null) {
      reply.code(400);
      return { error: "invalid_body" };
    }

    if (!ALLOWED_PROVIDER_SLUGS.has(body.providerSlug)) {
      reply.code(400);
      return {
        error: "invalid_provider_slug",
        message: `providerSlug must be one of: ${[...ALLOWED_PROVIDER_SLUGS].join(", ")}`,
      };
    }

    // Which dashboard the agent lands in is the caller's explicit choice, not
    // whichever one happens to be selected server-side. Creating into the wrong
    // dashboard is a durable mistake — there's no "move agent" affordance, so
    // fixing it means deleting and recreating — and deriving it from stored
    // selection state would misfile the agent whenever the two disagree (another
    // tab, a stale page). Requiring it makes the request say what it means.
    const scope = await resolveDashboardId(body.dashboardId, orgId, req.authUser!.id);
    if (!scope.ok) {
      reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
      return { error: scope.error };
    }

    if (
      !(await canPerformDashboardAction(
        scope.dashboardId,
        scope.orgId,
        orgId,
        req.authUser!.id,
        "createAgent",
      ))
    ) {
      reply.code(403);
      return {
        error: "dashboard_permission_denied",
        message: "Your role doesn't allow creating agents on this dashboard.",
      };
    }

    if (
      body.upstreamKeyId !== null &&
      // scope.orgId, not orgId: the vault a BYOK key must belong to is the
      // DASHBOARD's own org (its host's), which a shared caller's own org can
      // differ from — see resolveDashboardId's DashboardScopeResult doc.
      !(await upstreamKeyBelongsToProvider(body.upstreamKeyId, scope.orgId, body.providerSlug))
    ) {
      reply.code(400);
      return { error: "invalid_upstream_key" };
    }

    // Scoped to this DASHBOARD (+ non-archived): a name only needs to be free
    // within the dashboard it's being created in, so two independent dashboards
    // can each have a "support-bot". Archived agents don't count as "taken" —
    // DELETE /v1/agents/:id archives rather than hard-deletes (see that route).
    // Mirrors the partial unique index on (dashboard_id, name) in schema.ts.
    const existing = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.name, body.name),
          eq(agents.dashboardId, scope.dashboardId),
          ne(agents.status, "archived"),
        ),
      );
    if (existing.length > 0) {
      reply.code(409);
      return {
        error: "agent_name_taken",
        message: `An agent named "${body.name}" already exists in this dashboard`,
      };
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const policyId = randomUUID();
    const agentId = randomUUID();

    // 1:1 dedicated policy per agent (not a shared template) — see the schema
    // module doc comment for why: PATCH /v1/agents/:id/policy must not have a
    // blast radius onto other agents.
    //
    // scope.orgId, not orgId: a policy's org has to match the agent's (and
    // therefore the dashboard's) own org, which a shared caller's own org can
    // differ from.
    await db.insert(policies).values({
      id: policyId,
      orgId: scope.orgId,
      name: `${body.name} policy`,
      budgetCents: body.maxBudgetCents ?? 0,
      maxBudgetCents: body.maxBudgetCents,
    });

    // THE INSERT IS CONDITIONAL ON THE DASHBOARD STILL BEING LIVE, decided by
    // Postgres in one statement, because nothing above it can decide it.
    //
    // This route is a five-statement, non-transactional sequence, and
    // resolveDashboardId ran at statement 1 — the race is in the gap before this
    // one. Soft delete is what opened that gap: a hard `DELETE FROM dashboards`
    // would have made these two statements queue and failed one of them, but
    // `UPDATE dashboards SET archived_at` doesn't touch the primary key, so it
    // takes FOR NO KEY UPDATE, which does NOT conflict with the FOR KEY SHARE
    // this insert's FK check takes. The parent row always exists now, so the FK
    // is reduced to checking something that is always true. Unfixed, a delete
    // committing here leaves a brand-new ACTIVE agent holding a live token
    // inside an already-swept dashboard — invisible everywhere, never revoked.
    //
    // FOR SHARE is the part that actually closes it, not the WHERE. Under READ
    // COMMITTED a plain sub-SELECT would read its own snapshot, never block on
    // the uncommitted UPDATE, and still see archived_at IS NULL. FOR SHARE
    // conflicts with FOR NO KEY UPDATE, so this waits for the delete to commit
    // and Postgres then re-evaluates the predicate against the new row version
    // and matches nothing. Either the agent is created before the sweep (and the
    // sweep archives it) or it is never created at all.
    //
    // dashboardAccessible (lib/dashboard-scope.ts) is interpolated directly into
    // this raw SQL rather than hand-copied — its SQL chunks splice into any
    // sql`` template, this CTE included, so the FOR SHARE lock's need for raw
    // SQL doesn't force a second hand-written copy of the sharing predicate to
    // drift out of sync with the shared one.
    //
    // ${scope.orgId} for the inserted row's org_id, NOT the caller's orgId — the
    // agent has to belong to the DASHBOARD's own org regardless of who (host or
    // shared guest) is creating it. resolveDashboardId already resolved and
    // returned that value; the CTE below only needs to re-check the dashboard
    // is still live and reachable, not re-derive its org.
    const inserted = await db.execute(sql`
      with live as materialized (
        select "id"
        from "dashboards"
        where "id" = ${scope.dashboardId}::uuid
          and ${dashboardAccessible(orgId, req.authUser!.id)}
          and "archived_at" is null
        for share
      )
      insert into "agents" (
        "id", "org_id", "dashboard_id", "name",
        "provider_slug", "model", "policy_id", "token_hash", "upstream_key_id"
      )
      select
        ${agentId}::uuid, ${scope.orgId}, live."id", ${body.name},
        ${body.providerSlug}, ${body.model}::text, ${policyId}::uuid,
        ${tokenHash}, ${body.upstreamKeyId}::uuid
      from live
      returning "id"
    `);

    if ((inserted.rowCount ?? 0) === 0) {
      // The dashboard was deleted out from under this request. Drop the policy
      // row written just above — it is 1:1 with an agent that now doesn't exist,
      // nothing else references it, and leaving it behind would accumulate
      // orphans on a path a stale tab can hit repeatedly.
      await db.delete(policies).where(eq(policies.id, policyId));
      reply.code(404);
      return { error: "dashboard_not_found" };
    }

    reply.code(201);
    return {
      id: agentId,
      name: body.name,
      providerSlug: body.providerSlug,
      model: body.model,
      status: "active" satisfies AgentStatus,
      maxBudgetCents: body.maxBudgetCents,
      upstreamKeyId: body.upstreamKeyId,
      dashboardId: scope.dashboardId,
      // Returned once. Only the hash is ever persisted — this response is the
      // only chance the caller has to see the raw token.
      token,
    };
  });

  app.get<{ Querystring: { dashboardId?: string } }>("/v1/agents", async (req, reply) => {
    const orgId = req.activeOrgId!;

    // The dashboard is required, not optional-with-an-org-wide-fallback. An
    // omitted id used to mean "every agent in the org", which is exactly the
    // behaviour that made all dashboards show the same list — leaving that as a
    // silent default would keep the bug one forgotten parameter away.
    const scope = await resolveDashboardId(req.query.dashboardId, orgId, req.authUser!.id);
    if (!scope.ok) {
      reply.code(scope.error === "dashboard_id_required" ? 400 : 404);
      return { error: scope.error };
    }

    const rows = await db
      .select({
        id: agents.id,
        name: agents.name,
        providerSlug: agents.providerSlug,
        model: agents.model,
        status: agents.status,
        maxBudgetCents: policies.maxBudgetCents,
        upstreamKeyId: agents.upstreamKeyId,
      })
      .from(agents)
      // Three independent filters, all load-bearing:
      //   dashboardId — the whole point of this endpoint; dashboards don't share
      //     agents, so this is what makes them independent of one another.
      //   orgId — kept even though dashboardId already implies it, as
      //     defence-in-depth: if the dashboard scoping above ever regresses, the
      //     failure stays contained instead of leaking across accounts.
      //     scope.orgId (the DASHBOARD's own org), not the caller's req.activeOrgId
      //     — dashboard sharing (PLAN.md) means those can legitimately differ for
      //     a shared caller, and this filter is asserting agents.orgId matches
      //     its own dashboard, not matching whoever's asking.
      //   status — archived agents are DELETE /v1/agents/:id's result (an
      //     archive, not a hard row delete). Excluding them is what makes delete
      //     stick from the dashboard's perspective: without it, an archived agent
      //     reappears on the very next 3s poll.
      .leftJoin(policies, eq(policies.id, agents.policyId))
      .where(
        and(
          eq(agents.dashboardId, scope.dashboardId),
          eq(agents.orgId, scope.orgId),
          ne(agents.status, "archived"),
        ),
      );

    const month = currentMonth(new Date());

    const withSpend = await Promise.all(
      rows.map(async (row) => {
        const [spendRaw, tokensRaw, currentPrompt] = await Promise.all([
          redis.get(spendKey(row.id, month)),
          redis.get(tokenKey(row.id, month)),
          redis.get(currentPromptKey(row.id)),
        ]);
        const spentMicroCents = spendRaw === null ? 0 : Number.parseInt(spendRaw, 10);
        const tokens = tokensRaw === null ? 0 : Number.parseInt(tokensRaw, 10);
        return {
          id: row.id,
          name: row.name,
          providerSlug: row.providerSlug,
          model: row.model,
          status: row.status,
          maxBudgetCents: row.maxBudgetCents,
          upstreamKeyId: row.upstreamKeyId,
          currentMonthSpendCents: microCentsToCents(
            Number.isNaN(spentMicroCents) ? 0 : spentMicroCents,
          ),
          currentMonthTokens: Number.isNaN(tokens) ? 0 : tokens,
          currentPrompt,
        };
      }),
    );

    return withSpend;
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/v1/agents/:id",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const agent = await findAgent(req.params.id, orgId, req.authUser!.id);
      // findAgent is org-scoped, so another org's id already reads as null here
      // — and since it also excludes archived agents and agents in deleted
      // dashboards, so does everything the UI treats as gone. (The archived
      // check used to live in this handler; it moved into findAgent so
      // policy/freeze/unfreeze/delete get it too.)
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      // Checked before parseUpdateBody, same "unauthorized caller learns
      // nothing about their payload" ordering routes/dashboards.ts's role
      // PATCH uses — an invalid body from a caller who couldn't have made
      // this edit anyway shouldn't 400 before it 403s.
      if (
        !(await canPerformDashboardAction(
          agent.dashboardId,
          agent.dashboardOrgId,
          orgId,
          req.authUser!.id,
          "updateAgent",
        ))
      ) {
        reply.code(403);
        return {
          error: "dashboard_permission_denied",
          message: "Your role doesn't allow editing agents on this dashboard.",
        };
      }

      const parsed = parseUpdateBody(req.body);
      if (!parsed.ok) {
        reply.code(400);
        if (parsed.error === "provider_slug_immutable") {
          return {
            error: "provider_slug_immutable",
            message: "An agent's assistant can't be changed after it's created.",
          };
        }
        if (parsed.error === "dashboard_id_immutable") {
          return {
            error: "dashboard_id_immutable",
            message: "An agent can't be moved to a different dashboard.",
          };
        }
        return { error: "invalid_body" };
      }
      const body = parsed.body;

      if (body.name !== undefined) {
        // Same dashboard + non-archived scoping as POST /v1/agents (and the
        // partial unique index in db/schema.ts), plus ne(id) so an agent doesn't
        // collide with its own row when the name is submitted unchanged. Scoped
        // to the agent's OWN dashboard — renaming can't move it, so a name in
        // some other dashboard is none of this check's business.
        const clash = await db
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.name, body.name),
              eq(agents.dashboardId, agent.dashboardId),
              ne(agents.status, "archived"),
              ne(agents.id, agent.id),
            ),
          );
        if (clash.length > 0) {
          reply.code(409);
          return {
            error: "agent_name_taken",
            message: `An agent named "${body.name}" already exists in this dashboard`,
          };
        }
      }

      if (body.maxBudgetCents !== undefined && agent.policyId === null) {
        reply.code(409);
        return { error: "agent_has_no_policy" };
      }

      if (
        body.upstreamKeyId !== undefined &&
        body.upstreamKeyId !== null &&
        // agent.dashboardOrgId, not orgId — same reasoning as POST /v1/agents.
        !(await upstreamKeyBelongsToProvider(body.upstreamKeyId, agent.dashboardOrgId, agent.providerSlug))
      ) {
        reply.code(400);
        return { error: "invalid_upstream_key" };
      }

      const agentFields: { name?: string; model?: string | null; upstreamKeyId?: string | null } =
        {};
      if (body.name !== undefined) agentFields.name = body.name;
      if (body.model !== undefined) agentFields.model = body.model;
      if (body.upstreamKeyId !== undefined) agentFields.upstreamKeyId = body.upstreamKeyId;

      if (Object.keys(agentFields).length > 0) {
        await db
          .update(agents)
          .set({ ...agentFields, updatedAt: new Date() })
          .where(eq(agents.id, agent.id));
      }

      // Budget lives on the agent's dedicated 1:1 policy row, same target
      // PATCH /v1/agents/:id/policy writes to.
      if (body.maxBudgetCents !== undefined && agent.policyId !== null) {
        await db
          .update(policies)
          .set({ maxBudgetCents: body.maxBudgetCents, updatedAt: new Date() })
          .where(eq(policies.id, agent.policyId));
      }

      // Re-read so the response reflects committed state including the fields
      // the caller didn't send — same column set as a GET /v1/agents row minus
      // the live Redis spend counters. Never includes the token.
      const rows = await db
        .select({
          id: agents.id,
          name: agents.name,
          providerSlug: agents.providerSlug,
          model: agents.model,
          status: agents.status,
          maxBudgetCents: policies.maxBudgetCents,
          upstreamKeyId: agents.upstreamKeyId,
        })
        .from(agents)
        .leftJoin(policies, eq(policies.id, agents.policyId))
        .where(eq(agents.id, agent.id));

      const updated = rows[0];
      if (updated === undefined) {
        reply.code(404);
        return { error: "agent_not_found" };
      }
      return updated;
    },
  );

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/v1/agents/:id/policy",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const agent = await findAgent(req.params.id, orgId, req.authUser!.id);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      // Budget lives on a separate route from PATCH /v1/agents/:id, but it's
      // the same "edit an agent" capability the updateAgent toggle governs
      // there — gating one and not the other would let a restricted Observer
      // rewrite an agent's budget through this door instead.
      if (
        !(await canPerformDashboardAction(
          agent.dashboardId,
          agent.dashboardOrgId,
          orgId,
          req.authUser!.id,
          "updateAgent",
        ))
      ) {
        reply.code(403);
        return {
          error: "dashboard_permission_denied",
          message: "Your role doesn't allow editing agents on this dashboard.",
        };
      }

      const body = parsePolicyBody(req.body);
      if (body === null) {
        reply.code(400);
        return { error: "invalid_body" };
      }

      if (agent.policyId === null) {
        reply.code(409);
        return { error: "agent_has_no_policy" };
      }

      await db
        .update(policies)
        .set({ maxBudgetCents: body.maxBudgetCents, updatedAt: new Date() })
        .where(eq(policies.id, agent.policyId));

      return { id: agent.id, maxBudgetCents: body.maxBudgetCents };
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/v1/agents/:id/freeze",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      // Authorization is now the session + org membership (requireAuth + the
      // org-scoped findAgent), not the agent's own token: a logged-in org member
      // can stop any agent in their org. The raw agent token remains the auth
      // only for the agent -> proxy path.
      const agent = await findAgent(req.params.id, orgId, req.authUser!.id);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      if (
        !(await canPerformDashboardAction(
          agent.dashboardId,
          agent.dashboardOrgId,
          orgId,
          req.authUser!.id,
          "freezeAgent",
        ))
      ) {
        reply.code(403);
        return {
          error: "dashboard_permission_denied",
          message: "Your role doesn't allow freezing agents on this dashboard.",
        };
      }

      const body = parseFreezeBody(req.body);
      if (body === null) {
        reply.code(400);
        return { error: "invalid_body" };
      }

      const status: AgentStatus = body.mode === "hard" ? "hard_frozen" : "soft_frozen";

      await db
        .update(agents)
        .set({ status, updatedAt: new Date() })
        .where(eq(agents.id, agent.id));

      // Redis fast-path flag, set in lockstep with Postgres — see
      // backend/proxy/src/lib/freeze.ts for why the proxy checks this too.
      await redis.set(freezeKey(agent.id), "1");

      return { id: agent.id, status };
    },
  );

  app.post<{ Params: { id: string } }>(
    "/v1/agents/:id/unfreeze",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      // Session + org membership authorizes this (see the freeze route).
      const agent = await findAgent(req.params.id, orgId, req.authUser!.id);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      if (
        !(await canPerformDashboardAction(
          agent.dashboardId,
          agent.dashboardOrgId,
          orgId,
          req.authUser!.id,
          "unfreezeAgent",
        ))
      ) {
        reply.code(403);
        return {
          error: "dashboard_permission_denied",
          message: "Your role doesn't allow unfreezing agents on this dashboard.",
        };
      }

      await db
        .update(agents)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(agents.id, agent.id));

      await redis.del(freezeKey(agent.id));

      return { id: agent.id, status: "active" satisfies AgentStatus };
    },
  );

  app.delete<{ Params: { id: string } }>("/v1/agents/:id", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const agent = await findAgent(req.params.id, orgId, req.authUser!.id);
    if (agent === null) {
      reply.code(404);
      return { error: "agent_not_found" };
    }

    if (
      !(await canPerformDashboardAction(
        agent.dashboardId,
        agent.dashboardOrgId,
        orgId,
        req.authUser!.id,
        "deleteAgent",
      ))
    ) {
      reply.code(403);
      return {
        error: "dashboard_permission_denied",
        message: "Your role doesn't allow deleting agents on this dashboard.",
      };
    }

    await db
      .update(agents)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    // Same belt-and-suspenders Redis flag freeze/unfreeze use — the proxy's
    // FROZEN_STATUSES set already includes "archived" so the Postgres status
    // alone would deny the agent, but setting this too keeps the fast-path
    // check consistent with every other status transition here.
    await redis.set(freezeKey(agent.id), "1");

    return { id: agent.id, status: "archived" satisfies AgentStatus };
  });
}
