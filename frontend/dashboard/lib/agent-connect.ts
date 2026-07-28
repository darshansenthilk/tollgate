import { PROXY_URL } from "@/lib/api";

/**
 * Bridges the dashboard's assistant labels ("chatgpt"/"claude") to the proxy's
 * real adapter slugs ("openai"/"claude") that appear in its URL path — the
 * same split backend/proxy/src/adapters/registry.ts's assistantAdapterSlugs
 * exists for. Duplicated here (not imported) because this is presentational
 * code in a different service; keep in sync with that map.
 */
const ADAPTER_SLUGS: Record<string, string> = {
  chatgpt: "openai",
  claude: "claude",
};

/**
 * The dashboard's Claude model dropdown stores short labels
 * (lib/agent-options.ts's MODELS_BY_PROVIDER), but the real Anthropic API
 * only accepts the exact dated model id — sending "sonnet" literally would
 * fail upstream. Keep in sync with backend/shared/src/index.ts's CLAUDE_PRICES
 * keys, which this must match for cost metering to actually price the call.
 */
const CLAUDE_UPSTREAM_MODEL_IDS: Record<string, string> = {
  opus: "claude-3-opus-20240229",
  sonnet: "claude-3-5-sonnet-20241022",
  haiku: "claude-3-5-haiku-20241022",
};

/** ChatGPT's dashboard model values ("gpt-4o", "gpt-4o-mini") already are the
 *  real upstream model ids, so only Claude needs translating. */
function upstreamModelId(providerSlug: string, model: string): string {
  if (providerSlug === "claude") return CLAUDE_UPSTREAM_MODEL_IDS[model] ?? model;
  return model;
}

/**
 * The base URL an official provider SDK should be pointed at so its own
 * (unmodified) path-building lands on the proxy's real route. Confirmed
 * against both SDKs' source, not assumed:
 *   - OpenAI's default baseURL already bakes in "/v1" (it's
 *     "https://api.openai.com/v1"), and the SDK appends e.g.
 *     "chat/completions" on top of whatever baseURL is given — so the
 *     override must include "/v1" itself, or the proxy would see
 *     "/openai/chat/completions" instead of "/openai/v1/chat/completions".
 *   - Anthropic's default baseURL is "https://api.anthropic.com" (no "/v1")
 *     and the SDK's own request path literal is "/v1/messages" — so the
 *     override must NOT add "/v1", or it would double up.
 */
function proxyBaseUrl(providerSlug: string): string | null {
  const adapterSlug = ADAPTER_SLUGS[providerSlug];
  if (adapterSlug === undefined) return null;
  return adapterSlug === "openai" ? `${PROXY_URL}/${adapterSlug}/v1` : `${PROXY_URL}/${adapterSlug}`;
}

export interface ConnectSnippets {
  python: string;
  typescript: string;
}

/** null when the agent's assistant/model isn't one this can generate code for
 *  (an unknown providerSlug, or no model chosen yet). */
export function buildConnectSnippets(
  providerSlug: string,
  model: string | null,
  token: string,
): ConnectSnippets | null {
  if (model === null) return null;
  const baseUrl = proxyBaseUrl(providerSlug);
  if (baseUrl === null) return null;
  const upstreamModel = upstreamModelId(providerSlug, model);

  if (providerSlug === "claude") {
    return {
      python: `from anthropic import Anthropic

client = Anthropic(
    base_url="${baseUrl}",
    api_key="${token}",
)

response = client.messages.create(
    model="${upstreamModel}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.content[0].text)`,
      typescript: `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${baseUrl}",
  apiKey: "${token}",
});

const response = await client.messages.create({
  model: "${upstreamModel}",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.content[0].text);`,
    };
  }

  return {
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${token}",
)

response = client.chat.completions.create(
    model="${upstreamModel}",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`,
    typescript: `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${baseUrl}",
  apiKey: "${token}",
});

const response = await client.chat.completions.create({
  model: "${upstreamModel}",
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.choices[0].message.content);`,
  };
}

/** The proxy path + minimal request body for a real, trivial test call —
 *  shared with the "Test connection" server route so the test hits the exact
 *  same route shape the snippets above describe. max_tokens is kept at the
 *  provider's practical minimum to keep a real test call's cost negligible. */
export function buildTestRequest(
  providerSlug: string,
  model: string | null,
): { path: string; body: Record<string, unknown> } | null {
  if (model === null) return null;
  const adapterSlug = ADAPTER_SLUGS[providerSlug];
  if (adapterSlug === undefined) return null;
  const upstreamModel = upstreamModelId(providerSlug, model);

  if (providerSlug === "claude") {
    return {
      path: `/${adapterSlug}/v1/messages`,
      body: {
        model: upstreamModel,
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      },
    };
  }

  return {
    path: `/${adapterSlug}/v1/chat/completions`,
    body: {
      model: upstreamModel,
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    },
  };
}
