/**
 * @tollgate/shared — domain types shared across proxy, api, and dashboard.
 *
 * Types only for now; business logic lands in later milestones.
 *
 * License-key verification (self-hosting) deliberately does NOT live here,
 * even though it's conceptually "shared logic" — it needs node:crypto,
 * and this file's exports are reachable from the dashboard's CLIENT
 * bundle (browser code), which can't resolve Node built-ins. It lives at
 * @tollgate/shared/license instead (src/license.ts), a separate package
 * export only backend/api and backend/proxy's server-only
 * check-license.ts import — never anything client-side. Putting it here
 * once actually broke the live dashboard dev server (webpack tried to
 * bundle node:crypto for the browser and failed outright); keep it split.
 */

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/**
 * Guarantee tier per provider integration:
 * - enforced:  cost known/reservable pre-request → hard budget guarantee
 * - metered:   cost derived post-response → bounded overshoot
 * - monitored: no reliable per-request cost → detection + freeze only
 */
export type GuaranteeTier = "enforced" | "metered" | "monitored";

/** What the proxy does if enforcement state (Redis) is unreachable. */
export type FailMode = "fail_closed" | "fail_open_degraded";

export interface Provider {
  id: string;
  /** Stable slug used in proxy routes, e.g. "openai" → /openai/* */
  slug: string;
  name: string;
  /** Upstream base URL requests are forwarded to. */
  baseUrl: string;
  tier: GuaranteeTier;
  /** Default fail behavior; payments-class providers should be fail_closed. */
  defaultFailMode: FailMode;
  createdAt: string;
}

/**
 * Cost derived from an upstream response.
 * - costCents:          settled cost, metered from the response (fractional cents ok)
 * - estimatedCostCents: optional pre-request reservation, for enforced-tier providers
 *
 * Kept in cents (USD) to match Policy/SpendEvent; the proxy converts to integer
 * micro-cents before touching the Redis counter (see proxy budget layer).
 */
export interface ProviderCost {
  costCents: number;
  estimatedCostCents?: number;
  /**
   * Token counts metered from the response, when the provider reports them
   * (e.g. OpenAI's usage.prompt_tokens/completion_tokens). Optional — an
   * adapter that can't report tokens simply omits these, and the hot path
   * skips the token counter update rather than guessing. Independent of
   * costCents: a response can report tokens without a known price (or vice
   * versa in a future adapter).
   */
  promptTokens?: number;
  completionTokens?: number;
  /**
   * The model the provider actually reports having served, as opposed to the
   * descriptive `model` label an agent was created with (which the proxy never
   * enforces). Recorded on the spend_events audit row so the activity log shows
   * what really ran.
   */
  model?: string;
}

/**
 * A single tool/function call an upstream response asked the caller to
 * execute. Distinct from Policy.endpointAllowlist, which scopes which
 * upstream HTTP paths an agent may hit at all — this is about what a specific
 * chat-completion response, once allowed to happen, asked the agent to DO.
 */
export interface ToolCallRef {
  /** The tool/function name exactly as the provider named it, so it can be
   *  compared against Policy.blockedTools without per-provider translation. */
  name: string;
}

/**
 * A tool/function an agent is allowed to be told about — the OTHER half of
 * the tool firewall from ToolCallRef/blockedTools. That pair governs what a
 * response is allowed to ask for AFTER the fact; this governs what the
 * request tells the model it CAN ask for in the first place, so the schema
 * lives once in Tollgate instead of duplicated in the customer's own app.
 *
 * `parameters` is JSON Schema describing the tool's arguments — the one part
 * of a "tools" declaration every provider agrees on (each just nests it
 * differently: OpenAI/Gemini call it `parameters`, Claude/Bedrock call it
 * `input_schema`). Left as `Record<string, unknown>` rather than a typed
 * JSON-Schema shape because Tollgate never interprets it — it's forwarded
 * verbatim to whichever provider the agent talks to, which is the one thing
 * actually qualified to validate it.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * The seam the proxy hot path forwards through. The route handler
 * (token auth → budget check → forward → meter → settle) only ever calls these
 * methods on whichever adapter matches the request's provider slug — it never
 * names a concrete provider. Adding a provider = one new adapter object in the
 * registry, zero route changes.
 */
/** Everything an adapter needs to address and authenticate one forwarded
 *  request. Assembled by the proxy hot path; consumed only by
 *  ProviderAdapter.buildUpstreamRequest. */
