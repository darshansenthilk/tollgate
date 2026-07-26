# Progressive Sign-In Lockout — Implementation Plan

Status: **IMPLEMENTED 2026-07-25** on `Eshaan-2` (uncommitted); verified with
API integration tests + a browser smoke-test. Scope: the email+password sign-in
path (Better Auth on the api). Does not touch sign-up, password reset, or OAuth.

> The previous PLAN.md (dashboard UI to match the reference mock) was
> **implemented 2026-07-24**; its record lives in `docs/COMPLETION.md`. Per this
> file's rolling convention, it now tracks the new work below.
>
> **Updated 2026-07-25** with your answers: email-keyed lockout + keep the IP
> limiter, **no CAPTCHA** (deferred); doubling ladder kept (Q2); 24h inactivity
> decay added (Q3); file stays at repo root (Q5).

---

## 1. Goal & exact requirements

Blunt brute-force / credential-stuffing on `/api/auth/sign-in/email` with a
progressive, self-resetting lockout.

1. **5 consecutive failed sign-ins** → lock the account's sign-in for a cooldown.
2. First cooldown = **5 minutes**. After it expires the user gets **another 5
   attempts**.
3. Each subsequent lockout **doubles** the previous cooldown (5 → 10 → 20 → …),
   **capped at 24 hours**.
4. Once a lockout **hits the 24h cap**, the escalation **resets to 0** — after
   that 24h lockout expires the user is back to a clean slate (5 attempts, next
   lockout 5 min).
5. A **successful** sign-in at any point clears the record (counter + escalation).
6. **Messaging:** on a failed attempt, only tell the user how many attempts
   remain **once they are down to their last 3** (i.e. show the count for the
   3rd/4th/5th failure; stay generic before that).

### The lockout ladder (derived from the rules above)

`duration(L) = min(5 min × 2^L, 24 h)`, where `L` is the escalation level (0-based).

| Lockout # | Level `L` | Failures to trigger | Cooldown |
|-----------|-----------|---------------------|----------|
| 1 | 0 | 5 | 5 min |
| 2 | 1 | 5 | 10 min |
| 3 | 2 | 5 | 20 min |
| 4 | 3 | 5 | 40 min |
| 5 | 4 | 5 | 1 h 20 m |
| 6 | 5 | 5 | 2 h 40 m |
| 7 | 6 | 5 | 5 h 20 m |
| 8 | 7 | 5 | 10 h 40 m |
| 9 | 8 | 5 | 21 h 20 m |
| 10 | 9 | 5 | **24 h (capped)** → reset `L` to 0 |

> Kept as specified (Q2). Reaching the cap takes 10 cycles (~66 h cumulative) — a
> long tail, but it only bites a genuinely persistent attacker.

### Messaging thresholds

`remaining = 5 − failures`. Show the count only when `remaining ≤ 3`:

| Failure # | Remaining | Message shown |
|-----------|-----------|---------------|
| 1 | 4 | Generic: "Invalid email or password." |
| 2 | 3 | "Invalid email or password. **3 attempts remaining** before a temporary lockout." |
| 3 | 2 | "… **2 attempts remaining** …" |
| 4 | 1 | "… **1 attempt remaining** …" |
| 5 | 0 | Locked: "Too many failed attempts. Try again in **5 minutes**." |

---

## 2. Where to enforce — browser vs server (the options you asked for)

**Short answer: enforce on the server; use the browser only as a UX mirror.**

| Option | How | Pros | Cons | Verdict |
|--------|-----|------|------|---------|
| **A. Browser only** (localStorage counter) | Count failures in JS, block the form client-side | Instant feedback, zero backend state | **No security at all** — cleared by devtools / incognito / a different browser / curl. An attacker never runs your JS. Defeats the entire purpose. | ❌ Not as the control |
| **B. Server only** | Count + lock in the api, return 429 | Real protection, authoritative, can't be bypassed | Needs a round-trip for feedback; needs shared state (have it: Redis) | ✅ **The enforcement layer** |
| **C. Both (server authoritative + browser mirror)** | Server enforces; browser reads the 429/`Retry-After` and shows a live countdown, persisted in localStorage | Real protection **and** the snappy "by the browser" UX you described; countdown survives reloads | Slightly more code (small) | ✅✅ **Recommended** |

