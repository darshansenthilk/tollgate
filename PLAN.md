# PLAN.md — Dashboard sharing (candidate 2: `dashboard_members`)

**Status: BUILT (both 6a and 6b), verified live against the dev DB with three real accounts
(host/guest/outsider). A code-review pass returned 7 findings — all 7 are now FIXED and
re-verified live via curl (see "Code review findings (fixed)" below, and its "Re-verification"
subsection). Still outstanding: a real browser pass (no browser-automation tool has been available in
any session so far) and the commit itself — the user has not been asked yet.** This is the
plan for the feature `claude-docs/PLANS.md`
parked as candidate 2, blocked on the tier/ownership decisions that are now resolved below (the
permission-tier *customization* itself — viewer/editor/owner-style restrictions — is still explicitly
future work; see "Out of scope").

Branch: `Eshaan-feature-permissions`. Builds on slice 5 (`16c5b6b`, the My Dashboards / Shared Dashboards
nav toggle, currently a stub with no data).

## What the user asked for, verbatim in substance

- On `/agents`, there's a 2-person icon next to the dashboard name that currently does nothing
  (`components/agent-dashboard.tsx:285-291` — a decorative, `aria-hidden`, non-interactive chip).
- Move that icon to the top right of the dashboard card, and make it a real clickable button.
- At the same time, shift the dashboard name, its pen/rename button, and the "Polling every 3s" line
  left to fill the space, so the header doesn't look lopsided once the icon moves.
- Clicking the button opens a popup: a list of everyone currently added (by email), and below that, a
  field to add another email.
- Adding an email grants that person access — it shows up on their `/dashboards/shared` page.
- From the adding user's side, the popup stays open and the list now includes the new email.
- Right now, any added user gets full permissions on the dashboard (no restrictions). A later feature
  will let the host customize what each added user can do — **not this plan**.

## Decisions (confirmed with the user before writing this plan)

**D1 — Sharing works across orgs, by email, not limited to the host's own org.** There is no product
flow today for two people to join the same org (no invite-to-org UI; `claude-docs/COMPLETION.md`'s slice-4
verification had to add a second org member by hand via SQL to test it at all). So "share with a user" has
to mean "grant one specific outside person access to this one dashboard," independent of org membership —
the Google-Docs model implied by "add an email."

**D2 — If the email doesn't match an existing Tollgate account, the add fails with an error.** No
email-sending dependency exists in this codebase (`backend/api/package.json` has no Resend/SES/nodemailer/
etc.), so there's no way to actually deliver an invite to someone without an account. Building that is a
separate, later feature. This plan's add-member flow does a lookup by email against Better Auth's `user`
table and 4xxs if nothing matches.

**D3 — Every dashboard gets an explicit host (`dashboards.createdBy`).** `dashboards` has never recorded
who created it (`org_id` was the only scope — see slice 5's D7, which explicitly declined to add this
column ahead of this exact decision). New dashboards stamp the creator's user id at creation. Existing
dashboards backfill to whichever member holds the `"owner"` role in that dashboard's org
(Better Auth's `member` table, provisioned automatically for every org — see `lib/auth.ts`'s
`session.create` hook, which always creates exactly one `owner` member when an org is first provisioned).

**D4 — This plan is add-only.** No remove-member button in the popup yet. Removing a member (and the
tier system generally) is explicitly future work, once the host/customization feature is scoped.

## Current state (grounding facts, so the plan below is concrete, not speculative)

- `components/agent-dashboard.tsx` is **shared with the marketing landing page's live demo**
  (`marketing/live-demo-section.tsx`). Every dashboard-specific feature on it (title, rename) is an
  **optional prop**, defaulted or omitted so the demo renders unchanged. The share button must follow the
  same pattern — see "Frontend" below.
