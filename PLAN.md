# PLAN.md

Status: **Dashboard Expansion slice 1 is IMPLEMENTED and API-verified as of 2026-08-02 — pending the
user's manual browser check. Nothing has been committed.** Everything the "Next slice" section below
specifies now exists as real code: the `dashboards`/`active_dashboards` tables + migration
(`0007_rare_lightspeed.sql`), all four API routes (`backend/api/src/routes/dashboards.ts`), the
create tile + dialog + selector tiles, and the `/agents` empty-state gate. The authorized agent wipe
has been run — and deleted **nothing**, because `agents`/`spend_events`/`policies` were already empty
across every org, so PLAN.md's premise that live agents existed did not hold in practice.

**The sections below are kept as the design record, not as a to-do list** — they still hold the visual
specs, DE1–DE13, and the explicit out-of-scope boundaries (sharing, permission tiers, and scoping
individual agents to a dashboard, none of which this slice attempts). Three deviations were made
deliberately during implementation and are recorded in `docs/COMPLETION.md`'s 2026-08-02 entry: `GET
/v1/dashboards/active` returns a `{ dashboard }` envelope rather than a bare `null` (Fastify can't send
one) and is org-joined so a stale selection can't leak another org's name; `active_dashboards.dashboard_id`
carries a real cascading FK; and `dashboards.name`'s 50-char cap lives in route validation, not as a
column constraint. **A fresh session picking this up should read `docs/COMPLETION.md` first, then
`docs/PLANS.md`'s "Next task" — not this file's "Next slice" as if it were still pending.** The
one-navbar plan that used to sit at the top of this file stays put, unchanged, below (implemented,
pending the user's manual signed-in check).

---

## Active feature idea: Dashboard Expansion

**The pitch:** today Tollgate has exactly one dashboard per account (`/agents` and friends). Dashboard
Expansion treats a dashboard the way Google Docs treats a doc — a user can create *multiple*
dashboards, each one shareable with other users, and each shared user can hold a different permission
level on that specific dashboard (independent of their permissions on any other dashboard they can
see). This is the natural next step for the stated audience — companies managing fleets of AI agents —
once a single company has more agents/teams than fit sanely under one shared view: separate dashboards
per team, environment, or client, shared selectively instead of all-or-nothing.

This is presumably what the `Eshaan-feature-permissions` branch (checked out as a clean copy of `main`
before this idea was captured) was created for — flagging the connection here in case that context gets
lost later.

**Done so far (scaffold only, 2026-07-31 through 2026-08-02):**
- New nav tab **"Manage Dashboards"** added to `components/nav-links.ts`, immediately to the left of
  the existing "Dashboard Panel" tab — renders in `main-nav.tsx` (the dashboard-wide nav) only; the
  marketing landing page's separate nav (`sticky-nav.tsx`) doesn't consume this list, so it's
  unaffected.
- New route `app/dashboards/page.tsx` — a placeholder card so the new nav link doesn't 404. Not in
  `middleware.ts`'s `PUBLIC_ROUTES`, so it's gated behind sign-in the same as every other dashboard
  route, automatically, with no middleware change needed.
- Page title ("Manage Dashboards") tuned to visually match `/agents`: same h1 classes as
  `agent-dashboard.tsx`'s "Agent Dashboard" (`text-[2.1rem] font-medium tracking-[-0.02em]`, no
  `font-heading`), same `pl-4 text-left` inner offset, and same outer container (`max-w-5xl`, not the
  `max-w-2xl` first used) — the container-width match was the fix that actually landed the title at the
  same on-screen x-position as "Agent Dashboard" and, per your check, in line with the nav bar's own
  left edge. Subtitle set to the exact text "Create a dashboard and view shared ones."
- `tsc --noEmit` passes clean throughout. Verified live against the running dev server via `curl`
  (session-cookie auth): `/dashboards` 307s to `/sign-in` when signed out, 200s with the placeholder
  content when signed in; `/agents`' rendered nav HTML confirms the link order is `/dashboards`,
  `/agents`, `/status`, `/activity`, `/settings` — "Manage Dashboards" immediately left of "Dashboard
  Panel", as asked.
- **Next slice fully planned below ("Create a new dashboard" tile + grid + backend) — APPROVED FOR
  IMPLEMENTATION 2026-08-02, no code written yet. This is where a fresh session picks up.**

**Explicitly not done — this is a name and a doorway, not the feature:**
- ~~No data model~~ — **partially resolved 2026-08-02:** owner-only `dashboards` + `active_dashboards`
  tables are now planned (see "Data model" under "Next slice" below) once you approve the regression risk
  flagged there. Still genuinely missing: the `dashboard_members` (dashboard_id, user_id, role) table for
  actual sharing, and any decision on how individual **agents** get assigned to a specific dashboard
  (today's org-wide agent list stays org-wide regardless of which dashboard tile is active — see "What
  this still doesn't do" under "New API routes" below).
- No permission model. "Varying permissions" needs actual tiers defined (viewer / editor / owner? who
  can invite/remove members, delete the dashboard, change other members' roles?) before any API or UI
  work can start.
- No create/share/invite UI beyond the create-tile's own dialog — no member list, no invite flow.
- ~~No decision on what happens to existing accounts' single implicit dashboard during migration~~ —
  **resolved 2026-08-02:** no migration, a full wipe instead (see "The agent wipe" under "Next slice"
  below).
- No decision on org/team boundaries — can a dashboard be shared with someone outside the owner's
  organization entirely, or only within it?

The permission-tier and sharing questions above are still open — but the create/select mechanics don't
need those answers yet. Below is a concrete plan for that slice.

### Next slice: "Create a new dashboard" tile + the grid it lives in

**Reference:** `c:\Users\AcePo\Downloads\tollgate plus.png` — a wide, rounded-rectangle card, thin solid
border, centered black "+", white fill. Read directly (not copied into the repo — the design gets
recreated with this app's existing primitives and theme tokens, not by embedding the raster image as an
asset).

**Why a grid, not just a lone button:** per your framing, `/dashboards` will eventually list the user's
own dashboards *and* ones shared with them, tile by tile, scrollable like Google Docs' doc/template
grid. The create-tile is the **first cell** of that same grid, not a separate page element — exactly how
Google Docs puts its blank-template tile first in the gallery, ahead of any existing docs. Building the
grid shell now (even with only one cell in it today) means the real dashboard tiles that show up later
slot in without restructuring the page again.

**Create-tile visual spec (translating the reference into this app's system, not its literal colors):**
- Shape/border: `bg-card`, `rounded-xl`, a solid `ring-1 ring-foreground/10`-style border like `Card`
  (`components/ui/card.tsx`) already uses — not the reference's literal black-on-white, since this app
  is theme-aware (light/dark, see `ThemeToggle`) and a hardcoded black border would look wrong in dark
  mode. Solid border, not dashed — the reference shows solid, so no substituting the more common "dashed
  outline = add new" idiom without you asking for it.
- Icon: lucide-react's `Plus` (already a dependency, already used the same way in
  `create-agent-dialog.tsx`), centered, sized larger than this app's usual inline icons (proposing
  `size-8`) so it reads clearly in an otherwise-empty tile, matching the reference's bold centered "+".
- **Sizing ("slightly smaller length"):** the tile's actual on-screen *width* will be set by its grid
  column, not a fixed pixel value (see grid below) — so "shorter length" is really about aspect ratio.
  The reference is quite elongated, roughly 2.6:1 (width:height). Proposing something closer to **2:1**
  — still clearly a wide "card," not a square, but noticeably less banner-like, so it reads well as one
  tile among several same-shaped dashboard-preview tiles rather than one long strip. Concretely:
  `aspect-[2/1]` on the tile, width flowing from the grid column.
- Hover state: border/ring brightens on hover (e.g. `hover:ring-foreground/30`) plus `cursor-pointer` —
  same "this is clickable" signal this app already gives buttons and other interactive controls.

**Position:** first cell, top-left, in a responsive grid replacing today's single "Coming soon" card on
`/dashboards`. Proposed grid: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4` — a first guess at
breakpoints, easily retuned once real dashboard tiles exist and their content shape (name, member count,
last-updated, etc.) is known. Not sticky/pinned — like Google Docs, it scrolls out of view with the rest
of the grid as the list grows; no virtualization or pagination needed at this scale.

