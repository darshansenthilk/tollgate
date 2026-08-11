# PLAN.md

## What shipped before this round (condensed recap)

The **role-permission delegation** feature (the HardHat popup on `/agents`) is built and committed. A host
opens it, picks a role, and flips 6 on/off toggles — `createAgent`, `updateAgent`, `freezeAgent`,
`unfreezeAgent`, `deleteAgent`, `addDashboardMember` — which the api enforces for cross-org members via
`canPerformDashboardAction`. Last round was fix/polish on it, four commits:

- **`80653af`** — add-member errors split into three real 400s (`dashboard_member_is_self`,
  `dashboard_member_is_host`, `dashboard_member_already_exists`); the old idempotent-success path is gone.
- **`0a19137`** — host-only gating of the rename pencil + HardHat button via a new `isHost` field on
  `GET /v1/dashboards/:id/my-permissions`; red/green fill on the permission toggles.
- **`78e35aa`** — `--err` darkened ~12% in both theme variants.
- **`e93ebd2`** — rename popup always breaks the quoted name onto its own line; **roles
  Admin/Moderator/Manager/Helper removed, leaving only Observer** (migration `0016` narrowed the
  `dashboard_member_role` pgEnum); stale `claude-docs/PLAN.md` deleted.

**State:** branch `Eshaan-feature-permissions`, HEAD `e93ebd2`, **1 commit ahead of origin (unpushed)**.
`main` is at `a6de787` and unmerged — it lacks all four of the above plus `638e6e6`. The role removal is
fully verified (typecheck ×4, 89 proxy tests, migration applied, curl matrix, adversarial review with 0
surviving findings); **nothing visual on this feature has ever been browser-checked** — no browser
automation has been available in any session on this branch.

**Carried-over open item:** `frontend/dashboard/lib/api.ts:668-672` still claims re-adding a member is
idempotent, which `80653af` made a 400. Folded into this round's work (see W6). The *other* carried-over
item — the one-option role dropdown firing a no-op PATCH — is **dissolved by this feature**: the dropdown
becomes genuinely multi-option.

---

# This round: host-created custom roles (create + delete)

## The ask

In the HardHat popup, let the host **create a new role** and give it the same 6 permission toggles
Observer already has. A created role then appears in the **member-role dropdown** in the share dialog, so
the host can assign it to specific accounts. The host can also **delete a role**, under three rules:

- **Observer can never be deleted.**
- **Two roles on one dashboard cannot share a name** — case-insensitively, so `Editor` and `editor`
  collide (D10).
- **A role anyone currently holds cannot be deleted** — the refusal says how many accounts hold it, as a
  count only, never a list of who.

## The central change — roles become data, actions do not

Today a role is a **compile-time value in three places at once**: the `DashboardMemberRole` TS union in
`@tollgate/shared`, the `dashboard_member_role` pgEnum, and a literal path segment in
`/v1/dashboards/:id/permissions/:role`. A host-created role cannot exist in any of them — you cannot add a
union member or an enum value at runtime. So this feature **deletes that enum and that union** and
replaces them with rows in a new `dashboard_roles` table.

The line this plan does **not** cross: the 6 *actions* stay a fixed compile-time list
(`DASHBOARD_PERMISSION_ACTIONS`, `dashboard_permission_action` pgEnum). Only the *roles* become dynamic.
Every exhaustive `Record<DashboardPermissionAction, boolean>` in the codebase stays exactly as it is.

## Decisions

**D1 — Roles are per-dashboard rows, not global.** `dashboard_roles` is scoped by `dashboard_id`, matching
how `dashboard_role_permissions` is already scoped ("two dashboards' Observer rows are independent").
Creating "Editor" on one dashboard does not create it on any other, including other dashboards the same
host owns. This is the existing invariant, not a new one.

