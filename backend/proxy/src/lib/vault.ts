import type { Pool } from "pg";
import { upstreamKeyEnvVar } from "@tollgate/shared";
import { decryptUpstreamKey } from "./upstream-key-crypto.js";

/**
 * Resolves the real upstream API key a request forwards with.
 *
 * Org-scoped (BYOK): an org can store its own OpenAI/Anthropic key(s) via the
 * api's /v1/upstream-keys, so its agents' usage bills to that org's provider
 * account. The org is established solely by the agent's Tollgate token (see
 * lib/agents.ts's AuthedAgent.orgId) — never by anything the caller sends.
 *
 * MULTI-KEY: an org can store several keys per provider (distinct labels), so
 * a single "the org's key" no longer exists — each agent picks ONE by id
 * (agents.upstream_key_id, resolved by the caller and passed in as `keyId`).
 *
 * RESOLUTION ORDER, and why:
 *   1. keyId is null (agent hasn't been assigned a specific stored key) ->
 *      Tollgate's deployment-wide env key (OPENAI_UPSTREAM_KEY etc) straight
 *      away. Deliberately does NOT guess among an org's several stored keys
 *      for this provider — an unpicked key is treated as "not opted in", the
 *      same as having zero stored keys, keeping BYOK strictly opt-in.
 *   2. keyId is set but doesn't resolve to a row for this exact org+provider
 *      (deleted, reassigned to another provider, wrong org) -> deny (null).
 *      Deliberately NOT a fallback to env: the agent was explicitly pointed at
 *      a key, so silently billing Tollgate's shared key instead would be a
 *      surprise charge to us and a silent violation of the org's intent.
 *   3. Row found but CANNOT be decrypted -> deny (null), same reasoning.
 *   4. Row found and decrypts -> use it.
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
  getUpstreamKey(orgId: string, slug: string, keyId: string | null): Promise<string | null>;
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
    async getUpstreamKey(orgId, slug, keyId) {
      // Step 1 above: no key assigned to this agent -> env fallback, no guessing.
      if (keyId === null) return envKey(slug, env);

      const result = await pool.query<StoredKeyRow>(
        `SELECT encrypted_key, iv, auth_tag
           FROM org_upstream_keys
          WHERE id = $1 AND org_id = $2 AND provider_slug = $3`,
        [keyId, orgId, slug],
      );

      const row = result.rows[0];
      // Step 2 above: assigned key missing/deleted/mismatched -> fail closed.
      // Deliberately doesn't fire onDecryptFailure — that alarm is for vault
      // corruption (step 3), not a stale reference an org's own edit caused.
      if (row === undefined) return null;

      const plaintext = decryptUpstreamKey({
        ciphertext: row.encrypted_key,
        iv: row.iv,
        authTag: row.auth_tag,
      });

      if (plaintext === null) {
        // Step 3 above: fail closed rather than fall back.
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
    async getUpstreamKey(_orgId, slug, _keyId) {
      return envKey(slug, env);
    },
  };
}
