# TOTP Two-Factor Authentication (Layer 2) — Implementation Plan

Status: **CODE COMPLETE (2026-07-25; enforcement policy revised 2026-07-26 — see §6), BROWSER
VERIFICATION PENDING, NO NEXT TASK DECIDED — AWAITING INSTRUCTIONS.** All 11 steps in §11 are
implemented and checked off. `docs/COMPLETION.md`'s "TOTP two-factor authentication (Layer 2)" session
summary (plus its 2026-07-26 follow-up entry) has the file-by-file record, and
`docs/AUTH-IMPLEMENTATION.md`'s Layer 2 entry has the user-facing summary **plus a "Verification
status" note that is still genuinely open**: everything was verified at the API level (a from-scratch
TOTP implementation standing in for an authenticator app on 2026-07-25; the 2026-07-26 opt-in revision
re-checked via `curl`) and `pnpm -r typecheck` is clean, but no live-browser pass has happened yet — the
opt-in prompt, enrollment screen, QR rendering, the sign-in challenge, the backup-codes modal's
dismiss-blocking, and the Settings page have only been verified by reading the code, not by seeing them
run. `docs/AUTH-IMPLEMENTATION.md` has the exact manual walkthrough to run when that's possible.

**Do not assume the next task is Layer 3 (or anything else) without being told.** This file is
intentionally left as-is (not rewritten for a new feature per the rolling convention below) because
Layer 2 isn't fully closed out yet — it's implemented but unverified in a browser. If resumed with no
further direction, the right move is to report this status and ask what to do next (run the browser
verification pass together, start Layer 3 planning, or something else) — not to pick one unprompted.

> The previous PLAN.md (progressive sign-in lockout) was **implemented 2026-07-25**; its record now
> lives in `docs/COMPLETION.md`. Per this file's rolling convention, it now tracks the new work below.
>
> The full auth-layering brainstorm (all options considered, trade-offs, phased rollout, "don't do"
> list) lives in `docs/AUTH-PLAN.md`. The user-facing per-layer summary (what each layer accomplishes,
> in plain terms) lives in `docs/AUTH-IMPLEMENTATION.md`. This file is the actionable, file-by-file
> implementation plan for just the Layer 2 piece (Phase 2 of that rollout) — update
> `docs/AUTH-IMPLEMENTATION.md`'s Layer 2 entry from PLANNED to IMPLEMENTED, and add a
> `docs/COMPLETION.md` session summary, once this ships.

---

## 0. Decision: authenticator-app TOTP (not email-delivered codes)

The original ask was a plan where "the email sends a 6-digit code that has to be replicated after
layer 1" — that mechanism is Email OTP, not TOTP. TOTP (Time-based One-Time Password, RFC 6238) is the
authenticator-app kind — a code generated *locally* by an app (Google Authenticator, 1Password, etc.)
from a secret established once at enrollment, never transmitted over the network again. An
email-delivered code is a different mechanism (OTP over an email channel) with a different — weaker —
security profile. They're compared side by side in `docs/AUTH-PLAN.md` §2 and §6.

**Confirmed 2026-07-25: this plan implements authenticator-app TOTP, not email-delivered codes.**
Three reasons:

1. **Tollgate has zero outbound email infrastructure today** (no verification emails, no
   password-reset emails — confirmed by grep, nothing exists). Email-delivered codes need that
   infrastructure built from scratch; TOTP needs none — the "delivery channel" is an app already on
   the user's phone.
2. **Email OTP inherits tollgate's existing unverified-email gap.** Nothing today proves the address
   on a user's account belongs to them. Sending a "second factor" to an unproven inbox doesn't prove
   possession of anything meaningful — it's security theater until email verification (Phase 0 in
   `docs/AUTH-PLAN.md`) ships regardless.
3. **This is exactly the wrong app to hand the weaker option to.** Tollgate's session cookie is an
   admin-plane control surface (mint spendable tokens, move budget caps, undo freezes). TOTP is free,
   requires no delivery infrastructure, and is immune to "attacker also controls the email account" —
   a correlated-risk scenario that specifically undermines email OTP.

The email-code mechanism is kept in **§12 (Appendix)** for reference only — it was considered and not
chosen. Everything below is scoped to TOTP.

---

## 1. Goal & exact requirements

Add a second authentication factor on top of the existing email+password sign-in, so a correctly
guessed, reused, or breached password alone no longer produces a session — and make it **mandatory for
every account from day one** (decided 2026-07-25, see §6).

