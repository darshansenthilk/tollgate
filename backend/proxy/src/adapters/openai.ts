import { OPENAI_PRICES, type ProviderAdapter, type ProviderCost } from "@tollgate/shared";
import { looksLikeSse, parseSseDataFrames, readPath } from "../lib/sse.js";

/** Narrow an unknown chat-completions body to the fields we meter. */
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

/**
 * Pull usage out of a streamed (SSE) chat-completions transcript.
 *
 * With stream_options.include_usage (which prepareRequestBody forces on — see
 * below) OpenAI emits one extra chunk just before `data: [DONE]` whose `usage`
 * is the total for the whole request and whose `choices` is an empty array.
 * Every other chunk carries `usage: null`, so scanning for the last non-null
 * one is exactly right.
 *
 * `model` is read from any chunk, since it's repeated on all of them and the
 * final usage chunk isn't guaranteed to be the one we want it from.
 */
function readStreamedUsage(
  raw: string,
): { model: string; promptTokens: number; completionTokens: number } | null {
  const frames = parseSseDataFrames(raw);
  if (frames.length === 0) return null;

  let model: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  for (const frame of frames) {
    const frameModel = readPath(frame, "model");
    if (typeof frameModel === "string") model = frameModel;

    const prompt = readPath(frame, "usage", "prompt_tokens");
    const completion = readPath(frame, "usage", "completion_tokens");
    if (typeof prompt === "number" && typeof completion === "number") {
      promptTokens = prompt;
      completionTokens = completion;
    }
  }

  if (model === null || promptTokens === null || completionTokens === null) return null;
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

  /**
   * Force usage reporting on streamed requests.
   *
   * OpenAI omits usage from streams unless stream_options.include_usage is set,
   * and without usage there is NOTHING to meter — a streaming agent would spend
   * real money while Tollgate recorded zero and never enforced its budget. So
   * this is not optional politeness; it's what makes the budget gate mean
   * anything for streaming callers.
   *
   * The visible effect on the client is one additional final chunk whose
   * `choices` is empty — documented OpenAI behaviour that the official SDKs
   * already handle. Non-streaming bodies are passed through untouched.
   */
  prepareRequestBody: (requestBody) => {
    if (typeof requestBody !== "object" || requestBody === null) return requestBody;
    const rec = requestBody as Record<string, unknown>;
    if (rec["stream"] !== true) return requestBody;

    const existing = rec["stream_options"];
    const streamOptions =
      typeof existing === "object" && existing !== null
        ? (existing as Record<string, unknown>)
        : {};

    return { ...rec, stream_options: { ...streamOptions, include_usage: true } };
  },

  parseCost: (rawBody): ProviderCost => {
    // Streamed responses are an SSE transcript, not JSON — read them
    // accordingly rather than letting JSON.parse fail into a $0 cost.
    const usage = looksLikeSse(rawBody)
      ? readStreamedUsage(rawBody)
      : readUsage(parseJson(rawBody));
    if (usage === null) return { costCents: 0 };

    // Token counts are reported independently of whether we know how to
    // price the model — always surface them once genuinely parsed.
    const tokenCounts = {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      model: usage.model,
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
