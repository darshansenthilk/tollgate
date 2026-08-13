import type { PlatformConnector } from "./types.js";
import { anthropicManagedAgentsConnector } from "./anthropic-managed-agents.js";

/**
 * The connector registry: agents.host_platform value -> connector. Mirrors
 * backend/proxy/src/adapters/registry.ts's buildRegistry() exactly, down to
 * throwing on a duplicate slug — same reasoning: a silent second registration
 * shadowing the first is a startup-time bug, not something to let through.
 */
export type ConnectorRegistry = ReadonlyMap<string, PlatformConnector>;

export function buildConnectorRegistry(
  connectors: readonly PlatformConnector[],
): ConnectorRegistry {
  const map = new Map<string, PlatformConnector>();
  for (const connector of connectors) {
    if (map.has(connector.slug)) {
      throw new Error(`duplicate platform connector slug in registry: ${connector.slug}`);
    }
    map.set(connector.slug, connector);
  }
  return map;
}

/** Default registry wired for production. Keyed by the same string values
 *  as agents.host_platform / ALLOWED_HOST_PLATFORMS in routes/agents.ts. */
export const connectors: ConnectorRegistry = buildConnectorRegistry([
  anthropicManagedAgentsConnector,
]);