export interface UpstreamRequestArgs {
  /** The wildcard portion after the provider slug, with no leading slash
   *  (e.g. "v1/chat/completions"). */
  path: string;
  /** The caller's raw query string including its leading "?", or "" when
   *  they sent none. The adapter — not the hot path — decides where this
   *  lands, because a signing provider has to sign the exact final URL. */
  query: string;
  method: string;
  /** The body exactly as it will go out on the wire, or undefined for a
   *  bodyless request. Present because request-signing schemes (AWS SigV4)
   *  hash the payload as part of the signature. */
  body: string | undefined;
  /** Decrypted credential for this org — see UpstreamCredential. */
  credential: UpstreamCredential;
}

/** Where a forwarded request goes and what it carries. */
export interface UpstreamRequestSpec {
  /** Absolute URL, query string included. */
  url: string;
  /** Auth (and any provider-required) headers. Merged over the hot path's
   *  defaults, so an adapter can override content-type if it must. */
  headers: Record<string, string>;
}

export interface ProviderAdapter {
  /** Stable slug used in proxy routes, e.g. "openai" → POST /openai/*. */
  slug: string;
  /**
   * Upstream base URL requests are forwarded to. Documentation only for
   * providers whose host is per-customer (Azure's is
   * https://{resourceName}.openai.azure.com, Bedrock's is per-region) — those
   * derive the real host from the credential inside buildUpstreamRequest.
   */
  baseUrl: string;
  /**
   * Build the full outgoing request: URL (including query) and auth headers.
   *
   * One method rather than a separate URL builder and header builder because
   * the two aren't independent for every provider. AWS SigV4 signs the method,
   * path, query, headers and a hash of the body together, so its auth header
   * can only be produced once the final URL and body are known — a
   * `buildAuthHeaders(key)` seam is structurally incapable of expressing it.
   * Allowed to be async for the same reason (signing is crypto work).
   */
  buildUpstreamRequest: (
    args: UpstreamRequestArgs,
  ) => UpstreamRequestSpec | Promise<UpstreamRequestSpec>;
  /**
   * Meter an upstream response into a settled cost.
   *
   * Takes the RAW body text, not pre-parsed JSON, because a streamed response
   * ("stream": true) is an SSE transcript rather than a JSON document — the
   * adapter has to decide how to read it. Handing adapters parsed JSON is what
   * previously made every streamed request meter as $0.
   */
  parseCost: (rawBody: string) => ProviderCost;
  /**
   * Optionally rewrite the client's request body before it's forwarded, so the
   * provider actually reports the usage this proxy needs to meter. OpenAI needs
   * an explicit opt-in for usage on streamed responses; Anthropic always
   * reports it, so its adapter omits this. Return the body unchanged when
   * nothing is needed.
   */
  prepareRequestBody?: (requestBody: unknown) => unknown;
  /**
   * Extract the tool/function names an upstream response asked to invoke, so
   * the hot path can enforce Policy.blockedTools before the response reaches
   * the caller. Optional and per-provider (each one's tool-call shape in the
   * raw response differs — OpenAI's tool_calls[].function.name isn't Claude's
   * tool_use content blocks). An adapter without this is treated as "nothing
   * to check" rather than failing closed: an agent talking to a provider that
   * hasn't had extraction wired up yet shouldn't be blanket-denied for it.
   */
  extractToolCalls?: (rawBody: string) => ToolCallRef[];
  /**
   * Prepend Policy.systemPrompt to the client's own request body, in whatever
   * shape this provider expects a system prompt (OpenAI: a leading
   * role:"system" message; Claude/Bedrock: a top-level `system` field —
   * they're not interchangeable). Optional and per-provider for the same
   * reason extractToolCalls is: an agent on a provider without this wired up
   * yet simply sends its request unmodified rather than erroring.
   */
  injectSystemPrompt?: (requestBody: unknown, systemPrompt: string) => unknown;
  /**
   * Add Policy.toolDefinitions to the client's own request body, in whatever
   * shape this provider expects a tools declaration (OpenAI:
   * tools[].function.{name,description,parameters}; Claude/Bedrock:
   * tools[].{name,description,input_schema}; Gemini:
   * tools[].functionDeclarations[]). MERGES with any tools the caller's own
   * request already carries rather than replacing them — same reasoning as
   * injectSystemPrompt not overwriting a caller-supplied system message.
   * Optional and per-provider for the same reason extractToolCalls/
   * injectSystemPrompt are.
   */
  injectToolDefinitions?: (requestBody: unknown, tools: ToolDefinition[]) => unknown;
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export interface ModelPrice {
  /** Cents per 1M input (prompt) tokens. */
  inputCentsPerMTok: number;
  /** Cents per 1M output (completion) tokens. */
  outputCentsPerMTok: number;
}

/**
 * Trailing name segments that identify a RELEASE of a model rather than a
 * different model, and so can be dropped when looking up a price.
 *
 * Deliberately narrow. Providers publish a new dated id every few weeks
 * ("gpt-4o-2024-08-06", "claude-3-5-sonnet-20241022", "gemini-1.5-flash-001")
 * and each one that misses the price table meters at $0 — silently disabling
 * budget enforcement for that agent. Stripping these suffixes fixes that
 * whole class of gap without a table edit.
 *
 * What is NOT here matters more than what is. Stripping any trailing segment
 * would make an unknown "gpt-4o-nano" resolve to "gpt-4o" and bill ~16x its
 * real rate, so only segments that cannot name a distinct model are removed:
 * pure numbers, vN revisions, and "latest". "preview" and "mini"/"nano"-style
 * words are excluded on purpose — those genuinely are different models at
 * different prices, and guessing at them is worse than reporting $0 honestly.
 */
const RELEASE_SUFFIX = /^(\d+|v\d+|latest)$/;

/**
 * Look up a model's price, falling back to its family when the exact id is a
 * dated or versioned release of one.
 *
 * Returns undefined when nothing matches — callers must treat that as "cost
 * unknown", never as free. See ProviderCost: token counts are still reported,
 * so an unpriced model is visible as usage-without-cost rather than vanishing.
 */
export function findModelPrice(
  model: string,
  prices: Record<string, ModelPrice>,
): ModelPrice | undefined {
  const exact = prices[model];
  if (exact !== undefined) return exact;

  // Peel release suffixes off the end, most specific first:
  // gpt-4o-2024-08-06 -> gpt-4o-2024-08 -> gpt-4o-2024 -> gpt-4o
  const parts = model.split("-");
  let end = parts.length;
  while (end > 1 && RELEASE_SUFFIX.test(parts[end - 1] ?? "")) {
    end -= 1;
    const candidate = prices[parts.slice(0, end).join("-")];
    if (candidate !== undefined) return candidate;
  }

  return undefined;
}

/**
 * OpenAI's real chat-completions pricing — the single source of truth,
 * imported by proxy/src/adapters/openai.ts (which meters real traffic) and
 * the dashboard's marketing-page demo simulator (which never calls OpenAI,
 * but stays correct if these numbers change instead of drifting from a
 * hardcoded copy).
 */
export const OPENAI_PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { inputCentsPerMTok: 250, outputCentsPerMTok: 1000 },
  "gpt-4o-mini": { inputCentsPerMTok: 15, outputCentsPerMTok: 60 },
  "gpt-4-turbo": { inputCentsPerMTok: 1000, outputCentsPerMTok: 3000 },
  "gpt-4": { inputCentsPerMTok: 3000, outputCentsPerMTok: 6000 },
  "gpt-3.5-turbo": { inputCentsPerMTok: 50, outputCentsPerMTok: 150 },
};