**Interaction:** clicking the tile opens a `CreateDashboardDialog` — new component modeled directly on
the existing `create-agent-dialog.tsx` pattern (a `Dialog` whose `DialogTrigger` wraps the clickable
element; here that's the whole tile instead of a small `<Button>`). Content: a single required `name`
field asking for the dashboard's name (`Input` + `Label`, same primitives as `create-agent-dialog.tsx`),
**capped at 50 characters** — `maxLength={50}` on the `Input` itself (hard stop, matches the pattern
`two-factor-enroll.tsx:131` already uses for its 6-digit code field, just a longer cap) plus a small
"`{length}/50`" counter hint under the field so the limit is visible before it's hit, not just enforced
silently at the boundary. `DialogFooter` with Cancel/Submit.

**Open questions from last round — answered 2026-08-02:**
1. **"Bound to the user account, persists on reload — not local."** This pulls the `dashboards` backend
   forward into this slice; it's no longer deferrable. See "Data model" and "New API routes" below.
2. **"Goes straight to Dashboard Panel, like Google Docs."** Clicking a dashboard tile navigates to
   `/agents` immediately, and — by the same logic (Google Docs opens a brand-new doc immediately after
   you create it from a template) — creating one does too: on success, the new dashboard is auto-selected
   as active and the app navigates straight to `/agents`. That auto-select-on-create half isn't something
   you said explicitly; flagged as **DE11** below, not a silent assumption.
3. **"Empty slate — must create a dashboard in Manage Dashboards first."** `/agents` now branches on
   whether the caller has an active dashboard: none → empty-state message + a link to `/dashboards`,
   instead of today's loading/agent-list content.

**Regression risk — RESOLVED 2026-08-02, not just accepted:** the question was whether existing accounts
(including the user's own, `eshaan.joshi07@gmail.com`, which has real agents under today's implicit
dashboard) should hit the empty-state gate. The answer went further than "yes, that's fine" — the user
opted into actively **wiping every existing agent for every account** rather than leaving them orphaned-
but-intact: *"it is fine to remove my existing agents, and actually wipe them for all accounts, like they
have never made one in the first place"* (user, 2026-08-02). No auto-provisioned default dashboard, no
migration path — a clean reset. See "The agent wipe" immediately below for the concrete, planned steps.

### The agent wipe (authorized 2026-08-02 — irreversible, read before running)

This is a genuine `DELETE`, not a soft-archive — do this deliberately, not as a side effect buried in an
unrelated migration:
1. **Log before deleting.** Count agents per `org_id` (and total) before touching anything, so there's a
   record of what existed. This is the only "undo" available — there's no soft-delete/backup step planned
   here unless you ask for one.
2. **Handle the FK dependency first.** `spend_events.agent_id` references `agents.id`
   (`backend/api/src/db/schema.ts:185`) — delete (or otherwise resolve) dependent `spend_events` rows
   before/with the `agents` rows, or the delete will fail on the constraint. `agents.policy_id` references
   `policies.id` the other direction (agent → policy) — deleting agents doesn't force deleting policies;
   leftover orphaned policy rows are harmless (never re-attached to anything) but flag if you'd rather
   clean those up too in the same pass.
3. **Every account, every org — not scoped to one.** `DELETE FROM spend_events; DELETE FROM agents;`
   (or the Drizzle equivalent) with no `WHERE org_id = ...` — this is deliberately global, not per-org,
   per the user's own wording ("wipe them for all accounts").
4. **Do it inside a transaction**, and probably as a one-off script/migration run once at rollout time
   (not something `runMigrations()` replays idempotently on every boot — that's for schema, not a
   one-time data reset).
5. Existing `org_upstream_keys` (BYOK) rows are untouched — this wipes agents and their spend history
   only, not org-level config.

### Data model, ownership, and "active dashboard" (now required, not deferrable)

**Ownership: `org_id`, not raw `user_id` — a recommendation, not a silent choice.** Every existing
resource in this codebase (`agents`, `policies`) is scoped by the caller's **active organization**, not
their bare user id — `backend/api/src/lib/auth.ts`'s own doc comment: *"one organization per account
(created on sign-up)... this is also the seed of the future host/invite/delegate model... the org
plugin already carries the member/invitation tables and roles."* `docs/PLANS.md` (the original auth
plan) says the same thing more directly: adopting Better Auth's `organization` plugin was **explicitly
chosen to be "exactly the host/invite/delegate shape the user described"** — i.e. this codebase already
has infrastructure sitting unused for exactly the "share with multiple users at varying permissions"
half of this feature's pitch. Scoping `dashboards.org_id` the same way `agents.org_id` already works:
- Matches 100% of existing precedent (`routes/agents.ts`'s isolation pattern — 404 on cross-org access,
  never trust a client-supplied org id, always stamp from `req.activeOrgId`).
