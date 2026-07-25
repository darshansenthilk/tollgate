# PLANS.md

**Purpose:** Tracks the next task to work on for this branch. A fresh Claude session (after a context clear) should treat the "Next task" section below as its starting instruction, after reading `docs/COMPLETION.md` for history.

---

## Status as of 2026-07-24 (end of the UI session)

Current branch is `Eshaan-2` (tracks `origin/Eshaan-2`). Merges into `main` are done manually by the user — never push a feature branch to `main` on their behalf.

**Everything is committed and in sync with `origin/main`** at **`77432c6`** ("Redid the UI") — `git rev-list --left-right --count HEAD...origin/main` → `0 0`. The 2026-07-24 UI session landed as four commits: `47c808f` (needs-attention banner removed, selection toolbar with disabled action buttons), `29e3c08` (System status overhaul), `168cf45` (bracket animation + table-header hover fix), `77432c6` (dashboard restyled to the reference mock). Earlier work — the opt-in "Select agents" mode, heading/nav rename, poll re-render fix (Features 4–6), **Edit agent** (Feature 7, `69859c7`) and the **"industrial glass" overhaul** (Feature 8, `4bdfe04`) — is all in `main` too.

**One small change is still uncommitted:** the "Sort by" select trigger's hover highlight (`components/ui/select.tsx`) plus its `docs/COMPLETION.md` entry. Nothing else is pending.

`docs/COMPLETION.md` has the full detail of every item. The root-level `PLAN.md` holds the (now implemented) plan for the mock restyle, kept only for reference — `docs/PLANS.md` is the canonical planner.

**The agent filter feature is cancelled** — documented 2026-07-15, never started, dropped by the user. Do not implement it.

## Next task

**Auth — IMPLEMENTATION COMPLETE; finish browser verification, get an eyeball, then commit.**
The full email+password / per-account org-isolation auth feature was built and BACKEND-verified on
2026-07-24 (Better Auth on the Fastify api as the authority). See the **Feature 9 (Auth)** entry in
`docs/COMPLETION.md` for exactly what shipped — every file, the behavior, and the curl results. The
detailed original plan is preserved below this block for reference (it was fully implemented).

### RESUME HERE (do this first, in order)
1. **Restart the dev servers.** The api (:4000) was left running detached with the NEW code; the
   dashboard (:3000) is still running the OLD pre-`better-auth` code (its restart was interrupted)
   and MUST be restarted to load `better-auth` + `middleware.ts`. Restart both **detached** per the
   `running-the-dev-server` memory (kill the :3000 process first; **never `next build` while `next
   dev` runs**). If :4000 is down, `pnpm --filter @tollgate/api dev` — it re-applies both migration
   sets idempotently on boot. Confirm ports 3000/4000/8080 are all listening.
2. **Browser smoke test — the one thing curl couldn't do (cross-origin cookie flow).** Visit
   http://localhost:3000 -> should redirect to `/sign-in`; sign up a NEW email+password -> should
   land on the dashboard with the email shown top-right; create an agent; **Sign out** -> back to
   `/sign-in`; hit `/` again -> redirected. Watch the network: `POST :4000/api/auth/sign-up/email`
   must set a cookie that then rides on `GET :4000/v1/agents`. If the cookie doesn't stick, check
   the api CORS (`origin:[DASHBOARD_ORIGIN], credentials:true`), no `Secure` on the http cookie, and
   `credentials:"include"` on the client (both already set — `lib/auth-client.ts` / `lib/api.ts`).
3. **Ask the user to eyeball** the sign-in/sign-up pages + the nav email/sign-out — a backgrounded
   tab can't judge visuals or animations (existing users are `usera@`..`userd@example.com`,
   password `password12345`, from the backend curl test).
4. **Commit** once verified. Do NOT push to `main` — the user merges manually.