/**
 * Anthropic's Messages API pricing — same reuse as OPENAI_PRICES.
 *
 * Keyed by FAMILY, without the dated suffix Anthropic puts on every model id:
 * findModelPrice strips "-20241022" and matches "claude-3-5-sonnet", so a
 * newly-dated release of a known family prices correctly the day it ships
 * instead of silently metering $0 until someone edits this file.
 */
export const CLAUDE_PRICES: Record<string, ModelPrice> = {
  "claude-3-5-sonnet": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-3-5-haiku": { inputCentsPerMTok: 80, outputCentsPerMTok: 400 },
  "claude-3-opus": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  "claude-3-sonnet": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "claude-3-haiku": { inputCentsPerMTok: 25, outputCentsPerMTok: 125 },
};

/**
 * Google's Gemini API pricing — same reuse as OPENAI_PRICES/CLAUDE_PRICES.
 * Keyed on `modelVersion` as Gemini's own API reports it back on every
 * response (proxy/src/adapters/gemini.ts), which is often a dated/pinned
 * string (e.g. "gemini-1.5-flash-001") rather than the bare model name — an
 * entry here has to match that exact string or it silently prices at $0
 * (by design, same as an unpriced OpenAI/Claude model — see gemini.ts's
 * parseCost). Verify against Google's current pricing page before relying
 * on these for real billing; add pinned-version keys as they're seen.
 */