**D2 — Observer becomes an ordinary row, flagged `is_default`.** The alternative — keep `observer` as an
enum value and add a nullable `role_id` beside it — means two columns representing one thing and a
`COALESCE` in every authorization query. Instead every dashboard gets exactly one seeded row
(`name = 'Observer'`, `is_default = true`), and `dashboard_members.role_id` is a plain FK. `is_default`
earns its keep twice: `POST .../members` needs it to resolve which role a new member gets (D3), and the
delete route keys its "Observer can't be deleted" refusal off it (D14).

**D3 — `dashboard_members.role_id` is NOT NULL with no column default.** A per-dashboard uuid cannot be a
static column default the way `'observer'` was, so `POST /v1/dashboards/:id/members` resolves the
dashboard's `is_default` role id and inserts it explicitly. NOT NULL rather than "NULL means Observer" —
otherwise there are two spellings of the same state and every read has to handle both.

**D4 — Every dashboard has its default role from birth.** `POST /v1/dashboards` (the only insert site in
the codebase — verified, `dashboards.ts:261`) creates the Observer row in the same request; migration
`0017` backfills one for every existing dashboard, archived ones included, so un-archiving can't surface a
dashboard with no roles.

**D5 — The wire key for a role is its uuid, not its name.** `/v1/dashboards/:id/permissions/:role` becomes
`/v1/dashboards/:id/permissions/:roleId`, and `PATCH .../members/:userId` takes `{ roleId }`. Names are
mutable-in-principle display strings; ids are not. `:roleId` **must be screened with `UUID_RE` before it
reaches Postgres**, for exactly the reason `lib/dashboard-scope.ts` documents for dashboard ids: a
malformed uuid is a driver cast error (22P02) and, with no `setErrorHandler` registered, Fastify answers
500 with the raw driver message instead of the 404 these routes promise.

**D6 — A member's role must belong to that member's dashboard, enforced in SQL.** `dashboard_members` now
carries both `dashboard_id` and `role_id`, which could in principle disagree. Rather than rely on the
route's check alone, `dashboard_roles` gets a `UNIQUE (id, dashboard_id)` constraint and
`dashboard_members` gets a **composite FK `(role_id, dashboard_id) → dashboard_roles (id, dashboard_id)`**.
Postgres then makes the mismatch unrepresentable. This is an authorization table; the codebase's existing
instinct (see `selectDashboardIfLive`) is to decide these in SQL where SQL can decide them. Note the
composite FK target must be a real `UNIQUE` **constraint**, not merely a unique index.

**D7 — `dashboard_role_permissions` drops its `dashboard_id` column.** With `role_id` a uuid FK, the
dashboard is already determined by the role. Keeping the column would be a denormalization that can
disagree with `dashboard_roles.dashboard_id` — the same hazard D6 closes, but with no equivalent
constraint available. The PK becomes `(role_id, action)`. Dashboard scoping lives in exactly one place:
`dashboard_roles.dashboard_id`.

**D8 — One new list route, not host-only: `GET /v1/dashboards/:id/roles`.** Both dialogs need the role
list (the popup for its dropdown, the share dialog for its per-member dropdown). Host-gating it would
break the share dialog for non-host members, who **already** see role names on every member row today — so
the names are not new information. Only *configuring* a role's toggles stays host-only.

**D9 — Member rows carry their role inline as `{ id, name }`.** `GET .../members` returns
`role: { id, name }` per member rather than a bare id, so the dialog can render a label without a
successful second fetch to join against. The separate roles list is only needed to populate the *options*.

**D10 — Creating a role is host-only, and duplicate names are a 400, not a silent no-op.** Follows
`80653af`'s precedent: `dashboard_role_name_exists`, `dashboard_role_name_too_long`, `invalid_body` for
empty/non-string. **Uniqueness is case-insensitive and per dashboard**, enforced by a unique index on
`(dashboard_id, lower(name))` as well as by the route check — so a race can't produce two "Editor"s, and
`Editor`/`editor`/`EDITOR` are one name, not three. Compared after the same `.trim()` `parseNameBody`
already applies to dashboard names, so `"Editor "` collides too. This also means the seeded `Observer` row
makes a second role called "observer" in any casing impossible, which is the desired reading of D14.

