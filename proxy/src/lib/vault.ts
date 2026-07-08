/**
 * Resolves the real upstream API key for a provider. In this milestone the
 * "vault" is env vars, keyed by slug convention: OPENAI → OPENAI_UPSTREAM_KEY.
 * Keyed by slug (not a provider name in the route), so a new provider needs no
 * code change here either.
 */
export interface Vault {
  getUpstreamKey(slug: string): string | null;
}

function envVarName(slug: string): string {
  return `${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_UPSTREAM_KEY`;
}

/** Production vault reading from process.env. */
export function envVault(env: NodeJS.ProcessEnv = process.env): Vault {
  return {
    getUpstreamKey(slug) {
      const value = env[envVarName(slug)];
      return value === undefined || value === "" ? null : value;
    },
  };
}
