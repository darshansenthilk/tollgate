import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq, ne } from "drizzle-orm";
import type { Redis } from "ioredis";
import {
  currentMonth,
  spendKey,
  freezeKey,
  microCentsToCents,
  type AgentStatus,
} from "@tollgate/shared";
import { db } from "../db/client.js";
import { agents, policies } from "../db/schema.js";
import { hashToken, generateToken } from "../lib/tokens.js";

interface CreateAgentBody {
  name: string;
  providerSlug: string;
  maxBudgetCents: number | null;
  model: string | null;
}

/**
 * Agent creation is restricted to providers the dashboard's dropdown offers.
 * Keep in sync with the frontend's provider options if that list changes.
 */
const ALLOWED_PROVIDER_SLUGS = new Set(["anthropic", "openai"]);

function parseCreateBody(body: unknown): CreateAgentBody | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;

  const name = rec["name"];
  const providerSlug = rec["providerSlug"];
  const maxBudgetCentsRaw = rec["maxBudgetCents"];
  const modelRaw = rec["model"];

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

  return { name, providerSlug, maxBudgetCents, model };
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

/** Same shape/behavior as backend/proxy/src/routes/proxy.ts's extractBearer —
 *  duplicated rather than shared, matching this codebase's existing pattern
 *  of keeping small per-service auth helpers local (see lib/tokens.ts). */
function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1];
  return token === undefined ? null : token.trim() || null;
}

/** Shared lookup used by the policy/freeze/unfreeze/delete routes: agent
 *  must exist. tokenHash is included so freeze/unfreeze can verify the
 *  caller-supplied token without a second query. */
async function findAgent(
  id: string,
): Promise<{ id: string; policyId: string | null; tokenHash: string } | null> {
  const rows = await db
    .select({ id: agents.id, policyId: agents.policyId, tokenHash: agents.tokenHash })
    .from(agents)
    .where(eq(agents.id, id));

  return rows[0] ?? null;
}

/**
 * Freeze/unfreeze require the caller to prove they hold the agent's own
 * token, via the same Bearer scheme the proxy uses — this is what the
 * dashboard's paste-token field is for. Returns an error code to send as a
 * 401, or null if the token is present and matches.
 */
function checkAgentToken(
  req: { headers: { authorization?: string } },
  agent: { tokenHash: string },
): "missing_token" | "invalid_token" | null {
  const token = extractBearer(req.headers.authorization);
  if (token === null) return "missing_token";
  if (hashToken(token) !== agent.tokenHash) return "invalid_token";
  return null;
}

export function registerAgentRoutes(app: FastifyInstance, redis: Redis): void {
  app.post<{ Body: unknown }>("/v1/agents", async (req, reply) => {
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

    const existing = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.name, body.name));
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
      name: `${body.name} policy`,
      budgetCents: body.maxBudgetCents ?? 0,
      maxBudgetCents: body.maxBudgetCents,
    });

    await db.insert(agents).values({
      id: agentId,
      name: body.name,
      providerSlug: body.providerSlug,
      model: body.model,
      policyId,
      tokenHash,
    });

    reply.code(201);
    return {
      id: agentId,
      name: body.name,
      providerSlug: body.providerSlug,
      model: body.model,
      status: "active" satisfies AgentStatus,
      maxBudgetCents: body.maxBudgetCents,
      // Returned once. Only the hash is ever persisted — this response is the
      // only chance the caller has to see the raw token.
      token,
    };
  });

  app.get("/v1/agents", async () => {
    const rows = await db
      .select({
        id: agents.id,
        name: agents.name,
        providerSlug: agents.providerSlug,
        model: agents.model,
        status: agents.status,
        maxBudgetCents: policies.maxBudgetCents,
      })
      .from(agents)
      // Archived agents are DELETE /v1/agents/:id's result (an archive, not a
      // hard row delete — see that route). Excluding them here is what makes
      // delete actually stick from the dashboard's perspective: without this,
      // an archived agent would reappear on the very next 3s poll.
      .leftJoin(policies, eq(policies.id, agents.policyId))
      .where(ne(agents.status, "archived"));

    const month = currentMonth(new Date());

    const withSpend = await Promise.all(
      rows.map(async (row) => {
        const raw = await redis.get(spendKey(row.id, month));
        const spentMicroCents = raw === null ? 0 : Number.parseInt(raw, 10);
        return {
          id: row.id,
          name: row.name,
          providerSlug: row.providerSlug,
          model: row.model,
          status: row.status,
          maxBudgetCents: row.maxBudgetCents,
          currentMonthSpendCents: microCentsToCents(
            Number.isNaN(spentMicroCents) ? 0 : spentMicroCents,
          ),
        };
      }),
    );

    return withSpend;
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/v1/agents/:id/policy",
    async (req, reply) => {
      const agent = await findAgent(req.params.id);
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
      const agent = await findAgent(req.params.id);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      const tokenError = checkAgentToken(req, agent);
      if (tokenError !== null) {
        reply.code(401);
        return { error: tokenError };
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
      const agent = await findAgent(req.params.id);
      if (agent === null) {
        reply.code(404);
        return { error: "agent_not_found" };
      }

      const tokenError = checkAgentToken(req, agent);
      if (tokenError !== null) {
        reply.code(401);
        return { error: tokenError };
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
    const agent = await findAgent(req.params.id);
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
