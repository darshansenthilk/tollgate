# PLAN.md

Status: **NO PLAN YET — AWAITING INSTRUCTIONS ON A NEW FEATURE.** Nothing below is a plan to execute.
Do not start drafting an implementation plan, architecture proposal, or file-by-file checklist until
the user directs it.

**Working branch: `Eshaan-test-main`.** Confirm with `git branch --show-current` at the start of a
fresh session rather than trusting any cached assumption — the user commits/merges/pushes via their
own Windows-side git client independently of Claude Code's tool calls, sometimes mid-conversation, so
branch state can move without any `git` command having been run in-session. `main`/`origin/main`
currently also contain this work (the user merged and pushed it there mid-session, then explicitly
chose to leave it rather than unwind an already-pushed merge) — that's expected, not a conflict to
resolve.

> **The previous plan here (landing page navbar consolidation + hero section CTA swap) is fully
> shipped, committed, and merged.** Two navbars on `"/"` (the global dashboard nav and the marketing
> page's own nav) are now one — logo, wordmark styling, button colors/shadow/font, and the signed-in
> state all went through several rounds of user-directed visual correction before landing. Separately,
> the hero section's "Request access" button was removed, "See it live" moved into its slot, and a new
> "Get started" → `/sign-up` button took the primary slot. Full file-by-file detail, every correction
> round, and the branch/commit situation are in `docs/COMPLETION.md`'s **"Session summary — 2026-07-26
> (Landing page navbar + hero CTA)"** entry (top of the file). `tsc --noEmit` was clean throughout;
> structural behavior was verified via `curl` against the running dev server; the signed-in-only visual
> state was checked by the user themselves in a real browser (no browser-automation tool is installed
> in this environment — ask before installing one, per standing instruction).
>
> Before that: TOTP Two-Factor Authentication (Layer 1 + Layer 2, opt-in) — shipped, merged, verified
> for both new and pre-existing accounts. See `docs/COMPLETION.md`'s TOTP entries and
> `docs/AUTH-IMPLEMENTATION.md`. Layer 3 (step-up re-auth) remains an unplanned recommendation
> (`docs/AUTH-PLAN.md` §4).

---

## What's next

Not yet named. The broader "connect the landing page with the rest of the web app" effort mentioned in
prior sessions had its first concrete slice (the navbar merge, above) completed; whether there's more
to that effort, or the user has a different feature in mind, isn't decided — ask, don't assume, if
resumed with no further direction.

## Current routing map (still accurate, general context)

- `/` — public marketing/landing page. No session check — visiting it while authenticated just renders
  the marketing content (with its nav's signed-in "Dashboard Panel" button), doesn't redirect.
- `/agents` — the real dashboard. Gated.
- `/sign-in`, `/sign-up` — auth pages. `middleware.ts` bounces a signed-in visitor away from these to
  `/agents`.
- `/enroll-2fa` — one-time post-sign-up 2FA opt-in prompt (not a gate; skippable).
- `/settings`, `/status` — dashboard-authenticated pages.
- Gating: `middleware.ts` is optimistic (cookie presence only, redirects unauthenticated visitors to
  `/sign-in` for anything not in its public/auth allow-list); `require-auth.ts` on the api is the real
  authority for every `/v1/*` call.

**Recurring gotcha, worth checking any time this area is touched again:** client-side
`router.push("/")` / `router.replace("/")` calls need to target `/agents` when the intent is "the
authenticated app," not bare `/` (which is the public marketing page). This has bitten the app once
already (fixed 2026-07-26, see `docs/COMPLETION.md`).

## Outstanding, not blocking, not forgotten

- No live-browser verification of the 2FA UI has ever happened (opt-in prompt, QR rendering,
  enrollment/challenge screens, backup-codes modal, Settings) — everything's been checked by reading
  the code plus API-level `curl`/DB passes, or (for the nav work above) by the user themselves.
- Nobody has signed in as the real `eshaan.joshi07@gmail.com` account with a live TOTP code since the
  auth merge — its data was confirmed intact via a read-only DB check, but an actual sign-in hasn't been
  run. Needs the user to do it themselves.
- Layer 3 (step-up re-auth on sensitive agent-control actions) is still just a recommendation in
  `docs/AUTH-PLAN.md` §4 — not planned, not scheduled, not implied to be next.