- The CardHeader today (`agent-dashboard.tsx:279-331`) is one `flex items-center gap-3` row: a decorative
  icon chip, then a column with the title+pen row on one line and "Polling every 3s" below it. `Card` at
  line 279 already has `className="relative"` — the same positioning anchor `dashboard-tile.tsx` uses for
  its absolutely-positioned 3-dot menu trigger, so the share button can reuse that exact convention rather
  than inventing a new one.
- `dashboards` (`backend/api/src/db/schema.ts:301-330`): `id` (uuid pk), `orgId` (plain `text`,
  deliberately not an FK to Better Auth's `organization` table — see the module's own decoupling comment),
  `name`, `createdAt`, `archivedAt` (soft delete). `active_dashboards` (`:332-350`) is the same
  decoupled-`text`-userId pattern for per-user selection.
- **Every dashboard-scoped route today authorizes on exactly one predicate: `eq(dashboards.orgId, callerOrgId)`**,
  plus `isNull(archivedAt)`. That's `lib/dashboard-scope.ts`'s `resolveDashboardId` (used by
  `GET/POST /v1/agents` — `routes/agents.ts:299,427` — and `GET /v1/activity` — `routes/activity.ts:39`),
  plus four inline copies of the same shape in `routes/dashboards.ts`: list (`:167-204`), active
  (`:206-237`), rename (`:239-290`), select (`:292-333`, via `selectDashboardIfLive`), and delete
  (`:347-...`). **All eight of these sites need to accept a second path to authorization** — "caller is a
  `dashboard_members` row for this dashboard" — alongside the org check, for a shared user to actually be
  able to open, view, and act on a dashboard from `/dashboards/shared`. This is the highest-risk part of
  this feature (see "Staging" below).
- No `Popover` UI primitive exists yet — only `ui/dialog.tsx` (modal) and `ui/dropdown-menu.tsx` (menu).
  Every existing "click a button, do a small piece of dashboard admin" flow in this app
  (`rename-dashboard-dialog.tsx`, `delete-dashboard-dialog.tsx`, `create-dashboard-dialog.tsx`) is a
  `Dialog`. The share popup should be the same: a new `components/share-dashboard-dialog.tsx`, not a new
  primitive.

## Data model

**`backend/api/src/db/schema.ts`**
- `dashboards.createdBy: text("created_by")` — nullable at the column level (matches the
  `active_dashboards.userId` decoupling comment: plain text, deliberately not an FK to Better Auth's
  `user` table). Migration backfills every existing row (see below), so in practice it's never null once
  the migration lands — but stays nullable at the schema level the same way `archivedAt` does, rather than
  a hard NOT NULL that a future manual row could violate.
- New table `dashboardMembers` (`dashboard_members`):
  - `dashboardId: uuid` — FK to `dashboards.id`, no `onDelete` action (mirrors `agents.dashboardId`'s own
    reasoning: a soft-deleted dashboard's membership rows should stay as a record, not vanish — nothing
    should ever need to hard-delete a `dashboards` row).
  - `userId: text` — Better Auth user id, plain text, same decoupling as `active_dashboards.userId`.
  - `addedAt: timestamp with tz, default now()`.
  - `uniqueIndex` on `(dashboardId, userId)` — adding the same email twice is a no-op/409, not a duplicate
    row.
  - No `id` primary key needed; the composite unique index is sufficient and matches
    `active_dashboards`'s own single-purpose-table style.

**Migration** — three steps in one file, same shape as slice 3's `0010` (add nullable → backfill → the
column stays as-is since it's meant to stay nullable, no tightening needed here):
1. `ALTER TABLE dashboards ADD COLUMN created_by text;`
2. `CREATE TABLE dashboard_members (...)`.
3. Backfill `created_by` for every existing dashboard from Better Auth's `member` table, matched on
   `organizationId = dashboards.org_id AND role = 'owner'`.
   - **Confirm the live column names before writing this.** Better Auth's Postgres adapter creates its own
     tables outside drizzle (`db/auth-migrate.ts`), and this repo's own code only ever reads them through
     Better Auth's `adapter.findOne`/`findMany` API (see `lib/auth.ts:174-206`), never raw SQL — this
     migration would be the first place doing that. Inspect the actual `member` table (`\d member` or
     equivalent) before assuming `"organizationId"`/`"userId"`/`"role"` are the literal quoted column
     names.

