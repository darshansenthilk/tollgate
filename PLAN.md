# PLAN.md

## What shipped this round (condensed recap)

Continuation of the role-permission-delegation feature (HardHat popup) — this round was all fix/polish
work on top of it, no new-feature planning. Three commits, **all committed AND pushed to
`origin/Eshaan-feature-permissions` by Eshaan already** (see this round's git-state warning below —
confirmed via `git rev-list --left-right --count origin/...HEAD` reading `0 0`, with no successful
`git fetch` run this session, so the only way the local `origin/...` ref could show that is Eshaan pushing
himself):

1. **`80653af` "Fixed dashboard sharing error messages"** — `POST /v1/dashboards/:id/members` used to say
   "You cannot add your own account to a dashboard" for BOTH a true self-add AND for adding the dashboard's
   host by someone else, and silently no-op'd (200, no message) when re-adding an existing regular member.
   Restructured into three distinct outcomes: self-add → `400 dashboard_member_is_self` ("You cannot add
   yourself to this dashboard."), target-is-host → `400 dashboard_member_is_host`, target-already-a-member
   → `400 dashboard_member_already_exists` (removed the old `ON CONFLICT DO NOTHING` idempotent-success
   fallback) — both latter cases now say "You cannot add an account that is already in this dashboard."
   Frontend (`lib/api.ts` fallback copy, a stale comment in `share-dashboard-dialog.tsx`) updated to match.

2. **`0a19137` "Added toggle color to UI"** — two unrelated changes bundled in one commit:
   - **Host-only gating for the rename pencil and HardHat permissions button** (`agent-dashboard.tsx`):
     both are hard host-only actions on the api, not among the 6 delegatable toggles, so any shared member
     (any role) was previously seeing both and getting a 403 on click. `GET
     /v1/dashboards/:id/my-permissions` now also returns `isHost: boolean`; threaded through
     `app/agents/page.tsx` (new `isHost` state, fetched in the same call as `myPermissions`, same
     fail-open-while-loading convention) into `AgentDashboard`'s new `isHost` prop, gating both buttons
     and the `CardAction` wrapper condition.
   - **Red/green fill on the permission toggle switches** (`share-permissions-dialog.tsx`): off → red, on →
     green, via inline `style={{ backgroundColor: enabled ? "var(--ok)" : "var(--err)" }}` at the one call
     site — the shared `Switch` primitive (`components/ui/switch.tsx`) itself was left untouched since this
     red/green semantic is specific to "toggle = allow/deny," not a generic switch look, and `Switch` has no
     other consumer in the app right now.

3. **`78e35aa` "Darkened red toggle"** — `--err` darkened ~12% (hue preserved) in `globals.css`, both theme
   variants: light `#d92d20`→`#bf281c`, dark `#ff5c5c`→`#e05151`. Ambiguous which theme Eshaan was viewing
   when he asked, so both got the same proportional shift rather than guessing one.

Also answered a **research-only question this round, no code touched**: confirmed a light/dark toggle
exists (`components/theme-toggle.tsx`, rendered on Settings → Appearance), just not in the main nav.

`pnpm --filter @tollgate/api typecheck` and `pnpm --filter @tollgate/dashboard typecheck` both clean after
every change above.

## Current repo state — VERIFY BEFORE TRUSTING (Eshaan pushes mid-session unannounced, every commit, not
just finished features — confirmed again this round on 3 small unrelated fixes)

- Branch `Eshaan-feature-permissions`, HEAD `78e35aa`, **in sync with `origin/Eshaan-feature-permissions`**
  (already pushed). Working tree clean.
- `main` (local and origin) is still at `a6de787` — **this branch has NOT been merged into `main` yet**, so
  `main` still lacks everything above AND still has the two bugs from the prior round live (dashboard
  rename/delete missing a host check; the `/agents` 500 from the migration-numbering collision) — both were
  fixed on this branch in `638e6e6`, which is also not yet in `main`.
- Dev servers: api (`tsx watch`, :4000) and dashboard (`next dev`, :3000) both up, Postgres/Redis reachable.

## Not done yet

- **Nothing from this round has been browser- or curl-verified** — everything above (the 3-way add-member
  error split, the host-only icon gating, the toggle colors, the red darkening) has only been typechecked,
  never actually exercised live. This is the natural next step.
- **The HardHat popup's own toggle UI itself has still never been browser-checked** (carried over from
  before this round too) — only the rename/delete security fix specifically was, by Eshaan, live.
- This branch is unmerged into `main` — `main` is currently behind on both features and bugfixes.

## Where to pick up

1. If Eshaan wants a browser pass: check the add-member 3-way split (self-add, host-add, repeat-add of a
   real member all show their own correct message), confirm the pencil/HardHat icons are hidden for a
   non-host shared member and shown for the host, and eyeball the toggle red/green + darkened shade in both
   themes.
2. If Eshaan raises something else instead, treat that as the real next task — don't assume browser
   verification is next just because it's the logical follow-up.
3. Merging this branch into `main` hasn't been discussed this round — don't assume it's wanted; ask first
   if it comes up.