export const GEMINI_PRICES: Record<string, ModelPrice> = {
  "gemini-1.5-flash": { inputCentsPerMTok: 7.5, outputCentsPerMTok: 30 },
  "gemini-1.5-flash-8b": { inputCentsPerMTok: 3.75, outputCentsPerMTok: 15 },
  "gemini-1.5-pro": { inputCentsPerMTok: 125, outputCentsPerMTok: 500 },
  "gemini-2.0-flash": { inputCentsPerMTok: 10, outputCentsPerMTok: 40 },
};

/**
 * Azure OpenAI pricing. Azure serves OpenAI's models, and its standard
 * (pay-as-you-go) rates have historically matched OpenAI's list price — but
 * they are set by Microsoft, bill to an Azure subscription, and can diverge,
 * so this is deliberately its OWN table rather than an alias of
 * OPENAI_PRICES: a future divergence should be a one-line edit here, not a
 * silent mispricing everywhere.
 *
 * Keyed on what Azure reports back in the response's `model` field, which is
 * the dated deployment version (e.g. "gpt-4o-2024-08-06") rather than the
 * bare family name — hence both spellings below. An unlisted key prices at $0
 * by design (same as every other adapter); verify against your own Azure
 * pricing page before relying on these for real billing, since rates also
 * vary by region and deployment type.
 */
export const AZURE_PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { inputCentsPerMTok: 250, outputCentsPerMTok: 1000 },
  "gpt-4o-mini": { inputCentsPerMTok: 15, outputCentsPerMTok: 60 },
  "gpt-4-turbo": { inputCentsPerMTok: 1000, outputCentsPerMTok: 3000 },
  "gpt-4": { inputCentsPerMTok: 3000, outputCentsPerMTok: 6000 },
  // Azure spells its 3.5 deployments "gpt-35-turbo" (no dot) — a genuinely
  // different id from OpenAI's own, not a dated variant, so it needs its
  // own entry rather than relying on suffix stripping.
  "gpt-35-turbo": { inputCentsPerMTok: 50, outputCentsPerMTok: 150 },
  "gpt-3.5-turbo": { inputCentsPerMTok: 50, outputCentsPerMTok: 150 },
};

/**
 * AWS Bedrock's on-demand pricing for Anthropic Claude models — AWS sets
 * these, and while they've historically tracked Anthropic's own list price,
 * that's not guaranteed, so this is its own table rather than an alias of
 * CLAUDE_PRICES (same reasoning as AZURE_PRICES). Provisioned-throughput
 * commitments bill differently; these are on-demand rates only.
 *
 * Keyed on the FAMILY portion of a Bedrock model id, after
 * bedrock.ts's normalizeBedrockModelId strips the region-inference-profile
 * prefix ("us.") and the trailing ":N" revision — findModelPrice then peels
 * the dated suffix and "vN" the same way it does for every other provider.
 * Verify against AWS's own Bedrock pricing page before relying on these for
 * real billing, same caveat as every other price table here.
 */
export const BEDROCK_PRICES: Record<string, ModelPrice> = {
  "anthropic.claude-3-5-sonnet": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "anthropic.claude-3-5-haiku": { inputCentsPerMTok: 80, outputCentsPerMTok: 400 },
  "anthropic.claude-3-opus": { inputCentsPerMTok: 1500, outputCentsPerMTok: 7500 },
  "anthropic.claude-3-sonnet": { inputCentsPerMTok: 300, outputCentsPerMTok: 1500 },
  "anthropic.claude-3-haiku": { inputCentsPerMTok: 25, outputCentsPerMTok: 125 },
};

// ---------------------------------------------------------------------------
// Upstream provider keys (BYOK)
//
// An org can supply its OWN OpenAI/Anthropic key so upstream usage bills to
// their provider account instead of Tollgate's. Everything here is pure format
// and naming convention — the actual AES-256-GCM encrypt/decrypt lives in the
// backends (this file is bundled into the browser dashboard, so no node:crypto).
// ---------------------------------------------------------------------------

