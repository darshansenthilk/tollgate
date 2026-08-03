# Layering auth beyond email+password — reference doc

> **Note (2026-08-03): root `PLAN.md` no longer exists.** It was retired and deleted; the TOTP/2FA
> material this file points at was already archived into `docs/COMPLETION.md`'s 2026-07-25 and
> 2026-07-26 entries and into `docs/AUTH-IMPLEMENTATION.md` before that. Read references to root
> `PLAN.md` below as historical. The live planner is `docs/PLANS.md`.

**Purpose:** Standing reference for tollgate's account-security roadmap beyond the current
email+password + progressive-lockout baseline (see `docs/COMPLETION.md`, "Progressive sign-in
lockout"). Captures the full option space that was researched, the reasoning, and the recommended
sequencing, so future work (starting with the TOTP 2FA plan in root `PLAN.md`) doesn't need to
re-derive it. Researched and written 2026-07-25.

---

## 1. The threat model, plainly

Today, one artifact — the session cookie issued after email+password login — is the entire trust
boundary between "anonymous internet" and "full control of an org's agent fleet." Anyone holding a
valid cookie (via stolen password, credential stuffing, session hijack, or an unlocked/shared
browser) can, with zero additional friction: mint a brand-new spendable bearer token
(`POST /v1/agents`), raise or remove an agent's budget cap (`PATCH /v1/agents/:id/policy`), undo
someone else's emergency freeze (`POST /v1/agents/:id/unfreeze`), or delete an agent — because
`requireAuth` (`backend/api/src/lib/require-auth.ts`) only ever checks "is this cookie valid," never
"is this actually the account owner, right now, doing this specific dangerous thing."

The existing rate-limit + progressive lockout (`backend/api/src/lib/login-throttle.ts`) is real
protection, but it only slows down *guessing* the password — it does nothing once a password is
simply correct (phished, reused, breached) or a cookie is otherwise obtained.

**One gap sits underneath every option below and should close regardless of which MFA path is
chosen:** tollgate has no email verification and no password-reset flow at all. An unverified email
is a soft spot no second factor fixes — it's the door beside the door.

## 2. Option comparison

| Option | Security value | User friction | Implementation effort | Best fit |
|---|---|---|---|---|
| **TOTP 2FA** (`twoFactor` plugin) | High — defeats password-only takeover (stuffing, reuse, breach) | Low after enrollment; ~zero with 30-day trust-device | Low-moderate — 1 line server-side, 1–2 days incl. new UI | **Layer 2** |
| **Passkeys/WebAuthn** (`passkey` plugin) | Highest — phishing-resistant, kills credential stuffing outright | Very low day-to-day (biometric tap); harder recovery if all authenticators lost | Moderate — new package; step-up-without-new-session not yet supported upstream | Layer 2 alternative / **Layer 3 credential** |
| **SMS / Email OTP as 2nd factor** | Low–medium — SMS is NIST-deprecated for AAL2 + SIM-swap risk; email OTP is only as strong as an unverified inbox | Low (email) to medium (SMS enrollment) | High — zero email/SMS infra exists today | Recovery-companion / fallback only |
| **Adaptive / risk-based auth** (new-device, geo-velocity, IP reputation) | Medium — catches post-auth anomalies nothing else in the stack watches for | Near-zero (silent) unless step-up is triggered | Low (in-house tier 1) → medium (vendor tier) | Invisible background layer that *feeds* step-up |
| **Step-up re-auth on sensitive actions** | High — directly gates the exact routes where damage happens | Rare — only at mint/unfreeze/budget-raise/delete, ~once per session window | Small-medium — mirrors `login-throttle.ts` patterns closely | **Layer 3** |
| **Enterprise SSO** (`sso` plugin) | High for enterprise orgs, but doesn't strengthen the cookie itself | None for individual users (opt-in per org); moderate admin setup | Medium — 1–2 weeks incl. domain verification | Enterprise-tier, not universal |
| **Session & device management** (list/revoke sessions, new-sign-in email) | Medium — turns "silent indefinite foothold" into "noticed and revocable" | Lowest in the whole space — settings-page only | Low — list/revoke endpoints already live at `/api/auth/*` | Invisible-background / companion to any layer |
| **Backup codes & recovery-flow hardening** | High indirectly — closes the bypass route around whatever MFA is chosen | Low — only touched during actual recovery | Medium — needs email infra as a shared prerequisite | Recovery-companion / **Layer 0 (prerequisite)** |

## 3. Layer 2 recommendation

**Primary: TOTP via Better Auth's `twoFactor` plugin.** It's a one-line addition to the plugin array
already proven out in `backend/api/src/lib/auth.ts` (same pattern as `organization()`), auto-migrates
its own table the same way `db/auth-migrate.ts` already handles org tables, requires zero changes to
`require-auth.ts`, and directly closes the gap that matters most: a correctly-guessed or breached
password alone no longer produces a session — the plugin's sign-in hook deletes the session and
withholds the cookie until the second factor passes.

**Runner-up: Passkeys/WebAuthn.** Pick this instead — or offer it alongside TOTP as an enrollment
option — the moment phishing resistance specifically matters more than setup simplicity: TOTP codes
can still be relayed by a real-time adversary-in-the-middle phishing page (user types the code into a
fake site that forwards it live); a passkey physically cannot be, because the browser
cryptographically binds the credential to the exact origin.

*(See root `PLAN.md` for the detailed, source-verified implementation plan for this layer.)*

## 4. Layer 3 recommendation: step-up re-authentication, not a second blanket factor

**Recommendation: scoped step-up re-auth in front of the specific state-changing routes in
`backend/api/src/routes/agents.ts`** — `POST /v1/agents` (mints a live spendable token),
`POST /v1/agents/:id/unfreeze` (undoes an emergency stop), `DELETE /v1/agents/:id` (archive), and the
budget-*raising* branches of `PATCH /v1/agents/:id/policy` / `PATCH /v1/agents/:id` (budget-*lowering*
is risk-reducing and shouldn't be gated) — plus any future org-invite/promote-member route.

Why this beats a second login-time factor as the third layer: a hard second factor at login
(TOTP/passkey) answers "is this the account owner logging in" — but once a session exists (trusted
device, 30-day TOTP trust cookie, or simply a still-open tab), it says nothing about what that
already-authenticated session is about to do. Requiring 2FA again on every page load would double
everyday friction for zero marginal benefit on routine, low-risk actions (viewing spend, listing
agents, lowering a budget). Step-up instead asks the hard question exactly once, exactly where the
blast radius actually is: a stolen/replayed/XSS'd cookie is reduced to read-only — it cannot mint a
token, raise a cap past its current value, undo someone else's freeze, or delete an agent — without
proving the password (or 2FA factor) again, in a short elevation window (5–15 min), scoped per-session
via a Redis flag mirroring the existing lockout module's HMAC'd-key style.

**On "installation key":** a registered passkey or hardware security key *is* the modern,
cryptographically sound version of that instinct — not a separate mechanism to build alongside it.
The property being reached for with "installation key" is *possession of a specific physical thing,
bound to one place, that a remote attacker can't replicate by just copying a string*. A static
installation-key string fails that test the moment it's copied or leaked; a WebAuthn credential
doesn't, because the private key is generated on-device, never exportable, and never transmitted — a
stolen key or copied string is useless without the physical authenticator and its biometric/PIN
gesture present. Concrete path: ship step-up with password re-verification first, then upgrade the
step-up *credential itself* to a registered hardware key/passkey specifically for the mint-token /
raise-budget / unfreeze actions once passkeys are onboarded — at that point "you need your
installation key to authorize spend" is literally true, in a stronger form than the original idea.

## 5. Phased rollout

1. **Phase 0 — prerequisite, ship regardless of MFA choice:** email verification
   (`requireEmailVerification: true` + `sendVerificationEmail`) and a real password-reset flow with
   `revokeSessionsOnPasswordReset: true` and rate-limiting on the reset-request endpoint (reuse
   `login-throttle.ts`'s keying pattern). This is the one piece of infra (transactional email) every
   later phase leans on.
2. **Phase 1 — cheap, immediate blast-radius control:** active-sessions list + revoke-all/revoke-others
   in the dashboard settings page. The backend endpoints already exist
   (`/api/auth/list-sessions`, `/api/auth/revoke-*`) — this is pure frontend work and ships before any
   MFA decision is finalized.
3. **Phase 2 — Layer 2:** enable the `twoFactor` plugin. *(Superseded 2026-07-25: the enforcement
   policy below was the original recommendation, but the actual decision — see root `PLAN.md` §6 — is
   **mandatory for every account from day one**, not opt-in-with-nudge. Left here for the historical
   record of the trade-off; `PLAN.md` is authoritative.)* Original reasoning: default **opt-in with a
   persistent dashboard nudge** for all accounts, but **mandatory for org owner/admin roles** and for
   any account whose org exceeds a chosen aggregate budget threshold — enforced via a custom hook
   alongside the existing sign-in hooks in `auth.ts`, since Better Auth doesn't gate sign-in on 2FA
   status itself. Ship backup codes with a custom hashed (not plain/encrypted) storage encryptor,
   matching the one-way convention already used for bearer tokens in `tokens.ts`, plus an unskippable
   "save these now" acknowledgment screen. **Root `PLAN.md` has the actionable, current plan.**
4. **Phase 3 — Layer 3, step-up on sensitive actions:** wire `requireStepUp` in front of the routes
   named in Section 4, using password re-verification initially. Fail *closed* here (unlike
   `login-throttle.ts`'s deliberate fail-open) since the risk being guarded is worse than an extra
   prompt.
5. **Phase 4 — upgrade path, as passkeys mature:** offer passkey enrollment as a TOTP alternative for
   Layer 2, and once available, let a registered passkey/hardware key serve as the step-up credential
   in Phase 3 instead of password re-entry — realizing the "installation key" concept in its strongest
   form.
6. **Phase 5 — opportunistic, low-cost:** fold in tier-1 new-device detection (own Postgres table, no
   vendor) alongside Phase 2/3 as a trigger that *forces* step-up early if a sign-in looks unfamiliar,
   even inside an otherwise-valid elevation window.
7. **Phase 6 — only on real enterprise demand:** SSO via the `sso` plugin, built with an explicit "SSO
   required, password disabled" enforcement hook (not a default) so it doesn't just become a second,
   unmonitored login door.

## 6. Don't do (not worth it right now)

- **SMS OTP as a 2FA channel.** NIST SP 800-63B-4 downgraded SMS OTP below AAL2, it's vulnerable to
  SIM-swap, and tollgate has zero SMS infrastructure today — building it from scratch for a weaker
  factor than free TOTP isn't a good trade.
- **Email OTP as a primary second factor.** Tollgate has no email verification yet, so an OTP sent to
  an unproven address doesn't prove anything about the account owner. Revisit only as a recovery
  fallback *after* Phase 0 ships. (Note: Better Auth's `emailOTP`/`phoneNumber` plugins are for
  passwordless primary sign-in / address verification, not a password-plus-code second factor — the
  actual mechanism for an email-delivered second factor is the `twoFactor` plugin's channel-agnostic
  OTP method with a custom `sendOTP` email callback. Either way, it needs email infra tollgate doesn't
  have yet, and is weaker than TOTP once that infra exists.)
- **Enterprise SSO before there's an enterprise customer.** Real cost (1–2 weeks, cert/domain-
  verification UX, ongoing IdP-outage exposure) for zero improvement to the individual-account threat
  model — the cookie behaves identically regardless of login path.
- **Buying a fraud/risk vendor** (Sentinel, IPQualityScore, etc.). Recurring cost and third-party
  user-data exposure that isn't justified at this scale; the free in-house tier-1 new-device check
  covers the useful part cheaply.
- **A concurrent-session cap.** Easy to get wrong (silently signs a user out of a second legitimate
  device), no built-in primitive in Better Auth core, and not central to this threat model — skip
  until sessions list/revoke ships and real evidence of need appears.
- **Passkeys as the mandatory universal Layer 2 on day one.** Stronger than TOTP, but the "lost every
  authenticator" recovery story is harder to support today, and Better Auth's step-up-without-new-
  session gap (open upstream issue) means it can't yet cleanly serve as Layer 3 either — land it as an
  option/upgrade path (Phase 4), not the mandatory default.
