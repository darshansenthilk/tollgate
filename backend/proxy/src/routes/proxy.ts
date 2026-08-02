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
  /**
   * Bridges an agent's descriptive assistant label to the real adapter slug
   * it's allowed to call (see registry.ts's assistantAdapterSlugs doc
   * comment for why these are different vocabularies). Injected — like the
   * registry — so the route handler still hardcodes no provider names.
   */
  assistantAdapterSlugs: ReadonlyMap<string, string>;
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

/**
 * Records a request the gates refused. Denials used to return early without
 * writing anything, so the audit log only ever contained allowed traffic — the
 * dashboard's activity panel would show nothing at exactly the moments an
 * operator most wants a record (an agent hammering a frozen token, or grinding
 * against an exhausted budget). Fire-and-forget, like the allowed-path write.
 */
function recordDenial(
  deps: ProxyDeps,
  log: FastifyRequest["log"],
  args: {
    agentId: string;
    providerId: string;
    endpoint: string;
    decision: "denied_frozen" | "denied_budget";
  },
): void {
  void deps.spendLog
    .record({
      agentId: args.agentId,
      providerId: args.providerId,
      endpoint: args.endpoint,
      method: "POST",
      estimatedCostCents: null,
      // Nothing was forwarded, so nothing was spent — that's the point.
      actualCostCents: 0,
      decision: args.decision,
      model: null,
      promptTokens: null,
      completionTokens: null,
      latencyMs: null,
      upstreamStatus: null,
    })
    .catch((err: unknown) => {
      log.error({ err }, "spend_events denial write failed");
    });
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

      // 3. Assistant gate: the agent's declared assistant must map to the
      //    adapter this request resolved to — otherwise a token created for
      //    one assistant could be used against a different upstream with zero
      //    checks. Fails closed: an unmapped assistant slug matches nothing.
      if (deps.assistantAdapterSlugs.get(agent.providerSlug) !== adapter.slug) {
        reply.code(403);
        return {
          error: "provider_mismatch",
          providerSlug,
          assistantSlug: agent.providerSlug,
        };
      }

      // 4. Freeze gate: Postgres status (system of record) plus a Redis
      //    fast-path flag the api's freeze/unfreeze endpoints set in lockstep.
      const frozenInRedis = await deps.freeze.isFrozen(agent.id);
      if (FROZEN_STATUSES.has(agent.status) || frozenInRedis) {
        recordDenial(deps, req.log, {
          agentId: agent.id,
          providerId: adapter.slug,
          endpoint: `/${path}`,
          decision: "denied_frozen",
        });
        reply.code(403);
        return { error: "agent_frozen" };
      }

      // 5. Budget gate: current month spend vs. policy ceiling. A null ceiling
      //    means unlimited — no counter comparison.
      const month = currentMonth(deps.now());
      const key = spendKey(agent.id, month);
      if (agent.maxBudgetCents !== null) {
        const spentMicroCents = await deps.budget.getSpendMicroCents(key);
        const budgetMicroCents = agent.maxBudgetCents * MICROCENTS_PER_CENT;
        if (spentMicroCents >= budgetMicroCents) {
          recordDenial(deps, req.log, {
            agentId: agent.id,
            providerId: adapter.slug,
            endpoint: `/${path}`,
            decision: "denied_budget",
          });
          reply.code(403);
          return { error: "budget_exceeded" };
        }
      }

      // 6. Forward upstream with the vaulted key. The incoming Tollgate token is
      //    dropped; the adapter supplies the real upstream auth. Scoped to the
      //    agent's org so a BYOK org forwards with THEIR provider key (and is
      //    billed for it) — see lib/vault.ts for the full resolution order,
      //    including why an undecryptable org key denies rather than falls back.
      const upstreamKey = await deps.vault.getUpstreamKey(
        agent.orgId,
        adapter.slug,
        agent.upstreamKeyId,
      );
      if (upstreamKey === null) {
        reply.code(502);
        return { error: "upstream_key_unavailable" };
      }

      const url = adapter.buildUpstreamUrl(path);
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...adapter.buildAuthHeaders(upstreamKey),
      };
      // Let the adapter opt the request into usage reporting before it goes
      // out (OpenAI streams omit usage unless asked) — without this, a streamed
      // request returns nothing meterable and would spend against no budget.
      const outgoingBody =
        req.body === undefined
          ? undefined
          : (adapter.prepareRequestBody?.(req.body) ?? req.body);
      const body = outgoingBody === undefined ? undefined : JSON.stringify(outgoingBody);

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

      // 7. Meter: parse cost via the adapter, then atomically bump the counter.
      //    The adapter gets the raw text (not parsed JSON) so it can read a
      //    streamed SSE transcript as well as a JSON body.
      const { costCents, estimatedCostCents, promptTokens, completionTokens, model } =
        adapter.parseCost(upstreamText);
      await deps.budget.addSpendMicroCents(key, centsToMicroCents(costCents));

      // Token counter is independent of cost — only bumped when the adapter
      // actually reported usage (see ProviderCost's doc comment).
      if (promptTokens !== undefined && completionTokens !== undefined) {
        await deps.tokenUsage.addTokens(
          tokenKey(agent.id, month),
          promptTokens + completionTokens,
        );
      }

      // 8. Settle: write the audit event without blocking the response.
      void deps.spendLog
        .record({
          agentId: agent.id,
          providerId: adapter.slug,
          endpoint: `/${path}`,
          method: "POST",
          estimatedCostCents: estimatedCostCents ?? null,
          actualCostCents: costCents,
          decision: "allowed",
          // What the provider reports it actually served, plus the token split
          // — both surfaced in the dashboard's activity log.
          model: model ?? null,
          promptTokens: promptTokens ?? null,
          completionTokens: completionTokens ?? null,
          latencyMs,
          upstreamStatus: upstream.status,
        })
        .catch((err: unknown) => {
          req.log.error({ err }, "spend_events write failed");
        });

      // 9. Return the upstream response unchanged.
      reply.code(upstream.status);
      const contentType = upstream.headers.get("content-type");
      reply.header("content-type", contentType ?? "application/json");
      return reply.send(upstreamText);
    },
  );
}
