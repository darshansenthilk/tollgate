# COMPLETION.md

**Purpose:** This file details the features and changes shipped on the current branch so far. It exists as context for Claude (or any future contributor) to pick up this branch's history without needing to re-derive it from scratch — read this before starting new work here.

**Branch note:** work moved `Eshaan` → `Eshaan-next` on 2026-07-23. `Eshaan` was rebased onto `origin/main`, fast-forwarded into it, and retired (`origin/Eshaan` deleted). `Eshaan-next` was cut from the new `origin/main` and tracks `origin/Eshaan-next`.

---

## Session summary — 2026-07-26

### TOTP two-factor authentication — mandatory → opt-in

**Problem:** Layer 2 (TOTP, see the entry below) shipped 2026-07-25 as mandatory for every account,
with no opt-out. The product owner decided that was the wrong default: reversed to opt-in, encouraged
at sign-up, toggleable anytime from Settings.

**What changed:**
- `backend/api/src/lib/require-auth.ts` — removed the `403 two_factor_required` check entirely. The
  gate no longer looks at `user.twoFactorEnabled` at all; only the session/active-org checks remain.
  An account that never enrolled (or later disables it) authenticates on password alone.
- `backend/api/src/lib/auth.ts` — updated the `plugins` comment to drop the "mandatory" framing (no
  functional change; the plugin itself was always opt-in per account, only the custom gate enforced
  otherwise).
- `frontend/dashboard/lib/api.ts` — removed the `403 two_factor_required` → `/enroll-2fa` redirect
  rule, since the backend never returns that code anymore.
- `frontend/dashboard/components/auth-form.tsx` — a successful sign-up now routes to `/enroll-2fa`
  (the new opt-in prompt, below) instead of straight to `/`. Sign-in is unaffected either way.
- `frontend/dashboard/app/enroll-2fa/page.tsx` — rewritten from a forced enrollment gate into a
  two-step opt-in prompt: an initial "Secure your account?" screen with **"Enable two-factor
  authentication"** and **"Skip for now"** buttons (skip goes straight to `/`, no gate on the other
  side), and the existing `TwoFactorEnroll` flow if they opt in.
- `frontend/dashboard/app/settings/page.tsx` — copy changed from "Required for every Tollgate
  account" to "Optional, but recommended…"; the existing `TwoFactorEnroll`/`TwoFactorManage` swap
  logic (based on live `twoFactorEnabled`) needed no functional change — it already worked as a toggle.
- `frontend/dashboard/components/two-factor-manage.tsx` — the "Disable 2FA" dialog copy changed from
  "you'll be forced to re-enroll" to "you can turn it back on anytime," since disabling is now a real
  opt-out rather than "start over."
- `frontend/dashboard/components/two-factor-enroll.tsx`, `main-nav.tsx` — comments updated to describe
  the opt-in prompt instead of a forced gate; no functional change.
- `PLAN.md` §6, `docs/AUTH-IMPLEMENTATION.md` (Layer 2 entry) — updated to record this as the current
  policy, preserving the original 2026-07-25 mandatory decision for the historical record.

**Verified (2026-07-26):** `pnpm -r typecheck` clean across all workspaces. API-level smoke test against
the running dev server: signed up a fresh account via `curl`, confirmed `twoFactorEnabled: false` in
the response, then confirmed `GET /v1/agents` immediately returns `200 []` — not `403
two_factor_required` — proving the account has full dashboard access without ever enrolling. **Not
verified this session:** the opt-in prompt screen, the Settings copy, and the disable-dialog copy have
only been checked by reading the code, not by clicking through them in a browser (no browser automation
was installed/used this session).

### Merged into `main` — fixed a post-merge redirect bug, verified new + existing accounts

**Problem:** The user merged `Eshaan-2` (the branch carrying both Layer 1 and the Layer 2 work above)
into `main` themselves, resolving conflicts against `origin/main`'s independent landing-page/dashboard
restructure (root `/` became the public marketing page; the real dashboard moved to `/agents`), then
pushed it and cut a fresh local branch, `Eshaan-test-main`, off the result. Asked to confirm the merge
was clean and Auth still works for both new and pre-existing accounts.

**Branch state confirmed:** `Eshaan-test-main` is byte-for-byte identical to `origin/main` — both at
commit `f64ca94` ("Merge branch 'Eshaan-2'"), confirmed via a real fetch (WSL-side `git fetch` fails
with no credentials in this environment; had to fetch via `powershell.exe` against Windows-side git,
which has GitHub credentials configured — see the dev-environment note). The working tree's ~148
"modified" files were the same CRLF/LF line-ending noise seen earlier in this branch's history, zero
real content drift once whitespace is ignored.

**Bug found and fixed:** `origin/main`'s dashboard split moved the authenticated app from `/` to
`/agents` and `middleware.ts` was updated for it correctly, but 5 client-side post-auth navigations in
the Layer 2 code were never updated and still targeted bare `/` (now the unauthenticated marketing
page) — silently landing a freshly authenticated user on the landing page instead of the dashboard:
- `frontend/dashboard/components/auth-form.tsx` — the non-2FA sign-in success redirect, and the
  `TwoFactorChallenge` `onVerified` callback.
- `frontend/dashboard/app/enroll-2fa/page.tsx` — the "Skip for now" handler, the `TwoFactorEnroll`
  `onEnrolled` callback, and the already-enrolled-bookmark `useEffect` redirect.

All 5 now target `/agents`. Also cleared a stale `.next/types` cache (referencing the now-deleted
`app/page.tsx`) that was failing `tsc --noEmit` for an unrelated reason.

**Verified (2026-07-26), on the merged `Eshaan-test-main` branch:** `pnpm -r typecheck` clean across
all workspaces after the fix. Full API-level pass with a fresh synthetic account: sign-up → immediate
`200` on `/v1/agents` (Layer 1 alone suffices) → enable 2FA → verify → `twoFactorEnabled: true` → sign
out → sign in → `twoFactorRedirect: true` (password alone no longer resolves a session) → verify →
dashboard access restored → disable → access retained (real opt-out). Layer 1 regression: 5 wrong
passwords on a second throwaway account correctly triggered `ACCOUNT_LOCKED` (5 min), with the
"N attempts remaining" messages appearing at the documented threshold. Route-gating regression:
unauthenticated `GET /` returns `200` (public marketing page), unauthenticated `GET /agents` returns
`307` (redirects to sign-in) — confirms the split is enforced correctly post-merge.

For the pre-existing real account (`eshaan.joshi07@gmail.com`, which the user had already enrolled in
2FA themselves via the browser earlier in this session): confirmed via a read-only Postgres query that
its `user` row, `twoFactor` row (secret + 10 backup codes present), `member`/org-ownership row, and
active session all survived the merge intact, and confirmed via Redis that it isn't sitting in a stale
login-throttle lockout. **Not verified:** an actual sign-in as this account — that needs the user's
real password and a live code from their authenticator app, neither of which this session had or
should ask for; left for the user to click through themselves now that the `/agents` redirect fix is
in.

---

## Session summary — 2026-07-25

### Progressive sign-in lockout

**Problem:** Better Auth's built-in per-IP rate limiter (10/min on `/sign-in/email`) blunts
high-volume automated attacks but does nothing to slow a targeted, patient attacker working one
account at a time — password guessing or credential-stuffing against a single known email could
proceed indefinitely as long as it stayed under the IP-based ceiling.

**What changed:** Added a progressive, self-resetting lockout keyed by normalized email, layered on
top of (not replacing) the existing IP limiter.

- `backend/api/src/lib/login-throttle.ts` (new) — Redis-backed lockout: 5 consecutive failures
  triggers a cooldown starting at 5 minutes and doubling each escalation (5→10→20→…) capped at 24h;
  hitting the cap resets escalation to 0; a success clears the record entirely; records auto-expire
  after 24h of inactivity. The failure-transition is a single Lua script (`redis.eval`) so concurrent
  requests can't race past the threshold. Keys are `HMAC-SHA256(normalized_email, BETTER_AUTH_SECRET)`
  so raw emails never sit in Redis, and counting is uniform for real and non-existent emails (no
  enumeration signal). Fails open (allows sign-in) if Redis is unreachable — the IP limiter remains as
  backstop during an outage.
