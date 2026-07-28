import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  UPSTREAM_PROVIDERS,
  isUpstreamProviderSlug,
  maskUpstreamKey,
  upstreamKeyEnvVar,
  type UpstreamProviderSlug,
} from "@tollgate/shared";
import { db } from "../db/client.js";
import { orgUpstreamKeys } from "../db/schema.js";
import {
  encryptUpstreamKey,
  isVaultConfigured,
  VaultKeyUnavailableError,
} from "../lib/upstream-key-crypto.js";
import { verifyUpstreamKey } from "../lib/upstream-key-verify.js";

/**
 * BYOK management plane: an org supplies its own OpenAI/Anthropic key so
 * upstream usage bills to their provider account instead of Tollgate's shared
 * deployment key.
 *
 * Write-once-reveal-never, exactly like agent tokens: a saved key is never
 * returned by any endpoint here. The status route reports only whether one is
 * set plus a non-secret hint ("sk-…7mQ4"). Unlike agent tokens, the plaintext
 * IS recoverable internally — the proxy has to replay it upstream — but it's
 * never exposed back over the management API.
 *
 * Every route is gated by the requireAuth preHandler (index.ts), which 401s
 * anonymous callers and stamps req.activeOrgId — so the `!` below is safe, and
 * org scoping (cross-account isolation) hangs off that value, never client
 * input. Same pattern as routes/agents.ts.
 */

interface SaveKeyBody {
  providerSlug: UpstreamProviderSlug;
  key: string;
}

type ParseResult =
  | { ok: true; body: SaveKeyBody }
  | { ok: false; error: "invalid_body" | "invalid_provider_slug" };

function parseSaveBody(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null) return { ok: false, error: "invalid_body" };
  const rec = body as Record<string, unknown>;

  const providerSlug = rec["providerSlug"];
  const key = rec["key"];

  if (typeof providerSlug !== "string") return { ok: false, error: "invalid_body" };
  if (!isUpstreamProviderSlug(providerSlug)) {
    return { ok: false, error: "invalid_provider_slug" };
  }
  if (typeof key !== "string" || key.trim() === "") return { ok: false, error: "invalid_body" };

  return { ok: true, body: { providerSlug, key: key.trim() } };
}

export function registerUpstreamKeyRoutes(app: FastifyInstance): void {
  /**
   * Status for every supported provider. Deliberately returns one entry per
   * provider (not just the configured ones) so the dashboard can render the
   * full "Set / Not set" matrix from a single call.
   *
   * `fallbackAvailable` tells the user what actually happens today for a
   * provider they haven't configured: true means Tollgate's shared key covers
   * them, false means their agents for that provider can't reach upstream at
   * all until they add one.
   */
  app.get("/v1/upstream-keys", async (req) => {
    const orgId = req.activeOrgId!;

    const rows = await db
      .select({
        providerSlug: orgUpstreamKeys.providerSlug,
        keyHint: orgUpstreamKeys.keyHint,
        updatedAt: orgUpstreamKeys.updatedAt,
      })
      .from(orgUpstreamKeys)
      .where(eq(orgUpstreamKeys.orgId, orgId));

    const bySlug = new Map(rows.map((r) => [r.providerSlug, r]));

    return {
      // Surfaced so the dashboard can explain a save failure that has nothing
      // to do with the user's key (the deployment simply can't encrypt yet).
      vaultConfigured: isVaultConfigured(),
      providers: UPSTREAM_PROVIDERS.map((provider) => {
        const row = bySlug.get(provider.slug);
        return {
          slug: provider.slug,
          label: provider.label,
          isSet: row !== undefined,
          // Never the key itself — see the module doc comment.
          keyHint: row?.keyHint ?? null,
          updatedAt: row?.updatedAt?.toISOString() ?? null,
          fallbackAvailable: process.env[upstreamKeyEnvVar(provider.slug)] !== undefined,
        };
      }),
    };
  });

  /**
   * Save (or rotate) this org's key for one provider. The key is verified
   * against the real provider BEFORE anything is written — see
   * lib/upstream-key-verify.ts for why storing an unverified key is a trap.
   */
  app.put<{ Body: unknown }>("/v1/upstream-keys", async (req, reply) => {
    const orgId = req.activeOrgId!;

    const parsed = parseSaveBody(req.body);
    if (!parsed.ok) {
      reply.code(400);
      return parsed.error === "invalid_provider_slug"
        ? {
            error: "invalid_provider_slug",
            message: `providerSlug must be one of: ${UPSTREAM_PROVIDERS.map((p) => p.slug).join(", ")}`,
          }
        : { error: "invalid_body" };
    }
    const { providerSlug, key } = parsed.body;

    // Fail before touching the network if this deployment can't store a key
    // anyway — otherwise we'd send the user's key to the provider only to
    // discard it.
    if (!isVaultConfigured()) {
      reply.code(503);
      return {
        error: "vault_not_configured",
        message:
          "This Tollgate deployment can't store provider keys yet (VAULT_ENCRYPTION_KEY is unset on the api service).",
      };
    }

    const verification = await verifyUpstreamKey(providerSlug, key);
    if (!verification.ok) {
      reply.code(400);
      return { error: "key_rejected", message: verification.reason };
    }

    let encrypted;
    try {
      encrypted = encryptUpstreamKey(key);
    } catch (err) {
      // isVaultConfigured() passed a moment ago, so this is genuinely
      // unexpected — surface it rather than storing something unusable.
      req.log.error({ err }, "upstream key encryption failed");
      reply.code(503);
      return {
        error: "vault_not_configured",
        message:
          err instanceof VaultKeyUnavailableError
            ? err.message
            : "Couldn't encrypt the key for storage.",
      };
    }

    const keyHint = maskUpstreamKey(key);
    const now = new Date();

    // Upsert on the (org, provider) unique index so rotating a key replaces the
    // existing row rather than leaving two the proxy could pick between.
    await db
      .insert(orgUpstreamKeys)
      .values({
        id: randomUUID(),
        orgId,
        providerSlug,
        encryptedKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyHint,
      })
      .onConflictDoUpdate({
        target: [orgUpstreamKeys.orgId, orgUpstreamKeys.providerSlug],
        set: {
          encryptedKey: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyHint,
          updatedAt: now,
        },
      });

    // Response mirrors one entry of the status route — never the key.
    return { slug: providerSlug, isSet: true, keyHint, updatedAt: now.toISOString() };
  });

  /**
   * Remove this org's key for a provider, reverting its agents to whatever the
   * deployment fallback is (Tollgate's shared key, or nothing — see the status
   * route's fallbackAvailable).
   */
  app.delete<{ Params: { providerSlug: string } }>(
    "/v1/upstream-keys/:providerSlug",
    async (req, reply) => {
      const orgId = req.activeOrgId!;
      const { providerSlug } = req.params;

      if (!isUpstreamProviderSlug(providerSlug)) {
        reply.code(400);
        return { error: "invalid_provider_slug" };
      }

      const deleted = await db
        .delete(orgUpstreamKeys)
        .where(
          and(
            eq(orgUpstreamKeys.orgId, orgId),
            eq(orgUpstreamKeys.providerSlug, providerSlug),
          ),
        )
        .returning({ id: orgUpstreamKeys.id });

      if (deleted.length === 0) {
        reply.code(404);
        return { error: "upstream_key_not_found" };
      }

      return { slug: providerSlug, isSet: false };
    },
  );
}
