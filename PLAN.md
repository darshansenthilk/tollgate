# PLAN.md

**Status: the dashboard role-permissions feature is BUILT and verified — backend committed as `efbed52`,
this round's frontend reshape UNCOMMITTED in the working tree.**
This file is a reference for the feature as it stands. It is not a plan for new work; nothing here is
outstanding except the one gap named at the bottom.

---

## What the feature is

A dashboard's **host** (`dashboards.created_by`) can create named **roles**, flip 6 permission toggles on
each, assign them to members from the share dialog, and delete them. Roles are per-dashboard. Only a
**cross-org** member — someone who reached the dashboard through an explicit `dashboard_members` grant —
is actually gated by a role's toggles; a same-org caller keeps full parity (`canPerformDashboardAction`'s
first line).

## The one design fact everything follows from

**Roles are DATA; actions are CODE.** Roles used to be a compile-time value in three places at once (a
`DashboardMemberRole` TS union, a `dashboard_member_role` pgEnum, a literal path segment) — all three are
gone, replaced by rows in `dashboard_roles`, addressed on the wire by **uuid**, never by name. The 6
actions stayed a fixed list (`DASHBOARD_PERMISSION_ACTIONS` in `@tollgate/shared`) because each one names
a specific route's gate in code, so making them data would buy nothing and cost the exhaustive
`Record<DashboardPermissionAction, boolean>` the api, the popup and `/my-permissions` all rely on. That
asymmetry is written up in `@tollgate/shared`'s "Dashboard permissions" section — read it before changing
either half.

## Data model (`backend/api/src/db/schema.ts`, migration `0017_normal_blink.sql`)

- **`dashboard_roles`** — `id`, `dashboard_id` (FK, no `onDelete`), `name`, `is_default`, `created_at`.
  - `UNIQUE INDEX (dashboard_id, lower(name))` — names are unique per dashboard, **case-insensitively**,
    which is also what stops a second "observer" shadowing the seeded default.
  - `UNIQUE CONSTRAINT (id, dashboard_id)` — looks redundant, isn't: it is the target of the composite FK
    below, and Postgres only accepts a *constraint* there, not an index.
- **`dashboard_members.role_id`** — NOT NULL, no column default. Composite FK
  `(role_id, dashboard_id) → dashboard_roles (id, dashboard_id)` with **NO `onDelete` action**.
- **`dashboard_role_permissions`** — `(role_id, action)` PK, `enabled`. `role_id` FK is
  **`ON DELETE CASCADE`**. It has no `dashboard_id` of its own; the role determines the dashboard.

**The two FKs are deliberately asymmetric and both are load-bearing:**
- The **missing** `onDelete` on `dashboard_members.role_id` is what makes Postgres *refuse* (23503) to
  delete a role somebody holds. The friendly "N accounts have it" 400 is the explanation; this omission is
  the enforcement. Never "tidy" it into a cascade — it would silently strip people's roles.
- The **cascade** on `dashboard_role_permissions.role_id` sweeps a deleted role's toggles. Safe precisely
  because a held role can't be deleted at all, so it only ever sweeps config nobody is using.

**Observer** is an ordinary row flagged `is_default`, seeded per dashboard: by `POST /v1/dashboards` (in
the same transaction as the dashboard) and by `0017` for every pre-existing dashboard, archived ones
included. Exactly one per dashboard. `POST .../members` resolves it to assign a new member; `DELETE
.../roles/:roleId` refuses on it. Both key off the **flag**, never the literal name "Observer".

## API surface (`backend/api/src/routes/dashboards.ts`)

| Route | Who | Notes |
|---|---|---|
| `GET /v1/dashboards/:id/roles` | anyone who can reach the dashboard | `[{id,name,isDefault}]`, default first then `created_at`. **Not** host-only: both dialogs need it, and members already see role names. |
| `POST /v1/dashboards/:id/roles` | host | 201. `dashboard_role_name_exists` / `_name_too_long` / `invalid_body` / `dashboard_role_limit_reached`. |
| `DELETE /v1/dashboards/:id/roles/:roleId` | host | `{id}`. `dashboard_role_is_default` → `dashboard_role_in_use` → delete, in that order. |
| `GET`/`PATCH /v1/dashboards/:id/permissions/:roleId` | host | `{roleId, permissions}`. |
| `PATCH /v1/dashboards/:id/members/:userId` | host | body `{roleId}`; returns `{userId, role:{id,name}}`. |
| `GET /v1/dashboards/:id/members` | anyone who can reach it | each member carries `role: {id,name}` inline. |
| `GET /v1/dashboards/:id/my-permissions` | anyone who can reach it | **unchanged shape**: `{isHost, permissions}`. |

