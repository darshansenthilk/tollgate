# PLAN.md

## What shipped, what's outstanding (as of this writing)

The role-permission-delegation feature (HardHat button, per-role action toggles) is **built and
already live on `main`** (pushed to origin as `a6de787`, before any review ran — Eshaan merged/pushed
it himself mid-epic). This session's work was a follow-up round on top of that, not a new feature:

1. **Security review (inline, since a background `/code-review xhigh` workflow hit the account's
   session usage limit and returned a false "no findings")** found 2 real bugs, both fixed and
   curl-verified against live Postgres/Redis: `DELETE`/`PATCH /v1/dashboards/:id` (delete/rename)
   had no host check — any shared member of any role, even one with all 6 new toggles off, could
   delete or rename a dashboard. Now gated the same way the sibling member-role/member-delete/
   permissions routes already were (`resolveDashboardId` → `createdBy === caller`, `403
   dashboard_host_required` otherwise).
2. **Unrelated bug also found + fixed**: `/agents` was 500ing for every account. Root cause: the
   earlier `main`-merge collided two independently-generated Drizzle migrations both numbered
   `0012` (this branch's `dashboard_members` one vs. `main`'s `tool_approval_requests`/
   `policies.*`/`spend_events.prompt` one) — the journal only kept one chain, silently dropping
   `main`'s migration from ever running against local Postgres even though `schema.ts` and the
   query code already assumed it had. Fixed by restoring the corrupted snapshot file, deleting the
   orphaned SQL, and regenerating cleanly via `pnpm db:generate` → `0015_lazy_warstar.sql` → `pnpm
   db:migrate`. Verified live.
3. **Hit a dev-environment gotcha mid-session**: `pnpm dev:api`'s `tsx watch` did not hot-reload the
   route fix (WSL inotify issue) — the running process was hours stale. Diagnosed via `/health`'s
   `uptimeSec` never resetting across the edit; fixed by killing the whole process tree and
   restarting. **If a backend edit doesn't seem to take effect, check for this before assuming the
   code is wrong.**

**Full narrative + verification detail for all of the above is in `claude-docs/COMPLETION.md`**
(new entry at the top) — this file stays condensed per Eshaan's `<3k` token budget for it.

## Current repo state — VERIFY BEFORE TRUSTING (Eshaan pushes mid-session unannounced)

- Branch `Eshaan-feature-permissions`, HEAD `a6de787` (same as `main` — both point at the merge that
  includes the untested permissions feature).
- Uncommitted in the working tree: `backend/api/src/routes/dashboards.ts` (the host-check fix),
  `backend/api/drizzle/meta/0012_snapshot.json` (restored), `backend/api/drizzle/0012_curved_wolfpack.sql`
  (deleted), `backend/api/drizzle/0015_lazy_warstar.sql` + `meta/0015_snapshot.json` (new, generated).
  **`main` currently has the unpatched dashboard rename/delete bug and the broken `/agents` migration
  state live** until these are committed and pushed.
- `pnpm --filter @tollgate/api typecheck` clean. Dev servers: api (:4000) and dashboard (:3000) both
  up and healthy as of this writing; Postgres/Redis reachable (Docker Desktop running on the Windows
  host).

## Not done yet

- **No browser check of the original permissions feature itself** — the HardHat popup's toggle UI,
  and action-hiding for a restricted Observer, have never been visually confirmed (only curl +
  typecheck). The rename/delete fix specifically WAS confirmed live in-browser by Eshaan.
- **Nothing from this round is committed or pushed.**

## Where to pick up

1. Ask Eshaan whether to commit + push the fixes above (flag clearly: `main` has the bugs live).
2. Browser-check the HardHat popup: toggle each of the 6 actions as host, confirm a restricted
   Observer's corresponding UI actions actually hide/disable (not just 403 on click).
3. If Eshaan raises something else instead, treat that as the real next task.
