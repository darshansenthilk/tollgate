import { createCipheriv, randomBytes } from "node:crypto";
import type { UpstreamKeyCiphertext } from "@tollgate/shared";

/**
 * Encrypts an org's BYOK upstream provider key for storage.
 *
 * WHY THIS IS NOT hashToken() (lib/tokens.ts): agent tokens are hashed one-way
 * because authentication only ever compares them. An upstream provider key is
 * the opposite — backend/proxy replays the ACTUAL plaintext to OpenAI/Anthropic
 * on every forwarded request, so hashing it would make it permanently unusable.
 * This is reversible symmetric encryption (AES-256-GCM), and the counterpart
 * decrypt lives in backend/proxy/src/lib/upstream-key-crypto.ts.
 *
 * The api only ever encrypts and the proxy only ever decrypts, which is why
 * there's no shared crypto module: each service holds exactly the half it
 * needs, and neither can accidentally perform the other's operation. (The
 * format contract they agree on is @tollgate/shared's UpstreamKeyCiphertext,
 * which stays pure because that file is also bundled into the browser.)
 *
 * The 32-byte encryption key comes from VAULT_ENCRYPTION_KEY in the server
 * environment and is NEVER stored in the database — so a database dump alone
 * yields no usable provider keys.
 */

/** AES-256-GCM's standard IV length. 96 bits is the size GCM is specified for. */
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";

export class VaultKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultKeyUnavailableError";
  }
}

/**
 * Loaded per call rather than at module load: a missing key must surface as a
 * handled per-request error the route can turn into a clear operator-facing
 * message, not a crash at boot that takes the whole api down (which would also
 * break agent CRUD, auth, everything — for a feature nobody may be using yet).
 */
function loadEncryptionKey(): Buffer {
  const raw = process.env.VAULT_ENCRYPTION_KEY;
  if (raw === undefined || raw.trim() === "") {
    throw new VaultKeyUnavailableError(
      "VAULT_ENCRYPTION_KEY is not set on the api service.",
    );
  }

  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) {
    throw new VaultKeyUnavailableError(
      `VAULT_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}).`,
    );
  }
  return key;
}

/** True when the service is configured to store BYOK keys at all. Lets the
 *  status endpoint tell the dashboard "this deployment can't accept keys yet"
 *  instead of only failing at save time. */
export function isVaultConfigured(): boolean {
  try {
    loadEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptUpstreamKey(plaintext: string): UpstreamKeyCiphertext {
  const key = loadEncryptionKey();
  // A fresh random IV per encryption. Reusing an IV under the same key breaks
  // GCM catastrophically, so this is generated here and never derived from
  // anything about the record.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}
