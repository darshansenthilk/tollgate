# PLAN.md — Verify dashboard member removal in-browser

Branch: `Eshaan-feature-permissions`.

## Shipped: remove a member from a dashboard, host-only (uncommitted — HEAD still `c6bdde0`)

- Backend: `DELETE /v1/dashboards/:id/members/:userId` in `backend/api/src/routes/dashboards.ts`,
  mirroring the existing PATCH role route's auth flow: `resolveDashboardId` (scope/404) →
  `createdBy === caller` (403 `dashboard_host_required`) → hard `db.delete(dashboardMembers)` → 404
  `dashboard_member_not_found` if nothing matched. `dashboard_members` has no FK from any other table, so
  the hard delete is safe and re-adding (existing POST, unchanged) inserts a genuinely fresh row.
- Frontend: `removeDashboardMember` added to `lib/api.ts` (returns a named
  `RemoveDashboardMemberResponse`, matching sibling response-type conventions) and threaded as an optional
  prop through `agent-dashboard.tsx` → `app/agents/page.tsx`, same pattern as `updateDashboardMemberRole`.
  `share-dashboard-dialog.tsx`: host-only muted "x" per member row (hover → `var(--err)`) → confirm dialog
  ("Are you sure you want to delete this user from the dashboard?") → on confirm, calls the endpoint and
  drops the row from local `members` state (no refetch).
- Verified: typecheck (api + dashboard, clean); a full curl matrix (host success; non-host member → 403;
  outsider → 404 `dashboard_not_found`; nonexistent member id → 404; repeat-delete → 404); and the
  add→promote-to-admin→remove→re-add sequence confirming role resets to `observer`.
- A `/code-review`-style multi-agent pass (3 independent lenses: auth-gate correctness,
  codebase-consistency, frontend/React correctness — each finding adversarially re-verified by a separate
  agent) caught and fixed 4 issues before commit-readiness:
  1. The confirm dialog was originally a React **sibling** of the share dialog rather than nested inside
     it — Base UI's dialog stacking (topmost-dialog / Escape-key handling) is tracked via parent React
     context, which siblings don't share, so Escape would have closed both dialogs at once. Fixed by
     nesting the confirm `<Dialog>` as a child of the outer `<Dialog>`.
  2. Stale `removeError` could bleed onto a *different* member's confirm dialog after a prior failure —
     now cleared wherever the confirm dialog opens or closes.
  3. The confirm dialog's built-in Escape/outside-click/corner-✕ weren't gated on the in-flight request the
     way the Cancel/Remove footer buttons already were — could abandon a request mid-flight. Fixed by
     guarding `onOpenChange` on `pendingRemoveUserId`.
  4. `removeDashboardMember` returned bare `Promise<void>` instead of a named response interface like its
     siblings (`DeleteDashboardResponse`, `UpdateDashboardMemberRoleResponse`) — cosmetic, fixed.
- The auth-gate review lens found **nothing** — independent confirmation the host-only gate itself is sound.
- **Still not done: a real visual check in a browser.** No browser-automation tool was available all
  session, so the hover color, the confirm-dialog copy/layout, and the actual click→remove→row-disappears
  flow have only been exercised via typecheck + curl, never actually looked at. That's this plan's one job.

## Guidelines for building on this

- **Host-only auth pattern**: `dashboardRow.createdBy === req.authUser!.id`, checked after
  `resolveDashboardId` and before any body/param validation — see the PATCH and DELETE members routes in
  `dashboards.ts` for the canonical shape.
- **No automated test harness** exists for `dashboards.ts`. Verify new endpoints with a curl matrix against
  the running dev api (`localhost:4000`). Sign up throwaway users via `POST /api/auth/sign-up/email`
  (`{email, password, name}`, auto-provisions org + session cookie).
- **Base UI dialog stacking**: any dialog-inside-a-dialog (confirm-on-top-of-a-panel) MUST be a React
  *descendant* of the outer `Dialog`, not a JSX sibling, or Escape-key/topmost tracking breaks silently —
  see `dialog/root/useRenderDialogRoot.mjs`'s `nested = Boolean(parentDialogRootContext)` for why.
- **New authorization logic gets a real review pass** before calling a slice done — a multi-agent adversarial
  review caught 3 real (non-auth) bugs this round even though the auth gate itself came back clean.

## Next: verify the member-removal UI actually works, in a browser

### Environment as of this writing

- Postgres (5432) / Redis (6379): reachable (Docker Desktop WSL2 integration is up).
- Dev servers **running now**, started at the end of the last session:
  - api: `tsx watch`, port 4000 (log: check `ps aux | grep tsx` for the pid; started via `pnpm dev:api`)
  - dashboard: `next dev`, port 3000 (started via `pnpm dev:dashboard`)
  - proxy: NOT running (not needed for this check) — start with `pnpm dev:proxy` only if something else
    needs it.
- If either has died since, restart with `pnpm dev:api` / `pnpm dev:dashboard` (NOT `pnpm dev`, which would
  also start the proxy unnecessarily). Confirm with `ps aux | grep -E "tsx watch|next dev"` before assuming.
- **Never run `next build`/`pnpm build` in `frontend/dashboard` while `next dev` is running** — corrupts the
  live `.next` cache and breaks CSS.

### What to actually do

1. Check whether a browser-automation tool is available this session (re-check every session — it has been
   unavailable every time so far on this branch, but confirm rather than assume).
2. If available: sign in (or sign up a throwaway account) at `http://localhost:3000`, create a dashboard,
   share it with a second throwaway account by email, open the share dialog, and drive the actual flow:
   hover the "x" (confirm it reads muted → red), click it, confirm the dialog copy/buttons look right,
   confirm, and confirm the row disappears without a full refetch flash. Also sanity-check the existing
   role-dropdown UI still looks right next to the new "x" (row layout didn't break).
3. If no browser tool is available: say so plainly (per CLAUDE.md — don't claim UI verification that didn't
   happen) and fall back to describing what curl/typecheck already covered, then ask Eshaan whether he wants
   to eyeball it himself at `localhost:3000` or proceed anyway.
4. This is a verification-only task — no code is expected to change unless the visual check turns up a real
   bug. If it does, fix it, then re-run the curl matrix + typecheck (see prior session's commands, both
   packages) before calling it done again.
5. Nothing has been committed yet on this branch — Eshaan commits it himself on his own timeline; don't
   commit or push without being asked.
