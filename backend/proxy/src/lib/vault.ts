import type { Pool } from "pg";
import { upstreamKeyEnvVar } from "@tollgate/shared";
import { decryptUpstreamKey } from "./upstream-key-crypto.js";

/**
 * Resolves the real upstream API key a request forwards with.
 *
 * Org-scoped (BYOK): an org can store its own OpenAI/Anthropic key via the
 * api's /v1/upstream-keys, so its agents' usage bills to that org's provider
 * account. The org is established solely by the agent's Tollgate token (see
 * lib/agents.ts's AuthedAgent.orgId) — never by anything the caller sends.
 *
 * RESOLUTION ORDER, and why:
 *   1. The org's own stored key, if present -> decrypt and use it.
 *   2. If the org has a stored key but it CANNOT be decrypted -> deny (null).
 *      Deliberately NOT a fallback: the org asked for their key to be used, so
 *      silently billing Tollgate's shared key instead would be both a surprise
 *      charge to us and a silent violation of their intent. Fail closed and let
 *      the route return upstream_key_unavailable.
 *   3. No stored key at all -> Tollgate's deployment-wide env key
 *      (OPENAI_UPSTREAM_KEY etc). This makes BYOK strictly opt-in: every org
 *      that hasn't configured one keeps working exactly as before.
 *
 * HOT PATH COST: one extra indexed SELECT per proxied request, on top of the
 * token lookup that already happens. Not cached on purpose — a key that's been
 * rotated or deleted has to take effect on the very next request, and any cache
 * would need cross-process invalidation (multiple proxy instances) to promise
 * that. Correctness over a few milliseconds until there's a measured reason to
 * revisit; the natural next step would be a short-TTL Redis entry invalidated
 * by the api's save/delete handlers.
 */
export interface Vault {
  getUpstreamKey(orgId: string, slug: string): Promise<string | null>;
}

/** The env fallback, resolved per call so a redeploy-free env change is picked
 *  up (and so tests can set it). */
function envKey(slug: string, env: NodeJS.ProcessEnv): string | null {
  const value = env[upstreamKeyEnvVar(slug)];
  return value === undefined || value === "" ? null : value;
}

interface StoredKeyRow {
  encrypted_key: string;
  iv: string;
  auth_tag: string;
}

/**
 * Production vault: org-stored keys from Postgres, falling back to env.
 *
 * `onDecryptFailure` is injected so the caller (index.ts) can log a real alarm
 * — an undecryptable stored key means every request for that org is now being
 * denied, which is exactly the kind of failure that must not be silent.
 */
export function pgVault(
  pool: Pool,
  options: {
    env?: NodeJS.ProcessEnv;
    onDecryptFailure?: (orgId: string, slug: string) => void;
  } = {},
): Vault {
  const env = options.env ?? process.env;

  return {
    async getUpstreamKey(orgId, slug) {
      const result = await pool.query<StoredKeyRow>(
        `SELECT encrypted_key, iv, auth_tag
           FROM org_upstream_keys
          WHERE org_id = $1 AND provider_slug = $2`,
        [orgId, slug],
      );

      const row = result.rows[0];
      if (row === undefined) return envKey(slug, env);

      const plaintext = decryptUpstreamKey({
        ciphertext: row.encrypted_key,
        iv: row.iv,
        authTag: row.auth_tag,
      });

      if (plaintext === null) {
        // Step 2 above: fail closed rather than fall back.
        options.onDecryptFailure?.(orgId, slug);
        return null;
      }

      return plaintext;
    },
  };
}

/**
 * Env-only vault, ignoring org entirely — the pre-BYOK behavior. Kept for
 * tests and for running the proxy without a database-backed vault.
 */
export function envVault(env: NodeJS.ProcessEnv = process.env): Vault {
  return {
    async getUpstreamKey(_orgId, slug) {
      return envKey(slug, env);
    },
  };
}
