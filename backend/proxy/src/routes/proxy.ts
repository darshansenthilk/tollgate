import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AgentStatus } from "@tollgate/shared";
import type { ProviderRegistry } from "../adapters/registry.js";
import type { AgentStore } from "../lib/agents.js";
import { hashToken, extractBearer } from "../lib/agents.js";
import type { BudgetStore } from "../lib/budget.js";
import {
  centsToMicroCents,
  currentMonth,
  spendKey,
  MICROCENTS_PER_CENT,
} from "../lib/budget.js";
import type { SpendLog } from "../lib/spend-log.js";
import { truncatePrompt } from "../lib/spend-log.js";
import type { Vault } from "../lib/vault.js";
import type { FreezeStore } from "../lib/freeze.js";
import type { TokenUsageStore } from "../lib/token-usage.js";
import { tokenKey } from "../lib/token-usage.js";
import type { CurrentPromptStore } from "../lib/current-prompt.js";
import type { ApprovalStore } from "../lib/tool-approvals.js";

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
  approvals: ApprovalStore;
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

/**
 * The raw query string from the incoming request ("?alt=sse"), or "" if there
 * wasn't one.
 *
 * Needed because req.params["*"] is the PATH portion of the wildcard only —
 * Fastify strips the query off it. Forwarding without this silently drops
 * every query parameter the caller sent, which is not a cosmetic loss:
 * Gemini's streaming endpoint is selected by ?alt=sse (without it the upstream
 * answers in a different format than the client asked for), and Azure OpenAI
 * rejects any request lacking ?api-version= outright. Taken from req.url
 * rather than reconstructed from a parsed object so parameters reach the
 * provider byte-identical to how the caller wrote them — re-encoding is a
 * chance to subtly corrupt a value we have no reason to interpret.
 */