**D11 — A newly created role starts with every toggle off.** No rows in `dashboard_role_permissions`, and
both `canPerformDashboardAction` and `fetchRolePermissions` already read "no row" as `false`. A new role is
therefore strictly no more privileged than an unconfigured Observer — nothing to add for this.

**D12 — The proxy is untouched.** Verified by grep: nothing under `backend/proxy` references dashboard
roles or members. The 89 proxy tests should still be run (they import `@tollgate/shared`, which changes),
but no proxy source or test file should need editing. If one does, something in this plan is wrong.

**D13 — Deleting a role is a hard delete, and its toggle rows cascade.** Unlike `dashboards` — soft-deleted
only because `agents.dashboard_id` and `spend_events.agent_id` make a hard delete destroy billing history
— a role has no audit value behind it: its `dashboard_role_permissions` rows are pure configuration, and by
D15 a role that anyone actually holds can't be deleted at all. So `dashboard_role_permissions.role_id`
gets **`ON DELETE CASCADE`**, and the role row is genuinely removed. The cascade can therefore only ever
sweep the config of a role nobody holds. Note the asymmetry with `dashboard_members.role_id`, which
deliberately gets **no** `onDelete` action at all — see D15.

**D14 — Observer (the `is_default` role) can never be deleted.** Checked before the in-use count, so a
host trying to delete Observer gets "the Observer role can't be deleted" rather than a member count that
implies the answer would change if they emptied it. `400 dashboard_role_is_default`. The check keys off
`is_default`, not off the literal name `"Observer"` — the name is display copy, the flag is the invariant,
and D3 depends on exactly one such row existing per dashboard for `POST .../members` to resolve.

**D15 — A role anyone holds can't be deleted, and the refusal reports a count and nothing else.**
`400 dashboard_role_in_use`, message `"This role can't be deleted because N account(s) currently have
it."` — the api composes the copy including singular/plural, and the dialog renders `err.message`, which
is what every other error path in these dialogs already does. **No emails, ids, or member list**: the
count is the whole payload, so no separate `memberCount` field either.

The count check is the *friendly* answer, not the guarantee. The guarantee is `dashboard_members.role_id`
having no `ON DELETE` action, so Postgres itself refuses the delete — which is why D6's composite FK is
load-bearing twice. To keep a concurrent "assign this role to someone" from turning the friendly 400 into a
raw 23503 → 500, run the count and the delete in one transaction that first takes `SELECT … FROM
dashboard_roles WHERE id = … FOR UPDATE`: `FOR UPDATE` conflicts with the `FOR KEY SHARE` a concurrent
member-insert's FK check takes, so the two serialize and whichever loses sees the committed truth. Same
reasoning, and the same lock-conflict table, as `selectDashboardIfLive`'s existing `FOR SHARE` comment.

**D16 — The delete button stays enabled for in-use roles.** Pre-disabling it (by shipping member counts on
`GET .../roles`) would mean the "N accounts have it" message could never appear — and that message is the
specified behavior, not a fallback. The attempt is what produces the explanation.

## Action inventory — what a role can be given

Unchanged from the existing feature. The 6 delegatable actions stay exactly as they are, and the same
things stay host-only and non-delegatable: renaming/deleting the dashboard, removing a member, changing a
member's role, and **managing roles themselves** (creating one, deleting one, configuring its toggles). A
role that could grant itself permissions — or delete the role gating it — would defeat the gate.

## Work items

**W1 — `backend/shared/src/index.ts`.**
- Delete `DashboardMemberRole` and `DASHBOARD_MEMBER_ROLES` outright. They cannot survive as a union.
- Leave `DashboardPermissionAction` / `DASHBOARD_PERMISSION_ACTIONS` untouched, and rewrite the section
  doc comment to say why roles moved to the database while actions did not — that asymmetry is the whole
  design and the next reader will ask about it.
