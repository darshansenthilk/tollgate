# PLANS.md

**Purpose:** Tracks the next task to work on for this branch. A fresh Claude session (after a context clear) should treat the "Next task" section below as its starting instruction, after reading `docs/COMPLETION.md` for history.

**There are three rolling planning docs, and this is the only one that says what to do next:**
- **`docs/PLANS.md`** (this file) — live status + the authoritative **"Next task"**. Edited in place.
- **`docs/COMPLETION.md`** — dated history of what actually shipped; new entries go on top. (The
  pre-2026-07-25 tail is legacy oldest-first, so find entries by *date*, not position.) Written *after*
  verification, so it's the most reliable answer to "what exists right now". Also holds the design
  rationale behind shipped choices.
- **`docs/NEXT_PROMPT.md`** — the ready-to-paste prompt for resuming after a context clear.

Plus two auth-specific **reference** docs that never carry next tasks: `docs/AUTH-PLAN.md` (option
brainstorm) and `docs/AUTH-IMPLEMENTATION.md` (what each auth layer does). Both still contain sentences
calling root `PLAN.md` "the actionable, current plan" — ignore those; that file is gone, and each doc
now carries a note saying so.

> Root **`PLAN.md` was retired and deleted on 2026-08-03.** It had become a second, confusable
> completion doc — near-identical name, overlapping content, and its "which one is authoritative"
> relationship with this file had already flipped twice, once leaving a full implementation plan for
> *already-shipped* code sitting at the top of the repo where it read as a to-do list. Everything in it
> was migrated first: the Dashboard Expansion design rationale (the old DE1–DE13) and a previously
> unrecorded 2026-07-26 landing-page-navbar entry went into `docs/COMPLETION.md`; its still-open threads
> went into "Other open threads" below. Root `NEXT_PROMPT.md`, a stale duplicate of
> `docs/NEXT_PROMPT.md` from the auth era, was deleted in the same pass. Recover either with
> `git checkout d8779e4 -- PLAN.md NEXT_PROMPT.md` if something turns out to have been missed.

---

## Status as of 2026-08-03

Current branch is `Eshaan-feature-permissions`. **All the feature CODE is committed** in two commits:
- `d8779e4` "Added multiple dashboard creation" — slice 1.
- `9f44926` "Added ability to rename dashboards" — the dashboard name in the panel + the rename pen.

> ⚠️ **The tree is NOT clean, and that matters.** The three planning docs above carry **uncommitted**
> 2026-08-03 edits and are the ONLY copy of this handoff, and the deletions of root `PLAN.md` /
> `NEXT_PROMPT.md` are staged but uncommitted too. `HEAD`'s versions still say "Nothing has been
> committed this session" and "four API routes". **Do not run `git checkout .`, `git stash`, or
> `git reset --hard`** — it would destroy the notes you are reading and resurrect the two retired files.
> The *other* ~84 modified files really are CRLF/LF line-ending churn; `git diff -w --stat` isolates the
> real ones. Ask the user before discarding anything. (Everything in this file above the 2026-07-24
> entries — the `Eshaan-2` auth work — shipped and merged into `main` long ago.)

**Dashboard Expansion has two slices shipped and API-verified, neither checked in a browser yet.**
What exists: the `dashboards`/`active_dashboards` data model + migration `0007_rare_lightspeed.sql`,
**five** API routes (create / list / active / select / **rename**), the create tile + dialog, the
dashboard-selector tiles, the `/agents` empty-state gate, the panel's dashboard-name title, and the
rename pen button + dialog. The authorized agent wipe has been run. Full detail — including the five
bugs two adversarial review passes caught and the exact `curl` verification matrices — is in
`docs/COMPLETION.md`'s 2026-08-02 and 2026-08-03 entries. The original feature pitch, the visual specs,
and the numbered design defaults now live in that same 2026-08-02 entry's "Design decisions" subsection.

**The agent filter feature is cancelled** — a *UI filter control on the agents table* (filter by
Assistant / Status, plus a name search), documented in this file 2026-07-15 and since deleted from it
by commit `613ae0a`; never started, dropped by the user. Do not implement it. **This is NOT the same
thing as "scoping agents to a dashboard" in the Next task section below** — that predates dashboards
entirely and is still a live candidate. If the user says "the filter", they almost certainly mean
dashboard scoping; ask rather than citing this cancellation at them.

## Next task

**AWAITING THE USER'S INSTRUCTIONS on the Dashboard Expansion main feature. Do not start work — ask
first.** Two slices are shipped and committed (see Status above). Nothing is queued, and the next
direction is the user's call, not a default to be inferred from this file.