**Recommendation: Option C.** The server (Redis-backed) is the source of truth
and the only thing that actually blocks. The browser layer is pure UX — it
mirrors the server's lockout so the button disables instantly and a countdown
ticks without hammering the api. Clearing localStorage just means the next
request gets a 429 from the server anyway. This is the honest way to give you the
"by the browser" feel without the browser being the (bypassable) gate.

---

## 3. What to key the lockout on — email vs IP vs both

| Key | Catches | Misses / risk |
|-----|---------|---------------|
| **Email (account)** | Repeated attacks on one account; matches "a *user* fails 5×" | Lets an attacker deliberately **lock a victim out** (account-lockout DoS). Doesn't stop password-spray across many accounts. |
| **IP** | One source hammering | Shared IPs (corporate NAT, mobile carriers) → collateral lockout of innocents; botnets rotate IPs and bypass. |
| **Email + IP (recommended)** | Per-account progressive lockout (this feature) **plus** IP rate-limiting for spray | Residual account-lockout-DoS on the email key (mitigated below) |

**Decision (Q1):** key the **progressive lockout by normalized email**, and keep
Better Auth's existing **per-IP** sign-in limiter (`/sign-in/email`: 10/min in
`auth.ts`) as the anti-spray backstop.

**Account-lockout-DoS note:** any per-account lockout lets someone grief a known
email. Mitigations here: the 24h cap **auto-resets** (never a permanent lock), and
the IP limiter throttles the griefer's source first. Softer options remain on the
table as **future** work if griefing becomes real — a CAPTCHA-after-N step, or
emailing the account owner on lockout — but they are explicitly **out of scope for
this build**.

**Enumeration safety:** the counter keys on the **submitted email string whether
or not the account exists**, so the "N remaining" / lockout behaviour is
identical for real and fake emails — it does **not** leak which emails have
accounts. Store the key as `HMAC(email, secret)` so raw emails aren't sitting in
Redis/logs.

---

## 4. Storage — Redis vs Postgres

**Recommendation: Redis.** It's already wired and central to this codebase
(`backend/api/src/lib/redis.ts`; the whole spend/freeze enforcement layer runs on
it), it's the natural fit for atomic counters + TTL expiry, and it needs **no new
table or migration**.

| | Redis (recommended) | Postgres table |
|---|---|---|
| Already available | ✅ connected singleton | ✅ (pool) but new table + drizzle migration |
| Atomic increment | ✅ `INCR`/Lua | needs `SELECT … FOR UPDATE` / upsert |
| Auto-expiry (decay + cleanup) | ✅ native TTL | manual sweep job |
| Durability across restart | in-memory (fine — throttle state is ephemeral) | durable |
| Matches existing patterns | ✅ mirrors freeze/spend stores | mismatch |

Ephemeral state is acceptable here (a Redis restart just forgives in-flight
lockouts — no worse than fail-open, below).

---

## 5. State model & algorithm

**Redis record** (one hash per identifier):

```
key:  tollgate:api:login-throttle:<hmac(normalized_email)>
hash: { failures: int, level: int, lockedUntil: epochSeconds }
TTL:  refreshed on every write to max(lockout-remaining, DECAY_WINDOW)
```

`DECAY_WINDOW` (Q3 — confirmed): if the identifier is idle for 24 h the key
expires, so escalation decays and storage is bounded.

### `checkLock(key)` — called in the **before** hook

```
r = HGETALL key
if r.lockedUntil and now < r.lockedUntil:
    return { locked: true, retryAfterSec: r.lockedUntil - now }
return { locked: false }
```

### `recordFailure(key)` — called in the **after** hook on a failed sign-in

Run atomically (single Lua script via `redis.eval`, so concurrent failures can't
race past the threshold):