- Behaves identically to plain per-user ownership *today*, for you specifically — one personal org per
  account, 1:1, per the existing sign-up hook — so "bound to the user account" is satisfied either way
  right now.
- Sets up the actual sharing/permission feature to potentially reuse Better Auth's already-installed
  member/role tables later, instead of inventing a second, parallel ownership system from scratch.

This is a recommendation I'm confident in given how deliberately the existing code already points this
way, not something you asked for directly — say so if you'd rather bind `dashboards` to bare `user_id`
instead.

**"Which dashboard am I looking at right now" is a separate, per-*user* concept from ownership** — org
membership will eventually have multiple people in it (once sharing exists), and each of them should be
able to have a different dashboard active at once. So: dashboards are owned by an org; *selection* is
tracked per user.

Proposed tables (`backend/api/src/db/schema.ts`, alongside `policies`/`agents`, same `pgTable` style):
```
dashboards           id (uuid, pk) · org_id (text, not null) · name (text, not null, ≤50 chars) ·
                     created_at (timestamp, default now)

active_dashboards    user_id (text, pk — one row per user) · dashboard_id (uuid, not null) ·
                     updated_at (timestamp, default now)
```
No `dashboard_members` table yet — sharing/permission tiers are still genuinely unscoped (see
"Explicitly not done" above); this only builds the owner-only half. A missing `active_dashboards` row
for a user (never selected/created anything) is exactly the empty-state signal for answer 3.

