import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
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
}

function parseCreateBody(body: unknown): CreateAgentBody | null {
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;

  const name = rec["name"];
  const providerSlug = rec["providerSlug"];
  const maxBudgetCentsRaw = rec["maxBudgetCents"];

  if (typeof name !== "string" || name.trim() === "") return null;
  if (typeof providerSlug !== "string" || providerSlug.trim() === "") return null;

  if (maxBudgetCentsRaw === undefined || maxBudgetCentsRaw === null) {
    return { name, providerSlug, maxBudgetCents: null };
  }
  if (typeof maxBudgetCentsRaw !== "number" || maxBudgetCentsRaw < 0) return null;

  return { name, providerSlug, maxBudgetCents: maxBudgetCentsRaw };
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

/** Shared lookup used by the policy/freeze/unfreeze routes: agent must exist. */
async function findAgent(
  id: string,
): Promise<{ id: string; policyId: string | null } | null> {
  const rows = await db
    .select({ id: agents.id, policyId: agents.policyId })
    .from(agents)
    .where(eq(agents.id, id));

  return rows[0] ?? null;
}

export function registerAgentRoutes(app: FastifyInstance, redis: Redis): void {
  app.post<{ Body: unknown }>("/v1/agents", async (req, reply) => {
    const body = parseCreateBody(req.body);
    if (body === null) {
      reply.code(400);
      return { error: "invalid_body" };
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
      policyId,
      tokenHash,
    });

    reply.code(201);
    return {
      id: agentId,
      name: body.name,
      providerSlug: body.providerSlug,
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
        status: agents.status,
        maxBudgetCents: policies.maxBudgetCents,
      })
      .from(agents)
      .leftJoin(policies, eq(policies.id, agents.policyId));

    const month = currentMonth(new Date());

    const withSpend = await Promise.all(
      rows.map(async (row) => {
        const raw = await redis.get(spendKey(row.id, month));
        const spentMicroCents = raw === null ? 0 : Number.parseInt(raw, 10);
        return {
          id: row.id,
          name: row.name,
          providerSlug: row.providerSlug,
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

      await db
        .update(agents)
        .set({ status: "active", updatedAt: new Date() })
        .where(eq(agents.id, agent.id));

      await redis.del(freezeKey(agent.id));

      return { id: agent.id, status: "active" satisfies AgentStatus };
    },
  );
}
