# PLAN.md — Dashboard member roles (permission assignment)

Branch: `Eshaan-feature-permissions`. Builds on the dashboard-sharing feature (`a2a32df`, host +
`dashboard_members`, currently full-parity access for every member).

## What's being built

- Every added member starts with role **Observer** — the default, no permissions, view-only.
- A role label sits to the right of each member's name, in the same position/style the "Host" label
  already occupies in the share dialog.
- **Host-only** (for now): clicking a member's role label opens a dropdown listing all 5 roles, ordered
  bottom→top by rank: **Observer (bottom) → Helper → Manager → Moderator → Admin (top)**. Picking one
  reassigns that member.
- **Host is not an assignable role.** It never appears in the dropdown and the host's own row stays
  non-interactive — matches how Host already works today (a separate identity, not a member-table value).

## Grounding facts (verified by reading the current code, not assumed)

- `dashboard_members` (`schema.ts:378-395`) has no role/permission column today — just `dashboardId`,
  `userId`, `addedAt`. Host = `dashboards.createdBy` (`schema.ts:313-317`), a separate column, not a
  members-table row — so the dropdown only ever touches `members` array entries, never the host.
- **No role or permission concept exists anywhere in this codebase.** Grepped `backend/api`,
  `backend/proxy`, `frontend/dashboard` for `requireRole`/`checkPermission`/`role` — nothing. The only
  authorization gate is `requireAuth` (`lib/require-auth.ts:28-55`): authenticates + checks org membership,
  no role check at all. Every dashboard route authorizes via one shared predicate,
  `dashboardAccessible` (`lib/dashboard-scope.ts:57-63`) — org match OR membership row exists — which
  gives host and every member **identical** capabilities today. This is explicitly doc-commented in
  `schema.ts:332-334` as "full parity... tiered permissions explicitly future work."
- Existing "Host" badge (`share-dashboard-dialog.tsx:137`) is a plain sibling span,
  `text-xs text-muted-foreground`, right-aligned by the row's `justify-between` — not a pill component.
  The role label should match this exact style when non-interactive.
- `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`
  (`components/ui/dropdown-menu.tsx`) already exist and have one live consumer to mirror:
  `dashboard-tile.tsx`'s 3-dot menu (trigger button → content → items with `onClick`).
- Fixed-set enums in this repo are plain TS unions in `backend/shared/src/index.ts`
  (`AgentStatus`, `SpendDecision`, etc.), mirrored 1:1 as a `pgEnum` in `schema.ts` under its own
  "mirror the string unions in `@tollgate/shared` exactly" comment (`schema.ts:24-26`). No *ordered*
  enum precedent exists in the repo — the only enum-comparison idiom is `ReadonlySet` membership
  (`proxy.ts:46-50` `FROZEN_STATUSES`), not rank comparison.

## Decisions / assumptions — flag if any of these read wrong

- **D1 — Role is per dashboard-membership** (`dashboard_members.role`), not global per user. Matches the
  existing per-dashboard sharing model; a user can already be a member of several dashboards independently.
- **D2 — This slice is assignment + display only. Enforcing what a role can/cannot do — including
  Observer's "view only" — is explicitly out of scope here**, the same way the original sharing plan
  carved "tier customization" out as future work. Helper/Manager/Moderator/Admin have no defined
  capabilities yet, and even just Observer-enforcement means auditing and gating every dashboard- and
  agent-mutating route — a separate, larger slice once the tiers themselves are defined. This plan adds
  the data model, the host-only write path, and the UI; it does not gate any existing route on the new
  column.
- **D3 — Host's own row is untouched**: still the current non-interactive "Host" span. Only entries in
  the `members` array become dropdown-editable, and only for the host viewer.

## Data model

- `backend/shared/src/index.ts`: new union `DashboardMemberRole = "observer" | "helper" | "manager" |
  "moderator" | "admin"`, doc-commented low→high like `AgentStatus`. Plus a small rank map,
  `DASHBOARD_MEMBER_ROLE_RANK: Record<DashboardMemberRole, number>` (observer=0 … admin=4) — new idiom
  (no ranked-enum precedent exists), styled after shared's existing small pure-helper exports.
- `schema.ts`: new `dashboardMemberRoleEnum = pgEnum("dashboard_member_role", ["observer","helper",
  "manager","moderator","admin"])` beside the other 4 enums, mirroring the shared union per convention.
- `dashboard_members` gains `role: dashboardMemberRoleEnum NOT NULL default 'observer'`.
- One drizzle-kit migration (next after `0012_zippy_power_man.sql`) — additive column with a default, no
  backfill logic needed.

## Backend

- `GET /v1/dashboards/:id/members` (`dashboards.ts:576`): include `role` on each member entry. Host entry
  unchanged (still `{id, email}`, no role — it's not a member row).
- New endpoint, e.g. `PATCH /v1/dashboards/:id/members/:userId` — body `{role}}`, validated against the 5
  enum values. **New host-only check**: caller's id must equal `dashboards.createdBy` — this doesn't exist
  anywhere yet (today's routes deliberately treat host and member as equal via `dashboardAccessible`), so
  it's new code, not an extension of that predicate. 403 with the existing `{error, message}` shape on a
  non-host caller or an unknown role value.
- No changes to any other route — see D2.

## Frontend

- `DashboardMember` (`lib/api.ts:498`) gains `role: DashboardMemberRole`.
- In `share-dashboard-dialog.tsx`, each member row's badge becomes conditional on viewer identity
  (dialog already tracks `viewerEmail` vs `host?.email`):
  - **Viewer is host**: role label becomes a `DropdownMenuTrigger` (same text styling as today's plain
    Host span). `DropdownMenuContent` lists all 5 roles **top-to-bottom as Admin, Moderator, Manager,
    Helper, Observer** — i.e. bottom-to-top by rank as asked, highest at the top of the open menu, lowest
    at the bottom. Selecting a `DropdownMenuItem` calls the new PATCH endpoint and updates the row's role
    in local state on success.
  - **Viewer is not host** (including a member viewing their own row): plain non-interactive label, same
    style as the current Host span — no dropdown, per "only the host for now."
  - Host's own row: unchanged.

## Out of scope (this slice)

- Enforcing any role's actual permissions on any route (see D2).
- Removing/downgrading a member's access entirely — no delete-member endpoint exists at all today; that
  gap is pre-existing and not introduced or closed here.
- Multiple hosts, host transfer, or org-level roles / Better Auth role sync.

## Rollout

Additive only — new enum, new nullable-by-default-free column (has a default), new endpoint, no existing
route or response field removed or changed shape. Safe to migrate and ship without coordinating with any
in-flight work (checked: the two uncommitted tweaks currently sitting in `dashboards.ts` / `lib/api.ts` are
unrelated error-copy wording changes, not permission work).