- No `DashboardRole` interface goes here: the wire shapes for dashboards already live locally in
  `routes/dashboards.ts` (`DashboardJson`, `DashboardUserJson`) and `lib/api.ts`, not in shared. Follow
  that.

**W2 — `backend/api/src/db/schema.ts`.**
- New `dashboardRoles` table: `id` (uuid PK), `dashboardId` (uuid, FK → dashboards.id, no `onDelete` —
  same reasoning as `dashboardMembers`: dashboards are only soft-deleted), `name` (text), `isDefault`
  (boolean, default false), `createdAt`. Unique index on `(dashboardId, lower(name))`; unique constraint
  on `(id, dashboardId)` for D6's composite FK.
- `dashboardMembers`: `role` → `roleId` (uuid, NOT NULL, composite FK per D6). **No `onDelete` action** —
  that omission is what makes Postgres refuse to delete a role someone holds (D15), so it needs a comment
  saying so; a future reader "tidying" it to `cascade` would silently strip people's roles.
- `dashboardRolePermissions`: drop `dashboardId` and `role`; add `roleId` (uuid, NOT NULL, FK →
  dashboardRoles.id, **`onDelete: "cascade"`** per D13); PK becomes `(roleId, action)`.
- Delete `dashboardMemberRoleEnum`.

**W3 — Migration `0017` (hand-edited; see the migration section below).**

**W4 — `backend/api/src/lib/dashboard-permissions.ts`.**
- `canPerformDashboardAction`: same same-org bypass, then read the member's `roleId` and look up
  `(roleId, action)`. The `?? "observer"` defensive fallback **goes away** — with no member row there is no
  role id, so return `false` directly. That is a tightening, and the doc comment should say so rather than
  leaving the reader to notice the fallback vanished.
- `fetchRolePermissions(roleId)` — takes a role id instead of `(dashboardId, role)`. Its "no row → false"
  fill loop over `DASHBOARD_PERMISSION_ACTIONS` is unchanged.

**W5 — `backend/api/src/routes/dashboards.ts`.**
- Delete `isDashboardMemberRole`. Add `resolveDashboardRole(roleId, dashboardId)` — `UUID_RE` screen (D5),
  then a lookup constrained to that dashboard, returning the row or null. **This helper is the
  authorization check for `:roleId`**, exactly as `resolveDashboardId` is for `:id`: a role id belonging to
  someone else's dashboard must answer 404, never 403 and never a leak of whether it exists.
- Add `parseRoleNameBody` alongside `parseNameBody`, with its own cap (`MAX_ROLE_NAME_LENGTH`, proposed
  **30** — see the open questions).
- `POST /v1/dashboards` — insert the Observer row alongside the dashboard (D4). Both writes in one
  transaction, so a dashboard can never exist without its default role.
- **New** `GET /v1/dashboards/:id/roles` — `resolveDashboardId` gate only, not host-only (D8). Returns
  `[{ id, name, isDefault }]`, `isDefault` first then `createdAt` ascending, so Observer always heads both
  dropdowns.
- **New** `POST /v1/dashboards/:id/roles` — host-only, same `resolveDashboardId` → `createdBy === caller`
  ordering every other host-only route here uses (host check **before** body parsing, so an unauthorized
  caller learns nothing about whether their payload was valid). Returns 201 `{ id, name, isDefault: false }`.
- **New** `DELETE /v1/dashboards/:id/roles/:roleId` — host-only, same gate ordering. Then, in this order:
  `resolveDashboardRole` → 404; `is_default` → `400 dashboard_role_is_default` (D14); in-use count →
  `400 dashboard_role_in_use` with the count in the message (D15); otherwise delete, letting the toggle
  rows cascade (D13). Returns `{ id }`, echoed back rather than an empty body — `request()` in `lib/api.ts`
  always calls `res.json()`, the same reason `DeleteDashboardResponse` exists. The count-and-delete run in
  one transaction opened with `SELECT … FOR UPDATE` on the role row (D15); a repeat delete answers 404,
  which callers read as "already gone", matching `deleteDashboard`'s own convention.