```
r = load(key) or { failures:0, level:0, lockedUntil:0 }
r.failures += 1
if r.failures >= THRESHOLD (5):
    durMin = min(BASE_MIN(5) * 2^r.level, CAP_MIN(1440))
    r.lockedUntil = now + durMin*60
    r.failures = 0                       # fresh 5 attempts after cooldown
    r.level = (durMin >= CAP_MIN) ? 0 : r.level + 1   # reset escalation at the cap
    save(r, ttl = max(durMin*60, DECAY_WINDOW))
    return { locked:true, retryAfterSec: durMin*60, remaining:0 }
else:
    save(r, ttl = DECAY_WINDOW)
    return { locked:false, remaining: THRESHOLD - r.failures }
```

### `recordSuccess(key)` — called in the **after** hook on a successful sign-in

```
DEL key
```

### Turning results into responses

- **before hook**, `locked` → throw `429` with `Retry-After` and a body carrying
  `retryAfterSec` (so the client can render a countdown). Even a correct password
  is rejected while locked (that's the point).
- **after hook**, on failure:
  - `locked` → `429` (same shape as above), message "Too many failed attempts.
    Try again in {human duration}."
  - else if `remaining ≤ 3` → `401`, message "Invalid email or password.
    {remaining} attempt(s) remaining before a temporary lockout.", `code:
    LOGIN_ATTEMPTS_REMAINING`.
  - else → leave Better Auth's original generic 401 untouched.

---

## 6. Integration points (files)

### Phase 0 — Spike (verify before building) ⚠️

Better Auth's hook surface is the one unknown. Confirm against the **installed
v1.6.25** (quick probe / node_modules types):

- `betterAuth({ hooks: { before, after } })` via `createAuthMiddleware` from
  `better-auth/api`, and that `ctx.path === "/sign-in/email"`, `ctx.body.email`,
  and client IP are reachable in the hook.
- How the **after** hook reads pass/fail (expected: `ctx.context.returned` is an
  `APIError` on failure) and whether throwing a new `APIError` in the after hook
  **overrides** the response body/message.
- **Fallback if the after hook can't rewrite the body:** emit the remaining count
  as a response **header** (`X-Login-Attempts-Remaining`) added in
  `auth-mount.ts` (added to `Access-Control-Expose-Headers`, which that file
  already mirrors), and have the client read the header. Lockout (429) is fully
  ours regardless, so that path is unaffected.

### Backend

- **`backend/api/src/lib/login-throttle.ts`** (new): `checkLock`,
  `recordFailure`, `recordSuccess`, the Lua script, `identifierKey(email)`
  (HMAC), and the constants. Takes the existing `redis` singleton.
- **`backend/api/src/lib/auth.ts`** (edit): add `hooks.before` (call
  `checkLock`, throw 429 if locked) and `hooks.after` (call
  `recordFailure`/`recordSuccess`, throw the messaged error). Keep the existing
  `rateLimit` block as the IP backstop.
- **`backend/api/src/lib/auth-mount.ts`** (edit only if using the header
  fallback): expose `X-Login-Attempts-Remaining`.
- **Fail-open policy:** if Redis is unreachable, `checkLock`/`recordFailure`
  **fail open** (allow the sign-in, log it) so a Redis blip can't lock everyone
  out. Better Auth's IP limiter stays as the backstop during an outage.

### Frontend

- **`frontend/dashboard/components/auth-form.tsx`** (edit): on `error.status ===
  429` → read `retryAfterSec`, store `lockedUntil` in localStorage, disable the
  form, render a live countdown; on `error.code === LOGIN_ATTEMPTS_REMAINING` →
  show the server message; otherwise keep the generic message. On mount, restore
  any unexpired `lockedUntil` from localStorage.
- Optional small **`useLockout()`** hook to hold the countdown/localStorage logic.

---

## 7. Failure modes & security considerations

- **Concurrency:** the failure transition is a single Lua script → no
  read-increment races past the threshold.
- **Redis down:** fail open (see above); IP limiter remains.
- **Enumeration:** uniform counting for real/fake emails; HMAC'd keys; generic
  message until the last 3.
- **Account-lockout DoS:** inherent to per-account lockout; bounded by the 24h
  auto-reset + IP limiter; softer alternatives noted in §3 as future work.
- **Interaction with existing limits:** Better Auth's per-IP `/sign-in/email`
  10/min limiter and the global 300/min api limiter both still apply and also
  return 429; the client treats any 429 as "backoff" and shows the countdown when
  a `retryAfterSec` is present.
- **Clock:** all times are server-side epoch seconds; the client countdown is
  cosmetic and re-synced from each server response.

---

## 8. Testing

- **Unit** (pure ladder fn): durations 5→10→20→…→cap; reset to L0 at the cap;
  `remaining` math; message thresholds.
- **Integration** (curl / vitest against the api): 5 failures → 429; remaining
  message appears only on failures 3–5 (rem ≤ 3); correct password during
  lockout still 429; success resets; `Retry-After` present; second lockout = 10
  min.
- **Browser:** countdown renders, form disabled, persists across reload, re-enables
  after expiry.

---

## 9. Tunable constants (one place, in `login-throttle.ts`)

| Constant | Value | Meaning |
|----------|-------|---------|
| `THRESHOLD` | 5 | failures before a lockout |
| `BASE_LOCKOUT_MIN` | 5 | first cooldown |
| `MULTIPLIER` | 2 | doubling factor |
| `CAP_MIN` | 1440 | 24 h ceiling; reaching it resets escalation |
| `SHOW_REMAINING_AT` | 3 | start showing the count at this many remaining |
| `DECAY_WINDOW_SEC` | 86400 | idle time after which the record resets (Q3) |

---

## 10. Phased task checklist

- [x] **Phase 0** — Spiked Better Auth 1.6.25 hook surface against the installed
      source: `hooks.before`/`after` are single `createAuthMiddleware` handlers
      run for every endpoint (guard on `ctx.path`); the after-hook reads
      `ctx.context.returned` (an `APIError` on a failed sign-in) and throwing a
      new `APIError` rewrites the body. No header fallback needed.
- [x] **Phase 1** — `login-throttle.ts` (Redis + Lua, HMAC keys, fail-open) +
      unit tests (`login-throttle.test.ts`, 3/3 via `node --import tsx --test`).
- [x] **Phase 2** — Wired `hooks.before`/`hooks.after` in `auth.ts`; integration-
      tested against the live api (ladder + success-reset, see notes).
- [x] **Phase 3** — Frontend countdown + messaging in `auth-form.tsx` (localStorage
      mirror, live countdown, disabled form); dashboard typechecks.
- [x] **Phase 4** — Browser smoke-test: message progression, disabled form, live
      countdown, and persistence across reload all confirmed.

### Implementation notes

- **HTTP status nuance (important).** Better Auth's dispatch pins the response
  status to the endpoint's own result and lets an after-hook rewrite only the
  *body*, not the status (`dist/api/dispatch.mjs:243`). So the failed attempt
  that *trips* the lock comes back **HTTP 401** (an honest "your login failed")
  carrying `{ code: "ACCOUNT_LOCKED", retryAfter }`; every *subsequent* attempt is
  blocked pre-emptively by the before-hook as **HTTP 429**. The client keys on the
  body `code` (uniform across both), so the countdown renders either way.
- **Verified behaviour:** attempts 1→5 gave generic → "3/2/1 remaining" → locked
  (retryAfter 300); a correct password after failures returned 200 and cleared
  the record (next failure was generic again); a locked identifier is refused even
  with the right password (before-hook rejects before the check).
- **Files:** `backend/api/src/lib/login-throttle.ts` (new),
  `backend/api/src/lib/login-throttle.test.ts` (new), `backend/api/src/lib/auth.ts`
  (hooks), `backend/api/package.json` (`test` script),
  `frontend/dashboard/components/auth-form.tsx` (countdown + messaging).

---

## 11. Open questions / decisions

- **Q1 — resolved:** email-keyed progressive lockout **+** keep the IP limiter.
  **No CAPTCHA** in this build (deferred to future work — see §3).
- **Q2 — kept:** the 10-cycle doubling ladder stays as specified.
- **Q3 — resolved: yes** — 24h inactivity decay included (`DECAY_WINDOW_SEC`).
- **Q5 — resolved: yes** — plan stays at repo-root `PLAN.md`.
