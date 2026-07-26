import { OPENAI_PRICES, type ProviderAdapter, type ProviderCost } from "@tollgate/shared";

/** Narrow the unknown chat-completions body to the fields we meter. */
function readUsage(
  body: unknown,
): { model: string; promptTokens: number; completionTokens: number } | null {
  if (typeof body !== "object" || body === null) return null;

  const model = (body as Record<string, unknown>)["model"];
  const usage = (body as Record<string, unknown>)["usage"];
  if (typeof model !== "string") return null;
  if (typeof usage !== "object" || usage === null) return null;

  const promptTokens = (usage as Record<string, unknown>)["prompt_tokens"];
  const completionTokens = (usage as Record<string, unknown>)["completion_tokens"];
  if (typeof promptTokens !== "number" || typeof completionTokens !== "number") {
    return null;
  }

  return { model, promptTokens, completionTokens };
}

const MTOK = 1_000_000;

export const openaiAdapter: ProviderAdapter = {
  slug: "openai",
  baseUrl: "https://api.openai.com",

  buildAuthHeaders: (upstreamKey) => ({
    authorization: `Bearer ${upstreamKey}`,
  }),

  // Mirrors OpenAI's real path 1:1 under the provider slug — the proxied path
  // already includes "v1" (e.g. POST /openai/v1/chat/completions), so this
  // must NOT also prepend it, or the upstream URL doubles up ".../v1/v1/...".
  buildUpstreamUrl: (path) => {
    const clean = path.replace(/^\/+/, "");
    return `${openaiAdapter.baseUrl}/${clean}`;
  },

  parseCost: (responseBody): ProviderCost => {
    const usage = readUsage(responseBody);
    if (usage === null) return { costCents: 0 };

    // Token counts are reported independently of whether we know how to
    // price the model — always surface them once genuinely parsed.
    const tokenCounts = {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    };

    // Deliberate lookup: an unknown model shouldn't crash metering, it costs 0
    // and is left for reconciliation rather than guessed at.
    const price = OPENAI_PRICES[usage.model];
    if (price === undefined) return { costCents: 0, ...tokenCounts };

    const costCents =
      (usage.promptTokens * price.inputCentsPerMTok) / MTOK +
      (usage.completionTokens * price.outputCentsPerMTok) / MTOK;

    return { costCents, ...tokenCounts };
  },
};