## Backend

All in `backend/api/src/routes/dashboards.ts` unless noted, following the file's existing "everything
dashboard-shaped lives here" convention.

1. **Widen the authorization predicate everywhere listed in "Current state" above.** Introduce one shared
   SQL fragment/helper — e.g. `dashboardAccessPredicate(dashboardId, orgId, userId)` returning
   `archivedAt IS NULL AND (org_id = :orgId OR EXISTS(SELECT 1 FROM dashboard_members WHERE dashboard_id =
   dashboards.id AND user_id = :userId))` — and use it at all eight sites (`resolveDashboardId` plus the
   five inline `dashboards.ts` routes, list/active/rename/select/delete). **One shared fragment, not eight
   hand-rolled copies** — the whole point of factoring it out is that a shared or an added user gets
   *identical* treatment everywhere by construction, per D-none-yet — this is the assistant's own call,
   flagged here because it's the single highest-leverage decision in the backend work: get this fragment
   right once instead of getting one of eight call sites subtly wrong.
   - `resolveDashboardId`'s signature changes from `(raw, orgId)` to `(raw, orgId, userId)` — every one of
     its three callers (`agents.ts:299,427`, `activity.ts:39`) needs `req.authUser!.id` threaded in.
   - `selectDashboardIfLive` (`dashboards.ts:112-134`) gets the same `OR EXISTS` added to its `with live
     as materialized (...)` CTE. Its `FOR SHARE` locking behavior (the race-closing mechanism documented
     in its own comment) must still apply to the widened predicate — re-read that comment before touching
     the query, this is exactly the kind of SQL the CLAUDE.md security-review rule is for.
   - The `DELETE` route's inline claim statement (`dashboards.ts:368-378`) gets the same widening. Note it
     currently does **not** go through `resolveDashboardId` or `selectDashboardIfLive` at all — it's its
     own inline `UPDATE ... WHERE`, so this is a fourth distinct place to apply the fragment, not covered
     by fixing the other three.
2. **`GET /v1/dashboards/:id/members`** (new). Returns the host (`createdBy`, resolved to
   `{id, email}` via Better Auth's adapter) and the current member list (`{id, email, addedAt}` each,
   same adapter lookup per row — or one batched `findMany` if the adapter supports an `in` filter,
   confirm at implementation time). Authorized by the same widened predicate as above — anyone who can
   already reach the dashboard can see who else can.