### New API routes (`backend/api/src/routes/dashboards.ts`, new)

Registered in `index.ts`'s existing `requireAuth`-gated scope, alongside `agents`/`upstream-keys`/
`activity` — same deny-by-default gate, no middleware/auth changes needed.
- **`POST /v1/dashboards`** — body `{ name }`; server-side length validation (never trust the client
  `maxLength` alone — same principle `routes/agents.ts` already follows for its own inputs), insert with
  `orgId: req.activeOrgId!`, then upsert the caller's `active_dashboards` row to the new dashboard (DE11
  auto-select) → returns the created dashboard.
- **`GET /v1/dashboards`** — list where `orgId = req.activeOrgId!`, ordered `created_at asc` (DE7) — feeds
  the tile row on `/dashboards`.
- **`GET /v1/dashboards/active`** — the caller's `active_dashboards` row (by `userId`), or `null` if none
  → `/agents` calls this first to decide: empty-state, or proceed.
- **`POST /v1/dashboards/:id/select`** — verify the target dashboard's `orgId` matches the caller's (404,
  not 403, on mismatch — same non-leaking convention `agents.ts` uses), then upsert `active_dashboards` →
  used when clicking an existing tile.

**What this still doesn't do:** none of these routes touch `agents` at all — `/agents`, once an active
dashboard exists, keeps showing the exact same org-wide agent list it shows today, regardless of *which*
dashboard tile is active. Actually scoping individual agents to a specific dashboard is the still-open
"No decision on how an agent... gets assigned to a specific dashboard" item from "Explicitly not done"
above — a materially bigger change (agent creation, the proxy's hot path, existing data) that this slice
deliberately does not attempt. This slice builds the *selector*, not the *filter*.

**Upon successful creation:** Submit calls `POST /v1/dashboards`, which persists the dashboard
server-side (bound to the org, per "Data model" above) and auto-selects it as active. On success the
dialog closes and the app **navigates straight to `/agents`**, now showing that dashboard (DE11). Back on
`/dashboards` (e.g. navigating there afterward, or in another tab), a **new tile** — same size/shape as
the create tile (`aspect-[2/1]`, same grid cell) but **not white/`bg-card`** — has appeared, positioned
after the create tile and after every previously-created dashboard tile (appended to the end of the row,
not inserted anywhere else — the first dashboard ever created lands immediately to the right of the "+"
tile, per your description; each one after that continues appending, wrapping into new rows as the grid
fills). This is a **dashboard-selector tile**: clicking it calls `POST /v1/dashboards/:id/select` and
navigates to `/agents`, same as creation does. Over time the grid becomes:
`[+ create]  [Dashboard A]  [Dashboard B]  [Dashboard C] …`, every one of the latter switchable to, and
whichever is currently active (per `GET /v1/dashboards/active`) carries the selected-state ring.

**Dashboard-selector tile — visual spec:**
- Fill: this app's primary/brand button treatment (`bg-primary text-primary-foreground`, the same family
  `Button`'s `default` variant already uses — see `components/ui/button.tsx`) instead of the create
  tile's `bg-card` — deliberately the most different-reading option from the plain create tile, so the
  two tile *kinds* (an action vs. a specific dashboard) don't get confused at a glance. Same `rounded-xl`
  shape and `aspect-[2/1]` size as the create tile, per your "same size as it."
- Content: the dashboard's name (the same string entered in the create dialog, already capped at 50
  characters), centered, replacing the create tile's `Plus` icon — no icon on these.
- **Selected/active indicator:** since only one dashboard can be "the one shown in the Dashboard Panel"
  at a time, whichever tile is currently active needs to read as different from the rest of the row —
  proposing an extra `ring-2 ring-foreground` (or similar) on top of its own fill, the same idea as
  `main-nav.tsx`'s `mk-nav-link-current` treatment for the active nav route. Not in your message
  explicitly — flagged as DE10 below, not a silent assumption.

