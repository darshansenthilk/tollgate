import { createHash, randomBytes } from "node:crypto";

/**
 * Must stay byte-for-byte identical to proxy/src/lib/agents.ts's hashToken.
 * Duplicated rather than moved to @tollgate/shared because shared is also
 * pulled into the browser-bundled dashboard, which shouldn't gain a
 * node:crypto dependency. If this algorithm ever changes, change both.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Raw bearer token returned once at creation; only its hash is ever stored. */
export function generateToken(): string {
  return `tg_${randomBytes(32).toString("base64url")}`;
}