- `GET /v1/dashboards/:id/members` — join `dashboard_roles` so each member carries `role: { id, name }` (D9).
- `PATCH /v1/dashboards/:id/members/:userId` — body `{ roleId }`; resolve via `resolveDashboardRole` →
  `invalid_dashboard_member_role` 400 becomes a **404** for a role id that isn't this dashboard's, matching
  how every other unreachable id is answered here. Response `{ userId, role: { id, name } }`.
- `GET`/`PATCH /v1/dashboards/:id/permissions/:roleId` — `:role` → `:roleId`, validated by
  `resolveDashboardRole` instead of the union guard. Everything else (host gate, `parsePermissionsBody`,
  the concurrent per-action upserts) is unchanged; the upsert's conflict target becomes
  `(roleId, action)`.
- `GET .../my-permissions` — **unchanged**, including its response shape. It answers per-action, and the
  actions did not change.

**W6 — `frontend/dashboard/lib/api.ts`.**
- New `DashboardRole { id; name; isDefault }`; `listDashboardRoles(dashboardId)`,
  `createDashboardRole(dashboardId, name)`, `deleteDashboardRole(dashboardId, roleId)`. The delete
  helper's doc comment should name both refusal cases (`dashboard_role_is_default`,
  `dashboard_role_in_use`) and say the count arrives inside the message, since the caller renders it
  verbatim.
- `DashboardMember.role` → `DashboardRole`-shaped `{ id, name }`; `UpdateDashboardMemberRoleResponse.role`
  likewise; `updateDashboardMemberRole` takes a `roleId`.
- `DashboardRolePermissions` keyed by role id; `get`/`setDashboardRolePermissions` take a `roleId`.
- Drop the `DashboardMemberRole` import.
- **Fix the stale comment at 668-672** while this file is open — re-adding a member is a 400, not
  idempotent (carried-over item).

**W7 — `share-permissions-dialog.tsx` (the HardHat popup).**
- Delete `ROLE_LABELS` / `ROLE_OPTIONS`; fetch roles on open via a new `listDashboardRoles` prop, select
  the `isDefault` one initially instead of the hardcoded `"observer"`.
- `selectedRole` becomes a role id (`string | null` until the list loads); the toggle list renders only
  once a role is selected.
- **Add the create-role form**, inline under the role dropdown — an `Input` + `Button` row with a `Label`,
  the same shape as `ShareDashboardDialog`'s "Add someone by email" form, so this is reuse of a sibling
  dialog's layout rather than a new one. Inline rather than a nested dialog because creating needs no
  confirmation — deleting does, and that one *is* nested (below).
- On success: append to the local role list, select the new role, show its (all-false) toggles — the
  append-in-place style `handleAdd` already uses, no refetch.
- **Add the delete affordance**: a `Trash2` icon button beside the role dropdown, acting on the currently
  selected role, rendered only when that role is **not** `isDefault` (D14 — Observer simply has no button,
  rather than a disabled one the host can click for a refusal). Enabled regardless of who holds the role
  (D16).
- **Delete goes through a nested confirmation `Dialog`**, copied structurally from the remove-member
  confirm in `share-dashboard-dialog.tsx:352-412` — including its placement as a **React child of the
  outer `Dialog`** rather than a JSX sibling. That file's comment explains why (Base UI links a nested
  dialog's Escape/topmost tracking through React context; two sibling roots both consider themselves
  topmost and Escape closes the whole popup). Copy the `onOpenChange` guard too: ignore dismissal while a
  delete is actually in flight.
- On confirmed delete: drop the role from local state and select the `isDefault` role, then load its
  toggles. On `dashboard_role_in_use`, keep the confirm dialog open and show the api's message — the count
  is the point, so it must not be swallowed by closing the dialog.
- Errors go in the dialog's existing error-line style (`var(--err)`), rendering the `ApiError` message
  verbatim for `dashboard_role_name_exists` / `_too_long` / `_is_default` / `_in_use`.
