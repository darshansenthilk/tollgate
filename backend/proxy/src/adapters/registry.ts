import type { ProviderAdapter } from "@tollgate/shared";
import { openaiAdapter } from "./openai.js";

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
export const providers: ProviderRegistry = buildRegistry([openaiAdapter]);
