import {
  BEDROCK_PRICES,
  findModelPrice,
  type ProviderAdapter,
  type ProviderCost,
  type ToolCallRef,
  type ToolDefinition,
} from "@tollgate/shared";
import { signAwsRequest } from "../lib/aws-sigv4.js";

/**
 * AWS Bedrock — Anthropic Claude models only, non-streaming only.
 *
 * NON-STREAMING BY DESIGN (for now): Bedrock's InvokeModelWithResponseStream
 * uses AWS's own binary event-stream framing (application/vnd.amazon.
 * eventstream — a length-prefixed binary envelope with CRC checks), not SSE.
 * That needs its own parser and is real, separate work; scoped out until
 * there's a concrete reason to take it on. InvokeModel (this adapter) covers
 * every non-streaming caller today.
 *
 * REQUEST SHAPE: verified against AWS's own InvokeModel API reference and the
 * Claude Messages API request/response docs, not assumed —
 *   - Path: POST /model/{modelId}/invoke. modelId is a Bedrock id like
 *     "anthropic.claude-3-5-sonnet-20241022-v2:0", or a region-prefixed
 *     inference profile id like "us.anthropic.claude-3-5-sonnet-...".
 *     Mirrored 1:1 under the provider slug, same as every other adapter —
 *     the client calls POST /bedrock/model/{modelId}/invoke.
 *   - Body carries "anthropic_version": "bedrock-2023-05-31" (required) in
 *     place of Anthropic's own "anthropic-version" HEADER, and has no "model"
 *     field — the model is in the URL, not the body, same reason as Gemini.
 *   - Response is close to byte-identical to Anthropic's own Messages API:
 *     same usage.input_tokens/output_tokens field names.
 *
 * AUTH: AWS SigV4 request signing, not a static header — see aws-sigv4.ts,
 * in particular its note on the signing service name being "bedrock" despite
 * the "bedrock-runtime" hostname. This is also why the adapter seam had to
 * become an async buildUpstreamRequest: SigV4 signs the method, path, query,
 * headers and a hash of the exact body together, which a `buildAuthHeaders
 * (key)` shape could never express.
 */

interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

/** Bedrock's InvokeModel response for Claude is field-for-field the same
 *  shape as Anthropic's own Messages API response (see claude.ts's identical
 *  reader) — verified against AWS's own docs, not assumed. */
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
 * Strips the two things findModelPrice's generic dash-suffix peeling can't
 * express on its own, so BEDROCK_PRICES can stay keyed on plain family names:
 *   1. A leading region-inference-profile prefix ("us.", "eu.") before the
 *      "anthropic." vendor prefix.
 *   2. A trailing ":N" revision suffix (Bedrock appends this with a colon,
 *      not a dash, so RELEASE_SUFFIX's dash-splitting never sees it).
 *
 * "us.anthropic.claude-3-5-sonnet-20240620-v1:0"
 *   -> "anthropic.claude-3-5-sonnet-20240620-v1"   (strip prefix + ":0")
 *   -> "anthropic.claude-3-5-sonnet-20240620"      (findModelPrice peels v1)
 *   -> "anthropic.claude-3-5-sonnet"               (findModelPrice peels date)
 */
export function normalizeBedrockModelId(modelId: string): string {
  const vendorIndex = modelId.indexOf("anthropic.");
  const withoutProfile = vendorIndex === -1 ? modelId : modelId.slice(vendorIndex);
  return withoutProfile.replace(/:\d+$/, "");
}

/** Tool names from a response's `content` blocks — field-for-field the same
 *  shape as Anthropic's own Messages API (see claude.ts's identical
 *  toolUseNames; duplicated rather than imported, same call as readUsage
 *  above — no streaming variant needed since this adapter is non-streaming
 *  only, see the file doc comment). */
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

function extractBedrockToolCalls(rawBody: string): ToolCallRef[] {
  const body = parseJson(rawBody);
  if (typeof body !== "object" || body === null) return [];
  return toolUseNames((body as Record<string, unknown>)["content"]).map((name) => ({ name }));
}

/** Prepend to the top-level `system` field — same shape as Anthropic's own
 *  Messages API (see claude.ts's injectClaudeSystemPrompt), duplicated for
 *  the same reason as toolUseNames above. */
function injectBedrockSystemPrompt(requestBody: unknown, systemPrompt: string): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  const existing = rec["system"];

  if (existing === undefined || existing === null) return { ...rec, system: systemPrompt };
  if (typeof existing === "string") return { ...rec, system: `${systemPrompt}\n\n${existing}` };
  if (Array.isArray(existing)) {
    return { ...rec, system: [{ type: "text", text: systemPrompt }, ...existing] };
  }
  return rec;
}