function queryString(rawUrl: string): string {
  const index = rawUrl.indexOf("?");
  return index === -1 ? "" : rawUrl.slice(index);
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
      // These gates fire before the body is ever assembled, so there is no
      // forwarded prompt to record — not even a rejected one.
      prompt: null,
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
      const credential = await deps.vault.getUpstreamKey(
        agent.orgId,
        adapter.slug,
        agent.upstreamKeyId,
      );
      if (credential === null) {
        reply.code(502);
        return { error: "upstream_key_unavailable" };
      }

      // Inject the agent's configured system prompt before anything else
      // touches the body, so prepareRequestBody's usage-reporting tweak below
      // still applies to the final, agent-augmented request rather than the
      // caller's original one.
      const withSystemPrompt =
        req.body !== undefined && agent.systemPrompt !== null && adapter.injectSystemPrompt
          ? adapter.injectSystemPrompt(req.body, agent.systemPrompt)
          : req.body;

      // Then the agent's configured tools, minus any also on blockedTools —
      // advertising a tool the response gate (step 8 below) will always
      // strip anyway would just hand the model a dead option and confuse it
      // into trying it. This is a request-time filter, not a stored one:
      // Policy.toolDefinitions keeps the full list an operator configured,
      // so unblocking a tool later doesn't require re-entering it.
      const toolsToInject =
        agent.toolDefinitions?.filter((t) => !(agent.blockedTools?.includes(t.name) ?? false)) ??
        [];
      const withTools =
        withSystemPrompt !== undefined && toolsToInject.length > 0 && adapter.injectToolDefinitions
          ? adapter.injectToolDefinitions(withSystemPrompt, toolsToInject)
          : withSystemPrompt;

      // Let the adapter opt the request into usage reporting before it goes
      // out (OpenAI streams omit usage unless asked) — without this, a streamed
      // request returns nothing meterable and would spend against no budget.
      //
      // Serialized BEFORE the request is built, not after, because a signing
      // provider (AWS SigV4) hashes the exact payload as part of its auth
      // header — the body has to be final before auth can be computed.
      const outgoingBody =
        withTools === undefined
          ? undefined
          : (adapter.prepareRequestBody?.(withTools) ?? withTools);
      const body = outgoingBody === undefined ? undefined : JSON.stringify(outgoingBody);

      let upstreamRequest;
      try {
        upstreamRequest = await adapter.buildUpstreamRequest({
          path,
          // The caller's query is handed to the adapter rather than appended
          // here: a signing provider must sign the exact final URL, so it has
          // to own where the query lands.
          query: queryString(req.url),
          method: "POST",
          body,
          credential,
          // Not forwarded by default — see UpstreamRequestArgs's doc comment.
          // Only an adapter that explicitly reads a specific header out of
          // this actually forwards it.
          clientHeaders: req.headers,
        });
      } catch (err) {
        // A credential that's stored but unusable for this provider (an Azure
        // key saved without its resource name, say). Distinct from
        // upstream_key_unavailable — the key exists, it just can't address a
        // real endpoint — so it gets its own code and the adapter's own
        // message, which names the missing field.
        req.log.error({ err, providerSlug: adapter.slug }, "upstream request build failed");
        reply.code(502);
        return {
          error: "upstream_credential_incomplete",
          message: err instanceof Error ? err.message : "This provider credential is incomplete.",
        };
      }

      const { url } = upstreamRequest;
      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...upstreamRequest.headers,
      };

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

      // 8. Tool gate: unlike the frozen/budget gates, this runs AFTER the
      //    upstream call — a tool call only exists once the LLM has answered,
      //    so there is nothing to check beforehand. The tokens above are
      //    metered regardless (real money was already spent producing this
      //    response); what's denied is the agent ever finding out it's
      //    allowed to act on a blocked tool. adapter.extractToolCalls is
      //    optional, so a provider that hasn't had extraction wired up yet
      //    is skipped rather than treated as a violation.
      if (
        agent.blockedTools !== null &&
        agent.blockedTools.length > 0 &&
        adapter.extractToolCalls !== undefined
      ) {
        const blocked = new Set(agent.blockedTools);
        // EVERY blocked tool in the response needs its own grant, not just the
        // first one found. One response can carry several tool calls, so
        // checking only the first would let an operator's approval of
        // "delete_customer" smuggle an unapproved "send_payment" through
        // alongside it. De-duplicated so one name repeated in a response
        // doesn't demand two separate approvals.
        const blockedCalls = [
          ...new Set(
            adapter
              .extractToolCalls(upstreamText)
              .map((call) => call.name)
              .filter((name) => blocked.has(name)),
          ),
        ];

        // A standing block is not the end of the conversation: an operator can
        // approve a call from the dashboard, which arms a single-use grant the
        // agent's retry then spends. Checked BEFORE denying, so an approved
        // escalation costs the agent one denied attempt, not a policy edit.
        //
        // A grant is spent even when some OTHER tool in the same response goes
        // on to fail this gate. That's the fail-closed direction: the approval
        // was genuinely consumed by an attempt, and re-approving is cheap,
        // whereas peeking without consuming would lose the atomicity that stops
        // two concurrent calls redeeming one approval.
        const ungranted: string[] = [];
        for (const tool of blockedCalls) {
          if (!(await deps.approvals.consumeGrant(agent.id, tool))) ungranted.push(tool);
        }

        for (const tool of ungranted) {
          // Raise the escalation the operator will see. Fire-and-forget like
          // the audit writes — a queue that's briefly missing a row is better
          // than a hot path that blocks on it.
          void deps.approvals
            .requestApproval({ orgId: agent.orgId, agentId: agent.id, toolName: tool })
            .catch((err: unknown) => {
              req.log.error({ err }, "tool_approval_requests write failed");
            });
        }

        const deniedTool = ungranted[0];

        if (deniedTool !== undefined) {
          void deps.spendLog
            .record({
              agentId: agent.id,
              providerId: adapter.slug,
              endpoint: `/${path}`,
              method: "POST",
              estimatedCostCents: estimatedCostCents ?? null,
              // Real cost, unlike recordDenial's frozen/budget denials — the
              // call already happened, only the tool call is being withheld.
              actualCostCents: costCents,
              decision: "denied_tool",
              model: model ?? null,
              promptTokens: promptTokens ?? null,
              completionTokens: completionTokens ?? null,
              latencyMs,
              upstreamStatus: upstream.status,
              // Unlike the pre-forward denials, this request DID go out — so
              // the operator reviewing the block can see what was asked.
              prompt: truncatePrompt(body),
            })
            .catch((err: unknown) => {
              req.log.error({ err }, "spend_events denial write failed");
            });

          reply.code(403);
          return { error: "tool_call_blocked", tool: deniedTool };
        }
      }

      // 9. Settle: write the audit event without blocking the response.
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
          prompt: truncatePrompt(body),
        })
        .catch((err: unknown) => {
          req.log.error({ err }, "spend_events write failed");
        });

      // 10. Return the upstream response unchanged.
      reply.code(upstream.status);
      const contentType = upstream.headers.get("content-type");
      reply.header("content-type", contentType ?? "application/json");
      return reply.send(upstreamText);
    },
  );
}