**File-by-file (planned, not applied):**

*Backend:*
1. `backend/api/src/db/schema.ts` — add the `dashboards` and `active_dashboards` tables (see "Data
   model" above), same `pgTable` conventions `policies`/`agents` already use.
2. New Drizzle migration (`backend/api/drizzle/000X_*.sql` + snapshot/journal, generated via this
   project's existing `db:generate` — not hand-written).
3. New `backend/api/src/routes/dashboards.ts` — the four routes from "New API routes" above.
4. `backend/api/src/index.ts` — register `registerDashboardRoutes(scope)` inside the existing
   `requireAuth`-gated block (next to `registerAgentRoutes`/`registerUpstreamKeyRoutes`/
   `registerActivityRoutes`) — one line, no new middleware.

*Frontend:*
5. `frontend/dashboard/lib/api.ts` — add `createDashboard`, `listDashboards`, `getActiveDashboard`,
   `selectDashboard`, matching the existing `listAgents`/`createAgent` fetch-wrapper conventions.
6. `app/dashboards/page.tsx` — fetch `listDashboards()` + `getActiveDashboard()` on load; replace the
   single `<Card>` "Coming soon" block with a `<div className="grid ...">`: `<CreateDashboardTile />`
   first, then one `<DashboardTile />` per dashboard returned.
7. New `components/create-dashboard-tile.tsx` — the "+" tile: `DialogTrigger` wrapper + its visual spec.
8. New `components/create-dashboard-dialog.tsx` — the create form (modeled on
   `create-agent-dialog.tsx`'s structure, trimmed to the capped name field), calling `createDashboard`
   on submit, then `router.push("/agents")` on success.
9. New `components/dashboard-tile.tsx` — the dashboard-selector tile: name, `bg-primary` fill, selected
   ring when active, `onClick` → `selectDashboard(id)` then `router.push("/agents")`.
10. `app/agents/page.tsx` (and/or `components/agent-dashboard.tsx`) — call `getActiveDashboard()` before
    today's `listAgents()` poll; `null` → render the empty-state block (message + link to
    `/dashboards`) instead of the existing loading/agent-list content; otherwise unchanged.
11. No changes to `middleware.ts`, `nav-links.ts`, or `main-nav.tsx` in this slice.

**Defaults assumed (flag if you want any different):**
- **DE1:** `Card`'s theme tokens instead of the reference's literal black/white, for light/dark
  correctness.
- **DE2:** `aspect-[2/1]` as the "slightly smaller" target ratio (reference ≈ 2.6:1) — a concrete
  starting number, easy to nudge once it's actually on screen.
- **DE3:** Solid border, matching the reference exactly, not a dashed "add new" idiom.
- **DE4:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` — first-guess breakpoints.
- **DE5:** Retired — see "Upon successful creation" above, now specified.
- **DE6:** `maxLength={50}` as a hard stop plus a live `{length}/50` counter, rather than only validating
  on submit (e.g. a toast/error after the fact) — catches the limit before the user hits it instead of
  after.
- **DE7:** New dashboard tiles append strictly in creation order (newest last/rightmost, wrapping into
  new grid rows) — not reordered by recency-of-use or alphabetically.
- **DE8:** The name shown on a dashboard tile is read-only after creation for this slice — no rename
  affordance yet (would need its own dialog/flow, not asked for).
- **DE9:** `bg-primary text-primary-foreground` (this app's default `Button` fill) for the dashboard
  tile's "not white" look — the most different-reading option from the create tile's `bg-card`, and
  reuses an existing token rather than inventing a new one.
- **DE10:** Active tile gets `ring-2 ring-foreground` layered on its fill — your message didn't specify
  a "currently selected" indicator, but with more than one dashboard tile eventually on screen, *some*
  way to tell which one is active seems necessary; flagging in case you want something else (a badge, a
  checkmark, etc.) or have this covered differently.
- **DE11:** Creating a dashboard auto-selects it as active and navigates to `/agents`, inferred by
  analogy from "goes straight to Dashboard Panel like Google Docs" (which you said about *clicking* an
  existing tile) rather than stated about creation directly.
- **DE12:** No uniqueness constraint on dashboard names within an org for this slice — `agents` does
  reject duplicate names (409), but you haven't asked for that here; easy to add later if duplicate
  dashboard names in the same tile row turn out to be confusing in practice.
- **DE13:** Ownership is `org_id`, selection is per-`user_id` — see "Data model" above for the reasoning;
  flagged prominently there too since it's the biggest technical call in this update.

**Explicitly out of scope for this slice:** the `dashboard_members`/permission-tier table and any
share/invite UI (see "Explicitly not done" above), and actually scoping individual **agents** to a
specific dashboard (see "What this still doesn't do" above) — this slice is create + list + select +
the `/agents` empty-state gate, nothing about which agents appear once a dashboard is active.

**Verification plan (once implemented — per this project's UI-change convention, do not skip):**
- Dev server, signed in, fresh account (no dashboards yet): `/agents` shows the empty-state message +
  link to `/dashboards`, not today's loading/agent-list content.
- `/dashboards`: exactly one tile at first (the create tile), first cell of the grid, at the tuned
  `aspect-[2/1]` proportions. Hover shows the brightened border; cursor is a pointer.
- Click the create tile opens the dialog; the name field stops accepting input at 50 characters and the
  `{length}/50` counter tracks it; Escape / Cancel closes without creating anything.
- Submit with a valid name: `curl -X POST /v1/dashboards` (session-cookie auth, matching this project's
  established verification convention) returns the created row; dialog closes and the app lands on
  `/agents`, now showing that dashboard instead of the empty state.
- `curl /v1/dashboards/active` returns the just-created dashboard; a **second** `curl` in a fresh
  "session" (i.e. simulating a reload) returns the same one — confirms server-side persistence, not
  just in-memory client state.
- Back on `/dashboards`: the new dashboard tile appears immediately after the create tile — `bg-primary`
  fill, entered name centered, same `aspect-[2/1]` size — and carries the selected-state ring (DE10).
- Create a second dashboard: its tile appends after the first (not before, not replacing it) — confirms
  DE7's ordering; `GET /v1/dashboards` returns both in `created_at` order.
- Click the first (now inactive) tile: navigates to `/agents` showing that dashboard again; back on
  `/dashboards`, the selected ring has moved to it.
- Cross-org isolation smoke check: a second account's `GET /v1/dashboards`/`POST .../select` never sees
  or can select the first account's dashboards (404 on a cross-org id, mirroring `agents.ts`).
- Resize/check at a couple of grid breakpoints as the tile count grows past one row.
- Same caveat as the navbar plan below: no browser-automation tool is installed in this environment, so
  the visual/interaction parts need a manual check in your own browser at `http://localhost:3000/dashboards`
  (not the WSL gateway-IP link — see the CORS note from the session that debugged sign-in on
  `Eshaan-feature-permissions`); the `curl`-level checks above can happen without a browser.

---

Status: **IMPLEMENTED, PENDING YOUR MANUAL SIGNED-IN CHECK.** The plan below for consolidating the
landing page's two navbars into one has been carried out (see "File-by-file changes" — all three
edits applied as written, defaults D1–D4 taken as-is). `tsc --noEmit` passes clean. Verified via
`curl` against the already-running dev server: signed-out `/` renders exactly one `<nav>` (logo+
"Tollgate" linked to `/`, far right only "Sign in", no "Request access" anywhere in the nav); `/sign-in`
and `/sign-up` still render zero nav elements; `/agents` unauthenticated still 307s to `/sign-in`
(middleware untouched). **Not yet verified:** the signed-in branch (Agent Dashboard / System status /
Settings / Sign Out, and the sign-out click) — `StickyNav` is a client component that always
server-renders the signed-out branch first and only swaps in the signed-in view after browser
hydration, so `curl` can't see it; no browser-automation tool is installed in this environment and the
user opted to check this themselves in their own browser at `http://localhost:3000` rather than have
Playwright/Chromium installed. Nothing has been committed.

> **The previous plan here (TOTP Two-Factor Authentication, Layer 2) is fully shipped and merged.**
> Implemented 2026-07-25, revised to opt-in 2026-07-26, merged into `main` the same day (commit
> `f64ca94`, via the `Eshaan-2` branch), verified end-to-end for both a fresh account and the
> pre-existing real account (`eshaan.joshi07@gmail.com`). Full record: `docs/COMPLETION.md` (three
> dated entries) and `docs/AUTH-IMPLEMENTATION.md`. Layer 3 (step-up re-auth) remains an unplanned
> recommendation in `docs/AUTH-PLAN.md` §4.

---

## Active plan: one navbar on the landing page

This is the first concretely-scoped slice of the broader "connect the landing page with the rest of
the web app" effort named previously (see the tail of this file for what's still unscoped in that
larger effort — this plan does **not** cover the signup CTA flow or shared chrome beyond the nav).