/** Append to the `tools` array — same `{name, description, input_schema}`
 *  shape as Anthropic's own Messages API (see claude.ts's
 *  injectClaudeToolDefinitions), duplicated for the same reason as
 *  toolUseNames/injectBedrockSystemPrompt above. */
function injectBedrockToolDefinitions(requestBody: unknown, tools: ToolDefinition[]): unknown {
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
const ANTHROPIC_BEDROCK_VERSION = "bedrock-2023-05-31";

export class BedrockCredentialIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BedrockCredentialIncompleteError";
  }
}

export const bedrockAdapter: ProviderAdapter = {
  slug: "bedrock",
  // Template, not a real host — the real host is per-region, from the
  // credential's config, same pattern as Azure's per-customer host.
  baseUrl: "https://bedrock-runtime.{region}.amazonaws.com",

  buildUpstreamRequest: async ({ path, query, method, body, credential }) => {
    const accessKeyId = credential.secrets["accessKeyId"];
    const secretAccessKey = credential.secrets["secretAccessKey"];
    const region = credential.config["region"];

    if (accessKeyId === undefined || secretAccessKey === undefined || region === undefined) {
      // Fail loudly rather than sign with an empty credential, which SigV4
      // would happily do and AWS would then reject with an opaque
      // SignatureDoesNotMatch — this way the operator sees what's actually
      // missing instead of a cryptography error.
      throw new BedrockCredentialIncompleteError(
        "This AWS key is missing an access key, secret key, or region — re-save it in Settings.",
      );
    }

    const clean = path.replace(/^\/+/, "");
    const url = `https://bedrock-runtime.${region}.amazonaws.com/${clean}${query}`;

    const headers = await signAwsRequest({
      credentials: {
        accessKeyId,
        secretAccessKey,
        sessionToken: credential.secrets["sessionToken"],
      },
      region,
      url,
      method,
      headers: { "content-type": "application/json" },
      body,
    });

    return { url, headers };
  },

  // Unlike OpenAI's opt-in, this isn't about usage reporting (InvokeModel
  // always reports it, same as Anthropic's own API) — it injects the
  // required "anthropic_version" field Bedrock's body needs in place of the
  // "anthropic-version" HEADER the direct Anthropic API uses instead.
  prepareRequestBody: prepareBedrockRequestBody,

  parseCost: (rawBody): ProviderCost => {
    const usage = readUsage(parseJson(rawBody));
    if (usage === null) return { costCents: 0 };

    const tokenCounts = {
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      model: usage.model,
    };

    // Deliberate lookup: an unknown model shouldn't crash metering, it costs 0
    // and is left for reconciliation rather than guessed at.
    const price = findModelPrice(normalizeBedrockModelId(usage.model), BEDROCK_PRICES);
    if (price === undefined) return { costCents: 0, ...tokenCounts };

    const costCents =
      (usage.inputTokens * price.inputCentsPerMTok) / MTOK +
      (usage.outputTokens * price.outputCentsPerMTok) / MTOK;

    return { costCents, ...tokenCounts };
  },

  extractToolCalls: extractBedrockToolCalls,
  injectSystemPrompt: injectBedrockSystemPrompt,
  injectToolDefinitions: injectBedrockToolDefinitions,
};

/** Injected onto the body the client sends, the same shape prepareRequestBody
 *  fills for other adapters — Bedrock's required field lives in the body,
 *  not a header, so this runs as part of buildUpstreamRequest's caller
 *  instead. Exported so proxy.ts's existing prepareRequestBody hook can use
 *  it uniformly with every other adapter. */
export function prepareBedrockRequestBody(requestBody: unknown): unknown {
  if (typeof requestBody !== "object" || requestBody === null) return requestBody;
  const rec = requestBody as Record<string, unknown>;
  if (rec["anthropic_version"] !== undefined) return requestBody;
  return { ...rec, anthropic_version: ANTHROPIC_BEDROCK_VERSION };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
