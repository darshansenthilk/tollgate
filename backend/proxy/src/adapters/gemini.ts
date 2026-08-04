import {
  GEMINI_PRICES,
  findModelPrice,
  type ProviderAdapter,
  type ProviderCost,
  type ToolCallRef,
  type ToolDefinition,
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

/** Function-call names out of one candidate's `content.parts` array —
 *  Gemini represents a tool call as `{functionCall: {name, args}}` alongside
 *  any text parts. Gemini doesn't fragment a function call's name across
 *  streamed chunks the way OpenAI fragments tool_calls' arguments — each
 *  chunk's parts are complete — so the same reader works for both the
 *  non-streamed body and every streamed chunk. */
function functionCallNames(parts: unknown): string[] {
  if (!Array.isArray(parts)) return [];
  const names: string[] = [];
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    const functionCall = (part as Record<string, unknown>)["functionCall"];
    if (typeof functionCall !== "object" || functionCall === null) continue;
    const name = (functionCall as Record<string, unknown>)["name"];
    if (typeof name === "string") names.push(name);
  }
  return names;
}

function toolCallsFromCandidates(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const candidates = (body as Record<string, unknown>)["candidates"];
  if (!Array.isArray(candidates)) return [];

  const names: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const content = (candidate as Record<string, unknown>)["content"];
    if (typeof content !== "object" || content === null) continue;
    names.push(...functionCallNames((content as Record<string, unknown>)["parts"]));
  }
  return names;
}

/** Extract every tool name a generateContent response asked the caller to
 *  invoke, streamed (each SSE frame is its own complete chunk, not a delta
 *  fragment) or not. */
function extractGeminiToolCalls(rawBody: string): ToolCallRef[] {
  const names = looksLikeSse(rawBody)
    ? parseSseDataFrames(rawBody).flatMap(toolCallsFromCandidates)
    : toolCallsFromCandidates(parseJson(rawBody));
  return names.map((name) => ({ name }));
}

/**
 * Prepend to the top-level `systemInstruction.parts` array — Gemini has no
 * per-message system role, unlike OpenAI, and no top-level string field,
 * unlike Claude; it's always `{parts: [{text}, ...]}`. Preserves any parts
 * the caller already sent rather than overwriting them.
 */
export function injectGeminiSystemPrompt(requestBody: unknown, systemPrompt: string): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  const existing = rec["systemInstruction"];
  const existingParts =
    typeof existing === "object" && existing !== null
      ? (existing as Record<string, unknown>)["parts"]
      : undefined;

  return {
    ...rec,
    systemInstruction: {
      parts: [{ text: systemPrompt }, ...(Array.isArray(existingParts) ? existingParts : [])],
    },
  };
}

/**
 * Append the agent's tools as a new entry in Gemini's `tools` array — Gemini
 * nests function declarations one level deeper than OpenAI/Claude:
 * `tools: [{functionDeclarations: [{name, description, parameters}]}]`, and
 * the array can carry entries for non-function tools too (Google Search,
 * code execution). Adding a NEW entry rather than merging into an existing
 * functionDeclarations array, matching the "append, don't merge into
 * caller's own structures" approach the other adapters use — simpler, and
 * avoids guessing whether Gemini would reject a combined declarations list
 * differently than several small ones.
 */
export function injectGeminiToolDefinitions(
  requestBody: unknown,
  tools: ToolDefinition[],
): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  const existing = Array.isArray(rec["tools"]) ? rec["tools"] : [];
  const functionDeclarations = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  return { ...rec, tools: [...existing, { functionDeclarations }] };
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

  extractToolCalls: extractGeminiToolCalls,
  injectSystemPrompt: injectGeminiSystemPrompt,
  injectToolDefinitions: injectGeminiToolDefinitions,
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
