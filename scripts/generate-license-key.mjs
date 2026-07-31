#!/usr/bin/env node
/**
 * Internal tool — mints a self-host activation key. Run this yourself when
 * a company requests self-hosting (SELF_HOSTING.md's "Licensing" section);
 * there is no self-serve path, by design (matches the sales-assisted
 * self-hosting positioning already established for the marketing site).
 *
 * Requires LICENSE_SIGNING_PRIVATE_KEY in the environment — the Ed25519
 * private key (PKCS8/DER, base64), generated once and NEVER committed to
 * this repo. Store it in whatever secrets manager/password manager you
 * use; treat it like your most sensitive credential, because it is one —
 * anyone who has it can mint a key that every self-hosted install will
 * accept as genuine. backend/shared/src/license.ts only ever ships the
 * matching PUBLIC key (verifies, can't forge), which is the whole point of
 * using asymmetric signing here instead of a shared secret.
 *
 * Usage:
 *   LICENSE_SIGNING_PRIVATE_KEY=... node scripts/generate-license-key.mjs \
 *     --org "Acme Corp" --expires 2027-07-31
 *   LICENSE_SIGNING_PRIVATE_KEY=... node scripts/generate-license-key.mjs \
 *     --org "Acme Corp" --no-expiry
 */
import { createPrivateKey, sign } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    expires: { type: "string" },
    "no-expiry": { type: "boolean", default: false },
  },
});

if (values.org === undefined || values.org.trim() === "") {
  console.error("Usage: LICENSE_SIGNING_PRIVATE_KEY=... node scripts/generate-license-key.mjs --org \"Acme Corp\" [--expires YYYY-MM-DD | --no-expiry]");
  process.exit(1);
}
if (values.expires === undefined && !values["no-expiry"]) {
  console.error("Must pass either --expires YYYY-MM-DD or --no-expiry (explicit, not a default — see license.ts's LicensePayload doc comment).");
  process.exit(1);
}
if (values.expires !== undefined && values["no-expiry"]) {
  console.error("Pass --expires or --no-expiry, not both.");
  process.exit(1);
}

const rawKey = process.env.LICENSE_SIGNING_PRIVATE_KEY;
if (rawKey === undefined || rawKey.trim() === "") {
  console.error("LICENSE_SIGNING_PRIVATE_KEY is not set. This is the private signing key — see this script's own doc comment for where it's supposed to live (nowhere in this repo).");
  process.exit(1);
}

let expiresAt = null;
if (values.expires !== undefined) {
  const parsed = new Date(values.expires);
  if (Number.isNaN(parsed.getTime())) {
    console.error(`--expires "${values.expires}" isn't a parseable date. Use YYYY-MM-DD.`);
    process.exit(1);
  }
  expiresAt = parsed.toISOString();
}

const privateKey = createPrivateKey({
  key: Buffer.from(rawKey.trim(), "base64"),
  format: "der",
  type: "pkcs8",
});

const payload = {
  org: values.org,
  issuedAt: new Date().toISOString(),
  expiresAt,
};

function base64url(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
const signature = sign(null, payloadBytes, privateKey);
const key = `${base64url(payloadBytes)}.${base64url(signature)}`;

console.log(key);
console.error(`\nIssued to: ${payload.org}`);
console.error(`Expires:   ${payload.expiresAt ?? "never"}`);
console.error(`\nSend the line above (just the key itself, printed to stdout — everything else went to stderr) to the customer as TOLLGATE_LICENSE_KEY in their .env.`);
