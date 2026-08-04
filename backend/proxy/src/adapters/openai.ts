import { OPENAI_PRICES, type ProviderAdapter, type ProviderCost } from "@tollgate/shared";
import {
  extractOpenAiFormatToolCalls,
  injectOpenAiSystemPrompt,
  injectOpenAiToolDefinitions,
  parseOpenAiFormatCost,
  prepareStreamUsage,
} from "./openai-usage.js";

export const openaiAdapter: ProviderAdapter = {
  slug: "openai",
  baseUrl: "https://api.openai.com",

  // Mirrors OpenAI's real path 1:1 under the provider slug — the proxied path
  // already includes "v1" (e.g. POST /openai/v1/chat/completions), so this
  // must NOT also prepend it, or the upstream URL doubles up ".../v1/v1/...".
  buildUpstreamRequest: ({ path, query, credential }) => {
    const clean = path.replace(/^\/+/, "");
    return {
      url: `${openaiAdapter.baseUrl}/${clean}${query}`,
      headers: { authorization: `Bearer ${credential.secrets["apiKey"] ?? ""}` },
    };
  },

  // See prepareStreamUsage: without this a streamed request reports no usage
  // at all and would spend real money against a budget that never moves.
  prepareRequestBody: prepareStreamUsage,

  parseCost: (rawBody): ProviderCost => parseOpenAiFormatCost(rawBody, OPENAI_PRICES),

  extractToolCalls: extractOpenAiFormatToolCalls,
  injectSystemPrompt: injectOpenAiSystemPrompt,
  injectToolDefinitions: injectOpenAiToolDefinitions,
};