/**
 * One input a provider needs before Tollgate can call it on an org's behalf.
 *
 * Not every provider authenticates with a single opaque string. OpenAI,
 * Anthropic and Gemini do; Azure OpenAI additionally needs the customer's own
 * resource name (its endpoint hostname is per-customer), and AWS Bedrock needs
 * an access-key/secret pair plus a region. Describing those inputs as data —
 * rather than branching on the provider in the api, the vault and the
 * dashboard independently — is what keeps "add a provider" a change to this
 * list plus one adapter file.
 *
 * `secret: true` fields are encrypted at rest and NEVER returned by any api
 * route (same write-once-reveal-never rule as agent tokens). `secret: false`
 * fields are plain config that shows up in URLs anyway (a region, a hostname)
 * — stored in the clear so the dashboard can display which resource a key
 * points at.
 */
export interface CredentialField {
  /** Key this value is stored and looked up under. */
  name: string;
  label: string;
  /** Encrypted at rest and never echoed back when true. */
  secret: boolean;
  placeholder?: string;
  /** Shown under the input — say where to find the value, not what it is. */
  help?: string;
  /**
   * Accepted shape, enforced at save time by the api AND re-checked by the
   * adapter at request time. Belt-and-braces on purpose for values that get
   * interpolated into a URL: Azure's resourceName becomes the upstream
   * HOSTNAME, so a value containing a slash or dot could redirect an org's
   * traffic — and its api key — to a server of the submitter's choosing.
   * Defining it here means the two checks cannot drift apart.
   */
  pattern?: RegExp;
  /** Why `pattern` rejected the value, in the user's terms. */
  patternHelp?: string;
}

/** The single opaque API key that OpenAI/Anthropic/Gemini all use. */
const API_KEY_FIELD: CredentialField = {
  name: "apiKey",
  label: "API key",
  secret: true,
};

/**
 * Providers an org can bring their own key for, keyed by ADAPTER slug — the
 * same vocabulary backend/proxy/src/adapters/registry.ts routes on and that
 * the *_UPSTREAM_KEY env vars use, NOT the "chatgpt"/"claude" assistant labels
 * agents are created with (see registry.ts's assistantAdapterSlugs for why the
 * two differ). The label here is the user-facing name for the dashboard.
 */
export const UPSTREAM_PROVIDERS = [
  {
    slug: "openai",
    label: "OpenAI (ChatGPT)",
    fields: [{ ...API_KEY_FIELD, placeholder: "sk-…" }],
  },
  {
    slug: "claude",
    label: "Anthropic (Claude)",
    fields: [{ ...API_KEY_FIELD, placeholder: "sk-ant-…" }],
  },
  {
    slug: "gemini",
    label: "Google (Gemini)",
    fields: [{ ...API_KEY_FIELD, placeholder: "AIza…" }],
  },
  {
    slug: "azure",
    label: "Azure OpenAI",
    fields: [
      { ...API_KEY_FIELD, placeholder: "32-character key from the Azure portal" },
      {
        name: "resourceName",
        label: "Resource name",
        secret: false,
        placeholder: "my-company",
        // Deliberately the bare name, not the full URL: the adapter builds
        // https://{resourceName}.openai.azure.com itself, so accepting a whole
        // URL here would mean two ways to express the same thing and a class
        // of "did they include https://?" bugs.
        help: "Just the name from https://<name>.openai.azure.com — not the full URL.",
        pattern: /^[a-zA-Z0-9-]+$/,
        patternHelp:
          "Use only the resource name itself — letters, numbers and hyphens, with no https:// or dots.",
      },
    ],
  },
  {
    slug: "bedrock",
    label: "AWS Bedrock",
    fields: [
      {
        name: "accessKeyId",
        label: "Access key ID",
        secret: true,
        placeholder: "AKIA…",
      },
      { name: "secretAccessKey", label: "Secret access key", secret: true },
      {
        name: "sessionToken",
        label: "Session token",
        secret: true,
        help: "Only for temporary (STS) credentials — leave blank for a long-lived IAM user.",
      },
      {
        name: "region",
        label: "Region",
        secret: false,
        placeholder: "us-east-1",
        help: "The region your Bedrock models are enabled in.",
        // Same hostname-interpolation risk as Azure's resourceName: this
        // becomes part of bedrock-runtime.{region}.amazonaws.com.
        pattern: /^[a-z0-9-]+$/,
        patternHelp: "An AWS region id such as us-east-1 — lowercase, no spaces.",
      },
    ],
  },
] as const;