3. **`POST /v1/dashboards/:id/members`** (new). Body `{ email: string }`.
   - Same dashboard-access check as above (caller must already be able to reach the dashboard).
   - Trim + basic shape validation on the email → `400 invalid_body` on garbage input, mirroring
     `parseNameBody`'s style.
   - Look up the target by email via Better Auth's adapter (`auth.$context` → `adapter.findOne({model:
     "user", where: [{field: "email", value: email}]})` — the same pattern `lib/auth.ts`'s
     `session.create` hook already uses, just called from a route instead of a hook; confirm
     `auth.$context` is reachable outside a hook context at implementation time, since every existing use
     of the adapter in this codebase is hook-internal). No match → `404 dashboard_member_user_not_found`.
   - Insert into `dashboard_members`. `ON CONFLICT (dashboard_id, user_id) DO NOTHING`, and treat a
     0-row insert as success (idempotent add) rather than an error — matches this app's existing taste for
     "a repeat of an already-true action succeeds" (see D6 in `claude-docs/PLANS.md`'s slice-4 section:
     repeat delete reads as success too).
   - Adding the host's own email: harmless no-op is fine (they already have access) — don't special-case
     it, just let the unique index/host-is-already-authorized logic make it a no-op naturally. No need to
     block it explicitly.
4. **`GET /v1/dashboards/shared`** (new). Lists dashboards where the caller has a `dashboard_members` row
   (`archived_at IS NULL` still applies — an archived dashboard disappears from *both* the owner's and
   the shared users' lists, consistent with THE INVARIANT in `claude-docs/PLANS.md`'s slice-4 section:
   nothing reads an archived dashboard from any door). Separate route from `GET /v1/dashboards` rather than
   a query param on it — the two lists are genuinely different queries (org-scoped vs. membership-scoped),
   and `/dashboards` vs `/dashboards/shared` on the frontend are already two distinct pages/routes per
   slice 5.
5. **`POST /v1/dashboards`** (create) stamps `createdBy: req.authUser!.id` on insert.
6. New `FRIENDLY_ERROR_MESSAGES` entries in `frontend/dashboard/lib/api.ts`:
   `dashboard_member_user_not_found` ("No Tollgate account found with that email."),
   `dashboard_member_invalid_email` (or reuse `invalid_body`, decide at implementation time whichever
   reads better in the dialog).

## Frontend

**1. Header layout, `components/agent-dashboard.tsx` (`:279-331`).** Remove the decorative icon-chip
`<span>` (`:285-291`) entirely — its only content, the `Users` icon, becomes the new button instead.
Restructure `CardHeader`'s inner wrapper from the current single `flex items-center gap-3` row into two
siblings under one `flex items-center justify-between`:
- **Left**: the existing title+pen row and the "Polling every 3s" line, unchanged in their own internal
  layout — they just move to fill the space the icon chip vacated at the left edge (this is the "move
  cleanly to the left" the user asked for: a horizontal shift into the freed space, not a re-stack).
- **Right**: the new share button, `absolute` inside the already-`relative` `Card`
  (`className="relative"` at `:279`) — same corner-anchoring convention `dashboard-tile.tsx` established
  for its 3-dot trigger, so this is a second instance of an existing pattern, not a new one.
- Treat this as a first pass. Every prior visual change in this app (slice 5 especially) went through
  live rounds of user correction in the browser before landing — expect the same here rather than trying
  to nail exact spacing/alignment from the spec alone.

**2. New `components/share-dashboard-dialog.tsx`.** `Dialog` (not alert-dialog — nothing here is
destructive, so the outside-click-to-dismiss behavior standard dialogs have is fine, unlike the delete
confirm). Contents:
- A list of current members (email + maybe "Host" badge on the `createdBy` row), fetched on open.
- Below it, an email `Input` + "Add" `Button`. On submit, calls the add-member action; on success, appends
  to the visible list in place (matches "the drop down will still show but now that email has been added
  to the list" — no need to close the dialog or refetch the whole list, just append the returned member to
  local state).
- Inline error text for `dashboard_member_user_not_found` and any validation failure, same convention as
  the other dashboard dialogs (`rename-dashboard-dialog.tsx`'s error handling is the closest precedent).

**3. Wiring into `agent-dashboard.tsx` + `app/agents/page.tsx`.** New optional props on
`AgentDashboardProps`, following the exact `renameDashboard` pattern (`agent-dashboard.tsx:140-143`) so
the marketing demo (which passes neither) renders unchanged:
```
listDashboardMembers?: () => Promise<DashboardMembersResponse>;
addDashboardMember?: (email: string) => Promise<DashboardMember>;
```
Both closures, bound to the active dashboard's id by the caller in `app/agents/page.tsx`, the same way
its inline `renameDashboard` callback closes over `activeDashboard.id` today (`app/agents/page.tsx:205`).
The share button and dialog render only when both are supplied — same `renameDashboard !== undefined`
gating style already used for the pen button (`agent-dashboard.tsx:306`).

**4. `lib/api.ts`** — new exports: `DashboardMember` type, `listDashboardMembers(dashboardId)`,
`addDashboardMember(dashboardId, email)`, `listSharedDashboards()` (hits the new
`GET /v1/dashboards/shared`).

**5. `components/shared-dashboards.tsx`** stops being a pure stub (slice 5's D7/D12, which explicitly
named this component as "where the real fetch, loading, and populated-grid branches get added" once this
decision landed). Needs:
- A fetch on mount via `listSharedDashboards()`, the same `undefined`/`null`/value loading convention
  `app/agents/page.tsx` and `activity-log.tsx` already use for `activeDashboard`.
- A populated grid reusing `dashboard-tile.tsx` (or a trimmed variant without the 3-dot delete menu — a
  shared user shouldn't get a delete affordance on someone else's dashboard from this list; decide at
  implementation time whether that's a new prop on `DashboardTile` or a separate lightweight tile
  component, consistent with "no speculative abstraction" — don't build a third option preemptively).
- Clicking a tile should select it (`POST /v1/dashboards/:id/select`, now reachable for a shared user per
  the widened predicate above) and route to `/agents`, exactly like `manage-dashboards.tsx`'s tiles do
  today.
- Keep the existing empty-state copy for when the list is genuinely empty.

## Staging — two slices, not one PR

Given the backend widening touches eight authorization sites across three files and is the kind of
credential/tenant-isolation code CLAUDE.md flags for a mandatory real review pass, split this into two
slices rather than one large PR (an assistant call, not asked of the user — flagging it here so it's easy
to override):

- **Slice 6a — membership plumbing + UI, no cross-org access yet.** Schema + migration, the four new
  member routes/list-shared route, the header layout change, the share dialog, `createdBy` stamping. A
  shared user can be *added* and will *appear* on their own `/dashboards/shared` page, but clicking the
  tile doesn't yet work (select/agents/activity still org-only) — ship this, verify it in isolation.
- **Slice 6b — the cross-org access widening.** The eight-site predicate change (`resolveDashboardId`,
  `selectDashboardIfLive`, and the four other inline `dashboards.ts` checks) that makes a shared
  dashboard's tile actually clickable and its agents actually visible/manageable by a non-owning-org user.
  This is the slice that needs the heavier review pass before merge.

## Out of scope (explicitly, per the user)

- Permission tiers / customizing what an added user can do. Every member currently gets full access,
  identical to the host, on every route the widened predicate touches (view, create/edit/freeze agents,
  rename, delete, share further). The *next* feature narrows this down per-member — this plan does not
  attempt to pre-build role plumbing (columns, enums, or gating) for it.
- Removing an added member.
- Inviting an email with no existing Tollgate account (would need real email sending).

## Verification (once built)

- `pnpm typecheck` on `@tollgate/api` and `@tollgate/dashboard`.
- A `curl` matrix in the style of every prior slice: add by email (self, duplicate, nonexistent-account,
  malformed), list members, list shared dashboards from the added user's session, cross-org select/agents/
  activity access before vs. after 6b lands, and archived-dashboard behavior for a shared member (should
  404 the same way it does for the host).
- Manual browser pass: header layout at the widths this app already had trouble with before (narrow
  phone, the ~520px floor `agent-dashboard.tsx` documents elsewhere), the dialog's add/list/duplicate-error
  flow, and a real second account seeing the shared tile and being able to open it.

## Implementation notes (written after building 6a and 6b)

**The header used `CardAction` (`components/ui/card.tsx`), not the absolute-positioned-on-`relative`-Card
approach this plan sketched.** `CardAction` is this codebase's existing shadcn-style primitive for exactly
"an action pinned to a CardHeader's top-right corner" (`CardHeader` already carries a
`has-data-[slot=card-action]:grid-cols-[1fr_auto]` rule) — discovered while implementing, and a better fit
than reinventing `dashboard-tile.tsx`'s absolute-positioning trick for a plain Card. The title/pen/Polling
group stayed exactly as it was, just as CardHeader's other grid column, so it naturally fills the space the
old icon chip left.

**`GET /v1/dashboards` (My Dashboards) was deliberately NOT widened**, unlike this plan's "eight sites"
framing implied. It stays org-only on purpose — `GET /v1/dashboards/shared` (scoped by
`dashboard_members.user_id` instead) is the dedicated route for a guest's shared tiles, so merging shared
dashboards into the org-owned list would just duplicate them across both pages.

**The real site count was six, not eight — but two of those six turned out to gate a much wider blast
radius than this plan anticipated**, discovered by tracing every caller rather than trusting the original
inventory:
- `resolveDashboardId` (`lib/dashboard-scope.ts`) — as planned.
- `selectDashboardIfLive` (raw SQL) — as planned.
- `routes/dashboards.ts`: `GET /active`, `PATCH /:id`, `POST /:id/select`, `DELETE /:id` — as planned,
  though `DELETE` needed more than its own claim-check widened (see below).
- **`findAgent` (`routes/agents.ts`) — missed entirely by this plan's inventory.** It's the single
  authorization gate for `PATCH /v1/agents/:id`, `.../policy`, `.../freeze`, `.../unfreeze`, and
  `DELETE /v1/agents/:id` — five routes behind one function. Without widening it, a shared guest could
  view a dashboard's agents but not touch any of them, which isn't the "full permissions" behavior this
  plan and the user both specified. One fix (add `dashboardAccessible` to its `WHERE`, return the
  dashboard's own `orgId` too) covers all five.
- **`GET /v1/agents/:id/activity` (`routes/activity.ts`) — also missed.** Its own inline
  `eq(agents.orgId, orgId)` access check needed the same widening as its dashboard-wide sibling.

**A second, distinct bug class showed up alongside the access-check widening: several sites used the
CALLER's `orgId` where they needed the DASHBOARD's own `orgId`, which stopped being the same value the
moment a shared (cross-org) guest could act at all.** Left unfixed, these wouldn't have leaked anything —
they fail toward emptiness/rejection — but they would have silently broken the feature for exactly the
guest it exists to serve:
- `POST /v1/agents`'s race-closing raw SQL insert stamped the new agent's `org_id` from the caller's
  `orgId`. A guest-created agent in a shared dashboard would have landed with the GUEST's org on the row —
  wrong data, and it would have made every other org-scoped read of that agent (list, activity,
  `findAgent`) disagree about which org it belongs to. Fixed by having `resolveDashboardId` return the
  dashboard's own `orgId` alongside `dashboardId`, and using that for the insert, the 1:1 policy row, and
  `upstreamKeyBelongsToProvider`'s org check (same fix in `PATCH /v1/agents/:id`, via
  `agent.dashboardOrgId` off the widened `findAgent`).
- `GET /v1/agents` and `GET /v1/activity`'s own defence-in-depth `eq(agents.orgId, orgId)` filters (kept
  alongside the dashboard-id filter as a regression guard, per their existing comments) would have made a
  legitimate guest's own agent list come back EMPTY, since their agents' true `org_id` is the host's, not
  theirs. Fixed the same way: compare against `scope.orgId`, not the caller's `orgId`.
- `DELETE /v1/dashboards/:id`'s "find the org's oldest surviving dashboard" re-point logic searched the
  CALLER's org. A guest deleting a shared dashboard would have searched their own unrelated org for a
  survivor — at best finding nothing and blanking the host's own selection, at worst re-pointing the
  host's org members into a dashboard in the guest's org they have no access to. Fixed by reading the
  deleted dashboard's own `orgId` back from the claim `UPDATE ... RETURNING` and searching that.
  **One known, accepted rough edge left from this fix**: the bulk re-point of every `active_dashboards` row
  pointing at the deleted dashboard isn't itself org-aware (it never was), so a GUEST whose own active
  selection was the deleted dashboard gets re-pointed to the survivor in the HOST's org, which they likely
  can't reach. This self-heals rather than leaking: `GET /v1/dashboards/active`'s own `dashboardAccessible`
  check hides that inaccessible re-pointed row from them, so they land on "no dashboard selected" instead
  of an error. Confirmed live in the curl matrix below. A fully correct per-holder re-point (finding each
  affected user's OWN org) would need a cross-schema lookup against Better Auth's `member` table this
  session judged out of scope — flag if it ever needs revisiting.

**`findUserByEmail`/`findUserById` (`routes/dashboards.ts`) pass `select: ["id", "email"]` to Better
Auth's adapter**, not just a narrow TypeScript return type — caught before it shipped, in an early curl
check: the generic type parameter alone doesn't restrict what the adapter actually returns, and without
`select` the share dialog's responses were carrying the full Better Auth `user` row (name, image,
`emailVerified`, `twoFactorEnabled`, timestamps).

**Verified live against the dev DB**, three real accounts (host, guest added by email, and an unrelated
third account): guest can select/view/create/edit/freeze/unfreeze/delete agents and view activity in the
shared dashboard, and the created agent's `org_id` correctly matches the dashboard's (not the guest's) org
in Postgres directly. The outsider account 404s on every one of the same operations. Delete-and-re-point
was exercised with the GUEST as the deleter specifically (the least-tested direction), confirming the host
re-points correctly within their own org and the guest's own selection self-heals to null rather than
landing somewhere broken.

## Code review findings (fixed — all 7)

A multi-agent code-review workflow (`code-review` skill, high effort) ran against the full diff, focused
on the authorization surface above. 9 candidate findings were verified (of 11 raised); synthesis/dedup
failed on a session usage limit mid-run, so the raw verified list had 3 near-duplicate reports of the same
underlying bug, collapsed to one below. All 7 were fixed in a follow-up session and re-verified live
(see "Re-verification" at the end of this section).

1. **CORRECTNESS — self-add duplicates the host. FIXED.** `POST /v1/dashboards/:id/members` had no guard
   against a host adding their own email. **Fix:** the route now looks up the dashboard's `createdBy`
   (parallel-fetchable in principle, but this lookup is intentionally sequential — it only runs after the
   email has already resolved to a real user, so there's nothing to parallelize it against) and, when
   `target.id === createdBy`, rejects with `400 dashboard_member_is_host` instead of inserting. A silent
   no-op was considered and rejected: the frontend's `ShareDashboardDialog` appends whatever the POST
   returns straight into its local `members` list, so a quiet-success response would still have shown the
   host twice in the dialog itself (just not in the database) — an explicit error is what actually collapses
   the user-visible bug, not just the row-level one. New error code added to
   `frontend/dashboard/lib/api.ts`'s `FRIENDLY_ERROR_MESSAGES`.
2. **CORRECTNESS — case-sensitive email lookup. FIXED.** Confirmed against `better-auth`'s own
   `sign-up.mjs` (`const normalizedEmail = email.toLowerCase()`) that storage really is a plain
   `.toLowerCase()`, not fuller Unicode case-folding — so a plain `.toLowerCase()` on the lookup input is
   sufficient. `findUserByEmail` is now called with `rawEmail.trim().toLowerCase()`.
3. **CLEANUP — stale doc comment. FIXED.** The comment above `GET /v1/dashboards/:id/members` now says
   the route is gated by `resolveDashboardId`'s cross-org `dashboardAccessible` check, not the old
   slice-6a org-only description.
4. **EFFICIENCY — sequential queries that could be parallel. FIXED.** The `createdBy` select and the
   `dashboard_members` rows select in `GET /v1/dashboards/:id/members` now run inside one `Promise.all`.
5. **EFFICIENCY — N+1 user lookup. FIXED.** Added `findUsersByIds` (`routes/dashboards.ts`), a single
   `adapter.findMany({ where: [{ field: "id", operator: "in", value: ids }], limit: ids.length })` call —
   Better Auth's `Where` type does support an `"in"` operator (confirmed by reading
   `@better-auth/core`'s adapter type definitions), so this flattens what was N round trips into one. The
   member list is re-joined from `memberRows` (not iterated off the batched result) specifically to keep
   the existing `addedAt`-ascending order, since a `Map`/array from a batched `IN` query carries no
   ordering guarantee of its own.
6. **EFFICIENCY — missed `.returning()`. FIXED.** The insert now chains
   `.returning({ addedAt: dashboardMembers.addedAt })`. Postgres does not emit a `RETURNING` row for one
   `ON CONFLICT DO NOTHING` skipped, so the idempotent-repeat-add path still falls back to the old
   follow-up `SELECT` — only the common, non-conflicting path saves the round trip.
7. **CORRECTNESS (PLAUSIBLE) — a third hand-copy of the sharing predicate. FIXED.** Before assuming "no
   clean fix" was actually true, tested whether `dashboardAccessible`'s `SQL` return value can be
   interpolated directly into another `sql\`...\`` template (rather than only used inside the drizzle query
   builder's `.where()`) — confirmed with a standalone script against `PgDialect.sqlToQuery`: the
   composed query renders correctly, fully qualifying `dashboards`/`dashboard_members` columns exactly as
   the hand-written clause it replaces did. `POST /v1/agents`'s race-closing raw SQL insert
   (`routes/agents.ts`) now does `and ${dashboardAccessible(orgId, req.authUser!.id)}` instead of hand-
   copying the `org_id = ... OR EXISTS(...)` clause a third time — one fewer copy to keep in sync if the
   sharing predicate ever changes. (`selectDashboardIfLive` in `routes/dashboards.ts` has an identical
   hand-copy that the review didn't flag as one of the 7 findings; it wasn't touched, since it's out of
   this fix's explicit scope, but the same reuse would apply there too if it's ever revisited.)

### Re-verification (after applying the 7 fixes)

`pnpm typecheck` clean on both `@tollgate/api` and `@tollgate/dashboard`. Re-ran the curl matrix against
the dev DB with the same three real accounts (host/guest/outsider, session cookies reused from the prior
session's scratchpad — still valid), against a freshly created dashboard (the one used for the original
matrix had since been archived by the prior session's own delete-and-repoint test):

- Normal add, idempotent repeat-add (same `addedAt` both times, confirming the `.returning()` fallback
  path), nonexistent-email 404, and malformed-body 400 all still behave exactly as before — no regression
  from the `.returning()` or N+1 changes.
- **Self-add**: host adding their own email now gets `400 dashboard_member_is_host` instead of a silent
  200. Confirmed directly in Postgres that `dashboard_members` for the test dashboard holds exactly one
  row (the guest) — the host was never inserted, on either self-add attempt.
- **Case-insensitive add**: host added the guest via `Share-Guest-1786251899@Test.Local` (a mixed-case
  variant of the guest's real, lowercase-stored address) and it resolved to the same account and the same
  existing `addedAt` — confirming both the fix and that it's correctly idempotent against the
  already-lowercase-stored row.
- `GET /v1/dashboards/:id/members` lists the host once and the guest once — no duplication.
- `GET /v1/dashboards/shared`: host's own list is empty (their dashboard correctly does NOT appear on
  their own shared page — the bug's second symptom), guest's list contains exactly the shared dashboard,
  outsider's list is empty.
- Cross-org regression check: guest can still select the shared dashboard and create an agent in it
  (exercising finding #7's fixed call site specifically); the created agent's `org_id` in Postgres still
  correctly matches the dashboard's own org, not the guest's — confirming the `dashboardAccessible`
  composition didn't change the insert's authorization behavior. Outsider still 404s on both. A
  since-archived dashboard from the prior session (which guest still has a live `dashboard_members` row
  for) still correctly 404s for guest — the archived-dashboard invariant survived the query changes.
