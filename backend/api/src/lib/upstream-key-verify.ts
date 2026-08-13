import type { UpstreamCredential, UpstreamProviderSlug } from "@tollgate/shared";

/**
 * Validate-before-save: proves a submitted BYOK key actually works against the
 * real provider BEFORE it's encrypted and stored.
 *
 * Why this matters more than it looks: a typo'd or revoked key that's saved
 * without verification fails silently — not here, but later, on every agent
 * under that org, at whatever moment their traffic next runs. The failure would
 * surface as upstream 401s far from the settings page that caused them. So the
 * save path refuses to persist anything that can't authenticate right now.
 *
 * Both providers are probed with their models-list endpoint rather than a
 * completion: it authenticates identically, but consumes no tokens and costs
 * the org nothing to validate.
 */

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Anthropic requires an explicit API version on every request, including this
 *  one. Matches backend/proxy/src/adapters/claude.ts's pinned version. */
const ANTHROPIC_VERSION = "2023-06-01";

interface ProbeSpec {
  url: string;
  headers: Record<string, string>;
  /** User-facing provider name for error copy. */
  displayName: string;
}

/**
 * How to prove a credential works, per provider. Returning null means "this
 * provider has no cheap read-only probe" — the caller then skips verification
 * rather than inventing one that costs the org money or gives a false pass.
 */
function probeSpec(slug: UpstreamProviderSlug, credential: UpstreamCredential): ProbeSpec | null {
  const apiKey = credential.secrets["apiKey"] ?? "";

  if (slug === "claude") {
    return {
      url: "https://api.anthropic.com/v1/models?limit=1",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION },
      displayName: "Anthropic",
    };
  }

  if (slug === "gemini") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/models",
      headers: { "x-goog-api-key": apiKey },
      displayName: "Google",
    };
  }

  if (slug === "azure") {
    const resourceName = credential.config["resourceName"];
    // parseSaveBody already enforced presence and the hostname-safe pattern,
    // so this is a belt-and-braces guard rather than an expected branch.
    if (resourceName === undefined) return null;
    return {
      // Lists the resource's deployments: authenticates exactly like a
      // completion would, consumes no tokens, and additionally proves the
      // resource name is real — the one thing an api key alone can't.
      url: `https://${resourceName}.openai.azure.com/openai/deployments?api-version=2023-03-15-preview`,
      headers: { "api-key": apiKey },
      displayName: "Azure OpenAI",
    };
  }

  if (slug === "bedrock") {
    // AWS authenticates with a SigV4 signature over the request rather than a
    // static header, so there's no probe that can be built here from headers
    // alone. Verified at first use instead.
    return null;
  }

  if (slug === "openai") {
    return {
      url: "https://api.openai.com/v1/models",
      headers: { authorization: `Bearer ${apiKey}` },
      displayName: "OpenAI",
    };
  }

  if (slug === "anthropic-admin") {
    const adminApiKey = credential.secrets["adminApiKey"] ?? "";
    return {
      // Cheap, read-only, and specific to Admin keys — a regular "claude"
      // key (sk-ant-...) gets a 401 here even though it authenticates fine
      // against /v1/models, which is exactly the mix-up this probe exists to
      // catch before the poller finds out at 3am.
      url: "https://api.anthropic.com/v1/organizations/me",
      headers: { "x-api-key": adminApiKey, "anthropic-version": ANTHROPIC_VERSION },
      displayName: "Anthropic",
    };
  }

  // "mcp-downstream", "salesforce-connected-app": neither authenticates with
  // a bare apiKey secret (see their field definitions in @tollgate/shared's
  // UPSTREAM_PROVIDERS), so falling through to the OpenAI probe above would
  // send an empty bearer token and always report a false rejection. No cheap
  // read-only probe exists for these yet either — same "verified at first
  // use" tradeoff as Bedrock above.
  return null;
}

/** Pull the provider's own error message out of its JSON envelope. Both use
 *  `{ error: { message } }`, but never assume — fall back to the raw body. */
function extractProviderMessage(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null) return null;
    const error = (parsed as Record<string, unknown>)["error"];
    if (typeof error !== "object" || error === null) return null;
    const message = (error as Record<string, unknown>)["message"];
    return typeof message === "string" ? message : null;
  } catch {
    return null;
  }
}

export async function verifyUpstreamKey(
  slug: UpstreamProviderSlug,
  credential: UpstreamCredential,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const spec = probeSpec(slug, credential);
  // No cheap probe exists for this provider (see probeSpec). Storing
  // unverified is the lesser evil versus either refusing the provider
  // outright or burning the org's money on a real completion to check.
  if (spec === null) return { ok: true };

  let res: Response;
  try {
    res = await fetchImpl(spec.url, { method: "GET", headers: spec.headers });
  } catch {
    // Network-level failure: we genuinely don't know whether the key is good,
    // so don't store it and don't claim it was rejected either.
    return {
      ok: false,
      reason: `Couldn't reach ${spec.displayName} to verify the key. Check connectivity and try again.`,
    };
  }

  if (res.ok) return { ok: true };

  const body = await res.text().catch(() => "");
  const providerMessage = extractProviderMessage(body);

  // 401/403 is the common, actionable case — say plainly that the provider
  // rejected it, and pass their own wording through rather than inventing one.
  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      reason: providerMessage
        ? `${spec.displayName} rejected that key: ${providerMessage}`
        : `${spec.displayName} rejected that key.`,
    };
  }

  return {
    ok: false,
    reason: providerMessage
      ? `${spec.displayName} returned ${res.status}: ${providerMessage}`
      : `${spec.displayName} returned an unexpected ${res.status} while verifying the key.`,
  };
}