export type UpstreamProviderSlug = (typeof UPSTREAM_PROVIDERS)[number]["slug"];

/**
 * The credential fields a provider needs, or an empty list for a slug this
 * build doesn't know. Callers that iterate this (the api's save validation,
 * the dashboard's key form) therefore degrade to "no fields" rather than
 * throwing on an unrecognised provider.
 */
export function credentialFieldsFor(slug: string): readonly CredentialField[] {
  return UPSTREAM_PROVIDERS.find((p) => p.slug === slug)?.fields ?? [];
}

/**
 * Fields the org must actually supply. `sessionToken` is the only optional one
 * today (AWS long-lived IAM users don't have one), and it's marked optional by
 * carrying a `help` that says so — rather than adding a `required` flag whose
 * only false value would be this single field.
 */
export function isOptionalCredentialField(field: CredentialField): boolean {
  return field.name === "sessionToken";
}

/**
 * A decrypted credential, as the proxy's vault hands it to an adapter.
 *
 * Split rather than one flat bag so the two halves keep their different
 * handling rules visible at the point of use: `secrets` came out of the
 * encrypted column and must never be logged or returned over the api, while
 * `config` is ordinary data that already appears in request URLs.
 */
export interface UpstreamCredential {
  secrets: Readonly<Record<string, string>>;
  config: Readonly<Record<string, string>>;
}

/**
 * The field whose value the dashboard shows a masked hint of ("sk-…7mQ4").
 * The first secret field, by convention — for Bedrock that's the access key
 * id, which is the half of an AWS credential pair a human actually recognises.
 */
export function hintFieldFor(slug: string): string | null {
  return credentialFieldsFor(slug).find((f) => f.secret)?.name ?? null;
}

export function isUpstreamProviderSlug(value: string): value is UpstreamProviderSlug {
  return UPSTREAM_PROVIDERS.some((p) => p.slug === value);
}

/**
 * Bridges the descriptive assistant label an agent is created with (dashboard's
 * PROVIDERS list, stored as agents.provider_slug — "chatgpt"/"claude"/"gemini")
 * to the ADAPTER slug that routes proxy requests and names org_upstream_keys
 * rows and *_UPSTREAM_KEY env vars ("openai"/"claude"/"gemini"). The two
 * vocabularies differ on purpose (the label is consumer-facing, the adapter
 * slug is a routing/storage detail) — this is the one source of truth for the
 * mapping, consumed by backend/proxy/src/adapters/registry.ts (the proxy's
 * authorization gate) and backend/api/src/routes/agents.ts (validating that an
 * agent's chosen upstream_key_id actually belongs to a key for its provider).
 * Keep in sync with frontend/dashboard/lib/agent-options.ts's PROVIDERS list.
 */
export const ASSISTANT_ADAPTER_SLUGS: Readonly<Record<string, string>> = {
  chatgpt: "openai",
  claude: "claude",
  gemini: "gemini",
  // Azure and Bedrock are the two cases where the assistant label and the
  // adapter slug coincide — they name a HOSTING platform rather than a
  // model family, so there's no consumer-facing alias to translate to.
  azure: "azure",
  bedrock: "bedrock",
};

/**
 * Env var holding Tollgate's own shared key for a provider, e.g.
 * "openai" -> OPENAI_UPSTREAM_KEY. This is the deployment-wide fallback used
 * for orgs that haven't configured BYOK; see backend/proxy/src/lib/vault.ts.
 */
export function upstreamKeyEnvVar(slug: string): string {
  return `${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_UPSTREAM_KEY`;
}

/**
 * At-rest storage format for a BYOK key. Deliberately NOT the one-way SHA-256
 * treatment agent tokens get (backend/api/src/lib/tokens.ts): the proxy must
 * hand the real plaintext key to OpenAI/Anthropic on every forwarded request,
 * so this has to be reversible. AES-256-GCM (an AEAD) — hence an iv and an
 * auth tag alongside the ciphertext, all base64. The encryption key itself
 * lives in VAULT_ENCRYPTION_KEY on the server, never in the database.
 */