### Current state — the two navbars today

**Navbar A — `components/main-nav.tsx`, mounted globally.** `app/layout.tsx` renders `<MainNav />` in
the root layout, above `{children}`, on *every* route except `NO_NAV_ROUTES = {"/sign-in", "/sign-up",
"/enroll-2fa"}` (main-nav.tsx:27). `"/"` is not in that set, so it renders on the landing page today —
visually the topmost element on the page, above everything else including Navbar B. Contents:
- Far left: `<img src="/logo.svg">` (`size-5 shrink-0 rounded-sm`) + "Tollgate" text
  (`font-mono text-xs uppercase tracking-[0.25em]`).
- Middle-left: `LINKS` (`Agent Dashboard` → `/agents`, `System status` → `/status`, `Settings` →
  `/settings`), always rendered regardless of session — harmless on the dashboard routes (middleware
  already gates them, so you can't view them signed out) but visible-but-broken on the public landing
  page.
- Far right: signed-in email + "Sign out" button, rendered only when `sessionData.user` exists; renders
  nothing at all when signed out (no sign-in affordance).

**Navbar B — `components/marketing/sticky-nav.tsx`, rendered inside the page.** `app/(marketing)/page.tsx`
renders `<StickyNav />` as its first child (page.tsx:14) — i.e. inside the page content, sitting just
below Navbar A visually. Contents:
- Far left: `TollgateLogo` (hand-inlined SVG component, `size-5`) + "TOLLGATE" text
  (`font-heading text-base font-semibold tracking-[0.02em]`).
- Far right, signed out: "Sign in" (plain link, `font-mono text-xs uppercase`, `var(--muted-ink)`) +
  "Request access" (`href="#access"`, glass-button style).
- Far right, signed in: single "Agent Dashboard" glass-button CTA linking to `/agents`.

`middleware.ts` confirms `"/"` is in `PUBLIC_ROUTES` — no redirect either direction regardless of
session state — which is exactly why both navbars' signed-in/signed-out branches can both appear
stacked on the landing page today.

`TollgateLogo` (`components/marketing/tollgate-logo.tsx`) is also used by
`components/marketing/access-cta-section.tsx:44` (the page's bottom CTA section) — it stays; only
`sticky-nav.tsx` stops importing it.

### Target state

Keep **Navbar B (`StickyNav`)** as the base — it already sits first in the page content and already
carries the sticky/blur/border container styling that's supposed to survive. Hide **Navbar A
(`MainNav`)** on `"/"` so the landing page never mounts it. The merged nav is Navbar B with:

- **Logo:** swap `TollgateLogo` (SVG component) for Navbar A's `<img src="/logo.svg">` markup — per
  the prompt, only the graphic mark comes from the "higher" navbar; the "Tollgate" text label next to
  it keeps Navbar B's existing text/font (`font-heading text-base font-semibold tracking-[0.02em]`),
  since everything else is inherited from the landing-page navbar's styling.
- **Positioning:** stays the far-left flex child, as both navbars already do this — no structural
  change needed here beyond the swap above.
- **Logo click-through (new behavior, neither navbar does this today):** wrap the logo+"Tollgate"
  lockup in a link to `"/"`, so clicking the word "Tollgate" returns to the landing page.
- **Signed out, far right:** only "Sign in" remains (delete "Request access" entirely). Removing its
  sibling makes it the rightmost element automatically — no other styling change to it.
- **Signed in, far right:** `Agent Dashboard`, `System status`, `Settings` (same hrefs/labels/order as
  Navbar A's `LINKS`) rendered with Navbar B's existing link styling (`font-mono text-xs uppercase
  tracking-[0.12em]`, `var(--muted-ink)`, `hover:text-brand`) — i.e. today's "Sign in" treatment, not
  the old lone glass-button CTA, since these are now three peers rather than one action — followed by
  **"Sign Out"** as the final, rightmost element. Sign-out handler: `authClient.signOut()` then
  `router.refresh()`, staying on `"/"` (no redirect needed — `"/"` is public either way, unlike Navbar
  A's sign-out which must push to `/sign-in` because its host pages require auth).

### File-by-file changes

1. **`components/main-nav.tsx`** — add `"/"` to `NO_NAV_ROUTES`; update the comment above the set to
   note the marketing page now has its own merged nav instead of relying on this one.
2. **`components/marketing/sticky-nav.tsx`**
   - Remove the `TollgateLogo` import; replace the logo element with Navbar A's `<img src="/logo.svg"
     ... />` markup, kept inside the existing left-hand flex div next to the "TOLLGATE" text.
   - Wrap the logo+text lockup in `<a href="/">` (matching this file's existing plain-`<a>` convention
     for its own links, rather than introducing `next/link`'s `<Link>`, which only Navbar A currently
     uses).
   - Import the shared `LINKS` constant (see #3) instead of hand-writing the three links again.
   - Signed-out branch: drop the "Request access" anchor; keep "Sign in" as-is.
   - Signed-in branch: map `LINKS` with this file's existing link classes, then render a "Sign Out"
     button (`authClient.signOut()` + `router.refresh()`) as the last element — needs a `useRouter`
     import from `next/navigation`, not currently imported in this file.
3. **`components/nav-links.ts` (new)** — export the `{href, label}[]` array currently inlined in
   `main-nav.tsx` (`LINKS`), so both `main-nav.tsx` and `sticky-nav.tsx` import the same data instead
   of maintaining two literal copies of an identical 3-item list.
4. **No changes** to `middleware.ts`, `app/layout.tsx`, `app/(marketing)/layout.tsx`,
   `app/(marketing)/page.tsx`, `access-cta-section.tsx`, or `tollgate-logo.tsx`.

### Defaults assumed while planning (flag if you want any of these different)

- **D1:** Keep the existing "System status" label casing (lowercase "s", matching current `LINKS`)
  rather than "System Status" as capitalized in your prompt — a pure casing question, one-line change
  either way if you want it capitalized.
- **D2:** The three dashboard links, when signed in, get the plain uppercase nav-link treatment (like
  today's "Sign in"), not the glass-button CTA look "Agent Dashboard" currently has alone — since
  they're now three peers, not one highlighted action. Say so if you'd rather keep a button look for
  one or all of them.
- **D3:** Sign Out on the landing page nav stays on `"/"` (refresh only, no redirect), since `"/"` is
  public and remains valid post-sign-out — unlike Navbar A's sign-out elsewhere, which must leave
  auth-gated pages.
- **D4:** The logo/"Tollgate" home link uses a plain `<a href="/">`, matching this file's existing
  anchor-based links, rather than `next/link`'s `<Link>` — a style-consistency call scoped to this one
  file, not a statement about which is "correct" generally.

### Verification plan (once implemented — do not skip, per this project's UI-change convention)

- Dev server, load `"/"` signed out: exactly one navbar; far-left logo+"Tollgate" (links to `"/"`);
  far-right shows only "Sign in"; "Request access" gone from the nav (its `#access` section further
  down the page is untouched).
- Sign in, return to `"/"`: nav now shows `Agent Dashboard` / `System status` / `Settings` / `Sign Out`
  (far right); still exactly one navbar.
- Click each of the three links from the landing page while signed in → lands on `/agents`, `/status`,
  `/settings` respectively; those pages still show Navbar A (`MainNav`), unaffected by this change.
- Click "Sign Out" from the landing-page nav → session clears, nav reverts to signed-out state, still
  on `"/"`.
- Confirm `/agents`, `/status`, `/settings`, `/sign-in`, `/sign-up`, `/enroll-2fa` are unaffected —
  `MainNav` still renders correctly on the dashboard routes and stays hidden on the three no-nav
  routes.

### Explicitly not in scope for this plan

- The `#access` section's own content/CTA — only its nav-bar entry point is removed.
- Any change to `MainNav`'s behavior/styling on the authenticated dashboard pages.
- Renaming the `StickyNav` component/file — it stays the landing page's one nav, name unchanged.

---

## Broader landing-page-integration context (still open, not part of the plan above)

- No designed flow yet from "read the pitch" → sign up → land in the dashboard beyond the nav itself;
  the access-CTA section's own conversion path is still unscoped.
- **Gotcha already hit once, worth remembering if this touches auth-adjacent code again:** when `"/"`
  stopped being the dashboard, several client-side `router.push("/")` / `router.replace("/")` calls
  elsewhere weren't updated and silently sent freshly authenticated users to the marketing page instead
  of `/agents` (fixed 2026-07-26, see `docs/COMPLETION.md`). Any code this nav work touches should keep
  targeting `/agents` explicitly where "the app" is meant, never assume `"/"` means that.
- No live-browser verification of the 2FA UI has happened yet (opt-in prompt, QR rendering, enrollment/
  challenge screens, backup-codes modal, Settings) — everything checked so far by reading code plus
  API-level `curl`/DB passes. See `docs/AUTH-IMPLEMENTATION.md`'s verification note. Unrelated to this
  nav plan but still outstanding.
- Nobody has signed in as the real `eshaan.joshi07@gmail.com` account since the merge with a live TOTP
  code — still needs the user to do it themselves.
- Layer 3 (step-up re-auth on sensitive agent-control actions) remains unplanned, per
  `docs/AUTH-PLAN.md` §4.