**Constants:** `MAX_ROLE_NAME_LENGTH = 30`, `MAX_ROLES_PER_DASHBOARD = 15` (Observer included).

**Authorization rules that must not drift:**
1. `resolveDashboardId` gates `:id`; **`resolveDashboardRole` gates `:roleId`** and is the authorization
   check, not a convenience. A role id from another dashboard, a malformed one, and a deleted one all
   answer **404 `dashboard_role_not_found`** — never 403, never a distinguishable "exists but isn't yours".
2. `resolveDashboardRole` screens with `UUID_RE` **before** touching Postgres. Without it a malformed uuid
   is a 22P02 driver cast error and, with no `setErrorHandler` registered, Fastify answers **500** with the
   raw driver message.
3. Host-only routes check `createdBy === caller` **before parsing the body**, so an unauthorized caller
   learns nothing about whether their payload was valid.
4. Managing roles is *not* delegatable — creating, deleting and configuring stay host-only, alongside
   rename/delete-dashboard and remove-member. A role that could grant itself permissions would defeat the
   gate.
5. `DELETE .../roles/:roleId` runs its count-and-delete in one transaction opened with `SELECT … FOR
   UPDATE` on the role row, which conflicts with the `FOR KEY SHARE` a concurrent member-insert's FK check
   takes — that's what keeps a race from turning the friendly 400 into a raw 23503 → 500.
6. The in-use refusal reports **a count and nothing else**: `{error, message}` only, the api composing the
   pluralized sentence. No emails, ids, member list, or `memberCount` field.

## Frontend

Both dialogs are **a single `<Dialog>` each**. Nothing nests — see "No nested dialogs" below, which is the
one structural rule in this half of the feature.

- **`share-permissions-dialog.tsx`** (HardHat popup, host-only) — fetches roles on open, selects the
  `isDefault` one, renders the 6 toggles. Layout, top to bottom: **create form (hidden by default)** →
  **Role section** (label row carrying the `+`, then the dropdown + trash) → **delete confirmation (only
  when armed)** → the toggle list.
  - The create form is revealed by a gray `Plus` button (`variant="ghost"`, `size="icon-sm"`,
    `text-muted-foreground`) right-aligned on the **"Role" label row**, and unfolds **above the entire Role
    section** so it sits against its own trigger. It's on the label row and not beside the dropdown
    because the trash button acts on *the selected role* while `+` acts on *the dashboard*; side by side
    they'd read as an add/remove pair for one role.
  - `showCreateForm` resets to `false` in the `open && !seeded` seeding block — the form is **never**
    remembered across a close/reopen. Collapsing it also clears `newRoleName` and `createError`, so a
    reveal can't open onto a stale duplicate-name refusal.
  - After a successful create the form **stays open** (input cleared, new role selected below). One
    invariant — it closes only on `+` or on reopen — instead of two, since the error path must keep it
    open regardless.
  - The `+` **stays enabled at `MAX_ROLES_PER_DASHBOARD`**, and the trash button **stays enabled on a role
    someone holds**. Same doctrine in both cases: the attempt is what produces the explanation, so
    pre-disabling would mean that message could never appear. The *default* role is the one exception — it
    gets **no** trash button at all rather than a disabled one, since clicking it could only ever be
    refused.
  - The delete confirmation is an inline destructive-tinted panel, not a dialog. It **names the role**
    (via a `confirmingRole` lookup by id, so it can never name a role other than the one `handleDelete`
    would delete) and **stays open on failure** — for `dashboard_role_in_use` the message carries the
    holder count, which is the entire explanation, so dismissing it would throw that away.
  - `switchToRole` **disarms the confirmation**, and the role dropdown is disabled while
    `pendingDeleteRoleId !== null`. Both exist only because the panel is no longer modal; without them the
    host can switch roles out from under an armed or in-flight delete.
- **`share-dashboard-dialog.tsx`** — fetches role options in parallel with the member list; rows render
  `m.role.name`; re-picking a member's current role fires no request. If the roles fetch fails, rows fall
  back to plain labels rather than an empty dropdown. The remove-member confirmation is an inline panel
  **inside the targeted member's `<li>`** — the list scrolls (`max-h-48`), so a panel at the dialog's foot
  would leave the host guessing which of several similar emails they clicked. Scoping its condition to
  `m.id` is also what makes an orphaned confirmation structurally impossible here, so this file needs no
  equivalent of the permissions dialog's disarm-on-switch.