- The existing `generation` ref must guard the new create **and** delete calls, and switching roles
  mid-flight must keep invalidating stale toggle loads exactly as it does now. Keep the in-flight delete
  id in its own state, separate from `pendingAction`, the same way `share-dashboard-dialog.tsx` keeps
  `pendingRemoveUserId` separate from `pendingRoleUserId` so two flows can't race one row.

**W8 — `share-dashboard-dialog.tsx`.**
- Delete `ROLE_LABELS` / `ROLE_OPTIONS`; take the same `listDashboardRoles` prop and fetch the options on
  open, in parallel with the existing member fetch (both under the current `generation` guard).
- Member rows render `m.role.name`; the dropdown lists the fetched roles; `handleRoleChange` passes a role
  id. **Add the equality short-circuit** it never had (`if (roleId === m.role.id) return`) — harmless when
  the menu had one option, a pointless PATCH now that it has several.
- If the roles fetch fails, fall back to plain non-interactive labels rather than an empty dropdown.

**W9 — `agent-dashboard.tsx` / `app/agents/page.tsx`.** Thread `listDashboardRoles`,
`createDashboardRole` and `deleteDashboardRole` through, following the existing optional-and-paired
convention exactly: `listDashboardRoles` pairs with the sharing props (both dialogs need it), while
`createDashboardRole` and `deleteDashboardRole` pair with `get`/`setDashboardRolePermissions` (host-only,
HardHat popup only). The marketing demo supplies none of them and must keep rendering no role affordances
at all — check `/` after the change, not just `/agents`.

## Migration `0017` — hand-written, and drizzle cannot generate it

Same lesson as `0016`, one step harder: drizzle will emit `ADD COLUMN role_id uuid NOT NULL` (fails on
existing rows), `DROP COLUMN role`, and a PK swap, with **no idea** that the new column's value has to be
derived from a table this migration also creates. Order matters:

1. `CREATE TABLE dashboard_roles` + FK to dashboards + `UNIQUE (id, dashboard_id)` (D6) + unique index on
   `(dashboard_id, lower(name))`.
2. Seed: `INSERT INTO dashboard_roles SELECT gen_random_uuid(), id, 'Observer', true FROM dashboards;` —
   **every** dashboard, archived included (D4). Confirm the dev Postgres is ≥13 so `gen_random_uuid()` is
   core rather than a `pgcrypto` dependency.
3. `dashboard_members`: add `role_id` **nullable** → `UPDATE … FROM dashboard_roles WHERE dashboard_id
   matches AND is_default` → `SET NOT NULL` → add composite FK → `DROP COLUMN role`.
4. `dashboard_role_permissions`: add `role_id` nullable → same `UPDATE` (every surviving row is Observer's,
   since `0016` deleted the rest) → `SET NOT NULL` → drop the old PK, add `(role_id, action)` → add FK
   **`ON DELETE CASCADE`** (D13) → `DROP COLUMN role`, `DROP COLUMN dashboard_id`. Drizzle does emit the
   cascade from the schema, so this clause is the one part of the FK work not to hand-write — just verify
   it survived into the generated SQL, since D13 is the whole reason deleting a role works at all.
5. `DROP TYPE "public"."dashboard_member_role";` — last, once no column references it.

Every data statement is a no-op on an empty database, so the `0000 → 0017` replay on a fresh clone is
unaffected. After applying, re-run `pnpm db:generate` and confirm it reports no drift (i.e. `schema.ts` and
`meta/0017_snapshot.json` agree and no spurious `0018` appears) — that check is what caught nothing last
round precisely because it was run.

## Verification plan

There is **no api route-test suite** (`backend/api`'s `test` script only runs colocated `src/lib/*.test.ts`
unit tests), so route behavior is proved by curl, as in every prior round on this branch.

1. `pnpm typecheck` across all four packages. Expect a wave of errors in the dashboard first — deleting the
   `DashboardMemberRole` union is a deliberate compile-time tripwire that names every site needing an edit.
