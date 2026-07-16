import type { ProviderAdapter, ProviderCost } from "@tollgate/shared";

/**
 * Hardcoded price table, in cents per 1,000,000 tokens (USD).
 * The only place in the codebase that knows Anthropic's economics.
 */
interface ModelPrice {
  /** Cents per 1M input tokens. */
  inputCentsPerMTok: number;
  /** Cents per 1M output tokens. */
  outputCentsPerMTok: number;
}

const PRICES: Record<string, ModelPrice> = {
  "claude-3-5-sonnet-20241022": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-3-5-haiku-20241022": { inputCentsPerMTok: 80, outputCentsPerMTok: 400 },
  "claude-3-opus-20240229": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
};

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
    const price = PRICES[usage.model];
    if (price === undefined) return { costCents: 0 };

    const costCents =
      (usage.inputTokens * price.inputCentsPerMTok) / MTOK +
      (usage.outputTokens * price.outputCentsPerMTok) / MTOK;

    return { costCents };
  },
};
