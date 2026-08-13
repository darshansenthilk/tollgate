import { CLAUDE_PRICES, findModelPrice } from "@tollgate/shared";
import type { AnthropicManagedAgentLink, PlatformConnector, UsageBucket } from "./types.js";

/**
 * Anthropic Managed Agents connector — the pull-based half of external agent
 * governance for agents Tollgate can't put itself in the LLM traffic path of
 * (see backend/proxy/src/routes/mcp.ts's doc comment for the other half).
 *
 * Both real outbound calls this connector makes go through proxy's
 * /internal/connectors/* routes rather than calling Anthropic directly —
 * api can only ENCRYPT upstream credentials, proxy can only DECRYPT them, and
 * this connector needs to authenticate with a decrypted "anthropic-admin" key
 * it doesn't have permission to unwrap itself. See
 * backend/proxy/src/routes/internal-connectors.ts's doc comment for the full
 * reasoning.
 *
 * Built as a factory (createAnthropicManagedAgentsConnector), not a bare
 * object, so tests can inject a fake fetch — same DI shape CLAUDE.md asks for
 * in the proxy's hot path, applied here for the same reason: real network
 * calls have no place in a unit test. registry.ts's default export just
 * calls this with no arguments (the real global fetch).
 */

const MAX_1M_BUCKETS_PER_CALL = 1440; // Anthropic's own hard max for bucket_width=1m
const MAX_PAGES = 5; // safety cap against a misbehaving/looping paginated response

function internalConnectorSecret(): string {
  const secret = process.env.INTERNAL_CONNECTOR_SECRET;
  if (secret === undefined || secret === "") {
    throw new Error(
      "INTERNAL_CONNECTOR_SECRET is not configured on the api service — external agent governance can't reach proxy's internal connector routes",
    );
  }
  return secret;
}

function proxyInternalUrl(): string {
  return process.env.PROXY_INTERNAL_URL ?? "http://localhost:8080";
}

/** Anthropic's own error envelope is `{ error: { message } }` — mirrors
 *  upstream-key-verify.ts's identical extraction, kept local rather than
 *  shared since it's five lines operating on an already-parsed body here vs.
 *  a raw string there. */
function extractAnthropicErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = (body as Record<string, unknown>)["error"];
  if (typeof error !== "object" || error === null) return null;
  const message = (error as Record<string, unknown>)["message"];
  return typeof message === "string" ? message : null;
}

interface UsageReportResult {
  model?: string | null;
  uncached_input_tokens?: number;
  output_tokens?: number;
}

interface UsageReportBucket {
  starting_at: string;
  ending_at: string;
  results?: UsageReportResult[];
}

interface UsageReportResponse {
  data?: UsageReportBucket[];
  has_more?: boolean;
  next_page?: string | null;
}

