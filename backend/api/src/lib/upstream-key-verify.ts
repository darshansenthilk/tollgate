import type { UpstreamProviderSlug } from "@tollgate/shared";

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

function probeSpec(slug: UpstreamProviderSlug, key: string): ProbeSpec {
  if (slug === "claude") {
    return {
      url: "https://api.anthropic.com/v1/models?limit=1",
      headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      displayName: "Anthropic",
    };
  }
  return {
    url: "https://api.openai.com/v1/models",
    headers: { authorization: `Bearer ${key}` },
    displayName: "OpenAI",
  };
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
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  const spec = probeSpec(slug, key);

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
