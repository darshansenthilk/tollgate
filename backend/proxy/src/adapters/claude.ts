import {
  CLAUDE_PRICES,
  findModelPrice,
  type ProviderAdapter,
  type ProviderCost,
} from "@tollgate/shared";
import { looksLikeSse, parseSseDataFrames, readPath } from "../lib/sse.js";

interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Narrow an unknown Messages API body to the fields we meter. */
function readUsage(body: unknown): Usage | null {
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

/**
 * Pull usage out of a streamed (SSE) Messages transcript.
 *
 * Anthropic reports usage across two event types, and unlike OpenAI it needs no
 * opt-in:
 *   - `message_start` carries message.model and message.usage.input_tokens
 *     (plus a small initial output_tokens).
 *   - `message_delta` carries usage.output_tokens, which the API docs state is
 *     CUMULATIVE, not per-delta. So the correct total is the LAST one seen —
 *     summing them would massively overcount and over-bill the agent.
 */
function readStreamedUsage(raw: string): Usage | null {
  const frames = parseSseDataFrames(raw);
  if (frames.length === 0) return null;

  let model: string | null = null;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;

  for (const frame of frames) {
    const type = readPath(frame, "type");

    if (type === "message_start") {
      const frameModel = readPath(frame, "message", "model");
      if (typeof frameModel === "string") model = frameModel;

      const input = readPath(frame, "message", "usage", "input_tokens");
      if (typeof input === "number") inputTokens = input;

      // Initial value; a later message_delta supersedes it if one arrives.
      const output = readPath(frame, "message", "usage", "output_tokens");
      if (typeof output === "number") outputTokens = output;
    }

    if (type === "message_delta") {
      const output = readPath(frame, "usage", "output_tokens");
      // Cumulative — overwrite rather than add. See the doc comment above.
      if (typeof output === "number") outputTokens = output;

      // A stream that ran long enough to re-report input (e.g. server tool use)
      // gives a more accurate total than message_start's figure.
      const input = readPath(frame, "usage", "input_tokens");
      if (typeof input === "number") inputTokens = input;
    }
  }

  if (model === null || inputTokens === null || outputTokens === null) return null;
  return { model, inputTokens, outputTokens };
}

const MTOK = 1_000_000;

/** Anthropic API version pinned for the Messages endpoint. */
const ANTHROPIC_VERSION = "2023-06-01";

export const claudeAdapter: ProviderAdapter = {
  slug: "claude",
  baseUrl: "https://api.anthropic.com",

  // Mirrors Anthropic's real path 1:1 under the provider slug — the proxied
  // path already includes "v1" (e.g. POST /claude/v1/messages), so this must
  // NOT also prepend it, or the upstream URL doubles up ".../v1/v1/...".
  // Auth is x-api-key (not Authorization: Bearer), plus an explicit API
  // version header Anthropic requires on every request.
  buildUpstreamRequest: ({ path, query, credential }) => {
    const clean = path.replace(/^\/+/, "");
    return {
      url: `${claudeAdapter.baseUrl}/${clean}${query}`,
      headers: {
        "x-api-key": credential.secrets["apiKey"] ?? "",
        "anthropic-version": ANTHROPIC_VERSION,
      },
    };
  },

  // No prepareRequestBody: Anthropic reports usage on streamed responses
  // unconditionally, so unlike OpenAI there's nothing to opt into.

  parseCost: (rawBody): ProviderCost => {
    const usage = looksLikeSse(rawBody)
      ? readStreamedUsage(rawBody)
      : readUsage(parseJson(rawBody));
    if (usage === null) return { costCents: 0 };

    // Reported independently of whether the model is priceable, same as the
    // OpenAI adapter — a model we can't price still yields real token counts.
    const tokenCounts = {
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      model: usage.model,
    };

    // Deliberate lookup: an unknown model shouldn't crash metering, it costs 0
    // and is left for reconciliation rather than guessed at.
    const price = findModelPrice(usage.model, CLAUDE_PRICES);
    if (price === undefined) return { costCents: 0, ...tokenCounts };

    const costCents =
      (usage.inputTokens * price.inputCentsPerMTok) / MTOK +
      (usage.outputTokens * price.outputCentsPerMTok) / MTOK;

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