export function createAnthropicManagedAgentsConnector(
  fetchImpl: typeof fetch = fetch,
): PlatformConnector {
  async function callInternalConnector(
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const res = await fetchImpl(`${proxyInternalUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": internalConnectorSecret() },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await res.json().catch(() => null);
    return { status: res.status, body: parsed };
  }

  async function pollUsage(args: {
    link: AnthropicManagedAgentLink;
    since: Date;
    now: Date;
  }): Promise<UsageBucket[]> {
    const { link, since, now } = args;
    if (link.upstreamKeyId === null) {
      throw new Error(
        `anthropic_managed_agent_links row for agent ${link.agentId} has no upstreamKeyId configured — pick a stored "anthropic-admin" key for it first`,
      );
    }

    const minutes = Math.ceil((now.getTime() - since.getTime()) / 60_000);
    // Anthropic's own default limit for bucket_width=1m is 60 buckets, which
    // would silently truncate any poll window over an hour — explicit limit
    // covers the full window in one call up to Anthropic's real hard max.
    // Beyond that (the operator's poller hasn't run in over 24h), only the
    // most recent 24h backfills; a wider gap is an operational problem to fix
    // by running the poller more often, not something worth paginating years
    // of history for.
    const limit = Math.min(Math.max(minutes, 1), MAX_1M_BUCKETS_PER_CALL);

    const buckets: UsageBucket[] = [];
    let page: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const { status, body } = await callInternalConnector("/internal/connectors/anthropic-usage", {
        orgId: link.orgId,
        upstreamKeyId: link.upstreamKeyId,
        startingAt: since.toISOString(),
        endingAt: now.toISOString(),
        apiKeyIds: [link.anthropicApiKeyId],
        bucketWidth: "1m",
        limit,
        ...(page !== undefined ? { page } : {}),
      });
      if (status !== 200) {
        throw new Error(`anthropic usage poll failed (${status}): ${JSON.stringify(body)}`);
      }

      const report = body as UsageReportResponse;
      for (const bucket of report.data ?? []) {
        for (const result of bucket.results ?? []) {
          // group_by=model/api_key_id (set by the internal-connectors route)
          // is what makes `model` non-null here — still guarded rather than
          // trusted blindly, since it's a real network response.
          if (result.model === null || result.model === undefined) continue;
          const promptTokens = result.uncached_input_tokens ?? 0;
          const completionTokens = result.output_tokens ?? 0;
          if (promptTokens === 0 && completionTokens === 0) continue;

          // Deliberately NOT folding cache_creation/cache_read_input_tokens
          // into either the token count or the price here — the proxy's own
          // claude.ts adapter (which meters real proxied traffic) only ever
          // reads input_tokens/output_tokens too, and CLAUDE_PRICES has no
          // separate cache-tier rates. Matching that existing simplification
          // rather than inventing a more precise, inconsistent model here.
          const price = findModelPrice(result.model, CLAUDE_PRICES);
          const costCents =
            price === undefined
              ? null
              : (promptTokens * price.inputCentsPerMTok + completionTokens * price.outputCentsPerMTok) /
                1_000_000;

          buckets.push({
            startingAt: new Date(bucket.starting_at),
            endingAt: new Date(bucket.ending_at),
            model: result.model,
            promptTokens,
            completionTokens,
            costCents,
          });
        }
      }

      if (report.has_more !== true || report.next_page === null || report.next_page === undefined) break;
      page = report.next_page;
    }

    return buckets;
  }

  async function setBudget(args: {
    link: AnthropicManagedAgentLink;
    maxCostCents: number;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { link, maxCostCents } = args;
    if (link.upstreamKeyId === null) {
      return { ok: false, reason: "No stored Anthropic Admin key is configured for this agent yet." };
    }
    if (link.currentSessionId === null) {
      return { ok: false, reason: "No Managed Agents session id is configured for this agent yet." };
    }

    const { status, body } = await callInternalConnector("/internal/connectors/anthropic-session-budget", {
      orgId: link.orgId,
      upstreamKeyId: link.upstreamKeyId,
      sessionId: link.currentSessionId,
      maxCostCents,
    });

    if (status === 200) return { ok: true };

    // Real, expected outcomes here, not bugs: "the new cap isn't above
    // consumed spend yet" (the session needs to spend down first, or the cap
    // needs to be higher), "this session was created without a budget"
    // (Anthropic only accepts an update, never an initial create), a
    // revoked/expired admin key, etc. Anthropic's own message is passed
    // straight through so the operator sees the real reason.
    const message = extractAnthropicErrorMessage(body) ?? `Anthropic returned an unexpected ${status}`;
    return { ok: false, reason: message };
  }

  async function verifyCredential(args: {
    orgId: string;
    upstreamKeyId: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    // A tiny, real usage-report call with no api_key_ids filter (cheapest
    // possible read against the Admin API, org-wide) — proves the stored
    // credential still authenticates without needing to already know a real
    // Anthropic API key id to filter by.
    const now = new Date();
    const since = new Date(now.getTime() - 5 * 60 * 1000);
    const { status, body } = await callInternalConnector("/internal/connectors/anthropic-usage", {
      orgId: args.orgId,
      upstreamKeyId: args.upstreamKeyId,
      startingAt: since.toISOString(),
      endingAt: now.toISOString(),
      apiKeyIds: [],
      bucketWidth: "1m",
      limit: 1,
    });
    if (status === 200) return { ok: true };
    const message = extractAnthropicErrorMessage(body) ?? `Anthropic returned an unexpected ${status}`;
    return { ok: false, reason: message };
  }

  return {
    slug: "anthropic_managed_agents",
    label: "Anthropic Managed Agents",
    pollUsage,
    setBudget,
    verifyCredential,
  };
}

export const anthropicManagedAgentsConnector: PlatformConnector = createAnthropicManagedAgentsConnector();
