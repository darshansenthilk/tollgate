import { ASSISTANT_ADAPTER_SLUGS, type ProviderAdapter } from "@tollgate/shared";
import { openaiAdapter } from "./openai.js";
import { claudeAdapter } from "./claude.js";
import { geminiAdapter } from "./gemini.js";
import { azureAdapter } from "./azure.js";
import { bedrockAdapter } from "./bedrock.js";

/**
 * The provider registry: slug → adapter. The hot path looks an adapter up here
 * by `req.params.providerSlug` and calls only interface methods on it. Adding a
 * provider is a one-line change to this map plus a new adapter file — the route
 * handler never learns a provider's name.
 */
export type ProviderRegistry = ReadonlyMap<string, ProviderAdapter>;

export function buildRegistry(
  adapters: readonly ProviderAdapter[],
): ProviderRegistry {
  const map = new Map<string, ProviderAdapter>();
  for (const adapter of adapters) {
    if (map.has(adapter.slug)) {
      throw new Error(`duplicate provider slug in registry: ${adapter.slug}`);
    }
    map.set(adapter.slug, adapter);
  }
  return map;
}

/** Default registry wired for production. */
export const providers: ProviderRegistry = buildRegistry([
  openaiAdapter,
  claudeAdapter,
  geminiAdapter,
  azureAdapter,
  bedrockAdapter,
]);

/**
 * The descriptive assistant label an agent is created with (dashboard's
 * PROVIDERS list, stored as agents.provider_slug) doesn't share a vocabulary
 * with the real adapter slug that label is meant to authorize — "chatgpt" the
 * label vs. "openai" the adapter, by design, since the label is
 * consumer-facing and the adapter slug is a routing detail. This map is the
 * one place that bridges the two, so the proxy's assistant gate
 * (registerProxyRoute) can check "is this agent even allowed to call the
 * adapter this request resolved to" without hardcoding provider names into
 * the route handler itself — it stays an injected dependency like the
 * registry.
 *
 * Sourced from @tollgate/shared's ASSISTANT_ADAPTER_SLUGS — the single source
 * of truth, also consumed by backend/api/src/routes/agents.ts to validate an
 * agent's chosen upstream_key_id against its provider.
 */
export const assistantAdapterSlugs: ReadonlyMap<string, string> = new Map(
  Object.entries(ASSISTANT_ADAPTER_SLUGS),
);
