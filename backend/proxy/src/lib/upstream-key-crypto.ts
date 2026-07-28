import { createDecipheriv } from "node:crypto";
import type { UpstreamKeyCiphertext } from "@tollgate/shared";

/**
 * Decrypts an org's stored BYOK upstream provider key so the hot path can
 * forward the real key upstream. The encrypt counterpart lives in
 * backend/api/src/lib/upstream-key-crypto.ts — see its doc comment for why
 * these keys are encrypted (reversible) rather than hashed like agent tokens,
 * and why the two halves live in separate services.
 *
 * Must agree with the api on: AES-256-GCM, base64 fields, and the 32-byte
 * VAULT_ENCRYPTION_KEY. If the two services are ever given different values
 * for that env var, decryption fails the auth-tag check and returns null here
 * — which vault.ts deliberately treats as fail-closed, never as "fall back to
 * Tollgate's shared key" (that would silently bill the wrong account).
 */

const ALGORITHM = "aes-256-gcm";

function loadEncryptionKey(): Buffer | null {
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (raw === undefined || raw.trim() === "") return null;
  const key = Buffer.from(raw.trim(), "base64");
  return key.length === 32 ? key : null;
}

/**
 * Returns the plaintext key, or null if it can't be recovered — a wrong/absent
 * VAULT_ENCRYPTION_KEY, or a ciphertext that fails GCM's authentication tag
 * (tampered or corrupted). Callers must treat null as "deny", not "ignore".
 */
export function decryptUpstreamKey(stored: UpstreamKeyCiphertext): string | null {
  const key = loadEncryptionKey();
  if (key === null) return null;

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(stored.iv, "base64"),
    );
    // GCM verifies this tag on final(); a mismatch throws rather than
    // returning garbage plaintext, which is the whole point of using an AEAD.
    decipher.setAuthTag(Buffer.from(stored.authTag, "base64"));

    return Buffer.concat([
      decipher.update(Buffer.from(stored.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
