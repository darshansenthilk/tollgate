import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AgentStatus } from "@tollgate/shared";
import type { ProviderRegistry } from "../adapters/registry.js";
import type { AgentStore } from "../lib/agents.js";
import { hashToken } from "../lib/agents.js";
import type { BudgetStore } from "../lib/budget.js";
import {
  centsToMicroCents,
  currentMonth,
  spendKey,
  MICROCENTS_PER_CENT,
} from "../lib/budget.js";
import type { SpendLog } from "../lib/spend-log.js";
import type { Vault } from "../lib/vault.js";
import type { FreezeStore } from "../lib/freeze.js";
import type { TokenUsageStore } from "../lib/token-usage.js";
import { tokenKey } from "../lib/token-usage.js";
import type { CurrentPromptStore } from "../lib/current-prompt.js";

/**
 * Everything the hot path talks to is injected. That's what lets the route stay
 * provider-agnostic (it only holds a registry of adapters) and lets tests run
 * without Redis/Postgres/a live upstream.
 */
export interface ProxyDeps {
  registry: ProviderRegistry;
  agents: AgentStore;
  budget: BudgetStore;
  spendLog: SpendLog;
  vault: Vault;
  freeze: FreezeStore;
  tokenUsage: TokenUsageStore;
  currentPrompt: CurrentPromptStore;
  fetchImpl: typeof fetch;
  now: () => Date;
}

/** Statuses that deny new operations outright. */
const FROZEN_STATUSES: ReadonlySet<AgentStatus> = new Set<AgentStatus>([
  "soft_frozen",
  "hard_frozen",
  "archived",
]);

interface ProxyParams {
  providerSlug: string;
  "*": string;
}

function extractBearer(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return null;
  const token = match[1];
  return token === undefined ? null : token.trim() || null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function registerProxyRoute(app: FastifyInstance, deps: ProxyDeps): void {
  app.post<{ Params: ProxyParams }>(
    "/:providerSlug/*",
    async (req: FastifyRequest<{ Params: ProxyParams }>, reply: FastifyReply) => {
      const { providerSlug } = req.params;
      const path = req.params["*"];

      // 1. Resolve the adapter. This is the ONLY provider dispatch in the hot
      //    path — everything below calls interface methods, never a named provider.
      const adapter = deps.registry.get(providerSlug);
      if (adapter === undefined) {
        reply.code(404);
        return { error: "unknown_provider", providerSlug };
      }

      // 2. Authenticate: Bearer token → SHA-256 → agent row in Postgres.
      const token = extractBearer(req.headers.authorization);
      if (token === null) {
        reply.code(401);
        return { error: "missing_token" };
      }
      const agent = await deps.agents.findByTokenHash(hashToken(token));
      if (agent === null) {
        reply.code(401);
        return { error: "invalid_token" };
      }

      // 3. Freeze gate: Postgres status (system of record) plus a Redis
      //    fast-path flag the api's freeze/unfreeze endpoints set in lockstep.
      const frozenInRedis = await deps.freeze.isFrozen(agent.id);
      if (FROZEN_STATUSES.has(agent.status) || frozenInRedis) {
        reply.code(403);
        return { error: "agent_frozen" };
      }

      // 4. Budget gate: current month spend vs. policy ceiling. A null ceiling
      //    means unlimited — no counter comparison.
      const month = currentMonth(deps.now());
      const key = spendKey(agent.id, month);
      if (agent.maxBudgetCents !== null) {
        const spentMicroCents = await deps.budget.getSpendMicroCents(key);
        const budgetMicroCents = agent.maxBudgetCents * MICROCENTS_PER_CENT;
        if (spentMicroCents >= budgetMicroCents) {
          reply.code(403);
          return { error: "budget_exceeded" };
        }
      }

      // 5. Forward upstream with the vaulted key. The incoming Tollgate token is
      //    dropped; the adapter supplies the real upstream auth.
      const upstreamKey = deps.vault.getUpstreamKey(adapter.slug);
      if (upstreamKey === null) {
        reply.code(502);
        return { error: "upstream_key_unavailable" };
      }

      const url = adapter.buildUpstreamUrl(path);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...adapter.buildAuthHeaders(upstreamKey),
      };
      const body = req.body === undefined ? undefined : JSON.stringify(req.body);

      // Transient "what's happening now" state for the dashboard sidebar —
      // short TTL, Redis-only, never a Postgres row (see current-prompt.ts).
      // Written before the network call so it's visible for the duration of
      // a slow request, not just after it settles.
      if (body !== undefined) {
        await deps.currentPrompt.setCurrentPrompt(agent.id, body);
      }

      const startedAt = Date.now();
      const upstream = await deps.fetchImpl(url, {
        method: "POST",
        headers,
        body,
      });
      const latencyMs = Date.now() - startedAt;
      const upstreamText = await upstream.text();

      // 6. Meter: parse cost via the adapter, then atomically bump the counter.
      const { costCents, estimatedCostCents, promptTokens, completionTokens } =
        adapter.parseCost(parseJson(upstreamText));
      await deps.budget.addSpendMicroCents(key, centsToMicroCents(costCents));

      // Token counter is independent of cost — only bumped when the adapter
      // actually reported usage (see ProviderCost's doc comment).
      if (promptTokens !== undefined && completionTokens !== undefined) {
        await deps.tokenUsage.addTokens(
          tokenKey(agent.id, month),
          promptTokens + completionTokens,
        );
      }

      // 7. Settle: write the audit event without blocking the response.
      void deps.spendLog
        .record({
          agentId: agent.id,
          providerId: adapter.slug,
          endpoint: `/${path}`,
          method: "POST",
          estimatedCostCents: estimatedCostCents ?? null,
          actualCostCents: costCents,
          decision: "allowed",
          latencyMs,
          upstreamStatus: upstream.status,
        })
        .catch((err: unknown) => {
          req.log.error({ err }, "spend_events write failed");
        });

      // 8. Return the upstream response unchanged.
      reply.code(upstream.status);
      const contentType = upstream.headers.get("content-type");
      reply.header("content-type", contentType ?? "application/json");
      return reply.send(upstreamText);
    },
  );
}
