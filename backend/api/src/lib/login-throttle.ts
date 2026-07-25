import { createHmac } from "node:crypto";
import { redis } from "./redis.js";

/**
 * Progressive sign-in lockout, keyed by email, backed by Redis.
 *
 * The api is the auth authority (see auth.ts); this module is the enforcement
 * state for `/sign-in/email`. Better Auth's `hooks.before` calls {@link
 * checkSignInLock} to reject a locked identifier before the password is even
 * checked, and `hooks.after` calls {@link recordSignInFailure} /
 * {@link recordSignInSuccess} to advance or clear the counter. See PLAN.md.
 *
 * Model: 5 consecutive failures → a cooldown that doubles each lockout
 * (5m → 10m → 20m → …) capped at 24h; hitting the cap resets the escalation.
 * A success clears everything. Records auto-expire after 24h of inactivity
 * (the escalation "decay"), which Redis TTL gives us for free.
 *
 * Fail-open by design: if Redis is unreachable every function degrades to
 * "allow, don't lock" so a cache blip can't lock the whole product out. Better
 * Auth's per-IP limiter (auth.ts) remains as the backstop in that window.
 */

export const THRESHOLD = 5; // consecutive failures before a lockout
export const BASE_LOCKOUT_MIN = 5; // first cooldown, minutes
const MULTIPLIER = 2; // cooldown doubles each lockout
export const CAP_MIN = 24 * 60; // 24h ceiling; reaching it resets escalation
export const SHOW_REMAINING_AT = 3; // only surface the count at ≤ this many left
const DECAY_WINDOW_SEC = 24 * 60 * 60; // idle time after which a record resets

const SECRET = process.env.BETTER_AUTH_SECRET ?? "dev-login-throttle-secret";

/**
 * Redis key for an identifier. The email is normalized then HMAC'd so raw
 * addresses never sit in Redis (or logs), and so counting is uniform for real
 * and non-existent emails alike (no account-enumeration signal).
 */
function keyFor(email: string): string {
  const normalized = email.trim().toLowerCase();
  const digest = createHmac("sha256", SECRET).update(normalized).digest("hex");
  return `tollgate:api:login-throttle:${digest}`;
}

/**
 * Cooldown for a given escalation level, in minutes. Pure — unit-tested
 * directly and mirrored exactly by the Lua script below so the two can't drift.
 */
export function lockoutDurationMin(level: number): number {
  return Math.min(BASE_LOCKOUT_MIN * MULTIPLIER ** level, CAP_MIN);
}

/**
 * Escalation level after a lockout at `level` is served: normally +1, but reset
 * to 0 once the cooldown has reached the 24h cap ("goes back down to 0").
 */
export function nextLevel(level: number): number {
  return lockoutDurationMin(level) >= CAP_MIN ? 0 : level + 1;
}

/**
 * The whole failure transition in one atomic step so concurrent failed requests
 * can't race past the threshold. Increments the counter; on hitting THRESHOLD it
 * stamps the cooldown, resets the counter for the next window, and advances (or
 * resets) the escalation level. Returns [locked, retryAfterSec, remaining].
 *
 * Kept byte-for-byte in step with {@link lockoutDurationMin} / {@link nextLevel}.
 */
const FAILURE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local threshold = tonumber(ARGV[2])
local baseMin = tonumber(ARGV[3])
local mult = tonumber(ARGV[4])
local capMin = tonumber(ARGV[5])
local decay = tonumber(ARGV[6])

local failures = tonumber(redis.call('HGET', key, 'failures')) or 0
local level = tonumber(redis.call('HGET', key, 'level')) or 0
failures = failures + 1

if failures >= threshold then
  local dur = baseMin
  for _ = 1, level do dur = dur * mult end
  if dur > capMin then dur = capMin end
  local lockedUntil = now + dur * 60
  local newLevel
  if dur >= capMin then newLevel = 0 else newLevel = level + 1 end
  redis.call('HSET', key, 'failures', 0, 'level', newLevel, 'lockedUntil', lockedUntil)
  redis.call('EXPIRE', key, decay)
  return {1, dur * 60, 0}
else
  redis.call('HSET', key, 'failures', failures, 'level', level)
  redis.call('EXPIRE', key, decay)
  return {0, 0, threshold - failures}
end
`;

export type LockState = { locked: boolean; retryAfterSec: number };
export type FailureResult = LockState & { remaining: number };

/**
 * Is this identifier currently locked out? Called in the before-hook — a lock
 * rejects the request before the password is checked (so even correct
 * credentials are refused, and the attempt is not counted as a failure).
 */
export async function checkSignInLock(email: string): Promise<LockState> {
  try {
    const record = await redis.hgetall(keyFor(email));
    const lockedUntil = Number(record.lockedUntil ?? 0);
    const now = Math.floor(Date.now() / 1000);
    if (lockedUntil > now) return { locked: true, retryAfterSec: lockedUntil - now };
    return { locked: false, retryAfterSec: 0 };
  } catch (err) {
    console.warn("[login-throttle] checkSignInLock failed open:", err);
    return { locked: false, retryAfterSec: 0 };
  }
}

/**
 * Record one failed sign-in and return the resulting state. Fails open to
 * "not locked, full attempts remaining" (i.e. no message shown) if Redis is down.
 */
export async function recordSignInFailure(email: string): Promise<FailureResult> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const result = (await redis.eval(
      FAILURE_LUA,
      1,
      keyFor(email),
      now,
      THRESHOLD,
      BASE_LOCKOUT_MIN,
      MULTIPLIER,
      CAP_MIN,
      DECAY_WINDOW_SEC,
    )) as [number, number, number];
    const [locked, retryAfterSec, remaining] = result;
    return { locked: locked === 1, retryAfterSec, remaining };
  } catch (err) {
    console.warn("[login-throttle] recordSignInFailure failed open:", err);
    return { locked: false, retryAfterSec: 0, remaining: THRESHOLD };
  }
}

/** Clear an identifier's record on a successful sign-in (best-effort). */
export async function recordSignInSuccess(email: string): Promise<void> {
  try {
    await redis.del(keyFor(email));
  } catch (err) {
    console.warn("[login-throttle] recordSignInSuccess ignored error:", err);
  }
}

/** "5 minutes", "2 hours 40 minutes", "24 hours" — for the user-facing message. */
export function humanizeDuration(totalSec: number): string {
  const totalMin = Math.max(1, Math.round(totalSec / 60));
  if (totalMin < 60) return `${totalMin} minute${totalMin === 1 ? "" : "s"}`;
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  if (minutes === 0) return hourPart;
  return `${hourPart} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}
