import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq, ne } from "drizzle-orm";
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
import { agents, policies, orgUpstreamKeys } from "../db/schema.js";
import { hashToken, generateToken } from "../lib/tokens.js";

interface CreateAgentBody {
  name: string;
  providerSlug: string;
  maxBudgetCents: number | null;
  model: string | null;
  upstreamKeyId: string | null;
}

/**
 * Agent creation is restricted to the app names the dashboard's dropdown
 * offers. Keep in sync with the frontend's PROVIDERS options if that list
 * changes.
 */
const ALLOWED_PROVIDER_SLUGS = new Set(["claude", "chatgpt", "gemini"]);

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

  return { name, providerSlug, maxBudgetCents, model, upstreamKeyId };
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
  | { ok: false; error: "invalid_body" | "provider_slug_immutable" };

function parseUpdateBody(body: unknown): UpdateParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const rec = body as Record<string, unknown>;

  // providerSlug is the proxy's authorization boundary (the assistant gate in
  // backend/proxy/src/routes/proxy.ts decides which upstream an agent's token
  // may reach). Editing it would silently repoint a live token at a different
  // vendor, so reject the attempt loudly instead of ignoring the field.
  if ("providerSlug" in rec) return { ok: false, error: "provider_slug_immutable" };

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

/** Shared lookup for the policy/freeze/unfreeze/delete/update routes. Scoped to
 *  the caller's org: an id belonging to another org resolves to null (-> 404),
 *  so cross-account isolation is enforced right here rather than in each
 *  handler. status lets PATCH refuse to edit an archived agent. */
async function findAgent(
  id: string,
  orgId: string,
): Promise<{
  id: string;
  policyId: string | null;
  status: AgentStatus;
  providerSlug: string;
} | null> {
  const rows = await db
    .select({
      id: agents.id,
      policyId: agents.policyId,
      status: agents.status,
      providerSlug: agents.providerSlug,
    })
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.orgId, orgId)));

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

    if (
      body.upstreamKeyId !== null &&
      !(await upstreamKeyBelongsToProvider(body.upstreamKeyId, orgId, body.providerSlug))
    ) {
      reply.code(400);
      return { error: "invalid_upstream_key" };
    }

    // Scoped to this org (+ non-archived): a name only needs to be free within
    // the caller's own org. Archived agents don't count as "taken" — DELETE
    // /v1/agents/:id archives rather than hard-deletes (see that route). Mirrors
    // the partial unique index on (org_id, name) in schema.ts.
    const existing = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.name, body.name),
          eq(agents.orgId, orgId),
          ne(agents.status, "archived"),
        ),
      );
    if (existing.length > 0) {
      reply.code(409);
      return {
        error: "agent_name_taken",
        message: `An agent named "${body.name}" already exists`,
      };
    }

    const token = generateToken();
    const tokenHash = hashToken(token);
    const policyId = randomUUID();
    const agentId = randomUUID();

    // 1:1 dedicated policy per agent (not a shared template) — see the schema
    // module doc comment for why: PATCH /v1/agents/:id/policy must not have a
    // blast radius onto other agents.
    await db.insert(policies).values({
      id: policyId,
      orgId,
      name: `${body.name} policy`,
      budgetCents: body.maxBudgetCents ?? 0,
      maxBudgetCents: body.maxBudgetCents,
    });

    await db.insert(agents).values({
      id: agentId,
      orgId,
      name: body.name,
      providerSlug: body.providerSlug,
      model: body.model,
      policyId,
      tokenHash,
      upstreamKeyId: body.upstreamKeyId,
    });

    reply.code(201);
    return {
      id: agentId,
      name: body.name,
      providerSlug: body.providerSlug,
      model: body.model,
      status: "active" satisfies AgentStatus,
      maxBudgetCents: body.maxBudgetCents,
      upstreamKeyId: body.upstreamKeyId,
      // Returned once. Only the hash is ever persisted — this response is the
      // only chance the caller has to see the raw token.
      token,
    };
  });

  app.get("/v1/agents", async (req) => {
    const orgId = req.activeOrgId!;
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
      // Scoped to the caller's org so one account never sees another's agents.
      // Archived agents are DELETE /v1/agents/:id's result (an archive, not a
      // hard row delete — see that route). Excluding them here is what makes
      // delete actually stick from the dashboard's perspective: without this,
      // an archived agent would reappear on the very next 3s poll.
      .leftJoin(policies, eq(policies.id, agents.policyId))
      .where(and(eq(agents.orgId, orgId), ne(agents.status, "archived")));

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
      const agent = await findAgent(req.params.id, orgId);
      // findAgent is org-scoped, so another org's id already reads as null here.
      // Archived agents are hidden from GET /v1/agents (DELETE archives rather
      // than hard-deletes), so they must not be editable either — treat them
      // as gone rather than 200-ing an edit nobody can see.
      if (agent === null || agent.status === "archived") {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      const parsed = parseUpdateBody(req.body);
      if (!parsed.ok) {
        reply.code(400);
        return parsed.error === "provider_slug_immutable"
          ? {
              error: "provider_slug_immutable",
              message: "An agent's assistant can't be changed after it's created.",
            }
          : { error: "invalid_body" };
      }
      const body = parsed.body;

      if (body.name !== undefined) {
        // Same org + non-archived scoping as POST /v1/agents (and the partial
        // unique index in db/schema.ts), plus ne(id) so an agent doesn't collide
        // with its own row when the name is submitted unchanged.
        const clash = await db
          .select({ id: agents.id })
          .from(agents)
          .where(
            and(
              eq(agents.name, body.name),
              eq(agents.orgId, orgId),
              ne(agents.status, "archived"),
              ne(agents.id, agent.id),
            ),
          );
        if (clash.length > 0) {
          reply.code(409);
          return {
            error: "agent_name_taken",
            message: `An agent named "${body.name}" already exists`,
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
        !(await upstreamKeyBelongsToProvider(body.upstreamKeyId, orgId, agent.providerSlug))
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
      const agent = await findAgent(req.params.id, orgId);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
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
      const agent = await findAgent(req.params.id, orgId);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
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
      const agent = await findAgent(req.params.id, orgId);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
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
    const agent = await findAgent(req.params.id, orgId);
    if (agent === null) {
      reply.code(404);
      return { error: "agent_not_found" };
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
