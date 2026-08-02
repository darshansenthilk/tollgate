import {
  GEMINI_PRICES,
  findModelPrice,
  type ProviderAdapter,
  type ProviderCost,
} from "@tollgate/shared";
import { looksLikeSse, parseSseDataFrames, readPath } from "../lib/sse.js";

interface Usage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Unlike OpenAI/Claude, Gemini's request body carries no "model" field at
 * all — the model is embedded in the URL path itself
 * (`/v1beta/models/gemini-1.5-flash:generateContent`), not the body. The
 * *response* does carry it back as `modelVersion`, which is what both
 * readers below key pricing off — there's no other source for it once
 * we're only looking at the response body (parseCost's only input).
 */
function readUsage(body: unknown): Usage | null {
  if (typeof body !== "object" || body === null) return null;

  const model = (body as Record<string, unknown>)["modelVersion"];
  const usage = (body as Record<string, unknown>)["usageMetadata"];
  if (typeof model !== "string") return null;
  if (typeof usage !== "object" || usage === null) return null;

  const promptTokens = (usage as Record<string, unknown>)["promptTokenCount"];
  const completionTokens = (usage as Record<string, unknown>)["candidatesTokenCount"];
  if (typeof promptTokens !== "number" || typeof completionTokens !== "number") {
    return null;
  }

  return { model, promptTokens, completionTokens };
}

/**
 * Pull usage out of a streamed (`alt=sse`) transcript.
 *
 * Like Gemini's non-streaming response, `usageMetadata` on each chunk is
 * already a running total (not a per-chunk delta) — Google's own docs
 * describe it this way, same shape as Anthropic's message_delta.output_tokens
 * (see claude.ts's doc comment on that). So the last chunk that reports it
 * is the correct total; overwrite, don't sum.
 */
function readStreamedUsage(raw: string): Usage | null {
  const frames = parseSseDataFrames(raw);
  if (frames.length === 0) return null;

  let model: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  for (const frame of frames) {
    const frameModel = readPath(frame, "modelVersion");
    if (typeof frameModel === "string") model = frameModel;

    const prompt = readPath(frame, "usageMetadata", "promptTokenCount");
    const completion = readPath(frame, "usageMetadata", "candidatesTokenCount");
    if (typeof prompt === "number" && typeof completion === "number") {
      promptTokens = prompt;
      completionTokens = completion;
    }
  }

  if (model === null || promptTokens === null || completionTokens === null) return null;
  return { model, promptTokens, completionTokens };
}

const MTOK = 1_000_000;

export const geminiAdapter: ProviderAdapter = {
  slug: "gemini",
  baseUrl: "https://generativelanguage.googleapis.com",

  // Mirrors Gemini's real path 1:1 under the provider slug — the proxied
  // path already includes "v1beta" (e.g.
  // POST /gemini/v1beta/models/gemini-1.5-flash:generateContent), so this
  // must NOT also prepend it.
  //
  // Auth goes in a header, not the `?key=` query param Google's own
  // quickstart docs lead with — a key in the URL ends up in access logs and
  // proxy/CDN history wherever this request transits; the header doesn't.
  buildUpstreamRequest: ({ path, query, credential }) => {
    const clean = path.replace(/^\/+/, "");
    return {
      url: `${geminiAdapter.baseUrl}/${clean}${query}`,
      headers: { "x-goog-api-key": credential.secrets["apiKey"] ?? "" },
    };
  },

  // No prepareRequestBody: Gemini reports usageMetadata unconditionally on
  // both streamed and non-streamed responses, same as Anthropic — nothing
  // to opt into (contrast OpenAI, which needs stream_options.include_usage).

  parseCost: (rawBody): ProviderCost => {
    const usage = looksLikeSse(rawBody)
      ? readStreamedUsage(rawBody)
      : readUsage(parseJson(rawBody));
    if (usage === null) return { costCents: 0 };

    // Reported independently of whether the model is priceable, same as the
    // other adapters — a model we can't price still yields real token counts.
    const tokenCounts = {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      model: usage.model,
    };

    // Deliberate lookup: an unknown model shouldn't crash metering, it costs 0
    // and is left for reconciliation rather than guessed at. Gemini's
    // modelVersion is often more specific than the pricing table's keys
    // (e.g. a dated/pinned version) — see GEMINI_PRICES's own doc comment.
    const price = findModelPrice(usage.model, GEMINI_PRICES);
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
