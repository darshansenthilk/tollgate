import {
  CLAUDE_PRICES,
  findModelPrice,
  type ProviderAdapter,
  type ProviderCost,
  type ToolCallRef,
  type ToolDefinition,
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

/** Tool names from one message-shaped object's `content` blocks — Anthropic
 *  represents a tool call as a `{type: "tool_use", name, input}` block
 *  alongside any text blocks, not a separate field. Shared by the
 *  non-streamed reader and (per block) the streamed one below, since a
 *  streamed `content_block_start` event's `content_block` is the same shape
 *  as one entry in a full response's `content` array. */
function toolUseNames(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  const names: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const rec = block as Record<string, unknown>;
    if (rec["type"] === "tool_use" && typeof rec["name"] === "string") {
      names.push(rec["name"]);
    }
  }
  return names;
}

/**
 * Every tool name across a streamed transcript.
 *
 * Unlike OpenAI's fragmented tool_calls deltas, Anthropic sends a tool call's
 * name whole, once, on the `content_block_start` event that introduces it —
 * later `content_block_delta` events only carry `input`'s partial JSON — so
 * scanning for that one event type per block is sufficient.
 */
function toolCallsFromStream(raw: string): string[] {
  const names: string[] = [];
  for (const frame of parseSseDataFrames(raw)) {
    if (readPath(frame, "type") !== "content_block_start") continue;
    const block = readPath(frame, "content_block");
    if (typeof block !== "object" || block === null) continue;
    names.push(...toolUseNames([block]));
  }
  return names;
}

function toolCallsFromMessage(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  return toolUseNames((body as Record<string, unknown>)["content"]);
}

/** Extract every tool name a Messages API response asked the caller to
 *  invoke, streamed or not. */
function extractClaudeToolCalls(rawBody: string): ToolCallRef[] {
  const names = looksLikeSse(rawBody)
    ? toolCallsFromStream(rawBody)
    : toolCallsFromMessage(parseJson(rawBody));
  return names.map((name) => ({ name }));
}

/**
 * Prepend to the Messages API's top-level `system` field — NOT a `messages`
 * entry, unlike OpenAI. Anthropic's `system` is either a plain string or an
 * array of text blocks (the latter used when the caller wants cache_control
 * on part of it); this preserves whichever shape the caller already sent
 * rather than collapsing it, and only defaults to a plain string when there
 * was nothing there yet.
 */
export function injectClaudeSystemPrompt(requestBody: unknown, systemPrompt: string): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  const existing = rec["system"];

  if (existing === undefined || existing === null) {
    return { ...rec, system: systemPrompt };
  }
  if (typeof existing === "string") {
    return { ...rec, system: `${systemPrompt}\n\n${existing}` };
  }
  if (Array.isArray(existing)) {
    return { ...rec, system: [{ type: "text", text: systemPrompt }, ...existing] };
  }
  // Unrecognized shape — leave it alone rather than guess and risk dropping
  // whatever the caller's own application put there.
  return rec;
}

/**
 * Append to the Messages API's `tools` array — Anthropic calls the
 * parameters schema `input_schema`, not `parameters` (contrast OpenAI/
 * Gemini, which both use `parameters`). Appended, not prepended, for the
 * same reason as OpenAI's injectOpenAiToolDefinitions: tool order carries no
 * priority the way message order does.
 */
export function injectClaudeToolDefinitions(
  requestBody: unknown,
  tools: ToolDefinition[],
): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  const existing = Array.isArray(rec["tools"]) ? rec["tools"] : [];
  const added = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
  return { ...rec, tools: [...existing, ...added] };
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

  extractToolCalls: extractClaudeToolCalls,
  injectSystemPrompt: injectClaudeSystemPrompt,
  injectToolDefinitions: injectClaudeToolDefinitions,
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
