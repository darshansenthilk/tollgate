import {
  findModelPrice,
  type ModelPrice,
  type ProviderCost,
  type ToolCallRef,
  type ToolDefinition,
} from "@tollgate/shared";
import { looksLikeSse, parseSseDataFrames, readPath } from "../lib/sse.js";

/**
 * Metering for the OpenAI chat-completions wire format, shared by the OpenAI
 * adapter and the Azure OpenAI adapter.
 *
 * Shared rather than copied because it is literally the same protocol: Azure
 * hosts OpenAI's models and returns byte-identical response bodies (same
 * `usage.prompt_tokens` / `completion_tokens`, same streamed
 * `stream_options.include_usage` behaviour). Two copies would be two things to
 * remember to update the day that format changes, and the failure mode of
 * forgetting one is silent — an adapter that meters $0 forever while real money
 * is spent. The genuinely provider-specific parts (pricing table, auth, URL
 * shape) stay in each adapter.
 */

interface Usage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

/** Narrow an unknown chat-completions body to the fields we meter. */
function readUsage(body: unknown): Usage | null {
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
 * With stream_options.include_usage (which prepareStreamUsage forces on — see
 * below) OpenAI emits one extra chunk just before `data: [DONE]` whose `usage`
 * is the total for the whole request and whose `choices` is an empty array.
 * Every other chunk carries `usage: null`, so scanning for the last non-null
 * one is exactly right.
 *
 * `model` is read from any chunk, since it's repeated on all of them and the
 * final usage chunk isn't guaranteed to be the one we want it from.
 */
function readStreamedUsage(raw: string): Usage | null {
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * Meter an OpenAI-format response against the caller's own price table.
 *
 * The price table is a parameter, not an import, because that is the one thing
 * OpenAI and Azure genuinely don't share — same tokens, same response shape,
 * separately-set rates (see AZURE_PRICES's doc comment).
 */
export function parseOpenAiFormatCost(
  rawBody: string,
  prices: Record<string, ModelPrice>,
): ProviderCost {
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
  // and is left for reconciliation rather than guessed at. findModelPrice
  // additionally resolves dated releases (gpt-4o-2024-08-06) to their family.
  const price = findModelPrice(usage.model, prices);
  if (price === undefined) return { costCents: 0, ...tokenCounts };

  const costCents =
    (usage.promptTokens * price.inputCentsPerMTok) / MTOK +
    (usage.completionTokens * price.outputCentsPerMTok) / MTOK;

  return { costCents, ...tokenCounts };
}

/**
 * Force usage reporting on streamed requests.
 *
 * OpenAI (and Azure, which serves the same API) omits usage from streams
 * unless stream_options.include_usage is set, and without usage there is
 * NOTHING to meter — a streaming agent would spend real money while Tollgate
 * recorded zero and never enforced its budget. So this is not optional
 * politeness; it's what makes the budget gate mean anything for streaming
 * callers.
 *
 * The visible effect on the client is one additional final chunk whose
 * `choices` is empty — documented behaviour that the official SDKs already
 * handle. Non-streaming bodies are passed through untouched.
 */
/** Pull tool_calls' function names out of one message-shaped object — the
 *  shape is identical for a full response's `message` and a streamed chunk's
 *  `delta`, so both callers below share this. */
function toolCallNames(container: unknown): string[] {
  if (typeof container !== "object" || container === null) return [];
  const toolCalls = (container as Record<string, unknown>)["tool_calls"];
  if (!Array.isArray(toolCalls)) return [];

  const names: string[] = [];
  for (const call of toolCalls) {
    if (typeof call !== "object" || call === null) continue;
    const fn = (call as Record<string, unknown>)["function"];
    if (typeof fn !== "object" || fn === null) continue;
    const name = (fn as Record<string, unknown>)["name"];
    if (typeof name === "string") names.push(name);
  }
  return names;
}

/** Every tool name across a non-streamed response's choices (n > 1 requests
 *  return several, each independently able to call a tool). */
function toolCallsFromChoices(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const choices = (body as Record<string, unknown>)["choices"];
  if (!Array.isArray(choices)) return [];

  const names: string[] = [];
  for (const choice of choices) {
    if (typeof choice !== "object" || choice === null) continue;
    names.push(...toolCallNames((choice as Record<string, unknown>)["message"]));
  }
  return names;
}

/**
 * Every tool name across a streamed transcript's chunks.
 *
 * Unlike usage (one final summary chunk), a tool call's name only appears on
 * the chunk that introduces it — later chunks for the same call carry nothing
 * but argument-string deltas — so every frame has to be scanned, not just the
 * last one.
 */
function toolCallsFromStream(raw: string): string[] {
  const names: string[] = [];
  for (const frame of parseSseDataFrames(raw)) {
    if (typeof frame !== "object" || frame === null) continue;
    const choices = (frame as Record<string, unknown>)["choices"];
    if (!Array.isArray(choices)) continue;
    for (const choice of choices) {
      if (typeof choice !== "object" || choice === null) continue;
      names.push(...toolCallNames((choice as Record<string, unknown>)["delta"]));
    }
  }
  return names;
}

/**
 * Extract every tool/function name an OpenAI-format response asked the
 * caller to invoke, streamed or not. Shared by the OpenAI and Azure OpenAI
 * adapters for the same reason parseOpenAiFormatCost is — byte-identical wire
 * format.
 */
export function extractOpenAiFormatToolCalls(rawBody: string): ToolCallRef[] {
  const names = looksLikeSse(rawBody)
    ? toolCallsFromStream(rawBody)
    : toolCallsFromChoices(parseJson(rawBody));
  return names.map((name) => ({ name }));
}

/**
 * Prepend the agent's configured system prompt as a leading role:"system"
 * message.
 *
 * Prepended rather than replacing any system message the caller already
 * sent, because OpenAI's format allows several system messages and applies
 * them in order — the agent-level prompt takes effect first without silently
 * discarding whatever the caller's own application already puts there.
 */
export function injectOpenAiSystemPrompt(requestBody: unknown, systemPrompt: string): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  const messages = Array.isArray(rec["messages"]) ? rec["messages"] : [];
  return { ...rec, messages: [{ role: "system", content: systemPrompt }, ...messages] };
}

/**
 * Append the agent's configured tools to the client's own `tools` array —
 * OpenAI's shape is `tools: [{type: "function", function: {name,
 * description, parameters}}]`. Appended, not prepended like the system
 * prompt: tool ORDER carries no priority signal the way message order does,
 * so there's no equivalent reason to put Tollgate's first.
 */
export function injectOpenAiToolDefinitions(
  requestBody: unknown,
  tools: ToolDefinition[],
): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  const existing = Array.isArray(rec["tools"]) ? rec["tools"] : [];
  const added = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  return { ...rec, tools: [...existing, ...added] };
}

export function prepareStreamUsage(requestBody: unknown): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  if (rec["stream"] !== true) return requestBody;

  const existing = rec["stream_options"];
  const streamOptions =
    typeof existing === "object" && existing !== null
      ? (existing as Record<string, unknown>)
      : {};

  return { ...rec, stream_options: { ...streamOptions, include_usage: true } };
}