- `backend/api/src/lib/auth.ts` — wired via Better Auth's `hooks.before`/`hooks.after`
  (`createAuthMiddleware`), guarded on `ctx.path === "/sign-in/email"`. The before-hook rejects a
  locked identifier before the password is even checked (a correct password doesn't bypass a lock).
  The after-hook reads `ctx.context.returned` to detect a genuine credential failure (401) vs. success,
  and throws a rewritten `APIError` carrying `code: "ACCOUNT_LOCKED"` / `LOGIN_ATTEMPTS_REMAINING` plus
  `retryAfter` once remaining attempts drop to 3 or fewer (stays generic before that, to avoid leaking
  attempt counts early).
- `backend/api/src/lib/login-throttle.test.ts` (new) — unit tests for the pure ladder function,
  escalation reset at the cap, and remaining-attempts math (3/3 passing via
  `node --import tsx --test`).
- `frontend/dashboard/components/auth-form.tsx` — on a 429/`ACCOUNT_LOCKED` response, stores
  `lockedUntil` in localStorage, disables the form, and renders a live countdown that persists across
  reload; on `LOGIN_ATTEMPTS_REMAINING` shows the server's exact remaining-attempts message.

**Verified (2026-07-25):** Manual API + browser pass — attempts 1→5 gave generic → "3/2/1 remaining"
→ locked (`retryAfter` 300s); a correct password submitted while locked was still rejected (before-hook
fires ahead of the credential check); a success cleared the record so the next failure started fresh;
the browser countdown rendered, disabled the form, and survived a reload.

---

### TOTP two-factor authentication (Layer 2)

**Problem:** Layer 1 (email + password) has one hard failure mode — a phished, reused, or breached
password is simply *correct*, and a correct password was game over: full access to mint spendable
agent tokens, move budget caps, and undo emergency freezes. See `docs/AUTH-PLAN.md` for the full
phased rollout this closes Phase 2 of, and `PLAN.md` for the resolved, file-by-file implementation
plan this session executed top to bottom.

**What changed:** Added Better Auth's `twoFactor` plugin (authenticator-app TOTP, not email-delivered
codes — see `PLAN.md` §0 for why) and made enrollment **mandatory for every account from day one**,
enforced with a small custom gate rather than a plugin option.

- `backend/api/src/lib/auth.ts` — added `twoFactor({ issuer: "Tollgate" })` to the `plugins` array,
  a peer of `organization()`. All other config (backup code count/format, trust-device duration,
  account-lockout thresholds) left at the library defaults — see `PLAN.md` §9's decision log.
- Schema — no hand-written migration; `pnpm --filter @tollgate/api db:auth-migrate` (Better Auth's
  own `getMigrations`) added `user.twoFactorEnabled boolean` and a `twoFactor` table (`secret`,
  `backupCodes`, `verified`, `failedVerificationCount`, `lockedUntil`).
- `backend/api/src/lib/require-auth.ts` — **the mandatory-enforcement gate.** After the existing
  session/`activeOrgId` checks, refuses any session where `user.twoFactorEnabled` is `false` with
  `403 { error: "two_factor_required" }`, before stamping `req.authUser`/`req.activeOrgId`. This runs
  on every `/v1/*` call, so it also retroactively gates any pre-existing account — intended, not a bug
  (there were zero pre-existing accounts in this environment when it shipped).
- `frontend/dashboard/lib/auth-client.ts` — added `twoFactorClient()`, deliberately without
  `onTwoFactorRedirect`/`twoFactorPage` (the sign-in form handles the `twoFactorRedirect` response
  inline instead, no full-page reload).
- `frontend/dashboard/components/two-factor-enroll.tsx` (new) — the enrollment flow shared by both
  surfaces below: password re-entry → `enable()` returns a `totpURI` + 10 backup codes → QR
  (`qrcode.react`, new dependency) + manual-entry secret (parsed straight out of the `otpauth://` URI's
  `secret` query param) + a live-code confirmation via `verifyTotp()`.
- `frontend/dashboard/components/backup-codes-modal.tsx` (new) — the backup-codes acknowledgment
  modal, shared by first enrollment and by regenerating codes later. No close button, and
  `onOpenChange` never flips `open` off on its own, so Escape/outside-click can't dismiss it — only
  checking the acknowledgment box and clicking Continue can.
- `frontend/dashboard/components/two-factor-challenge.tsx` (new) — the sign-in code-entry screen:
  toggles between a TOTP code (`verifyTotp`) and a one-time backup code (`verifyBackupCode`), a "trust
  this device" checkbox, and specific handling for the two ways a challenge can die from underneath the
  user (`INVALID_TWO_FACTOR_COOKIE` / `TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE`) by bouncing back to
  credentials rather than showing a dead-end error.
- `frontend/dashboard/components/auth-form.tsx` — sign-in now checks the sign-in response for
  `{ twoFactorRedirect: true }` and swaps the card over to `TwoFactorChallenge` instead of navigating
  (there's no session yet to navigate with — Better Auth deletes the one it just issued and withholds
  the cookie). Sign-up is unaffected: a brand-new account's `twoFactorEnabled` defaults `false`, so the
  hook never fires for it — it lands on `/` and immediately hits the `two_factor_required` gate below.
- `frontend/dashboard/lib/api.ts` — `request()` now bounces a `403 two_factor_required` to
  `/enroll-2fa`, mirroring the existing `401` → `/sign-in` rule.
- `frontend/dashboard/app/enroll-2fa/page.tsx` (new) — the forced-enrollment landing page reached via
  the rule above; renders `TwoFactorEnroll` full-page with no dashboard nav (added to `main-nav.tsx`'s
  no-nav route set) and a "Sign out" escape hatch for the wrong-account case.
- `frontend/dashboard/app/settings/page.tsx` + `components/two-factor-manage.tsx` (new) — the
  Settings/Security surface: swaps between `TwoFactorEnroll` and `TwoFactorManage` based on the live
  session's `twoFactorEnabled` (reactive — the plugin's client-side atom listener refreshes the session
  after every `/two-factor/*` call, no manual refresh needed). `TwoFactorManage` offers "Regenerate
  backup codes" and "Disable 2FA," both gated by password re-entry. There is no "view existing backup
  codes" — Better Auth only exposes regenerate (which invalidates the old set); the UI reflects that
  limit rather than working around it. Disabling doesn't carve out an exception to "mandatory": the
  very next `/v1/*` call re-gates the same account immediately, which is intended ("start over," not
  "opt out" — see `PLAN.md` §6).
