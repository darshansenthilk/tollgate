import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import {
  UPSTREAM_PROVIDERS,
  isUpstreamProviderSlug,
  maskUpstreamKey,
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
 * BYOK management plane: an org supplies its own OpenAI/Anthropic/Gemini
 * key(s) so upstream usage bills to their provider account instead of
 * Tollgate's shared deployment key.
 *
 * MULTI-KEY: an org can store several keys per provider, each distinguished
 * by a `label` it picks ("Prod", "Jane's key"). Agents then pick ONE stored
 * key by id (agents.upstream_key_id, set via routes/agents.ts) rather than
 * the proxy guessing among an org's several keys for a provider — see
 * backend/proxy/src/lib/vault.ts's doc comment for the full resolution order.
 *
 * Write-once-reveal-never, exactly like agent tokens: a saved key is never
 * returned by any endpoint here. Every route reports only a non-secret hint
 * ("sk-…7mQ4"). Unlike agent tokens, the plaintext IS recoverable internally
 * — the proxy has to replay it upstream — but it's never exposed back over
 * the management API.
 *
 * Every route is gated by the requireAuth preHandler (index.ts), which 401s
 * anonymous callers and stamps req.activeOrgId — so the `!` below is safe, and
 * org scoping (cross-account isolation) hangs off that value, never client
 * input. Same pattern as routes/agents.ts.
 */

interface SaveKeyBody {
  providerSlug: UpstreamProviderSlug;
  label: string;
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
  // Optional on the wire: a caller that doesn't care about naming multiple
  // keys still gets a sane single-key experience.
  const rawLabel = rec["label"];

  if (typeof providerSlug !== "string") return { ok: false, error: "invalid_body" };
  if (!isUpstreamProviderSlug(providerSlug)) {
    return { ok: false, error: "invalid_provider_slug" };
  }
  if (typeof key !== "string" || key.trim() === "") return { ok: false, error: "invalid_body" };
  if (rawLabel !== undefined && typeof rawLabel !== "string") {
    return { ok: false, error: "invalid_body" };
  }

  const label = rawLabel === undefined || rawLabel.trim() === "" ? "Default" : rawLabel.trim();

  return { ok: true, body: { providerSlug, label, key: key.trim() } };
}

export function registerUpstreamKeyRoutes(app: FastifyInstance): void {
  /**
   * Every stored key for every provider, grouped by provider slug so the
   * dashboard can render "N keys configured" per provider from one call.
   * Deliberately lists ALL providers (not just ones with keys) — same reason
   * as before multi-key.
   */
  app.get("/v1/upstream-keys", async (req) => {
    const orgId = req.activeOrgId!;

    const rows = await db
      .select({
        id: orgUpstreamKeys.id,
        providerSlug: orgUpstreamKeys.providerSlug,
        label: orgUpstreamKeys.label,
        keyHint: orgUpstreamKeys.keyHint,
        updatedAt: orgUpstreamKeys.updatedAt,
      })
      .from(orgUpstreamKeys)
      .where(eq(orgUpstreamKeys.orgId, orgId));

    const byProvider = new Map<string, typeof rows>();
    for (const row of rows) {
      const existing = byProvider.get(row.providerSlug);
      if (existing) existing.push(row);
      else byProvider.set(row.providerSlug, [row]);
    }

    return {
      // Surfaced so the dashboard can explain a save failure that has nothing
      // to do with the user's key (the deployment simply can't encrypt yet).
      vaultConfigured: isVaultConfigured(),
      providers: UPSTREAM_PROVIDERS.map((provider) => ({
        slug: provider.slug,
        label: provider.label,
        keys: (byProvider.get(provider.slug) ?? []).map((row) => ({
          id: row.id,
          label: row.label,
          // Never the key itself — see the module doc comment.
          keyHint: row.keyHint,
          updatedAt: row.updatedAt.toISOString(),
        })),
      })),
    };
  });

  /**
   * Add (or rotate, if the label already exists for this org+provider) a key.
   * The key is verified against the real provider BEFORE anything is written
   * — see lib/upstream-key-verify.ts for why storing an unverified key is a
   * trap.
   */
  app.post<{ Body: unknown }>("/v1/upstream-keys", async (req, reply) => {
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
    const { providerSlug, label, key } = parsed.body;

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

    // Upsert on the (org, provider, label) unique index so saving under an
    // existing label rotates that key rather than accumulating a duplicate.
    const [row] = await db
      .insert(orgUpstreamKeys)
      .values({
        id: randomUUID(),
        orgId,
        providerSlug,
        label,
        encryptedKey: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyHint,
      })
      .onConflictDoUpdate({
        target: [orgUpstreamKeys.orgId, orgUpstreamKeys.providerSlug, orgUpstreamKeys.label],
        set: {
          encryptedKey: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyHint,
          updatedAt: now,
        },
      })
      .returning({ id: orgUpstreamKeys.id });

    return { id: row!.id, providerSlug, label, keyHint, updatedAt: now.toISOString() };
  });

  /**
   * Remove one stored key by id. Any agent pointed at it (agents.upstream_key_id)
   * falls back to the deployment env key on its next request — the FK is
   * ON DELETE SET NULL, so this never fails because an agent is still using it.
   */
  app.delete<{ Params: { id: string } }>("/v1/upstream-keys/:id", async (req, reply) => {
    const orgId = req.activeOrgId!;
    const { id } = req.params;

    const deleted = await db
      .delete(orgUpstreamKeys)
      .where(and(eq(orgUpstreamKeys.orgId, orgId), eq(orgUpstreamKeys.id, id)))
      .returning({ id: orgUpstreamKeys.id });

    if (deleted.length === 0) {
      reply.code(404);
      return { error: "upstream_key_not_found" };
    }

    return { id, deleted: true };
  });
}