export interface UpstreamKeyCiphertext {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Non-secret display hint stored alongside the ciphertext ("sk-…7mQ4"), so the
 * dashboard can show *which* key is set without the plaintext ever being
 * readable again. Never enough to reconstruct the key.
 */
export function maskUpstreamKey(key: string): string {
  const trimmed = key.trim();
  const tail = trimmed.slice(-4);
  const prefix = trimmed.startsWith("sk-ant-")
    ? "sk-ant-"
    : trimmed.startsWith("sk-")
      ? "sk-"
      : "";
  return `${prefix}…${tail}`;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * Freeze lifecycle:
 * - active:      requests evaluated normally
 * - pending:     low-confidence anomaly — running, awaiting operator review
 * - soft_frozen: new operations denied; in-flight + completion ops drain (SIGTERM)
 * - hard_frozen: total revocation (SIGKILL)
 * - archived:    retired; token revoked
 */
export type AgentStatus =
  | "active"
  | "pending"
  | "soft_frozen"
  | "hard_frozen"
  | "archived";

export interface Agent {
  id: string;
  orgId: string;
  name: string;
  /** Descriptive only: which provider this agent was provisioned to call.
   *  Not enforced by the proxy — a token still authenticates against any
   *  provider slug the registry knows. */
  providerSlug: string;
  status: AgentStatus;
  /** Policy this agent inherits from (templates/inheritance model). */
  policyId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

export type BudgetWindow = "daily" | "weekly" | "monthly";

/**
 * Policy is data, not deployment: rows in Postgres, hot copies in Redis,
 * mutable at runtime through the api service.
 */
export interface Policy {
  id: string;
  orgId: string;
  name: string;
  /** Budget in USD cents to avoid float drift. */
  budgetCents: number;
  budgetWindow: BudgetWindow;
  /** Requests per minute; null = unlimited. */
  rateLimitRpm: number | null;
  /** Upstream endpoint allowlist (proxy-emulated scoping); null = all. */
  endpointAllowlist: string[] | null;
  /** Tool/function names an agent's LLM is never allowed to be told it can
   *  call — enforced on the RESPONSE, after the upstream call, since that's
   *  the only place a tool call exists (see ProviderAdapter.extractToolCalls).
   *  null = nothing blocked. Denylist rather than allowlist so adopting this
   *  doesn't require enumerating every tool an agent already uses. */
  blockedTools: string[] | null;
  /** Prepended to every request this agent sends, so the agent's behavior is
   *  configured once in Tollgate rather than duplicated in every caller's own
   *  code — see ProviderAdapter.injectSystemPrompt. null = nothing injected;
   *  the caller's own request goes through exactly as sent. */
  systemPrompt: string | null;
  /** Tools this agent's requests advertise to the model, injected the same
   *  way systemPrompt is — see ProviderAdapter.injectToolDefinitions. null =
   *  nothing added; the caller's own tools (if any) go through unchanged.
   *  Any entry whose name is also in blockedTools is skipped at injection
   *  time rather than stored filtered here — see proxy.ts's gate — since
   *  advertising a tool the agent can never actually use would just be
   *  confusing the model with a dead option. */
  toolDefinitions: ToolDefinition[] | null;
  failMode: FailMode;
  /** Ceiling-on-ceiling: max budget a sub-admin may set under this policy. */
  maxBudgetCents: number | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// SpendEvent
// ---------------------------------------------------------------------------

/**
 * Why a spend_events row exists. Mostly the proxy's verdict on one forwarded
 * request — but the last two are an OPERATOR's decision on a blocked tool
 * call, written by the api rather than the proxy.
 *
 * They share this table (and therefore the dashboard's activity log) on
 * purpose: "the agent was blocked from deleting a customer" and "Dana let it
 * through once" are the same story, and splitting them across two feeds would
 * mean an auditor reading the log couldn't see who authorized what.
 */
export type SpendDecision =
  | "allowed"
  | "denied_budget"
  | "denied_rate"
  | "denied_endpoint"
  | "denied_frozen"
  | "denied_tool"
  | "approval_granted"
  | "approval_denied";

/** One governed request — the immutable audit-log unit. */
export interface SpendEvent {
  id: string;
  agentId: string;
  providerId: string;
  endpoint: string;
  method: string;
  /** Estimated cost reserved pre-request (credit-card-hold model). */
  estimatedCostCents: number | null;
  /** Settled cost once the response is metered; null while in flight. */
  actualCostCents: number | null;
  decision: SpendDecision;
  /** Generated if the agent didn't supply one; freeze-reconciliation key. */
  idempotencyKey: string;
  latencyMs: number | null;
  upstreamStatus: number | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Enforcement keys (Redis)
// ---------------------------------------------------------------------------

/**
 * Pure key/unit helpers shared by proxy (enforcement) and api (freeze +
 * dashboard reads) so both services derive identical Redis keys. No Node-only
 * APIs here — this file is also pulled into the (browser-side) dashboard.
 */

/**
 * Money is carried as cents (fractional) at the provider seam, but the Redis
 * spend counter is an integer bumped with an atomic INCRBY. We store
 * micro-cents (cents × 1e6): fine-grained enough that a sub-cent request never
 * rounds to zero, and still a plain integer. Only the Redis counter uses this
 * scale — spend_events rows store plain fractional cents.
 */
export const MICROCENTS_PER_CENT = 1_000_000;

export function centsToMicroCents(cents: number): number {
  return Math.round(cents * MICROCENTS_PER_CENT);
}

export function microCentsToCents(microCents: number): number {
  return microCents / MICROCENTS_PER_CENT;
}

/** UTC year-month, e.g. "2026-07", used to scope the monthly spend counter. */
export function currentMonth(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Redis key for an agent's spend in a given month: spend:{agent_id}:{month}. */
export function spendKey(agentId: string, month: string): string {
  return `spend:${agentId}:${month}`;
}

/**
 * Redis key for an agent's LLM token usage (prompt + completion, summed) in a
 * given month: tokens:{agent_id}:{month}. A separate counter from spend —
 * money and token count are metered independently, since a provider adapter
 * can report one without the other (see ProviderCost).
 */
export function tokenKey(agentId: string, month: string): string {
  return `tokens:${agentId}:${month}`;
}

/**
 * Redis key for an agent's current in-flight request body: transient
 * "what's happening right now" state for the dashboard sidebar. Written by
 * the proxy with a short TTL before forwarding, and never persisted to
 * Postgres — this is the one place in the system that holds prompt text at
 * all, and only briefly.
 */
export function currentPromptKey(agentId: string): string {
  return `current_prompt:${agentId}`;
}

/**
 * Redis key for the freeze fast-path: set (any value) while an agent is
 * soft/hard frozen, deleted on unfreeze. Postgres `agents.status` remains the
 * system of record and is still checked on every request; this key is an
 * additional, redundant check the api's freeze/unfreeze endpoints update in
 * lockstep, so enforcement doesn't depend on Postgres replication/visibility
 * alone.
 */
export function freezeKey(agentId: string): string {
  return `frozen:${agentId}`;
}

/**
 * Redis key for a one-off human approval of a tool the agent's policy
 * otherwise blocks: set with a TTL when an operator approves a pending
 * request, checked by the proxy's tool gate before it denies.
 *
 * Deliberately TTL'd rather than permanent, and deliberately NOT a mutation
 * of Policy.blockedTools: approving one escalation should let the agent's
 * retry through, not silently un-block that tool forever. The blocklist stays
 * the standing policy; this is the temporary exception to it.
 */
export function toolGrantKey(agentId: string, toolName: string): string {
  return `toolgrant:${agentId}:${toolName}`;
}

// ---------------------------------------------------------------------------
// Tool approval requests
// ---------------------------------------------------------------------------

/** Lifecycle of one escalation raised by the proxy's tool gate. */
export type ToolApprovalStatus = "pending" | "approved" | "denied";

/**
 * A blocked tool call an operator can approve or reject. Raised by the proxy
 * (which never resolves one) and resolved from the dashboard through the api
 * — the two halves of the escalation path that turns a hard tool denial into
 * a human decision.
 */
export interface ToolApprovalRequest {
  id: string;
  orgId: string;
  agentId: string;
  /** Tool/function name exactly as the provider named it. */
  toolName: string;
  status: ToolApprovalStatus;
  createdAt: string;
  /** Null while pending. */
  resolvedAt: string | null;
  /** User id of whoever approved/denied it; null while pending. */
  resolvedBy: string | null;
}

// ---------------------------------------------------------------------------
// Proof-of-life contracts (used by /health on proxy + api and the dashboard)
// ---------------------------------------------------------------------------

export type DependencyState = "ok" | "error";

export interface DependencyHealth {
  state: DependencyState;
  latencyMs: number;
  detail?: string;
}

export interface HealthReport {
  service: "proxy" | "api";
  ok: boolean;
  uptimeSec: number;
  timestamp: string;
  redis: DependencyHealth;
  postgres: DependencyHealth;
}