### RESUME HERE (do this first, in order)
1. **Read `docs/COMPLETION.md`'s 2026-08-03 and 2026-08-02 entries** — what shipped, how it was verified,
   and the five review-caught bugs already fixed. The 2026-08-02 entry also carries a "Design decisions"
   subsection (the old DE1–DE13: why `aspect-[2/1]`, why `bg-primary` tiles, why org-scoped ownership,
   etc.) — read that before changing any of those choices.
2. **Ask the user what they want next.** Do not pick a slice unilaterally. The plausible candidates, all
   still genuinely unbuilt:
   - **Scoping agents to a dashboard** — the big one, and the most likely intent behind "the main
     feature". Today every dashboard shows the *same* org-wide agent list; the tiles switch which
     dashboard is *active* but nothing filters by it. This built the **selector, not the filter**.
     It would touch `agents` (a `dashboard_id` column), agent creation, the proxy hot path, and existing
     rows.
   - **`dashboard_members` + permission tiers** — the "shared with other users at varying permissions"
     half of the original pitch. Needs the tiers actually defined (viewer/editor/owner? who can invite,
     remove, delete, change roles?) before any API or UI work.
   - **Share/invite UI** — depends on the above.
   - **Org/team boundaries** — never decided: can a dashboard be shared with someone *outside* the
     owner's organization, or only within it? Blocks the sharing design.
   - Smaller polish: a rename affordance on the `/dashboards` selector tiles (the pen exists only in the
     Dashboard Panel), deleting a dashboard, duplicate-name handling (names are non-unique by choice).
