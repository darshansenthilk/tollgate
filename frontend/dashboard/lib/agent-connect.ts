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
  gemini: "gemini",
  azure: "azure",
  bedrock: "bedrock",
};

/**
 * The dashboard's Claude model dropdown stores short labels
 * (lib/agent-options.ts's MODELS_BY_PROVIDER), but the real Anthropic API
 * only accepts the exact dated model id — sending "sonnet" literally would
 * fail upstream. These stay dated for that reason; metering still prices them
 * because findModelPrice strips the date back to the family key that
 * backend/shared/src/index.ts's CLAUDE_PRICES is keyed by.
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
 *   - Google's genai SDK (google-genai / @google/genai) defaults to
 *     "https://generativelanguage.googleapis.com" and builds paths like
 *     "/v1beta/models/{model}:generateContent" itself — same shape as
 *     Anthropic's, so the override must NOT add anything either. Matches
 *     backend/proxy/src/adapters/gemini.ts's route
 *     ("/gemini/v1beta/models/...:generateContent").
 *   - Bedrock has no official SDK base-url override in play here at all —
 *     the snippet is raw HTTP, so this is simply the root the path in
 *     buildTestRequest/the snippet's own fetch call is built against.
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
    // auth_token/authToken, NOT api_key/apiKey. Verified against the real SDK
    // source (both Python and TS): api_key routes through apiKeyAuth() and is
    // sent as an X-Api-Key header (Anthropic's own non-standard convention,
    // mirrored by claude.ts's adapter when it signs the OUTBOUND request with
    // the org's real vaulted key) — but the proxy's extractBearer only reads
    // Authorization: Bearer off the INCOMING request. api_key would 401 with
    // missing_token. auth_token routes through bearerAuth() and sends
    // Authorization: Bearer, which is what the token actually needs.
    return {
      python: `from anthropic import Anthropic

client = Anthropic(
    base_url="${baseUrl}",
    auth_token="${token}",
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
  authToken: "${token}",
});

const response = await client.messages.create({
  model: "${upstreamModel}",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.content[0].text);`,
    };
  }

  if (providerSlug === "azure") {
    // The Azure SDK builds /openai/deployments/{deployment}/... itself and
    // appends ?api-version=, so azure_endpoint is just Tollgate's /azure root.
    // `model` here is the DEPLOYMENT name, not a model id — Azure resolves the
    // real model from the deployment (see agent-options.ts).
    return {
      python: `from openai import AzureOpenAI

client = AzureOpenAI(
    azure_endpoint="${baseUrl}",
    api_key="${token}",
    api_version="2024-10-21",
)

response = client.chat.completions.create(
    model="${upstreamModel}",  # your Azure deployment name
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)`,
      typescript: `import { AzureOpenAI } from "openai";

const client = new AzureOpenAI({
  endpoint: "${baseUrl}",
  apiKey: "${token}",
  apiVersion: "2024-10-21",
});

const response = await client.chat.completions.create({
  model: "${upstreamModel}", // your Azure deployment name
  messages: [{ role: "user", content: "Hello" }],
});
console.log(response.choices[0].message.content);`,
    };
  }

  if (providerSlug === "bedrock") {
    // Deliberately raw HTTP, not boto3 / the AWS SDK. Every other snippet
    // here swaps one credential in an existing SDK client, but the AWS SDK's
    // whole job is signing requests with a real AWS key — which is exactly
    // what this agent must NEVER hold. Tollgate signs with the org's stored
    // AWS credential server-side (see backend/proxy/src/adapters/bedrock.ts);
    // the agent only ever needs its own Tollgate token as a bearer header,
    // same as every other provider.
    return {
      python: `import requests

response = requests.post(
    "${baseUrl}/model/${upstreamModel}/invoke",
    headers={"Authorization": "Bearer ${token}"},
    json={
        "max_tokens": 1024,
        "messages": [{"role": "user", "content": "Hello"}],
    },
)
print(response.json()["content"][0]["text"])`,
      typescript: `const response = await fetch(
  "${baseUrl}/model/${upstreamModel}/invoke",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer ${token}",
    },
    body: JSON.stringify({
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
    }),
  },
);
const data = await response.json();
console.log(data.content[0].text);`,
    };
  }

  if (providerSlug === "gemini") {
    return {
      python: `from google import genai

client = genai.Client(
    api_key="${token}",
    http_options={"base_url": "${baseUrl}"},
)

response = client.models.generate_content(
    model="${upstreamModel}",
    contents="Hello",
)
print(response.text)`,
      typescript: `import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({
  apiKey: "${token}",
  httpOptions: { baseUrl: "${baseUrl}" },
});

const response = await client.models.generateContent({
  model: "${upstreamModel}",
  contents: "Hello",
});
console.log(response.text);`,
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

/**
 * Platform-specific copy for pointing an externally-hosted agent's own tool
 * registration at Tollgate's MCP gateway (backend/proxy/src/routes/mcp.ts)
 * instead of the SDK snippets above — those describe rerouting LLM traffic,
 * which an externally-hosted agent's platform (not Tollgate) already owns.
 * null for any hostPlatform this doesn't recognize, mirroring
 * buildConnectSnippets's own "unknown input -> null" contract.
 */
export interface McpConnectInfo {
  serverUrl: string;
  token: string;
  instructions: string;
}

export function buildMcpConnectInfo(hostPlatform: string, token: string): McpConnectInfo | null {
  const serverUrl = `${PROXY_URL}/mcp`;

  if (hostPlatform === "anthropic_managed_agents") {
    return {
      serverUrl,
      token,
      // NOT a Console form — Anthropic's Managed Agents MCP registration is
      // API-driven: the agent declares this URL under mcp_servers (POST
      // /v1/agents), and the token goes into a vault credential
      // (type: "static_bearer", matched by mcp_server_url) referenced when
      // creating the session. See platform.claude.com/docs/en/managed-agents/
      // mcp-connector and .../vaults for the exact request shapes — confirmed
      // directly against those docs after an earlier, wrong assumption here
      // that this was a point-and-click Console flow.
      instructions:
        "Registered via the Managed Agents API, not a Console form: declare this URL under the agent's mcp_servers, then add the token as a static_bearer vault credential (matched by this same URL) and reference that vault when creating the session. See platform.claude.com/docs/en/managed-agents/mcp-connector.",
    };
  }

  if (hostPlatform === "salesforce_agentforce") {
    return {
      serverUrl,
      token,
      instructions:
        "In Salesforce Setup, register this URL as an external MCP tool source for this Agentforce agent, using the token as its auth credential.",
    };
  }

  return null;
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

  if (providerSlug === "gemini") {
    return {
      // Model is in the URL path, not the body — see gemini.ts's own doc
      // comment on why (Gemini's request body carries no "model" field).
      path: `/${adapterSlug}/v1beta/models/${upstreamModel}:generateContent`,
      body: {
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        generationConfig: { maxOutputTokens: 1 },
      },
    };
  }

  if (providerSlug === "bedrock") {
    return {
      // anthropic_version is injected server-side (bedrock.ts's
      // prepareRequestBody) — the caller never has to know Bedrock needs it.
      path: `/${adapterSlug}/model/${upstreamModel}/invoke`,
      body: {
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      },
    };
  }

  if (providerSlug === "azure") {
    return {
      // Deployment in the path, mandatory api-version in the query — Azure
      // rejects the request outright without the latter.
      path: `/${adapterSlug}/openai/deployments/${upstreamModel}/chat/completions?api-version=2024-10-21`,
      body: {
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