### Already verified 2026-07-24 (do NOT redo)
- `pnpm -r typecheck` clean across all 4 workspaces; `pnpm -r test` 18/18 (proxy).
- Backend via curl on the running api: anon `GET /v1/agents` -> 401; sign-up provisions a personal
  org; a second account sees an empty list (NOT the first's agent); cross-account PATCH/DELETE ->
  404; freeze with NO token (session+org authz) -> 200. All passed.

### Notes / small open items
- **Input validation** was intentionally kept as the existing strict hand-parsers (they own the
  frontend's error-code contract, e.g. `invalid_body`); Fastify JSON-schema-per-route was NOT added,
  to avoid regressing those messages. Reasonable future follow-up.
- Rate limiting can't resolve a client IP locally (Better Auth logs a shared-bucket warning) — set
  `advanced.ipAddress.*` for prod. Dev is fine.
- Stale dev agents from before this change still exist (their `org_id` is the retired placeholder) —
  harmless (invisible to every real org). Wipe for a clean DB if you like (`docker exec` psql was
  blocked in-session; run it yourself).

---

<sub>Original implementation plan (fully implemented — kept for reference):</sub>

### Scope
- A **sign-in** and a **sign-up** page (email + password only, **no 2FA**), styled to the existing
  "industrial glass" convention (Space Grotesk / JetBrains Mono, coral brand chrome, bracketed
  title, `Card` / `Input` / `Button`).
- A successful sign-in lands on the **existing dashboard** (`app/page.tsx`); the nav's top-right
  shows the **signed-in email** + a **Sign out** control.
- **The backend is the security boundary:** every `backend/api` route requires a valid session
  (deny by default) and is scoped to the caller's organization — so a direct call to `:4000`
  without a logged-in session is rejected, and one account can never see or touch another's
  agents/spend.
- **Build now:** auth + per-account isolation via a one-org-per-account model + the api hardening
  below. **Do NOT build now:** the invite flow, role/permission delegation UI, org switching — but
  lay the data model so they drop in later.

### Architecture (reflects the user's decisions)
**Better Auth runs on the Fastify api (`backend/api`) as the auth authority** — this reverses last
turn's dashboard-hosted recommendation, per the user's "API is the authority" choice.
- **Sessions:** Better Auth issues an httpOnly, Secure (prod), **SameSite=Lax** session cookie.
  Lax works across `localhost:3000 -> :4000` (same site — cookies aren't port-isolated) and across
  subdomains in prod (`dash.` / `api.` share a registrable domain). Only a truly cross-site split
  needs SameSite=None; if that ever comes up, prefer a same-origin reverse proxy over None.
- **Enforcement:** a Fastify `requireAuth` preHandler resolves the session via
  `auth.api.getSession({ headers })`, 401s when absent/invalid, and attaches `req.user` + the
  caller's **active org id**. Applied to every `/v1/agents*` route (deny by default).
- **Isolation (org-scoped):** adopt **Better Auth's organization plugin** — it provides
  `organization` / `member` / `invitation` tables + roles + an active-organization on the session,
  which is exactly the host/invite/delegate shape the user described. Use its data model now, add
  the UI later. On sign-up, auto-create a personal org, add the user as `owner`, set it active.
  Stamp every new agent with that org id; filter every read/mutation by it; a cross-org agent id
  returns **404** (not 403 — don't leak existence). The existing `agents.org_id` / `policies.org_id`
  columns already exist for this — replace `DEFAULT_ORG_ID` usage with the caller's active org.
  - *Lighter alternative (fewer moving parts):* hand-roll a minimal `organizations` + `memberships`
    pair now and adopt the org plugin when invites land — but that's rework the plugin avoids;
    recommend the plugin.
- **Persistence:** Better Auth + org-plugin tables live in the same Postgres as the api, managed
  through the api's existing **drizzle-kit** lineage (generate Better Auth's schema, express it as
  drizzle tables in `backend/api/src/db/schema.ts`, then `db:generate` + `db:migrate`). One
  migration system, since auth now lives in the api alongside the existing schema.
- **Password hashing:** Better Auth default **scrypt** (secure); argon2id optional via
  `emailAndPassword.password`.

### Concrete tasks — backend (`backend/api`, the security work)
1. **Deps + env.** Add `better-auth` to `backend/api`. Add `BETTER_AUTH_SECRET` (32+ random bytes),
   `BETTER_AUTH_URL`, and `DASHBOARD_ORIGIN=http://localhost:3000` to env + `.env.example`.
   `DATABASE_URL` already exists (`drizzle.config.ts`).
2. **Better Auth instance** — `backend/api/src/lib/auth.ts`: `betterAuth({ database (drizzle
   adapter over the existing pool), emailAndPassword: { enabled: true }, plugins: [organization()],
   trustedOrigins: [DASHBOARD_ORIGIN] })`, plus a sign-up hook creating the personal org + owner
   membership + active org.
3. **Mount handler** — register Better Auth's routes on Fastify (its handler under `/api/auth/*`),
   wired in `index.ts` alongside the agent/stub routes.
4. **`requireAuth` preHandler** — `backend/api/src/lib/require-auth.ts`: session -> `req.user` +
   `req.activeOrgId`; 401 otherwise. Attach to every `/v1/agents*` route — the deny-by-default gate.
5. **Org-scope the agent routes** (`routes/agents.ts`): create stamps `org_id = req.activeOrgId`;
   list filters by it; get/update/delete/freeze/unfreeze/policy fetch-then-verify
   `agent.org_id === req.activeOrgId` (else 404). **Name uniqueness becomes per-org:** change the
   partial unique index from `(name)` to `(org_id, name)` (new drizzle migration) and add `org_id`
   to the duplicate-name checks. This is a correctness requirement of isolation, not optional.
6. **Freeze/unfreeze auth change:** those routes currently require the agent's raw Bearer **token**
   (`routes/agents.ts`; `lib/api.ts` sends it). With session+org authz a dashboard operator
   shouldn't need the raw token — gate freeze/unfreeze/policy/delete by session+org instead. The
   agent token stays the auth for the **agent -> proxy** path only. (Flagged: changes the
   freeze/unfreeze contract and the dashboard calls.)
7. **Hardening — the "tight backend" list:**
   - `@fastify/rate-limit` — global + stricter on `/api/auth/*` (brute-force / credential-stuffing).
   - `@fastify/helmet` — security headers.
   - **CORS locked** — replace `cors: { origin: true }` (`index.ts:16`) with
     `origin: [DASHBOARD_ORIGIN], credentials: true` (credentials + wildcard origin is invalid
     anyway).
   - **Input validation** — Fastify JSON schemas on every route body/params (today they hand-parse
     `unknown`); rejects malformed/oversized input at the framework edge.
   - **CSRF** — Better Auth's origin check (`trustedOrigins`) + SameSite=Lax cover the session;
     ensure no state-changing GETs.
   - Same rate-limit/helmet/CORS pass on `backend/proxy` for parity (its routes are already
     agent-token-authenticated — that boundary is unchanged).
   - Drizzle parameterizes queries, so SQL injection is low-risk — note, don't chase.

### Concrete tasks — frontend (`frontend/dashboard`)
8. **Auth client** — `lib/auth-client.ts`: `createAuthClient({ baseURL: API_URL })` (+ the org
   plugin client) exposing `signIn` / `signUp` / `signOut` / `useSession`.
9. **Send credentials + handle 401** — `lib/api.ts`: add `credentials: "include"` to every fetch so
   the session cookie rides along; on 401, redirect to `/sign-in`. Drop the token args from
   `freezeAgent` / `unfreezeAgent` (now session-authorized).
10. **Route gating** — `middleware.ts`: optimistic redirect to `/sign-in` when the session cookie is
    absent (the api is the real gate; this is just UX).
11. **Pages** — `app/sign-in/page.tsx` + `app/sign-up/page.tsx` (or shared
    `components/auth-form.tsx`): styled email/password forms, link between them, **generic** error
    on failure (no enumeration). Signed-out users must not see `MainNav` — return `null` on
    `/sign-in` / `/sign-up`, or an `(auth)` route group with a minimal layout.
12. **Nav — email + sign out** — `components/main-nav.tsx`: `ml-auto` right cluster with the
    signed-in email (muted mono) + Sign out (ghost/outline, `hover:text-brand`) calling
    `authClient.signOut()` then routing to `/sign-in`. **Colour via classes, never inline `style`**
    (documented hover-breaking gotcha). Already `"use client"`, so `useSession()` fits.

### Auth / authz + hardening checklist (verify each)
- Deny-by-default: any `/v1/agents*` route without a session -> 401; agent CRUD unreachable anon.
- Cross-account isolation: user B cannot list/read/edit/delete/freeze user A's agents (-> 404), and
  cannot create an agent into A's org.
- httpOnly + Secure (prod) + SameSite=Lax cookies; strong `BETTER_AUTH_SECRET`, never committed
  (placeholder only in `.env.example`).
- Generic sign-in error ("invalid email or password"); auth endpoints rate-limited; CORS locked to
  the dashboard origin with credentials; helmet headers present; every route input-validated.
- Session expiry/rotation on defaults; sign-out actually invalidates the session (no stale cache).

### Known gotchas to resolve during implementation
- **Org-id type match:** Better Auth ids default to text, but `agents.org_id` / `policies.org_id`
  are `uuid`. Either configure Better Auth to generate uuids (`advanced.database.generateId`) or
  switch those columns to `text`. Decide before writing the migration.
- **Backfill:** existing dev-DB agents carry `DEFAULT_ORG_ID` and would belong to no real org after
  the model lands. Fine to wipe dev data or backfill them onto the first account's org.

### Follow-ups (design for, do NOT build now)
- Org invites, roles, and permission delegation (host invites members, delegates perms) — the org
  plugin already carries the tables/roles; this is the UI + enforcement of delegated permissions.
- Org switching, email verification, password reset, invite-only sign-up, 2FA (`twoFactor` plugin).
- Whether public sign-up stays open (each new account is isolated, so open sign-up is safe now) or
  becomes invite-only once the org model is user-facing.

### Verification
- `pnpm -r typecheck` clean. The api has no test setup today; at minimum exercise **401-when-anon**
  and **404-cross-org** by curl/hand and record it (add a small api test suite if feasible).
- Live, **with a visible tab**: sign up account A -> lands on dashboard, email top-right; create an
  agent; sign out -> `/sign-in`; sign up account B -> sees an empty list (NOT A's agent); direct
  `curl :4000/v1/agents` with no cookie -> 401; B cannot GET/PATCH/DELETE A's agent id -> 404.
- Browser caveats unchanged: `:hover` / animations need an eyeball (backgrounded tab); never edit
  source with `Get-Content | Set-Content`.

### Setup reminders (don't relearn these)
- Dev stack may already be up (`docker ps`, ports 3000/4000/8080). If not, start it **detached**
  per the `running-the-dev-server` memory. **Never `next build` while `next dev` runs** — shared
  `.next`, corrupts the dev server.
- Working tree is clean apart from the select-hover change noted above. Don't push to `main` —
  the user merges manually.
- **Never edit source files with PowerShell `Get-Content | Set-Content`** — it corrupts every
  non-ASCII character (it bit this session and mangled the user-visible `Name (A–Z)` sort
  labels). Use the Edit tool. See the `powershell-file-encoding` memory.

---

## Open: finish the "Create agent" dialog perf work

**Step 1 is done — the lag is NOT dev-mode-only, so the stop-condition did not fire.**
Full numbers and method in `docs/COMPLETION.md` (2026-07-24). Headline: in a *production*
build the dialog costs a 58–112 ms long task, the sidebar costs 21 ms with none, and a bare
`Select` popup with no dialog costs 63 ms / 76 ms long task. **The cost is Base UI's popup
machinery**, not app code and not dev overhead (that same `Select` is only ~1.3× slower in
dev, against a ~16× bundle-size gap).

### What is already known — do not re-derive

- Hypothesis #1 below (dialog subtree mount cost) is the live one. #2, #3, #4 are **not**
  implicated — measured, not assumed.
- The sidebar is already fine (21 ms, zero long tasks). Don't optimize it.
- **The open question:** is the ~60 ms one-time popup init (→ warm it during idle) or
  per-open (→ different fix)? Untestable via automation here: synthetic `.click()` cannot
  close a Base UI popup, so every trial is a cold open. Needs real user input, or a
  reload-between-trials harness.
- **Do not run `next build` while `next dev` is running** — they share
  `frontend/dashboard/.next` and the build corrupts the dev server
  (`500 __webpack_modules__[moduleId] is not a function`, no self-recovery). Measure prod
  first, then restore dev, or use a second working copy.
- A backgrounded tab pauses CSS animations/rAF and cannot be foregrounded programmatically
  on this machine — ask the user to click the tab before trusting any animation measurement.

### Older context (still accurate)

- **The idle-poll re-render is already fixed and is NOT the remaining cause.** `refresh()` in `frontend/dashboard/app/page.tsx` used to call `setAgents(data)` unconditionally every 3s, re-rendering the whole table each tick. It now returns the previous array reference when the payload is unchanged so React bails out. Measured before/after over 10s idle: **1 × 60ms long task → 0 long tasks, 0ms blocking.**
- **Polling less often will not help.** Idle polls now cost ~0. Dropping 3s → 10s only reduces HTTP volume, at the cost of the sidebar's `currentPrompt` live feel (it is a ~2min Redis TTL "what's happening now" view). This was considered and rejected.
- **Dev-mode overhead is large and may be the whole story.** The page loads **~3 MB of JavaScript across ~70 requests** under `next dev` — unminified, unbundled, HMR, dev-only React checks. DOM is tiny (113 nodes), so the app itself is not heavy.

### Step 1 — establish whether this is even a real problem (do this first)

Build and serve production, then compare feel:

```powershell
$env:Path = "$env:LOCALAPPDATA\pnpm-shim;$env:Path"; pnpm --filter @tollgate/dashboard build
$env:Path = "$env:LOCALAPPDATA\pnpm-shim;$env:Path"; pnpm --filter @tollgate/dashboard start
```

If the lag disappears in a production build, **stop** — report that and do not micro-optimize dev mode. Only continue if it persists.

### Step 2 — profile properly

**Methodological trap that wasted real effort last session: a backgrounded Chrome tab pauses CSS transitions and `requestAnimationFrame`.** Measurements taken while `document.visibilityState === "hidden"` are invalid — animated elements stay frozen at their start value and read as "not animating". **Always assert `document.visibilityState === "visible"` before trusting any animation or interaction measurement**, and bring the window to the front first.

Then: React DevTools Profiler on open of each of `CreateAgentDialog` and `AgentPromptSidebar` to see what actually re-renders, plus a Chrome Performance trace to separate scripting from layout/paint.

### Candidate causes worth checking (unverified hypotheses, not conclusions)

1. **Mount cost of the dialog subtree.** `CreateAgentDialog` mounts `Select`, `SelectContent`, `Input`, etc. from Base UI only when opened. First open may also be pulling dev chunks over the network.
2. **`AgentPromptSidebar` re-rendering on every poll while open.** It reads the agent fresh from the polled list by design (see its prop doc comment). With the bail-out fix it should only re-render when data genuinely changes — confirm that holds when `currentPrompt` is actively updating.
3. **Animation contention.** Dialog/sidebar entry animations running while the table re-renders. The new column-width transition (300ms) is a candidate to check for overlap.
4. **`transpilePackages: ["@tollgate/shared"]`** in `next.config.ts` — raw TS transpiled on the fly in dev.

### Constraints

- The user explicitly said **do not aim for perfection** here. Prefer one or two high-value, low-risk changes over a broad refactor.
- Do not regress the live-updating behaviour of the sidebar's `currentPrompt` or the over-budget toast.

### Verification

- `pnpm typecheck` clean across all 4 workspaces; `pnpm -r test` 18/18.
- Re-measure long tasks / blocking time on open of both surfaces, **with a visible tab**, and report before/after numbers rather than impressions.

## Candidate next steps (secondary, not committed)

1. **Model-value mismatch in the create-agent dropdown.** It offers `opus`/`sonnet`/`haiku`, but the Claude adapter prices full model IDs like `claude-3-5-sonnet-20241022` (`backend/proxy/src/adapters/claude.ts:14`), so agents created with those values never match a price entry and meter at 0. Pre-existing; surfaced during the 2026-07-23 rebase.
2. **Orphaned `handleDeleted`** in `frontend/dashboard/app/page.tsx` — dead since the Actions column was removed (it was only passed to the deleted `DeleteAgentButton`). `handleBatchDeleted` is the live one. Typecheck does not flag it. One-line deletion.
3. **Rename the OpenAI adapter's slug from `openai` to `chatgpt`.** Would make the dashboard's assistant vocabulary and the proxy's adapter slugs identical, removing the need for the `assistantAdapterSlugs` bridge (`backend/proxy/src/adapters/registry.ts`). Riskier: touches the live `/openai/*` route path, `openai.ts`'s `slug`, the `.env` var name (`OPENAI_UPSTREAM_KEY` → `CHATGPT_UPSTREAM_KEY`), `openai-route.test.ts`, and `demo/hammer.sh`/`demo/README.md`.
4. **`DELETE /v1/agents/:id`** is still a `501` stub (`backend/api/src/routes/stubs.ts`).

## How to use this file

When the user gives a new task, replace the "Next task" section with a concise, concrete description before starting work, then update `docs/COMPLETION.md` once it ships (same format: problem, what changed, file:line references, verification, date).
