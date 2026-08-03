# NEXT_PROMPT.md

**Purpose:** A ready-to-paste prompt for starting a fresh Claude session on this branch after a context clear, so it resumes from `docs/PLANS.md` instead of re-deriving history from scratch. This file always holds only the *current* prompt — each time a new one is prepared, the block below is overwritten, not appended to.

---

## Prompt to paste after `/clear`

```
Before doing anything else, read docs/COMPLETION.md (what's already been built on this
branch, with file:line references — the 2026-08-03 and 2026-08-02 entries are the current
ones) and docs/PLANS.md (current status + next task). Don't re-derive the history from git
or by reading the whole codebase.

Context: branch Eshaan-feature-permissions. The feature CODE is committed, but the planning docs
(docs/PLANS.md, docs/COMPLETION.md, docs/NEXT_PROMPT.md) have uncommitted edits and are the only
copy of the current handoff — and root PLAN.md and root NEXT_PROMPT.md were deleted, also
uncommitted. Do NOT run git checkout . / stash / reset --hard: it would restore two retired files
and destroy the notes you're reading. The other ~84 files git status shows are CRLF churn;
git diff -w --stat isolates the real ones.

Planning docs, in the order that matters: docs/PLANS.md is the live planner (status + "Next
task"), docs/COMPLETION.md is the history of what actually shipped, docs/NEXT_PROMPT.md is this
prompt. Root PLAN.md no longer exists — it was retired on 2026-08-03 because it had become a
second, confusable completion doc; everything in it was migrated into docs/COMPLETION.md (the
Dashboard Expansion "Design decisions" subsection and a recovered 2026-07-26 navbar entry) or
into docs/PLANS.md (the still-open threads). If you see a source comment citing "PLAN.md §5/§6",
that material lives in docs/AUTH-IMPLEMENTATION.md now.

The active feature is
Dashboard Expansion — multiple dashboards per account, Google-Docs style, eventually
shareable with other users at per-dashboard permission levels. Two slices are shipped and
committed:
  - d8779e4 — the dashboards/active_dashboards tables + migration 0007, four API routes,
    the create tile + dialog, the dashboard-selector tiles, and the /agents empty-state
    gate.
  - 9f44926 — the Dashboard Panel's card title now shows the active dashboard's name, plus
    a pen button + dialog to rename it (PATCH /v1/dashboards/:id, same 50-char cap).

The single most important thing to know: this built the SELECTOR, not the FILTER. Every
dashboard still shows the same org-wide agent list — switching tiles changes which
dashboard is active but filters nothing. Scoping agents to a dashboard is unbuilt, as are
dashboard_members, permission tiers, and any share/invite UI.

PLANS.md's "Next task" says you are AWAITING MY INSTRUCTIONS on the Dashboard Expansion
main feature. So:
- Summarize back to me what PLANS.md says the current status and next task are, so I know
  you're caught up.
- Do NOT research, design, plan, or write any code for the next slice. Do not self-assign
  anything from the candidate list in PLANS.md either.
- Then wait for my instructions.

Working rules that matter here (all in PLANS.md/memory):
- node/pnpm/docker and git network operations only run via powershell.exe from this WSL
  shell, never plain WSL bash.
- For anything I open in a browser, give me http://localhost:3000 — NOT the WSL gateway
  IP. The api's CORS/trusted-origin is pinned to localhost, and a gateway-IP origin gets a
  silent 403 that surfaces as "Something went wrong" with no useful client-side error. The
  gateway IP is only for your own curl checks.
- No browser-automation tool is installed. Don't install one, or anything else, without
  asking me first.
- components/agent-dashboard.tsx is shared with the marketing landing page's live demo, so
  check / (server-rendered, curl-able) before and after touching it.
- pnpm -r typecheck aborts on a pre-existing @tollgate/shared failure that is unrelated to
  this work; typecheck @tollgate/api and @tollgate/dashboard directly with pnpm --filter.
- I commit and merge myself, mid-session. Re-check git log before claiming anything about
  commit state, and never commit or push on my behalf unless I ask.

Still unverified and worth me eyeballing at some point: every visual/interaction detail of
both slices (tile proportions, hover/focus, the active ring, the {n}/50 counters, the pen
button's shake animation, create -> /agents click-through). These render client-side after
a fetch, so curl only ever sees "Loading...". The highest-value single check is a long
unbroken dashboard name (e.g. Platform_Engineering_Team_Q3_2026_Rollout) at phone width —
that's a CSS min-content clipping fix that was reasoned about, not observed.

Once a feature is actually done and verified, update docs/COMPLETION.md (same format:
problem, what changed, file:line references, how it was verified, date) and reset
docs/PLANS.md's "Next task" section.
```

## Notes
- This file holds only the current resume prompt. Every time you (Claude) prep for a new context clear, overwrite the prompt block above entirely — do not keep or stack prompts from earlier clears.
- The wrapper instructions (read COMPLETION.md + PLANS.md first, don't re-derive context) stay consistent across versions; only the task-specific detail in the middle changes to match whatever PLANS.md currently says.
