# PLAN.md

## What shipped this round (uncommitted, on `Eshaan-feature-permissions`)

The full role-permission-delegation feature (HardHat button + popup, from last round's plan) is
implemented end-to-end and verified by typecheck + curl, but **not yet browser-checked and not yet
committed**.

1. **Schema**: `dashboard_role_permissions` table (`dashboardId`, `role`, `action`, `enabled`,
   composite PK) — migration `0014_milky_mojo.sql`, generated via `pnpm db:generate` and applied to
   local Postgres via `pnpm db:migrate`.
2. **Shared**: `DashboardPermissionAction` type + `DASHBOARD_PERMISSION_ACTIONS` array added to
   `backend/shared/src/index.ts` (the 6 actions: createAgent, updateAgent, freezeAgent,
   unfreezeAgent, deleteAgent, addDashboardMember).
3. **Backend**:
   - New `backend/api/src/lib/dashboard-permissions.ts` — `canPerformDashboardAction()` (same-org
     caller = host or org-mate = always bypasses; cross-org caller = looks up their
     `dashboard_members` role, then that role's toggle for the action, default false) and
     `fetchRolePermissions()` (full 6-action set for one dashboard+role, host-only callers).
   - Host-only `GET`/`PATCH /v1/dashboards/:id/permissions/:role` in `dashboards.ts` — accepts any
     of the 5 roles even though the dropdown only offers Observer this round, per last round's plan.
   - **New, not in last round's plan**: `GET /v1/dashboards/:id/my-permissions` — NOT host-gated,
     answers "what can *I* do" for the calling user. Added because the host-only GET above can't
     answer that for a restricted Observer, and frontend action-hiding (item 6 below) needs it. See
     "Flag for Eshaan" below.
   - Enforcement wired into all 6 actions: POST `/v1/agents`, PATCH `/v1/agents/:id`, PATCH
     `/v1/agents/:id/policy` (reuses the `updateAgent` gate — same budget-editing capability via a
     second route), POST `/v1/agents/:id/freeze`, POST `/v1/agents/:id/unfreeze`, DELETE
     `/v1/agents/:id` (all in `agents.ts`), and POST `/v1/dashboards/:id/members` (`addDashboardMember`,
     in `dashboards.ts`). Every check runs before the route's own body parsing/validation, same
     "unauthorized caller learns nothing about their payload" ordering the existing role-PATCH route
     uses.
4. **Frontend**:
   - `components/ui/switch.tsx` — thin Base UI Switch wrapper (Root + Thumb, `data-checked` styling),
     following `checkbox.tsx`'s pattern.
   - `components/share-permissions-dialog.tsx` — role dropdown (Observer-only option list) + 6
     toggles, optimistic-update-with-revert-on-error, same generation-counter race-guard pattern as
     `share-dashboard-dialog.tsx`.
   - HardHat button wired into `agent-dashboard.tsx`'s `CardAction`, left of the existing share
     button, both now inside a shared `flex items-center gap-2` wrapper div.
   - `lib/api.ts`: `getDashboardRolePermissions`, `setDashboardRolePermissions`,
     `getMyDashboardPermissions`.
   - `app/agents/page.tsx` fetches `myPermissions` once per dashboard selection (NOT polled every
     3s like the agent list — permissions changing live under an open tab is a rare edge not worth
     the extra traffic) and threads it down as a new optional `myPermissions` prop.
   - Action-hiding (item 6, "frontend hides/disables restricted actions"): Create-agent button, each
     row's Edit pencil, batch Freeze/Unfreeze/Delete (`selection-toolbar.tsx`), the inline
     stop/resume in budget-alert popups (`agent-attention-alerts.tsx`), and the "Add someone by
     email" form in `share-dashboard-dialog.tsx` all hide/disable per `myPermissions`. **Fails open**
     (shows the control) when `myPermissions` is `undefined` — marketing demo, or not loaded yet —
     since the api route is the actual enforcement boundary; this is a UI nicety only.
5. **Verified**: `pnpm typecheck` clean on both `backend/api` and `frontend/dashboard`. Full curl
   matrix run against local Postgres/Redis and passed:
   - Host GET/PATCH permissions succeed; non-host GET/PATCH both 403 (`dashboard_host_required`);
     a total stranger (no access at all) gets 404 on both `permissions/:role` and `my-permissions`,
     not 403 — no information leak about dashboards they can't reach.
   - Invalid role param → 400.
   - A cross-org Observer guest: all 6 actions 403 while their toggle is off
     (`dashboard_permission_denied`); flipped on one at a time by the host, each then succeeds —
     including `addDashboardMember`, which correctly reached its inner
     `dashboard_member_user_not_found` 404 for a fake email, proving the permission gate ran and
     passed before that lookup.
   - Host bypass confirmed: host creates/freezes/deletes agents on their own dashboard regardless of
     any Observer toggle state (same-org check, not identity check).
   - Test dashboard/accounts created for the matrix were cleaned up via the app's own soft-delete
     route — no manual DB cleanup needed.

## Not done yet

- **No browser check.** Nothing above has been looked at in an actual browser — the HardHat button,
  the toggle dialog's look/feel, and the hide/disable behavior for a restricted Observer are only
  verified via curl + typecheck. Browser-automation tooling was never attempted this session (prior
  sessions on this branch found none available, but that wasn't re-tested here — check fresh next
  session rather than assuming either way).
- **Security review pass was started, then stopped before it produced anything.** A `/code-review
  xhigh` background workflow (multi-agent finder + independent-verifier pass) was launched per
  CLAUDE.md's "real review pass" requirement for auth-sensitive code — this round touches
  authorization on every agent mutation route — then Eshaan asked to stop it mid-run, before any
  findings came back. **This is the most important next step.**
- **Not committed.** 12 modified files + 5 new files, all uncommitted on `Eshaan-feature-permissions`.
  HEAD is still `de95544` "Added account removal feature for shared dashboards" as of this writing —
  confirm again with `git log`/`git status` before assuming, per this repo's own working rule (Eshaan
  commits this branch himself, unannounced, mid-session).

## New files this round

- `backend/api/drizzle/0014_milky_mojo.sql` + `backend/api/drizzle/meta/0014_snapshot.json`
- `backend/api/src/lib/dashboard-permissions.ts`
- `frontend/dashboard/components/share-permissions-dialog.tsx`
- `frontend/dashboard/components/ui/switch.tsx`

## Flag for Eshaan

`GET /v1/dashboards/:id/my-permissions` wasn't in last round's plan — it exists because the spec's
`GET .../permissions/:role` is host-only as specified, which leaves a restricted Observer no way to
learn their own permission set (needed for frontend hiding). This new route only ever answers "what
can *I*, the caller, do" — it never reveals another role's configuration, so it doesn't undermine the
host-only intent of the other route. Worth a quick look before merging since it's the one piece of API
surface added beyond the original spec.

## Where to pick up

1. Run the security review — either `/code-review xhigh` again (background) or inline, whichever
   Eshaan prefers this time; the diff is currently: `backend/api/src/routes/agents.ts`,
   `backend/api/src/routes/dashboards.ts`, `backend/api/src/lib/dashboard-permissions.ts`,
   `backend/api/src/db/schema.ts`, `backend/shared/src/index.ts`, plus the frontend files listed
   above.
2. Fix whatever the review finds.
3. Browser-check the feature as host (open the popup, toggle Observer permissions, confirm the UI),
   and ideally as a shared Observer account too (confirm actions actually hide/disable) — ports
   :3000 (dashboard) / :4000 (api) should already be running via `pnpm dev:api` / `pnpm
   dev:dashboard`; Postgres/Redis need Docker Desktop running on the Windows host.
4. Only after review + browser check: ask Eshaan whether to commit.