3. **Restart the dev servers** if a live check is needed — infra (Postgres/Redis) via Docker, `pnpm dev`
   for the three services (`:8080` proxy, `:4000` api, `:3000` dashboard). Note node/pnpm/docker/git-network
   only run via `powershell.exe` from this WSL shell. For a browser link, give the user
   `http://localhost:3000`, **not** a WSL gateway-IP link — the api's CORS/Better-Auth trusted origin is
   pinned to `http://localhost:3000` (`DASHBOARD_ORIGIN` in `.env`); a gateway-IP origin gets a silent 403
   that surfaces as "Something went wrong" with no useful client-side error (root-caused once already —
   don't re-debug it). The gateway IP (`ip route | grep default`) is only for this shell's own `curl`.
4. **The browser check is still outstanding and worth asking about**, though it no longer blocks: every
   visual/interaction detail is unverified (tile proportions, hover/focus, the active ring, the `{n}/50`
   counters, grid breakpoints, create → `/agents` click-through, the pen button's shake animation).
   `curl` cannot reach any of it — these render client-side after a fetch, so server HTML is always just
   "Loading…". No browser-automation tool is installed, and per the user's standing instruction,
   **don't install one without asking.** Highest-value single check: **a long unbroken dashboard name at
   phone width**, which is the `wrap-anywhere` clipping fix that was reasoned about rather than observed.

### Other open threads (inherited from the retired `PLAN.md`, unrelated to Dashboard Expansion)
These were the "still open" tail of the landing-page-integration effort. None is scheduled; they're
recorded here so retiring `PLAN.md` didn't drop them.
- **No designed flow from "read the pitch" → sign up → land in the dashboard**, beyond the nav itself.
  The access-CTA section's own conversion path is still unscoped.
- **The 2FA UI has never been checked in a real browser** — opt-in prompt, QR rendering, enrollment and
  challenge screens, backup-codes modal, Settings. All of it was verified by reading code plus API-level
  `curl`/DB passes only. See `docs/AUTH-IMPLEMENTATION.md`'s verification note.
- **Nobody has signed in as the real `eshaan.joshi07@gmail.com` account with a live TOTP code** since the
  auth merge. Only the user can do this.
- **The signed-in branch of the merged landing-page nav was never browser-verified** either (it
  server-renders the signed-out branch first, so `curl` can't see it) — see `docs/COMPLETION.md`'s
  2026-07-26 navbar entry.
- **Layer 3 (step-up re-auth on sensitive agent-control actions) remains unplanned** — `docs/AUTH-PLAN.md`
  §4 has the brainstorm.
- **Gotcha worth remembering near auth-adjacent code:** when `"/"` stopped being the dashboard, several
  client-side `router.push("/")` / `router.replace("/")` calls silently sent freshly authenticated users
  to the marketing page instead of `/agents` (fixed 2026-07-26). Target `/agents` explicitly where "the
  app" is meant; never assume `"/"` means that.

### Known issues, deliberately not fixed
- **Source comments cite a `PLAN.md` that no longer exists.** ~15 files (`lib/auth.ts`,
  `require-auth.ts`, `login-throttle.ts`, the 2FA components, etc.) reference "PLAN.md §5/§6" for the
  auth work. Those sections had already been rewritten out of `PLAN.md` long before it was retired on
  2026-08-03, so the pointers were stale even then. **The auth material they mean now lives in
  `docs/AUTH-IMPLEMENTATION.md` and `docs/AUTH-PLAN.md`.** Left alone deliberately — rewriting ~15
  committed source comments is its own change, not a docs-cleanup side effect.
- **`routes/agents.ts` 500s on a malformed `:id`.** A non-UUID `:id` hits Postgres as a 22P02 cast error,
  and the api registers no `setErrorHandler`, so Fastify answers 500 with the raw driver message. Five
  `agents.ts` routes have this, plus `GET /v1/agents/:id/activity` in `routes/activity.ts` — six in all,
  so a shared fix must cover both files. `routes/dashboards.ts` now shape-screens its own `:id` first (see the
  `UUID_RE` comment there); the general fix is a shared guard, a params schema, or a global
  `setErrorHandler` — not per-route patches.
- **`@tollgate/shared` fails `tsc --noEmit`** (`src/license.ts` — missing Node globals plus a real
  `LicenseCheck.payload` narrowing error). Pre-existing on this branch, unrelated to Dashboard Expansion:
  `git diff -w` shows the file is content-identical to HEAD. `pnpm -r typecheck` therefore aborts before
  reaching the api/dashboard packages — typecheck those two directly with `pnpm --filter` until it's fixed.

### Notes
- The wipe already ran (2026-08-02) and deleted **nothing** — `agents`, `spend_events`, and `policies`
  were all already empty across all 10 orgs, including `eshaan.joshi07@gmail.com`'s. The plan's premise
  that live agents existed did not hold. Don't run it again expecting a different result. More generally:
  **query the DB before trusting a plan's claims about live data** — that check cost nothing and changed
  what was worth telling the user.
- **`components/agent-dashboard.tsx` is shared with the marketing landing page's live demo**
  (`components/marketing/live-demo-section.tsx`), which runs a client-side simulator and has no dashboard
  concept. Both dashboard-related props (`dashboardName`, `renameDashboard`) are optional for that reason.
  Any future change to that component has to be checked against the marketing page too — the server-rendered
  `/` is curl-checkable, so verifying it is cheap.
- The user commits/merges via their own git client **mid-session**, so re-check `git log` before
  claiming anything is uncommitted; a "nothing committed yet" note in these docs can go stale within
  minutes.
- The `org_id`-not-`user_id` ownership call was implemented as recommended:
  `dashboards.org_id` scopes ownership, `active_dashboards.user_id` scopes selection.
- Merges into `main` are done manually by the user — never push a feature branch to `main` on their
  behalf, and never commit without being asked.

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
2. ~~**Orphaned `handleDeleted`**~~ — **STALE, do not act on this (verified 2026-08-03).** It named `frontend/dashboard/app/page.tsx`, which no longer exists (deleted in `62064fe` when the dashboard split into `(marketing)/` and `agents/`). `handleDeleted` now lives at `frontend/dashboard/app/agents/page.tsx:108` and is **live** — passed as `onDeleted` to `AgentDashboard`, whose prop is required (`components/agent-dashboard.tsx:121`) and invoked on batch delete. Deleting it would break the build.
3. **Rename the OpenAI adapter's slug from `openai` to `chatgpt`.** Would make the dashboard's assistant vocabulary and the proxy's adapter slugs identical, removing the need for the `assistantAdapterSlugs` bridge (`backend/proxy/src/adapters/registry.ts`). Riskier: touches the live `/openai/*` route path, `openai.ts`'s `slug`, the `.env` var name (`OPENAI_UPSTREAM_KEY` → `CHATGPT_UPSTREAM_KEY`), `openai-route.test.ts`, and `demo/hammer.sh`/`demo/README.md`.
4. ~~**`DELETE /v1/agents/:id`** is still a `501` stub~~ — **STALE, already shipped (verified 2026-08-03).** Implemented in `15a5ea7` and live at `backend/api/src/routes/agents.ts:479` (org-scoped lookup, 404 cross-org, archives rather than hard-deletes, sets the Redis freeze key). `stubs.ts` has no such stub — only `GET /v1/agents/:id` and the `/v1/policies*` ones.

## How to use this file

When the user gives a new task, replace the "Next task" section with a concise, concrete description before starting work, then update `docs/COMPLETION.md` once it ships (same format: problem, what changed, file:line references, verification, date).
