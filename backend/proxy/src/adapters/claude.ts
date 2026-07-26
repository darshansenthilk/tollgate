import { CLAUDE_PRICES, type ProviderAdapter, type ProviderCost } from "@tollgate/shared";

/** Narrow the unknown Messages API body to the fields we meter. */
function readUsage(
  body: unknown,
): { model: string; inputTokens: number; outputTokens: number } | null {
  if (typeof body !== "object" || body === null) return null;

  const model = (body as Record<string, unknown>)["model"];
  const usage = (body as Record<string, unknown>)["usage"];
  if (typeof model !== "string") return null;
  if (typeof usage !== "object" || usage === null) return null;

  const inputTokens = (usage as Record<string, unknown>)["input_tokens"];
  const outputTokens = (usage as Record<string, unknown>)["output_tokens"];
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number") {
    return null;
  }

  return { model, inputTokens, outputTokens };
}

const MTOK = 1_000_000;

/** Anthropic API version pinned for the Messages endpoint. */
const ANTHROPIC_VERSION = "2023-06-01";

export const claudeAdapter: ProviderAdapter = {
  slug: "claude",
  baseUrl: "https://api.anthropic.com",

  // Anthropic auths via x-api-key (not Authorization: Bearer) and requires an
  // explicit API version header on every request.
  buildAuthHeaders: (upstreamKey) => ({
    "x-api-key": upstreamKey,
    "anthropic-version": ANTHROPIC_VERSION,
  }),

  // Mirrors Anthropic's real path 1:1 under the provider slug — the proxied
  // path already includes "v1" (e.g. POST /claude/v1/messages), so this must
  // NOT also prepend it, or the upstream URL doubles up ".../v1/v1/...".
  buildUpstreamUrl: (path) => {
    const clean = path.replace(/^\/+/, "");
    return `${claudeAdapter.baseUrl}/${clean}`;
  },

  parseCost: (responseBody): ProviderCost => {
    const usage = readUsage(responseBody);
    if (usage === null) return { costCents: 0 };

    // Deliberate lookup: an unknown model shouldn't crash metering, it costs 0
    // and is left for reconciliation rather than guessed at.
    const price = CLAUDE_PRICES[usage.model];
    if (price === undefined) return { costCents: 0 };

    const costCents =
      (usage.inputTokens * price.inputCentsPerMTok) / MTOK +
      (usage.outputTokens * price.outputCentsPerMTok) / MTOK;

    return { costCents };
  },
};