1. Users can enroll a TOTP authenticator app (scan QR or enter a secret manually).
2. Enrollment issues one-time backup codes, shown once, that the user must acknowledge saving before
   the enroll flow can be dismissed.
3. **Every account must enroll before it can use the dashboard at all** — a signed-in-but-unenrolled
   session is blocked from every `/v1/*` route and forced into the enrollment flow (this is the
   "mandatory" decision — see §6 for exactly how it's enforced).
4. After enrollment, every sign-in from an untrusted browser requires a valid 6-digit TOTP code (or a
   backup code) after the password step, before a session cookie is issued.
5. A "trust this device" option suppresses the repeat prompt on that browser for a bounded period.
6. Users can view/regenerate backup codes and disable 2FA from a Settings/Security page, both gated
   by password re-entry.
7. None of this weakens or replaces the existing password lockout (`login-throttle.ts`) — it's
   additive.

## 2. Mechanism: Better Auth's `twoFactor` plugin

Source-verified against the actually-installed `better-auth@1.6.25` (read directly from
`node_modules`, cross-checked against the live better-auth.com docs — not assumed from memory, since
this library moves fast):

- Plugin export: `twoFactor()` from `better-auth/plugins` — a peer of the `organization()` plugin
  already in `backend/api/src/lib/auth.ts`, following the exact same pattern (plugin → auto-migrated
  schema → hooks) that's already proven out in this codebase.
- Confirmed options (`dist/plugins/two-factor/types.d.mts`): `issuer` (string shown in the
  authenticator app), `totpOptions` (`digits` default 6, `period` default 30s), `backupCodeOptions`
  (`amount` default 10, `length` default 10), `skipVerificationOnEnable`, `allowPasswordless`,
  `twoFactorCookieMaxAge` (default 600s — window to complete the 2FA step after the password step),
  `trustDeviceMaxAge` (default 2,592,000s / 30 days), and `accountLockout` (enabled by default,
  `maxFailedAttempts` 10, `durationSeconds` 900).
- Confirmed sign-in behavior (`dist/plugins/two-factor/index.mjs`): on a 2FA-enabled account, the
  plugin's hook **deletes the just-issued session and withholds the cookie entirely**, returning
  `{ twoFactorRedirect: true, twoFactorMethods: [...] }` instead of a session. A bare correct password
  genuinely produces nothing usable.
- The plugin self-applies its own rate limit on all `/two-factor/*` paths (10s window, max 3),
  independent of tollgate's existing `rateLimit` config in `auth.ts`.

**Config decisions locked in for this build** (§9 has the full decision log):
`issuer: "Tollgate"`, `trustDeviceMaxAge` left at the library default (30 days), `backupCodeOptions`
left at the library default (10 codes, 10 chars). All three are one-line config values, trivially
changed later — not worth spending more decision time on now.

## 3. Database

**No hand-written migration needed.** Better Auth owns this table the same way it already owns
`organization`/`member` — `backend/api/src/db/auth-migrate.ts` calls `getMigrations(auth.options)`,
which schema-diffs and is idempotent. Adding the plugin and running
`pnpm --filter @tollgate/api db:auth-migrate` (or letting it run on next boot) will:

- Add `user.twoFactorEnabled boolean default false`.
- Create a `twoFactor` table: `id`, `userId`, `secret`, `backupCodes`, `verified`,
  `failedVerificationCount`, `lockedUntil`.

Nothing in `backend/api/src/db/schema.ts` (the drizzle-owned app tables) changes.

## 4. Backend integration points

- **`backend/api/src/lib/auth.ts`** (edit) — add `import { twoFactor } from "better-auth/plugins"`;
  add `twoFactor({ issuer: "Tollgate" })` to the `plugins` array next to `organization()`.
- **`backend/api/src/lib/require-auth.ts`** (edit — **this is the mandatory-enforcement gate**,
  needed because of the "mandatory for everyone" decision in §6; a pure opt-in build would have needed
  zero changes here). After the existing session/`activeOrgId` checks, add: if
  `result.user.twoFactorEnabled` is `false`, `reply.code(403).send({ error: "two_factor_required" })`
  instead of letting the handler run — mirrors the existing `no_active_organization` 403 pattern
  immediately above it in the same function. Stamp `req.authUser`/`req.activeOrgId` only after this
  check passes.
- **`backend/api/src/db/auth-migrate.ts` / `run-auth-migrate.ts`** — no changes; the existing
  `getMigrations` call picks up the new plugin's schema automatically.

## 5. Frontend integration points

- **`frontend/dashboard/lib/auth-client.ts`** (edit) — add `twoFactorClient()` from
  `better-auth/client/plugins` next to the existing `organizationClient()`. Optionally pass
  `onTwoFactorRedirect` to control what happens on a sign-in that needs a second factor, instead of the
  plugin's default full-reload redirect.
- **New Settings/Security surface** (confirm whether a settings page exists yet — if not, this is new):
  1. **Enable 2FA** — button calling `authClient.twoFactor.enable({ password })`; render the returned
     `totpURI` as a QR code (e.g. `qrcode.react`) plus the raw secret as a manual-entry fallback; a
     code-entry field calling `authClient.twoFactor.verifyTotp({ code })` to confirm enrollment.
  2. **Backup-codes acknowledgment modal** — shown once, immediately after enrollment succeeds,
     displaying the returned `backupCodes` (10 by default). Must block dismissal until the user
     confirms they've saved them — codes are shown once and unrecoverable in plaintext afterward
     except via `authClient.twoFactor.generateBackupCodes({ password })`, which invalidates the old set.
  3. **Disable 2FA** — password re-entry required.
  4. **View/regenerate backup codes** — password re-entry required.
- **Sign-in flow** (`components/auth-form.tsx` / `app/sign-in/page.tsx`, edit) — recognize
  `{ twoFactorRedirect: true, twoFactorMethods: [...] }` in the sign-in response and render a
  code-entry screen calling `authClient.twoFactor.verifyTotp({ code, trustDevice })`, with a fallback
  link "Use a backup code" calling `authClient.twoFactor.verifyBackupCode({ code })`.
- **Forced-enrollment redirect (new, because of the mandatory decision)** — `frontend/dashboard/lib/api.ts`
  (which already bounces any `401` to `/sign-in`) needs a matching rule: on `403 two_factor_required`,
  redirect to a new forced-enrollment route (e.g. `/enroll-2fa`) that renders the "Enable 2FA" flow
  from point 1 above with no way to reach the dashboard until it succeeds. `middleware.ts`'s optimistic
  cookie-based gate can stay as-is (it only checks session-cookie presence); the real enforcement is
  server-side in `require-auth.ts`, this is just making sure the dashboard UI reacts to that 403
  correctly instead of showing a broken/empty page.
- **Sign-up path** — because enrollment is mandatory and `autoSignIn` puts a brand-new user straight
  into a session, a fresh sign-up will immediately hit the same `two_factor_required` gate on its first
  `/v1/*` call. Confirm `app/sign-up/page.tsx` routes through the same 403 handling as sign-in rather
  than assuming sign-up always lands cleanly on the dashboard.

## 6. Enforcement policy — REVISED 2026-07-26: opt-in, encouraged at sign-up + toggleable in Settings

**Superseded the original "mandatory for every account, from day one" decision below** — reversed
2026-07-26 at the product owner's direction. `require-auth.ts` no longer checks `user.twoFactorEnabled`
at all; an account with 2FA off authenticates on password alone, same as before Layer 2 existed. What
changed instead of the backend gate:

- **Sign-up flow (`auth-form.tsx`, `app/enroll-2fa/page.tsx`):** a fresh sign-up is routed to
  `/enroll-2fa`, which now opens on an encouragement prompt ("Secure your account?" / "makes it
  significantly harder for someone else to get into your dashboard, even if they get hold of your
  password") with **"Enable two-factor authentication"** and **"Skip for now"** — skipping goes
  straight to the dashboard, no gate, no forced return trip. Sign-in (an existing account) never sees
  this prompt, even if that account never enrolled — it's a one-time, sign-up-only nudge, not a
  recurring nag.
- **Settings (`app/settings/page.tsx`, `two-factor-manage.tsx`):** unchanged mechanically — it already
  swapped between `TwoFactorEnroll`/`TwoFactorManage` based on live `twoFactorEnabled` — but the copy no
  longer claims 2FA is required, and disabling is now a genuine opt-out (no re-enrollment forced on the
  next request) rather than "start over."
- **`lib/api.ts`:** the `403 two_factor_required` → `/enroll-2fa` redirect rule is removed entirely,
  since the backend never returns that code anymore.

**Original decision (2026-07-25, for the historical record — no longer in effect):** Better Auth does
not gate sign-in on 2FA status by itself, so mandatory enforcement was a small custom check:
`require-auth.ts` refused any session where `user.twoFactorEnabled` was `false` (403
`two_factor_required`), for every account, no role distinction. Simpler to implement than a
role-conditional version, but meant every existing account — not just new sign-ups — would be forced
into the enrollment flow the moment it shipped.

## 7. Recovery & lockout — DECIDED: manual operator action, no runbook yet

Decided 2026-07-25 (was Q5). Tollgate is single-admin-per-org today. If a user who opted into 2FA loses
both their authenticator device and their backup codes, there's no self-service recovery in this build
— they are locked out of the dashboard entirely (2FA being opt-in, per §6, only narrows *who* this can
happen to; it doesn't add a "skip it" path for someone already enrolled and mid-challenge). Handling
for now: **you, as the operator, clear it manually** via `auth.api.disableTwoFactor` (called
server-side, e.g. from a one-off script or a REPL against the running api) or a direct, audited delete
of the affected row in the `twoFactor` table. No written runbook for this cut — acceptable at current
single-operator scale; revisit if/when this actually happens or the product grows past one operator
knowing every account.

Other recovery/lockout notes:
- **Two independent lockout systems.** The plugin's own `accountLockout` (10 failed 2FA attempts → 15
  min lock, tracked on the `twoFactor` row) is separate from the existing password lockout in
  `login-throttle.ts`. Both are fine functionally but are two things to monitor, not one.
- **Not phishing-proof.** A real-time adversary-in-the-middle relay can still capture a correctly
  entered TOTP code along with the password. This is a known, accepted limitation of TOTP as a class —
  closing it fully means passkeys/WebAuthn (`docs/AUTH-PLAN.md` §3 runner-up), out of scope here.

## 8. What this plan does NOT cover

- **Layer 3 (step-up re-auth on sensitive agent-control actions)** — a separate, future plan per
  `docs/AUTH-PLAN.md` §4 / Phase 3. TOTP protects *login*; it does not add re-verification to an
  already-open session before it mints a token, raises a budget, or unfreezes an agent.
- **Email verification / password reset** — the Phase 0 prerequisite from `docs/AUTH-PLAN.md`. Not
  required for TOTP to work correctly (TOTP doesn't touch email at all), but still a gap worth closing
  in parallel since it undermines account recovery generally.
- **Passkeys/WebAuthn** — the recommended upgrade path once TOTP ships (Phase 4), not part of this cut.

## 9. Decision log (formerly "open questions" — all resolved)

- **Approach:** Authenticator-app TOTP, not email-delivered codes. Confirmed 2026-07-25 (§0). The
  email-OTP alternative in §12 is not being built.
- **Enforcement policy:** Opt-in — encouraged via a one-time prompt right after sign-up, toggleable
  anytime from Settings. Decided 2026-07-26 (§6), superseding the original 2026-07-25 "mandatory for
  every account from day one" decision.
- **`issuer` string:** `"Tollgate"`. Defaulted — trivially changed later, not worth a separate decision
  round.
- **Trust-device duration:** Library default, 30 days. Defaulted — same reasoning.
- **Break-glass recovery:** Manual operator action, no written runbook for this cut. Decided
  2026-07-25 (§7).
- **Backup code count/format:** Library default, 10 codes / 10 chars. Defaulted — same reasoning.

## 10. Testing plan

- **Manual pass (primary, no existing test harness for auth flows to extend):**
  1. Enroll: scan QR (or enter secret manually), confirm with a real code from an authenticator app,
     confirm the backup-codes modal appears and blocks dismissal until acknowledged.
  2. Sign out, sign back in: password succeeds, then the TOTP challenge screen appears; enter the
     live code, land on the dashboard.
  3. Repeat sign-in with "trust this device" checked; sign out/in again on the same browser — the
     challenge screen should NOT reappear.
  4. Use a backup code instead of a TOTP code on the challenge screen — confirm it works once and a
     second use of the same code fails.
  5. Disable 2FA (requires password), confirm the account can sign in with password alone again;
     re-enable and confirm a fresh QR/secret is issued (not the old one).
  6. **Mandatory-enforcement check:** on an account that has never enrolled, confirm any `/v1/*` call
     returns `403 two_factor_required` and the dashboard redirects to the forced-enrollment screen
     rather than rendering a broken/empty page.
  7. Fat-finger the TOTP code 10 times in a row — confirm the plugin's own `accountLockout` kicks in
     (15 min) independently of the existing password lockout.
- **Regression:** confirm the existing password-only lockout ladder (`login-throttle.ts`) still
  triggers correctly on repeated wrong passwords, unaffected by the new plugin.
- `pnpm -r typecheck` clean across all workspaces before calling this done.

## 11. Implementation checklist — execute in this exact order

- [x] **Step 1 — Backend plugin.** Add `twoFactor({ issuer: "Tollgate" })` to
      `backend/api/src/lib/auth.ts`'s `plugins` array (§4).
- [x] **Step 2 — Migrate.** Run `pnpm --filter @tollgate/api db:auth-migrate` (or restart the api) and
      confirm the new `twoFactor` table and `user.twoFactorEnabled` column exist (§3).
- [x] **Step 3 — Enforcement gate.** Edit `backend/api/src/lib/require-auth.ts` to 403
      `two_factor_required` when `user.twoFactorEnabled` is false (§4, §6).
- [x] **Step 4 — Client plugin.** Add `twoFactorClient()` to
      `frontend/dashboard/lib/auth-client.ts` (§5).
- [x] **Step 5 — Enrollment UI.** Build the Settings/Security "Enable 2FA" flow: QR + manual secret,
      code-entry confirmation, backup-codes acknowledgment modal (§5, point 1–2).
- [x] **Step 6 — Sign-in challenge UI.** Extend `auth-form.tsx`/`app/sign-in/page.tsx` to handle
      `twoFactorRedirect`, including the "use a backup code" fallback and "trust this device" option
      (§5).
- [x] **Step 7 — Sign-up path.** Confirm/fix `app/sign-up/page.tsx` so a brand-new account also lands
      on the forced-enrollment screen rather than assuming a clean dashboard landing (§5).
- [x] **Step 8 — Forced-redirect wiring.** Add the `403 two_factor_required` → `/enroll-2fa` redirect
      rule in `frontend/dashboard/lib/api.ts` (§5).
- [x] **Step 9 — Settings management.** Add "Disable 2FA" and "view/regenerate backup codes" actions,
      both requiring password re-entry (§5, points 3–4).
- [x] **Step 10 — Test.** Run the full manual pass in §10, plus `pnpm -r typecheck`.
- [x] **Step 11 — Docs.** Flip `docs/AUTH-IMPLEMENTATION.md`'s Layer 2 entry from PLANNED to
      IMPLEMENTED; add a dated session summary to `docs/COMPLETION.md` (same format as the "Progressive
      sign-in lockout" entry) describing what shipped, file-by-file, plus verification results.

---

## 12. Appendix — the email-delivered-code alternative (considered, not chosen)

Kept for reference in case this gets revisited later (e.g. as a recovery-fallback channel, per
`docs/AUTH-PLAN.md` §6, once email verification exists). Here's exactly how it would have been built —
including a correction from research:

**`emailOTP` is not the right plugin for this.** It's for passwordless primary sign-in or address
verification, not a password-plus-code second factor — its docs don't mention any integration with
Better Auth's actual 2FA system. The correct mechanism is still the **same `twoFactor` plugin**, using
its delivery-channel-agnostic OTP method with a **custom `sendOTP` callback** you write yourself:

```
twoFactor({
  issuer: "Tollgate",
  otpOptions: {
    async sendOTP({ user, otp }, request) {
      // your own email-sending call — Resend/SES/nodemailer/etc.
    },
  },
})
```

Everything else (hook behavior, `twoFactorRedirect`, backup codes, trust-device, account lockout)
works identically to the TOTP path — the only difference is the second-factor delivery mechanism.

**What this adds on top of the TOTP plan above:**

- **Real email-sending infrastructure from zero** — provider account (Resend/SES/etc.), API key/secret
  management, deliverability monitoring, bounce/failure handling. None of this exists in tollgate
  today.
- **A resend/abuse rate limit separate from sign-in throttling** — OTP-send volume needs its own cap
  (the existing `login-throttle.ts` guards logins, not "send me another code" floods) or an attacker
  can run up sending costs/volume.
- **Weaker guarantee than TOTP once built**, for the reasons in §0: correlated risk with email-account
  compromise, and (until Phase 0 ships) an unverified-address gap that undermines the whole point.

**Recommendation stands: build TOTP now; treat email-delivered codes as, at most, a recovery/fallback
channel to add later once email verification (Phase 0) exists — not the primary second factor.**