- `backend/api/package.json` — added `zod` as a direct dependency (matching `better-auth`'s own
  `^4.3.6` range). Without it, `tsc` failed on the exported `auth` const with TS2742 ("inferred type...
  cannot be named without a reference to zod/v4/core") — a pnpm node_modules isolation issue where a
  transitive dependency's type isn't nameable from a package that doesn't declare it directly.

**Verified (2026-07-25):** No existing test harness for auth flows to extend (per `PLAN.md` §10), so
this was an API-level pass driving the api directly (own from-scratch RFC 6238 TOTP implementation
standing in for an authenticator app, since no browser automation was used this session) plus a full
manual code re-read of every new frontend file:
- Sign-up → mandatory gate (`403 two_factor_required` on `/v1/agents`) → `enable()` issues a
  `totpURI`/10 backup codes → `verifyTotp()` completes enrollment → gate clears (`200`).
- Sign-out/sign-in on an enrolled account → `twoFactorRedirect: true`, no session issued (`401` on
  `/v1/agents` until the challenge completes) → a fresh TOTP code completes it → dashboard usable.
- A backup code works exactly once; reusing it fails `401 INVALID_BACKUP_CODE`.
- "Trust this device" (`trustDevice: true`) suppresses the challenge entirely on the next sign-in from
  the same client.
- The plugin's own account-level lockout (10 cumulative failed verifications, independent of
  `login-throttle.ts`'s password lockout) does trip `429 ACCOUNT_TEMPORARILY_LOCKED` — confirmed on the
  request *after* the 10th failure (the 10th failing request itself still returns a normal
  `INVALID_CODE`, since the lock is asserted at the start of the next request, not retroactively); a
  subsequently-correct code is still rejected while locked. The plugin's separate endpoint-level rate
  limit (3 requests/10s on `/two-factor/*`) was also observed independently and required pacing the
  test script around it.
- Disabling 2FA immediately re-trips the mandatory gate on the very next `/v1/*` call; re-enabling
  issues a demonstrably different secret and backup codes than the original enrollment.
- Regression: the pre-existing password lockout (`login-throttle.ts`) still trips `ACCOUNT_LOCKED`
  after 5 consecutive wrong passwords, confirmed in isolation (an earlier combined test run had shown a
  false failure here from exhausting a shared IP-keyed rate-limit bucket across many prior test steps —
  not a real regression).
- `pnpm -r typecheck` clean across all five workspaces.
- **Not verified this session:** live browser interaction (QR rendering, the enrollment/challenge
  screens, the backup-codes modal's dismiss-blocking, the Settings page) — browser automation was
  intentionally not used this session (see below). The dev servers were left running
  (api `:4000`, dashboard `:3000`) for a manual click-through.

**Environment note:** this session ran from a WSL2 shell with no Node install of its own; all
`pnpm`/`node` invocations went through `powershell.exe` against the Windows-side Node, and
`172.22.0.1` (the WSL default gateway) rather than `localhost` was needed to reach the Windows-hosted
dev servers from WSL-side `curl`. Docker Desktop's engine also had to be started before
`docker-compose up -d` would work. A Chromium download (via Playwright) was started to drive a real
browser for this verification pass but was stopped and removed at the user's request partway through;
API-level verification (above) was used instead.

---

## Session summary — 2026-07-15

### Feature 1: "Assistant" category (renamed from "Provider")

**Problem:** The agent-creation form and agents table used the label "Provider" with options "OpenAI"/"Anthropic" — internal/company-facing naming rather than the consumer-facing product names users actually recognize.

**What changed:** Renamed the category to "Assistant" throughout the dashboard, and its two options to the product names ChatGPT/Claude, including the underlying stored values (not just display labels).

- `frontend/dashboard/components/create-agent-dialog.tsx:26-29` — `PROVIDERS` array values changed from `openai`/`anthropic` to `chatgpt`/`claude`; labels to "ChatGPT"/"Claude".
- `frontend/dashboard/components/create-agent-dialog.tsx:129` — field label changed "Provider" → "Assistant".
- `frontend/dashboard/components/create-agent-dialog.tsx:65-67` — validation error message updated to "Select an assistant".
- `frontend/dashboard/app/page.tsx:148` — agents table column header "Provider" → "Assistant".
- `backend/api/src/routes/agents.ts:27` — `ALLOWED_PROVIDER_SLUGS` allow-list updated to `["claude", "chatgpt"]` so agent creation accepts the new values.
- `demo/seed.sh`, `demo/README.md` — updated to create/describe the demo agent with `providerSlug: "chatgpt"` instead of `"openai"`, so the demo script still passes the new allow-list.
- Existing dev-DB rows normalized in place (`openai`→`chatgpt`, `anthropic`/`Claude`→`claude`) so the running dashboard didn't show stale values.

---

### Feature 2: Real Claude (Anthropic) adapter in the proxy

**Problem:** Before this, "Claude" was selectable as an agent's assistant, but no code actually existed to route a request to Anthropic's API — the proxy's adapter registry (`backend/proxy/src/adapters/registry.ts`) held only `openaiAdapter`. Any agent labeled "Claude" had no real destination at all.

**What changed:** Built a full `ProviderAdapter` implementation for Anthropic's Messages API and registered it, so `/claude/*` is now a genuinely working proxy route.

- `backend/proxy/src/adapters/claude.ts` (new file) — implements auth via `x-api-key` + `anthropic-version` headers (Anthropic's real scheme, distinct from OpenAI's `Bearer` token), URL building against `https://api.anthropic.com`, and cost metering from Anthropic's real usage field names (`input_tokens`/`output_tokens`) against a hardcoded price table for `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, and `claude-3-opus-20240229`.
- `backend/proxy/src/adapters/registry.ts:27` — registry now built as `buildRegistry([openaiAdapter, claudeAdapter])`.
- `.env.example` and `.env` — added `CLAUDE_UPSTREAM_KEY` (the proxy's vault resolves upstream keys by `<SLUG>_UPSTREAM_KEY` convention, per `backend/proxy/src/lib/vault.ts`).
- `backend/proxy/test/claude-route.test.ts` (new file) — 8 tests mirroring the existing OpenAI route suite: forwarding, cost metering, spend accumulation, unrecognized-model-costs-zero, budget/freeze denial, bad-token rejection, and (after Feature 3 below) the provider-mismatch case.

**Verified live:** created a real agent labeled "claude" against the running dev proxy and confirmed the call reached the actual `api.anthropic.com` and got a genuine `authentication_error` back (expected, since only a placeholder key is configured locally) — proof the adapter is wired correctly end-to-end, not just unit-tested.

---

### Feature 3: Assistant enforcement gate (the big one)

**Problem:** An agent's "Assistant" label (Feature 1) was purely cosmetic — stored in Postgres but never read by the proxy's hot path. A token created for "ChatGPT" could be used to call the real Claude route and vice versa, with zero enforcement. The proxy's own agent lookup (`backend/proxy/src/lib/agents.ts`) didn't even `SELECT` the `provider_slug` column, so the data wasn't just unchecked — it wasn't available to the hot path at all.

**What changed:** The proxy now rejects any request where the calling agent's declared assistant doesn't correspond to the adapter the request resolved to.

- `backend/proxy/src/lib/agents.ts:15,35,43,58` — `AuthedAgent` and the Postgres query (`pgAgentStore`) now include `providerSlug`, so the hot path actually has this data.
- `backend/proxy/src/adapters/registry.ts:45-63` — new `assistantAdapterSlugs` map: `{"chatgpt": "openai", "claude": "claude"}`. This is the one place that bridges the dashboard's consumer-facing assistant vocabulary to the proxy's routing-slug vocabulary (they intentionally differ — "chatgpt" the label vs. "openai" the adapter slug).
- `backend/proxy/src/routes/proxy.ts:33-37` (interface), `95-105` (check) — new step 3 in the request pipeline: `if (deps.assistantAdapterSlugs.get(agent.providerSlug) !== adapter.slug)` → `403 {"error": "provider_mismatch", providerSlug, assistantSlug}`. Injected via `ProxyDeps` like the registry/vault/etc., so the route handler itself still hardcodes no provider names — later pipeline steps (freeze, budget, forward, meter, settle) renumbered 4-9.
- `backend/proxy/src/index.ts:6,48-61` — wired `assistantAdapterSlugs` into production.
- `backend/proxy/test/helpers.ts` — test harness extended with an `assistantAdapterSlugs` override (defaults to the production map).
- `backend/proxy/test/openai-route.test.ts`, `backend/proxy/test/claude-route.test.ts`, `backend/proxy/test/provider-agnostic.test.ts` — every existing fake agent now carries a matching `providerSlug`; each suite gained a `provider_mismatch` test case. `provider-agnostic.test.ts` specifically also proves the *new* gate is generic/injectable (via a fictional `acme-assistant` → `acme` mapping), not just the routing dispatch.

**Verified live:** created one ChatGPT-labeled and one Claude-labeled agent against the running dev server and exercised all four combinations — both matched pairs passed the gate and reached their real upstream (getting genuine auth errors back from OpenAI/Anthropic themselves); both mismatched pairs were blocked with `403 provider_mismatch` before any upstream call.

**Net result:** the Assistant field is no longer decorative — it is now the actual authorization boundary determining which upstream an agent's token can reach.

---

### Other session activity (non-feature)
- Started the local dev stack (Docker infra, `proxy`/`api` via `pnpm dev:proxy`/`dev:api`, `dashboard` via `pnpm dev:dashboard`) and fixed a one-time `corepack enable` setup issue (missing shim directory).
- Scope change (recorded in Claude's memory, not code): the branch moved from a strict backend/frontend ownership split to feature-based work — full-repo edits are now in scope, superseding an earlier "backend-only" restriction.

**Full test status as of this writing:** `pnpm --filter @tollgate/proxy test` → 18/18 passing. `pnpm --filter @tollgate/proxy typecheck` and `@tollgate/shared typecheck` → clean.

---

## Session summary — 2026-07-23

### Feature 4: Opt-in "Select agents" mode (replaces the Actions column)

**Shipped in commit `613ae0a`.**

**Problem:** The dashboard offered two overlapping ways to stop or delete an agent — a per-row **Actions** column and always-visible checkboxes feeding a batch `SelectionToolbar`. The Actions column was redundant (ticking one checkbox does the same thing), it cost a permanent table column, and the checkboxes cluttered the table even when you never intended to select anything.

**What changed:** The table now shows no checkboxes and no Actions column by default. An amber **"Select agents"** button under "Create agent" toggles selection mode.

- `frontend/dashboard/app/page.tsx` — added `selectionMode` state + `exitSelectionMode()`; checkbox column gated behind it; Actions `TableHead`/`TableCell` deleted; toolbar renders on `selectionMode && selectedAgents.length > 0`.
- `frontend/dashboard/components/ui/button.tsx` — new `amber` variant reusing the existing `--amber: #f5b83d` token (defined only in `:root`, never overridden in `.dark`, so one value covers both themes).
- `frontend/dashboard/components/batch-stop-dialog.tsx` — parameterized with `mode: "stop" | "resume"` rather than cloned, driving the API call (`freezeAgent` vs `unfreezeAgent`), labels, and copy. Added `onCompleted?: () => void`.
- `frontend/dashboard/components/batch-delete-dialog.tsx` — added the same `onCompleted`, fired only on full success so partial failures stay selected for retry.
- `frontend/dashboard/components/selection-toolbar.tsx` — splits the selection into `stoppable` / `resumable` (excluding `archived`), rendering **Stop** and **Resume** only when their subset is non-empty.
- `frontend/dashboard/lib/agent-status.ts` (new) — `STOPPED_STATUSES` / `isStopped()`, extracted from what had been duplicated in `page.tsx` and `stop-agent-button.tsx`.
- **Deleted** `components/stop-agent-button.tsx` and `components/delete-agent-button.tsx` — `page.tsx` was their only importer.

**The trap this design exists to avoid:** removing the Actions column naively would have destroyed the **only** path to resume a stopped agent. `StopAgentButton` was the sole caller of `unfreezeAgent`; `BatchStopDialog` hardcoded `freezeAgent`. Any `soft_frozen`/`hard_frozen` agent — including ones auto-frozen for exceeding budget — would have become permanently unreactivatable. Hence the toolbar Resume button. Delete needed no equivalent fix; `BatchDeleteDialog` was already at full parity.

**Verified live:** created a disposable agent, froze it via the API, resumed it *through the new UI* (API confirmed `status: active`), then deleted it through the UI — which doubled as the delete auto-exit test. Confirmed Stop-only for active selections, Resume-only for stopped, both for mixed, and that the Resume dialog scoped itself to just the stopped agent ("Resume 1 agent") when 2 were selected.

### Feature 5: Selection-mode animations

**Uncommitted as of this writing.** `frontend/dashboard/app/page.tsx` only.

- **Pop** — checkbox mounts with `animate-in fade-in zoom-in-75 duration-200` (scale 0.75 → 1 + fade, no overshoot).
- **Slide** — the checkbox column's width transitions `0 → 40px` over 300ms `ease-out`, so the other columns glide instead of snapping.
- `motion-reduce:` variants on both.

**Non-obvious constraint, documented in code comments:** the transition must live on a plain `<div>` *inside* the cell, not on the `<th>`/`<td>`. With `table-layout: auto` the browser derives column widths from content and **ignores a width set on the cell** (measured 16px when 40px was requested). The cell carries `w-0 p-0` so it shrink-wraps to that inner div — without `w-0`, auto-layout hands the new column a share of leftover table width and it opened to 76px instead of 40px.

**Verified by measurement:** collapsed 0px / expanded 40px, "Name" column shifts exactly 40px, returns to 0px with no drift.

### Feature 6: Heading, nav label, and poll re-render fix

**Uncommitted as of this writing.**

- `frontend/dashboard/app/page.tsx` — `<h1>` is now "Agent Dashboard" at `text-3xl` (30px, up from `text-2xl`/24px) with a white → `#9CA3AF` gradient via `bg-linear-to-r from-white to-[#9CA3AF] bg-clip-text text-transparent`. It is `inline-block` deliberately: as a block element the `h1` spans the full container, so the text would only ever sample the leftmost near-white slice of the ramp. Note Tailwind v4 renamed `bg-gradient-*` → `bg-linear-*`, and interpolates in oklab by default.
- `frontend/dashboard/app/layout.tsx:36` — nav link "Agents" → "Agent Dashboard" (href unchanged).
- `frontend/dashboard/app/page.tsx`, `refresh()` — **performance fix.** The 3s poll called `setAgents(data)` unconditionally with a fresh array, re-rendering the whole table every tick even when nothing changed; landing mid-animation, that was a visible frame hitch. Now returns the previous reference when the payload is unchanged so React bails out — the same pattern the selection pruning below it already used. **Measured: 1 × 60ms long task per 10s idle → 0 long tasks, 0ms blocking.**

### Other session activity (non-feature)
- `Eshaan` rebased onto `origin/main` (conflicts in `proxy.ts` and `create-agent-dialog.tsx`), fast-forwarded into `origin/main`, then retired in favour of `Eshaan-next`. Applied drizzle migrations `0002`/`0003` to the local dev DB.
- Rebase surfaced a latent bug git had auto-merged cleanly: `MODELS_BY_PROVIDER` was keyed `openai`/`anthropic` while `ProviderSlug` was `chatgpt`/`claude` — a type error and a runtime `undefined`. Rekeyed per `assistantAdapterSlugs`.

**Known open issue (pre-existing, not introduced here):** the create-agent model dropdown offers `opus`/`sonnet`/`haiku`, but the Claude adapter prices full model IDs like `claude-3-5-sonnet-20241022` (`backend/proxy/src/adapters/claude.ts:14`). Agents created with those values never match a price entry and meter at 0.

**Test status:** `pnpm -r test` → 18/18 passing. `pnpm typecheck` → clean across all 4 workspaces.

---

## Session summary — 2026-07-24

### Perf investigation: "Create agent" / sidebar lag — Step 1 result

**Not dev-mode-only. The plan's stop-condition did not trigger.** Production build
(`183 kB` First Load JS, 593 KB decoded JS / 31 requests, vs dev's ~3 MB / ~70) served on
:3100 while dev stayed on :3000:

| Interaction (production build) | Mount | Long task |
|---|---|---|
| "Create agent" dialog, cold trial 1 | 110 ms | 112 ms |
| "Create agent" dialog, cold trial 2 | 58 ms | 59 ms |
| Agent-info sidebar | 21 ms | none |
| Bare "Sort by" `Select` popup (no dialog) | 63 ms | 76 ms |

**Cause is Base UI's popup machinery, not app code and not dev overhead.** The clincher is
the last row — a plain 4-item `Select` with no dialog involved costs a 76 ms long task by
itself. That same `Select` cost 82 ms in dev vs 63 ms in prod (~1.3×), nowhere near the
~16× bundle-size gap; if dev overhead drove this, that ratio would be huge.

So PLANS.md hypothesis #1 (dialog subtree mount cost) is live; #2/#3/#4 are not implicated.
The sidebar at 21 ms / zero long tasks is already fine. **Still open:** whether the ~60 ms
is one-time popup init or per-open — untestable here because synthetic `.click()` cannot
close a Base UI popup, so every trial is a cold open.

**Measurement caveat:** taken with `document.visibilityState === "hidden"` (the tab cannot
be foregrounded programmatically on this machine). Only throttle-immune techniques were
used — synchronous timing around `click()`, `MutationObserver` for the async portal mount,
`PerformanceObserver` longtask. Hidden tabs skip paint, so these are a **lower bound**;
dev-vs-prod is apples-to-apples since both ran in the same tab.

**Environment gotcha found the hard way:** `next build` and `next dev` share
`frontend/dashboard/.next`, so building while the dev server runs corrupts it —
`500 __webpack_modules__[moduleId] is not a function` on every request, no self-recovery.
Fix: kill the dashboard process, delete `.next` (gitignored), relaunch.

### Feature 7: Edit agent

**Problem:** agents were immutable after creation. Fixing a typo or a wrong model meant
delete-and-recreate, which issues a **new token** and abandons the month's accumulated
spend. `PATCH /v1/agents/:id` was a 501 stub; only `maxBudgetCents` was reachable, via
`PATCH /v1/agents/:id/policy`.

**What changed:** a pen button at the right of every row opens a dialog mirroring "Create
agent", pre-filled, editing **Name / Model / Max budget**. The agent keeps its id, token,
and spend.

- `backend/api/src/routes/agents.ts` — new `PATCH /v1/agents/:id` plus `parseUpdateBody`
  (partial update: an absent key means "leave alone", which is why it can't reuse
  `parseCreateBody`, where absent and null both mean null). Name uniqueness reuses create's
  non-archived-scoped query plus `ne(agents.id, id)` so an agent can't collide with itself.
  Budget writes the same `policies` row `PATCH .../policy` targets. `findAgent` extended
  with `status` so archived agents 404.
- **`providerSlug` is rejected with `400 provider_slug_immutable`**, not silently ignored.
  Since Feature 3 it is the proxy's authorization boundary for which upstream an agent's
  token may reach, so editing it would silently repoint a live token at another vendor.
- `backend/api/src/routes/stubs.ts` — removed the `PATCH /v1/agents/:id` stub. **This was
  mandatory, not cleanup:** `registerStubRoutes` runs before `registerAgentRoutes`
  (`index.ts:37-38`) and Fastify throws on duplicate registration, so leaving it would have
  broken api boot. Noted in that file's doc comment.
- `frontend/dashboard/lib/agent-options.ts` (new) — `PROVIDERS` / `MODELS_BY_PROVIDER`
  extracted from `create-agent-dialog.tsx` now that two dialogs need them (same precedent as
  `lib/agent-status.ts`), plus `providerLabel()` / `modelsForProvider()` for safe lookup of
  a slug that arrives from the api as a plain `string`.
- `frontend/dashboard/components/edit-agent-dialog.tsx` (new) — **one dialog for the whole
  table, driven by an id, not one per row.** Given the 58–110 ms Base UI dialog mount
  measured above, a per-row instance would multiply that across every row. Seeds form state
  via React's render-time "adjusting state when a prop changes" pattern keyed on the agent's
  **id, not the object** — `agent` is re-derived from the 3 s poll every render, so keying on
  identity would wipe in-progress edits each tick. The snapshot deliberately survives close
  so the dialog doesn't blank mid close-animation. Sends only changed fields; Save disabled
  until dirty; duplicate-name check excludes the agent's own name.
- `frontend/dashboard/lib/api.ts` — `updateAgent()`, `UpdateAgentInput` (no `providerSlug`),
  `UpdateAgentResponse`, and a `provider_slug_immutable` friendly message.
- `frontend/dashboard/app/page.tsx` — `editingAgentId` state, `editingAgent` derived from
  the live list, `handleUpdated`, a rightmost edit column, and one `<EditAgentDialog>`.
  No `stopPropagation` needed: only the Name cell carries an `onClick`.
- `frontend/dashboard/app/globals.css` — `pen-shake` keyframe + `--animate-pen-shake`,
  nested inside `@theme` per Tailwind v4. Applied as
  `group-hover/button:animate-pen-shake motion-reduce:animate-none`, reusing the
  `group/button` class already in `button.tsx`'s base cva — no wrapper element needed.

**Icon:** lucide's `Pencil` (already a dependency) — the supplied icon minus the half-square.
`size-3.5` at `strokeWidth={1.75}` so it reads lighter than lucide's default 2.

**Verified live:** `PATCH` exercised directly — rename, model change, budget change, budget
→ null, multi-field, all 200. Negatives: duplicate name → 409 with a ready-to-display
message, `providerSlug` → 400 `provider_slug_immutable`, empty body → 400, negative budget →
400, blank name → 400, unknown id → 404, archived agent → 404. Renaming an agent to a
different case of its own name → 200 (self-collision correctly excluded), and a name freed
by archiving is reusable.

**Proxy enforcement proven end-to-end:** a probe agent at budget 100 passed the budget gate
and reached the real OpenAI (genuine `invalid_api_key`); immediately after
`PATCH maxBudgetCents → 0` the same call was denied `403 budget_exceeded` before any
upstream request — confirming edits take effect on the very next call, with no cache to bust
(`pgAgentStore.findByTokenHash` re-reads per request).

**Verified in the UI:** 7 columns with the edit button as the last cell of every row; pen
renders 2 paths at stroke-width 1.75; `pen-shake` keyframe confirmed present in the compiled
stylesheet. Dialog opens pre-filled with the assistant field **disabled**, Save **disabled
until dirty**, and clicking the pen does **not** open the sidebar. An edit through the UI
updated the row and **survived two 3 s poll ticks**, proving it persisted server-side rather
than only updating local state.

**Not verified:** the hover shake animation itself — a backgrounded tab pauses CSS
animations and the tab cannot be foregrounded programmatically here. Needs an eyeball.

**Test status:** `pnpm -r test` → 18/18 (unchanged; the api workspace still has no test
setup, by decision). `pnpm typecheck` → clean across all 4 workspaces.

### Feature 8: "Industrial glass" color + type overhaul

**Problem:** the dashboard used a cool neutral palette (gray/green/amber/red) and Geist
everywhere. The `docs/` style template defines a warm "industrial glass" identity — warm
near-black surfaces, a single coral accent, Space Grotesk / JetBrains Mono type, bracketed
mono labels. Requested: adopt that colorway + fonts only (no layout/component restructure).

**Design decisions (confirmed with the user):** coral **#ff4a3d** is "the orange"; it stays
**brand-only** (danger keeps its own red — the functional green→amber→red budget signal is
untouched); adopt Space Grotesk (headings) + JetBrains Mono (mono labels), keep Geist for
body; title becomes `[ Agent Dashboard ]`.

**What changed — almost entirely a token remap, so it cascades to every surface (Cards,
Dialogs, Selects, Badges, sidebar, and the `/status` page) with no per-component edits:**

- `frontend/dashboard/app/globals.css` —
  - `:root` custom tokens warmed: `--bg #0c0f12→#08080a`, `--ink #e8edf2→#ecebe6`,
    `--line` → `rgba(255,255,255,.09)`, `--panel #14181d→#121011`, `--ok #35d07f→#46c47f`,
    `--amber #f5b83d→#f0b03a`. `--err` kept (danger). New `--brand: #ff4a3d`.
  - `body` — added a fixed low-alpha coral `radial-gradient` ambient glow (switched
    `background`→`background-color` so the image isn't wiped).
  - `@theme inline` — `--font-heading` → Space Grotesk, added `--font-mono` → JetBrains
    Mono and `--color-brand` (enables `text-brand`/`bg-brand`/`to-brand`).
  - `.dark` — neutrals warmed with a whisper of chroma (~0.004 @ hue 60–80); `--primary`,
    `--ring`, `--sidebar-primary` set to coral; `--destructive` kept as danger red.
- `frontend/dashboard/app/layout.tsx` — load `Space_Grotesk` + `JetBrains_Mono` via
  `next/font/google` (variable-weight, no `weight` array), append their `.variable`s to
  `<html>`; nav gains a 10px sharp coral brand square and `hover:text-brand` links.
- `frontend/dashboard/app/page.tsx` — title wrapped as `[ Agent Dashboard ]`: coral mono
  brackets flanking the h1, whose gradient endpoint moved `#9CA3AF`→`--brand` (white→coral)
  and which now carries `font-heading` (Space Grotesk).

**Coral is confined to brand chrome** (nav mark, title, primary CTAs, focus rings) — never
functional status. Caveat noted in the CSS: coral and danger-red `#ff5c5c` are close in hue
but never co-occur in one component; deepen `--err` if it ever reads muddy.

**Verified (computed styles + `document.fonts`, valid in a hidden tab):** page bg
`rgb(8,8,10)`; body ambient glow present; title gradient `white → rgb(255,74,61)` in Space
Grotesk between `[` `]`; mono labels in JetBrains Mono; primary button, nav square, and
dialog submit all `rgb(255,74,61)`; dialog popover warmed (`oklch(0.205 0.004 60)`) with a
Space Grotesk title. `pnpm --filter @tollgate/dashboard typecheck` clean; dashboard serves
200 with no webpack error. **Not verified:** true perceived color/glyph rendering — a
backgrounded tab can't be judged for that and can't be foregrounded here; needs an eyeball.

**Test status:** `pnpm -r test` → 18/18 (no backend touched). `pnpm typecheck` → clean.

**Refinements after the initial overhaul (same `page.tsx`, all verified):**
- Title enlarged ~25%: h1 `text-3xl` → `text-[2.34rem]` (30px → 37.44px, measured 1.248×),
  brackets `text-2xl` → `text-3xl` to keep enclosing it.
- Subtitle copy → "Your group of agents, all managed in one place."
- Left bracket got `-ml-[6px]` so its glyph ink lines up under the subtitle's first
  character. Measured, not eyeballed: the monospace `[` ink sits +5px inset from its box
  while the sans first char sits −1px, a 6px gap → −6px closes it (residual 0px). Technique
  saved to the `browser-verification-gotchas` memory.

### Selection toolbar: always-visible, disabled-not-hidden actions, Clear removed

**Problem:** The batch-selection toolbar only rendered once at least one agent was selected
(`selectionMode && selectedAgents.length > 0`), so it popped in and out; Stop/Resume/Delete
were conditionally rendered per eligibility, so the bar changed shape as the selection
changed; and a "Clear" button duplicated what "Done"/deselecting already does.

**What was requested:** the action bar should show for the whole of selection mode (even with
nothing ticked); when an action doesn't apply, its button should be **greyed and unclickable**
(slight transparency) rather than vanish; and "Clear" should be removed.

**What changed (frontend only):**
- `frontend/dashboard/app/page.tsx:385` — toolbar render gate relaxed from
  `selectionMode && selectedAgents.length > 0` to just `selectionMode`; the now-unused
  `onClearSelection={clearSelection}` prop dropped from the render (`clearSelection` itself is
  still live — `exitSelectionMode` calls it).
- `frontend/dashboard/components/selection-toolbar.tsx` — removed the Clear `<Button>` (and the
  `Button` import and `onClearSelection` prop). Stop/Resume/Delete are now **always rendered**
  and passed `disabled` when their eligible subset is empty: `disabled={stoppable.length === 0}`
  / `resumable.length === 0` / `selectedAgents.length === 0`. Layout back to the simple
  `[N agents selected] …… [Stop][Resume][Delete]` split.
- `frontend/dashboard/components/batch-stop-dialog.tsx`, `batch-delete-dialog.tsx` — each gained
  an optional `disabled?: boolean` prop, threaded onto the `DialogTrigger`'s `<Button>`. The
  base `Button` already carries `disabled:opacity-50 disabled:pointer-events-none`
  (`components/ui/button.tsx:7`), so disabled = the exact "slightly transparent + unclickable"
  the request asked for, no new styling. `handleOpenChange` also guards `if (next && disabled)
  return` so no keyboard/programmatic path can open an empty-subset dialog.

**Design note:** Resume gets the same disabled-not-hidden treatment as Stop/Delete (disabled
when no *stopped* agent is selected) so the bar keeps a stable shape — the user named only Stop
and Delete, but hiding just Resume would reintroduce the shape-shifting the change is meant to
remove.

### Removed the "X agents need attention" banner

**What changed:** the red banner that listed stopped/over-budget agents at the top of the
dashboard was removed at the user's request — both the `needsAttention` computation and its
JSX block in `frontend/dashboard/app/page.tsx`. The `isStopped` / `isOverBudget` helpers stay
(still used by row rendering and `compareAgents`), as does the rest of the flagged plumbing
(the `Flag` icon on over-budget rows, flagged-first sort).

**Why / follow-up:** deliberately held back to be folded into a **planned flag feature** rather
than kept as a standalone banner. Saved to Claude's memory (`needs-attention-banner`) so the
concept — and the surviving `isOverBudget`/flag plumbing to build it on — is picked up when
that feature is built. **Verified:** typecheck clean; the banner text is absent from the
rendered dashboard (:3000), table still renders. Date: 2026-07-24.

### System status page overhaul + navbar hover fix

**Problem:** the `/status` page predated the "industrial glass" overhaul (Feature 8) and still
used raw `<section>`/`<div>` panels with inline styles, a plain `text-3xl` heading, a duplicate
"Tollgate" eyebrow, and bare `UP/DEGRADED/DOWN` mono text — visually a different product from
the dashboard. Separately, the navbar's "System status" link never highlighted coral on hover
the way "Agent Dashboard" does.

**Navbar hover fix — `frontend/dashboard/app/layout.tsx`:** the link already had
`hover:text-brand`, but also set its colour via an **inline `style` attribute**, which wins the
cascade over Tailwind's `:hover` class, so the hover never fired. Replaced the inline
`style={{ color: "var(--muted-foreground)" }}` with the `text-muted-foreground` utility class,
so `hover:text-brand` can take effect — now structurally identical to the working "Agent
Dashboard" link (`text-foreground … hover:text-brand`).

**Status page — `frontend/dashboard/app/status/page.tsx` (kept a server component; probe +
refresh-to-re-probe model unchanged):**
- Container widened to the dashboard's `max-w-5xl px-6 py-12`.
- Header adopts the bracketed title idiom copied from `app/page.tsx`: coral mono `[ ]` brackets
  (left one `-ml-[6px]`) flanking an `<h1>` with the white→`--brand` gradient, `bg-clip-text`,
  `font-heading` (Space Grotesk), `text-[2.34rem]`. The duplicate "Tollgate" eyebrow was
  removed (the nav already brands). Subtitle kept as a plain muted line with the health `Dot`.
- Each service is now a shared `Card` (`CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/
  `CardContent`) instead of a hand-styled `<section>`, so it matches the dashboard's "All
  agents" surface. The `HealthBadge` sits in the `CardAction` (top-right).
- Inline styles swapped for utility classes (`text-muted-foreground`, `font-mono`,
  `divide-border`); `style` retained only for dynamic status colour (the `Dot`, the unreachable
  error line) — same idiom `AgentStatusBadge` uses.
- Added `formatUptime()` (uptimeSec → "1h 04m") and a footer "Last checked <time> · refresh to
  re-probe." from the report's newest `timestamp`.

**`frontend/dashboard/components/health-badge.tsx` (new):** the health-domain analogue of
`AgentStatusBadge` — an outline `Badge` tinted via `color-mix` from a functional token, mapping
`up→--ok` / `degraded→--amber` / `down→--err`, in `font-mono`. Marked **`"use client"`** because
`Badge` calls a hook (`useRender`) and the status page is a server component, so the badge must
be a client leaf across that boundary (`state` is a plain string, crosses cleanly).

**Design guardrail honoured:** brand coral stays title-only; the functional UP/DEGRADED/DOWN
chips and dep dots use the green/amber/red trio, kept away from the coral title (coral and
`--err` are close in hue — `globals.css` mandates they never share a component context).

**Verified:** `pnpm --filter @tollgate/dashboard typecheck` clean; `/status` serves 200. Via
computed styles on :3000/status (valid in a hidden tab — no animation): title is a
white→`rgb(255,74,61)` gradient in Space Grotesk between coral brackets; both service panels are
`Card`s on `oklch(0.205 0.004 60)` with the ring; UP badges render `--ok` green
(`rgb(70,196,127)`) with a color-mix border in JetBrains Mono; both fonts loaded; the "Tollgate"
eyebrow is absent from the page body. Navbar: the "System status" link's inline `style` is gone
and it now carries `text-muted-foreground transition-colors hover:text-brand`, matching the
Agent Dashboard link. **Not verified (needs an eyeball):** the actual coral-on-hover paint — a
hidden tab can't reliably trigger `:hover` — and perceived colour/glyph rendering. Date:
2026-07-24.

### Bracketed-title load animation (both titles)

**What:** on tab load / route switch, each coral bracket now glides inward to its resting
place — the left `[` enters from farther left, the right `]` from farther right, settling onto
the stationary title.

- `frontend/dashboard/app/page.tsx` and `frontend/dashboard/app/status/page.tsx` — both bracket
  `<span>`s gained `animate-in slide-in-from-left-6` / `slide-in-from-right-6` (±1.5rem/24px
  start offset), `duration-500 ease-out`, and `motion-reduce:animate-none`. Also added
  `inline-block` to each bracket span: `transform` (which the slide uses) is a no-op on inline
  boxes, so the spans must be block-level for the translate to apply. Reuses the existing
  `animate-in` family (same as the checkbox pop); no new keyframes. The `<h1>` stays put so the
  brackets converge onto it.
- Replays on client-side navigation (destination page remounts) and on hard load (CSS animation
  plays on first paint).

**Verified (structural — a hidden tab pauses CSS animations, so the motion itself needs an
eyeball):** on both `/` and `/status`, each bracket has `animation-name: enter`, `duration 0.5s`,
`ease-out`; the paused-at-start transform reads `translateX(-24px)` (left) / `translateX(+24px)`
(right) — proving the offset, direction, and that the transform applies (`display: block`). The
actual glide needs a foreground tab to watch. Date: 2026-07-24.

**Note:** the bracketed-title markup is now duplicated across the two pages (title + brackets +
animation). Extracting a shared `BracketedTitle` component is a reasonable future tidy-up (same
precedent as `lib/agent-status.ts` / `HealthBadge`) — not done here to keep this change focused.

### Table header row no longer highlights on hover

**Problem:** hovering the header row (Name / Assistant / Status / …) highlighted it exactly like
a data row. `TableRow` carries `hover:bg-muted/50` (`components/ui/table.tsx:60`) and the same
component renders both the header row and the body rows, so the header picked up an interactive
affordance it doesn't have.

**What changed — `frontend/dashboard/components/ui/table.tsx`:** `TableHeader` gained
`[&_tr]:hover:bg-transparent` alongside its existing `[&_tr]:border-b`, undoing the highlight for
rows inside `<thead>` only.

**Why scoped to `TableHeader` rather than the call site:** passing `hover:bg-transparent` to the
header's `<TableRow>` in `page.tsx` would put both utilities on the *same element* at equal
specificity `(0,2,0)`, leaving the winner to Tailwind's stylesheet order — fragile. As a
descendant rule it resolves to `.<class> tr:hover` at `(0,2,1)`, which strictly outranks
`.hover\:bg-muted\/50:hover` at `(0,2,0)`. It also makes any future table correct by default.

**Verified (CSSOM rule analysis — real `:hover` can't be triggered in a backgrounded tab):** the
generated rule resolves to `.[&_tr]:hover:bg-transparent tr:hover { background-color: transparent }`
inside `@media (hover: hover)` (supported here). Structural match test: the **header row** is
matched by both the transparent rule and the muted rule — transparent wins on specificity, so no
highlight; the **body row** is matched only by the muted rule, so data rows still highlight.
`pnpm --filter @tollgate/dashboard typecheck` clean. **Needs an eyeball** for the actual painted
hover. Date: 2026-07-24.

**Gotcha worth remembering:** Tailwind v4 emits this as a 4-level *nested* rule (class → `& tr` →
`&:hover` → `@media` → `CSSNestedDeclarations`), so a naive CSSOM walker that resolves `&` only
against the immediate parent's `selectorText` will fail to find the declaration and wrongly
report the rule missing. Also, dev-server CSS rebuilds lag the file edit — an immediately-queried
stylesheet can legitimately not contain a just-added utility yet.

### Dashboard UI restyle to match the reference mock

**Problem:** the dashboard's structure/iconography lagged the reference design. Palette, fonts,
ambient glow and the bracketed title already matched (Feature 8 + this session); the gaps were
13 specific deltas — see the root `PLAN.md`, which this implements. **Constraint honoured: the
mock is rendered at a much larger zoom, so its *design* was adopted but not its dimensions —
every existing size token is unchanged and new elements were sized to the current small scale.**

- **`components/main-nav.tsx` (new, client)** — the nav moved out of `layout.tsx` so it can call
  `usePathname()` for an active-tab coral underline (`after:-bottom-3`, which equals the nav's
  `py-3`, so the bar lands on the nav's bottom border). Active link is `text-foreground` +
  `aria-current="page"`; inactive keeps `text-muted-foreground … hover:text-brand`. `layout.tsx`
  stays a server component and just renders `<MainNav />`. Wordmark brightened to
  `text-foreground/90`. **Colour is set with classes, never an inline `style`** — an inline style
  outranks the hover variant and would re-break the hover fixed earlier today.
- **`components/ui/button.tsx`** — two variants added beside `amber`: `brandOutline` and
  `amberOutline` (coloured text + 45% `color-mix` border + 12% wash, hover → 20%), the mock's
  tinted-outline CTA treatment. Same `color-mix` construction as `AgentStatusBadge`/`HealthBadge`.
- **`components/create-agent-dialog.tsx`** — trigger → `variant="brandOutline"` with a `Plus`
  icon. **`app/page.tsx`** — "Select agents" → `amberOutline` + `Users` icon; the toggled "Done"
  state stays neutral `outline` so the amber pill reads as "not yet in selection mode".
- **`components/agent-status-badge.tsx`** — badges gained a leading dot using `bg-current`, so
  all five statuses inherit the right colour with no extra mapping.
- **`components/ui/table.tsx`** — `TableHead` is now `text-xs uppercase tracking-wider
  text-muted-foreground`. Done in CSS so the JSX keeps readable sentence-case strings.
- **`app/page.tsx`** — coral hairline across the card's top edge
  (`bg-linear-to-r from-transparent via-brand to-transparent`; note v4's `bg-linear-*` rename);
  a `size-9` coral-tinted icon tile beside "All agents"; a pulsing green dot after "Polling every
  3s" (`motion-reduce:animate-none`); the table wrapped in `overflow-hidden rounded-lg border`;
  a `size-7` coral-tinted `Bot` avatar per row; the edit pen changed from bare ghost to
  `variant="outline"`; and the spend cell restructured so the amount sits on its own line with
  the bar and `%` sharing a row beneath it.

**Verified** (`pnpm --filter @tollgate/dashboard typecheck` clean; computed styles on :3000):
nav — active link carries `aria-current="page"` with a 2px coral `::after`, inactive has
`display: none`, and the indicator correctly follows the route (checked on both `/` and
`/status`). Buttons — coral/amber text with matching 12%/45% `color-mix` fill and border, one
icon each. Card — gradient hairline present, icon tile 36px coral, green dot. Table — headers
compute `text-transform: uppercase` at 12px/0.6px tracking, row avatar 28px coral with an svg,
status badge has a green dot matching its text colour, edit button has a real border, container
radius 10px. Spend cell — amount above; bar and `%` vertically centred with `%` to the bar's
right. **Needs an eyeball:** overall fidelity to the mock, hover states, and the pulse/pen
animations. Date: 2026-07-24.

### Resume button is green

**What:** the batch **Resume** button was `variant="default"` — solid brand coral, which read as
generic-primary and clashed with coral's brand-only rule. It's now green, matching the **Active**
status badge, since resuming is exactly what returns an agent to that state.

- `components/ui/button.tsx` — new `okOutline` variant on `--ok` (45% `color-mix` border, 12%
  wash, 20% on hover), built identically to `brandOutline`/`amberOutline`. It's the affirmative
  counterpart to `destructive`: Resume vs. Delete.
- `components/batch-stop-dialog.tsx` — `MODE_COPY.resume` now uses `okOutline` for **both** the
  toolbar trigger and the dialog's confirm button, mirroring how `stop` uses `destructive` for
  both.

**Tinted, not solid:** its siblings in the toolbar are Stop (neutral outline) and Delete (tinted
`bg-destructive/10`), so a solid green fill would have shouted over the destructive action. The
tint also matches the Active badge's own treatment.

**Verified:** typecheck clean; in selection mode the Resume trigger computes
`color: rgb(70,196,127)` — byte-identical to both the Active badge's colour and the raw `--ok`
token — over a 12% green wash with a 45% green border. (Read while disabled, since both local
agents are Active; `disabled` only changes opacity, not the colour values.) Date: 2026-07-24.

### Select trigger highlights on hover

**Problem:** the "Sort by" control had `transition-colors` but no hover state, so it never
acknowledged the pointer — unlike every button around it.

**What changed — `components/ui/select.tsx`:** `SelectTrigger` gained `hover:bg-muted` +
`dark:hover:bg-input/50`, the *exact* pair the `outline` button variant uses. The two share the
same bordered, transparent-fill shape, so they now lift identically. Applied to the shared
primitive, so the dialogs' Assistant/Model selects get it too.

**Verified:** typecheck clean; the sort trigger and an `outline` button carry an identical hover
class pair with identical resting backgrounds (`oklab(1 0 0 / 0.045)`), so the lift is the same
0.045 → 0.075 alpha — deliberately slight. All three utility rules confirmed generated. A
`disabled:hover:` guard was written and then removed as redundant: `disabled:pointer-events-none`
already makes `:hover` unreachable. **Needs an eyeball** for the painted hover (a backgrounded tab
can't trigger `:hover`). Date: 2026-07-24.

**Process note (cost me a repair):** re-indenting the wrapped table block with PowerShell
`Get-Content | Set-Content -Encoding utf8` **corrupted every non-ASCII character** (em/en dashes
→ mojibake), including the user-visible `Name (A–Z)` sort labels — `Get-Content` decoded the
UTF-8 file as ANSI. Reversed by re-encoding through Windows-1252 back to UTF-8 and verified by
enumerating the file's non-ASCII inventory. **Use the Edit tool for source edits; if a bulk
rewrite is unavoidable, round-trip via `[System.IO.File]::ReadAllText/WriteAllText` with an
explicit UTF-8 encoding.**

**Verified:** `pnpm --filter @tollgate/dashboard typecheck` clean. In the running dashboard
(:3000), via computed styles (valid in a backgrounded tab — no animation involved): with
**0 selected** the toolbar is present, reads "0 agents selected", has **no Clear button**, and
Stop/Resume/Delete are all `disabled` with `opacity: 0.5` + `pointer-events: none`. Selecting
1 then 2 active agents flipped Stop and Delete to enabled while Resume stayed disabled (no
stopped agent in the selection) — confirming eligibility drives the disabled state. Resume's
enable path is the symmetric `resumable.length === 0` and was not exercised live (both test
agents were Active); an eyeball on the greyed styling is still worth a glance. Date: 2026-07-24.

---

## Session summary — 2026-07-24 (Auth)

### Feature 9: Email + password auth — the api as authority, per-account org isolation

**Built 2026-07-24, UNCOMMITTED. Backend verified; browser flow + eyeball still pending — see the
"Next task" in `docs/PLANS.md`.** This is the "Auth" milestone.

**Problem:** the dashboard's api was wide open. `backend/api` ran `cors: { origin: true }` and every
`/v1/agents*` route was reachable anonymously — anyone who could reach `:4000` could CRUD every
agent. There was no account/user concept (single-tenant `DEFAULT_ORG_ID` placeholder).

**What changed:** **Better Auth (v1.6.25) now runs on the Fastify api as the auth authority.**
Email+password sign-in/sign-up, httpOnly SameSite=Lax session cookies, every `/v1/*` route gated
deny-by-default, and all agent data scoped to the caller's **organization** (one org per account,
provisioned on first session). Anonymous -> 401; another account's agent id -> 404. The dashboard
is a client that carries the cookie. Decisions (from the user): library Better Auth; the API (not
just the UI) enforces auth; per-account isolation; the scoping unit is the organization (seeds the
future host/invite/delegate model — NOT built this cut).

**Backend (`backend/api`):**
- `src/lib/auth.ts` (new) — `betterAuth({ database: pool, emailAndPassword, plugins:
  [organization()], trustedOrigins, rateLimit, databaseHooks })`. Uses Better Auth's **built-in
  Postgres (Kysely) adapter over the existing `pg` Pool** (not the drizzle adapter — see gotcha).
  **Org bootstrap lives in ONE `databaseHooks.session.create.before` hook:** it finds the user's
  membership and, if none, lazily creates a personal `organization` + owner `member` via
  `ctx.context.adapter`, then pins `activeOrganizationId` on the session. Consolidated there on
  purpose — a `user.create.after` hook runs deferred relative to session creation, so the
  membership wouldn't exist yet (that was the actual bug behind an initial `403
  no_active_organization`).
- `src/lib/require-auth.ts` (new) — `requireAuth` preHandler: `auth.api.getSession({ headers:
  fromNodeHeaders(req.headers) })` -> 401 if no session, 403 if no active org, else stamps
  `req.authUser` + `req.activeOrgId` (Fastify module augmentation declares them).
- `src/lib/auth-mount.ts` (new) — mounts `toNodeHandler(auth)` at `/api/auth/*` inside an
  **encapsulated Fastify plugin with pass-through content-type parsers**, so Better Auth reads the
  raw request body while the agent routes keep Fastify's JSON parser; `reply.hijack()` hands the
  socket to Better Auth.
- `src/db/auth-migrate.ts` + `src/db/run-auth-migrate.ts` (new) — apply Better Auth's own schema via
  `getMigrations(auth.options).runMigrations()` (`better-auth/db/migration`). Runs on api boot after
  the drizzle migrations, and via `pnpm --filter @tollgate/api db:auth-migrate`.
- `src/index.ts` — registers `@fastify/helmet` (CSP off, CORP cross-origin), `@fastify/rate-limit`
  (300/min global), CORS **locked** to `[DASHBOARD_ORIGIN]` with `credentials:true` (was
  `origin:true`); mounts auth (public); wraps stub+agent routes in an encapsulated scope with
  `preHandler: requireAuth`; runs both migration sets on boot.
- `src/db/schema.ts` — `agents.org_id` / `policies.org_id` changed **`uuid` -> `text`** (dropped the
  `DEFAULT_ORG_ID` default); the partial unique index moved from `(name)` to **`(org_id, name)`**
  (name unique per org). `DEFAULT_ORG_ID` export removed. Migration `drizzle/0004_married_ben_parker.sql`
  (applied).
- `src/routes/agents.ts` — every handler reads `req.activeOrgId!`; `findAgent(id, orgId)` filters by
  org (cross-org -> null -> 404); create stamps `org_id`; list + name-clash checks scoped by org;
  **freeze/unfreeze/policy/delete no longer require the agent's Bearer token** — session+org
  membership authorizes them (`extractBearer`/`checkStopAuth` removed). The raw agent token remains
  the auth only for the agent->proxy path.
- `backend/proxy/src/index.ts` — parity hardening: `@fastify/helmet` + a generous
  `@fastify/rate-limit` (1000/min). No CORS (server-to-server); the per-agent token + budget stay the
  real controls, so the data-plane cap is deliberately generous rather than throttling.
- `.env` / `.env.example` — `BETTER_AUTH_SECRET` (real 32-byte in `.env`, placeholder in the
  example), `BETTER_AUTH_URL=http://localhost:4000`, `DASHBOARD_ORIGIN=http://localhost:3000`.

**Frontend (`frontend/dashboard`):**
- `lib/auth-client.ts` (new) — `createAuthClient({ baseURL: API_URL, fetchOptions: { credentials:
  "include" }, plugins: [organizationClient()] })`; re-exports `signIn/signUp/signOut/useSession`.
- `lib/api.ts` — every fetch now sends `credentials: "include"`; a 401 bounces to `/sign-in`;
  `freezeAgent(id, mode)` / `unfreezeAgent(id)` dropped their `token` params.
- `middleware.ts` (new) — optimistic gate via `getSessionCookie` (`better-auth/cookies`): redirect to
  `/sign-in` when the cookie is absent, off the auth pages when present. The api is the real gate.
- `components/auth-form.tsx` + `app/sign-in/page.tsx` + `app/sign-up/page.tsx` (new) — email+password
  form in the industrial-glass style (bracketed `[ Tollgate ]`, Card/Input/Button); sign-in errors
  are generic (no enumeration); the account name defaults to the email; success -> dashboard.
- `components/main-nav.tsx` — right cluster shows the signed-in email + a **Sign out** control
  (`authClient.signOut()` -> `/sign-in`); the whole nav returns `null` on `/sign-in` / `/sign-up`.
  Colour via classes only (respects the hover gotcha).
- `components/batch-stop-dialog.tsx` — per-agent **token inputs removed** (session+org authz now);
  it's a plain confirm dialog with per-row success/error + retry.

**Gotcha worth remembering (Better Auth + this stack):** hand-matching Better Auth's drizzle schema
is brittle, so Better Auth OWNS its tables via its built-in adapter + `getMigrations`; drizzle-kit
keeps only the app tables. Org IDs are Better Auth's default text ids, so `org_id` became `text`.
Org provisioning must live in `session.create.before` (not `user.create.after`) because of hook
ordering. Cross-origin cookies work because `:3000` and `:4000` are the same site (host `localhost`),
so a SameSite=Lax host-only cookie set by the api rides to the dashboard — with `credentials:"include"`
+ CORS `credentials:true`.

**Verified (2026-07-24):** `pnpm -r typecheck` clean across all 4 workspaces; `pnpm -r test` 18/18
(proxy). Backend proven live via curl against the running api (:4000): anonymous `GET /v1/agents` ->
**401**; sign-up provisions an org and returns a session; a fresh account's list is **empty** (does
NOT include another account's agent); cross-account `PATCH`/`DELETE` -> **404**; **freeze with no
token** (session+org authz) -> **200 soft_frozen**.

**NOT yet verified (resume here):** the browser cross-origin cookie flow end-to-end (sign up in the
UI -> land on dashboard -> email shows -> create agent -> sign out). The dashboard dev server still
runs pre-`better-auth` code and needs a restart. A backgrounded tab can't judge the auth-page/nav
visuals or animations — needs a user eyeball. Nothing committed yet.