2. `pnpm --filter @tollgate/proxy test` (89) and `pnpm --filter @tollgate/api test` — neither should need a
   file changed (D12). If proxy tests fail, stop and re-read D12.
3. Apply the migration; confirm in Postgres: one `is_default` role per dashboard, every
   `dashboard_members.role_id` non-null and pointing at its own dashboard's role, the 12 existing
   permission rows repointed and still 12, `dashboard_member_role` type gone.
4. Curl matrix with a throwaway host + guest pair:
   - create a role → 201; duplicate name → 400; a **case-variant** of an existing name (`editor` vs
     `Editor`) → 400, and `"Observer"` in any casing → 400 (D10); empty and over-cap → 400; non-host
     caller → 403 before any body validation.
   - a roleId from a **different** dashboard, on `GET`/`PATCH .../permissions/:roleId`,
     `DELETE .../roles/:roleId` and `PATCH .../members/:userId` → **404**, not 403 and not 500. A
     malformed non-uuid → 404, not 500 (this is the `UUID_RE` screen from D5 — the single easiest thing to
     get wrong here).
   - assign the new role to the guest; toggle `createAgent` **off** → guest's create 403s; **on** → passes.
     Both directions, on a *custom* role, not just Observer.
   - a fresh member added by email still lands on Observer (D3).
   - `GET .../my-permissions` response shape byte-identical to before.
5. Deletion matrix, on top of the above:
   - `DELETE` the dashboard's Observer role → `400 dashboard_role_is_default`, **even with zero members
     holding it** (D14 orders the default check first).
   - `DELETE` a custom role the guest currently holds → `400 dashboard_role_in_use`, message carrying the
     right count, and **no email or user id anywhere in the response body** (D15 — grep the raw response
     for the guest's address). Add a second holder and confirm the count moves 1 → 2 and the copy
     pluralizes.
   - Reassign both holders off it, then `DELETE` → 200, and in Postgres: the role row gone **and** its
     `dashboard_role_permissions` rows gone with it (D13's cascade), with every other role's toggles
     untouched. Repeat `DELETE` → 404.
   - The FK backstop, directly in psql: `DELETE FROM dashboard_roles WHERE id = <a held role>` must raise
     23503 rather than succeed (D15). This is the check that proves the friendly count isn't the only
     thing standing between a host and silently stripping people's roles.
   - Non-host `DELETE` → 403, before the default/in-use checks reveal anything about the role.
6. **Browser pass on the popup** — the create form, the trash button appearing for custom roles and not
   for Observer, the nested confirm dialog (including Escape closing only *it*, which is the whole point
   of the nesting pattern W7 copies), the in-use count copy, and the multi-option dropdowns in both
   dialogs. This has never been possible on this branch (no browser automation in any session) and this
   round adds the first genuinely new *interactive* UI since the feature shipped. If no tooling is
   available again, say so explicitly rather than letting "verified" imply it.

## Out of scope

- **Renaming a role.** Not asked for. D5 already keys everything off role ids rather than names, so a
  later rename is a route plus a dialog affordance, with no schema or wire change.
- **Reassigning members as part of a delete.** D15 makes an in-use role undeletable rather than offering
  to move its holders somewhere first. That's the specified behavior; a "move everyone to Observer and
  then delete" flow would be a different feature.
- **Making the 6 actions dynamic.** Roles become data; actions stay a fixed compile-time list (D-section
  preamble).
- **Per-role member counts, role descriptions, role colors, reordering.** None asked for.
- **Cross-dashboard role templates.** D1 is deliberate.
- Merging to `main`, and the still-unpushed `e93ebd2`.

## Open questions — flagged, not blocking

1. **Name cap: 30 or 50?** Proposed 30, since these render in a compact dropdown trigger; dashboards use
   50. One-constant change either way.
2. **A per-dashboard role cap** (e.g. 20 → 400). Cheap boundary check, not asked for. Include or skip —
   now slightly less pressing, since roles are deletable.