- **`agent-dashboard.tsx` / `app/agents/page.tsx`** — `listDashboardRoles` is grouped with the sharing
  props (both dialogs need it); `createDashboardRole`/`deleteDashboardRole` with `get`/`setDashboard
  RolePermissions`. `canShareDashboard` / `canManageRoles` gate each group all-or-nothing, which is what
  keeps the marketing demo (`/`) rendering no role affordances at all.
- A single `generation` ref in each dialog invalidates stale async results on close and on role switch.
- `autoFocus` lands on **Cancel**, never on Delete/Remove, in both confirmation panels: they appear
  without a focus trap, so something has to take focus for a keyboard user to notice — and it should never
  be the destructive choice.

### No nested dialogs

Both confirmations used to be a second `<Dialog>` rendered as a React child of the first. They are inline
panels now, and the codebase contains **no dialog-in-a-dialog anywhere**. Consequences, both deliberate:

- **Escape closes the whole popup, including mid-request.** The nested confirm used to be topmost and
  swallow it. Not guarded — closing mid-flight was already permitted for an in-flight toggle save or role
  change: `generation` bumps in the `!open && seeded` branch, the response is discarded, the request still
  lands server-side, and the next open refetches from scratch. Locking the host out of the whole popup to
  protect one request is heavier than the behaviour it would preserve. Each outer `<Dialog>` carries a
  comment saying this, so it reads as a decision.
- If you ever *do* reintroduce a nested dialog: it must be a React **child** of the outer one, never a JSX
  sibling. Base UI links escape/topmost tracking through React context
  (`dialog/root/useRenderDialogRoot.mjs`: `nested = Boolean(parentDialogRootContext)`), which a sibling
  `Dialog.Root` never picks up — two sibling roots would both consider themselves topmost and Escape would
  close both.

## Verification already done — don't redo

**Backend (2026-08-11, commit `efbed52`).** `pnpm typecheck` ×4; 89 proxy tests + 24 api unit tests; **no
file under `backend/proxy` changed**. A 44-assertion HTTP matrix passed twice on independent fixtures,
covering case-insensitive duplicates, the `UUID_RE` screen answering 404 on all four routes, enforcement
flipping both directions on a *custom* role, the default-role refusal at zero holders, and the in-use
refusal's pluralized count with no email or id in the body. In Postgres: the cascade swept only the
deleted role's toggles; a direct `DELETE` of a held role raises 23503; a cross-dashboard role assignment
raises 23503 via the composite FK. The `0000 → 0017` fresh-clone replay was run into a scratch database
and produces the intended constraints.

**Frontend reshape (this round).** `pnpm typecheck` ×4, 89 proxy tests, 24 api unit tests — all green,
though the last two only evidence the diff's narrowness, since **nothing outside
`frontend/dashboard/components/` changed**. There is still no browser automation on this box, so the visual
pass was a 10-step manual checklist **run by Eshaan, who reported it good**: the `+` reveal and its reset
on reopen, the form staying open after a create, the confirm panel's placement and role naming,
disarm-on-role-switch, Observer having no trash button, the in-use refusal keeping the panel open with its
count, and the share dialog's in-row remove confirmation. That is the **first visual verification this
feature has ever had**, across five sessions.

## The one open gap

**A pre-existing first-boot bug, deliberately not fixed:** `0012_zippy_power_man.sql` reads Better Auth's
`member` table, but `index.ts` boots `runMigrations()` **before** `runAuthMigrations()`, so a genuinely
fresh database fails 0012 with `42P01`, swallowed as "postgres migration failed; continuing". Existing
databases are unaffected. The fix is a two-line reorder.

*(The browser-pass gap that sat here for four sessions is closed — see Verification above.)*

## Deliberately not built

Renaming a role (D5 keys everything off ids, so it's a route + a dialog affordance, no schema change);
reassigning members as part of a delete; making the 6 actions dynamic; per-role member counts, role
descriptions/colors/reordering; cross-dashboard role templates. An animated reveal on the create form and
the confirmation panels (both are plain conditional renders).

## Commit state

Backend and the original feature are committed and pushed as **`efbed52`**. **This round's frontend
reshape is uncommitted** — `share-permissions-dialog.tsx`, `share-dashboard-dialog.tsx` and this file are
all modified in the working tree. `main` is at `a6de787` and this branch is **unmerged**.
