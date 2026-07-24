# PLANS.md

**Purpose:** Tracks the next task to work on for this branch. A fresh Claude session (after a context clear) should treat the "Next task" section below as its starting instruction, after reading `docs/COMPLETION.md` for history.

---

## Status as of 2026-07-23

Current branch is `Eshaan-2` (cut from `main` after Feature 7 merged; tracks `origin/Eshaan-2`). `Eshaan-next` was merged into `main` (fast-forward) and is retired. Merges into `main` are done manually by the user — never push a feature branch to `main` on their behalf.

Shipped: the opt-in "Select agents" mode + animations, the heading/nav rename and poll re-render fix (Features 4–6) and the **Edit agent** feature (Feature 7) are **committed and merged into `main`** (commit `69859c7`). The **"industrial glass" colour/type overhaul** + refinements (Feature 8) is **uncommitted**, on `Eshaan-2`. See `docs/COMPLETION.md` for the full detail.

**The agent filter feature is cancelled** — documented 2026-07-15, never started, dropped by the user. Do not implement it.

## Next task

**Move the "Clear" button next to the selection count.** In the batch-selection toolbar,
"Clear" currently sits in the right-hand action group with Stop/Resume/Delete, pushed far
from the "X agents selected" label by `justify-between`. Put it **immediately to the right
of the count label** instead; leave Stop/Resume/Delete on the right.

- **Only file:** `frontend/dashboard/components/selection-toolbar.tsx`. Its root is a
  `flex items-center justify-between` div with two children today: the count `<span>` (left)
  and a `<div class="flex items-center gap-2">` action group (right) holding **Clear** +
  the Stop/Resume/Delete dialogs (`selection-toolbar.tsx:34–64`).
- **The change (pure layout):** wrap the count `<span>` and the Clear `<Button>` together in
  a left `<div class="flex items-center gap-2">`; keep Stop/Resume/Delete in the right group.
  `justify-between` then splits as
  `[N agents selected] [Clear] …… [Stop][Resume][Delete]`. Clear stays
  `variant="ghost" size="sm"`; no props/logic change — `onClearSelection` is already wired.
- **Verify:** enter selection mode (amber "Select agents"), tick ≥1 row; confirm Clear renders
  immediately right of the count and still clears; the count is live, so re-check at 2 and 3
  selected. `pnpm --filter @tollgate/dashboard typecheck` clean. Inspect per the browser
  caveat below (hidden tab — ask the user to look; a `computed`/`read_page` check is enough
  here since there's no animation).

### Setup reminders (don't relearn these)
- Dev stack may already be up (`docker ps`, ports 3000/4000/8080). If not, start it **detached**
  per the `running-the-dev-server` memory. **Never `next build` while `next dev` runs** — shared
  `.next`, corrupts the dev server.
- Feature 8 (the colour/type overhaul) is **uncommitted** on `Eshaan-2` — `globals.css`,
  `layout.tsx`, `page.tsx`, plus `docs/`. Feature 7 is already in `main`. Don't push to `main`.

---

## Open: finish the "Create agent" dialog perf work

**Step 1 is done — the lag is NOT dev-mode-only, so the stop-condition did not fire.**
Full numbers and method in `docs/COMPLETION.md` (2026-07-24). Headline: in a *production*
build the dialog costs a 58–112 ms long task, the sidebar costs 21 ms with none, and a bare
`Select` popup with no dialog costs 63 ms / 76 ms long task. **The cost is Base UI's popup
machinery**, not app code and not dev overhead (that same `Select` is only ~1.3× slower in
dev, against a ~16× bundle-size gap).

### What is already known — do not re-derive

- Hypothesis #1 below (dialog subtree mount cost) is the live one. #2, #3, #4 are **not**
  implicated — measured, not assumed.
- The sidebar is already fine (21 ms, zero long tasks). Don't optimize it.
- **The open question:** is the ~60 ms one-time popup init (→ warm it during idle) or
  per-open (→ different fix)? Untestable via automation here: synthetic `.click()` cannot
  close a Base UI popup, so every trial is a cold open. Needs real user input, or a
  reload-between-trials harness.
- **Do not run `next build` while `next dev` is running** — they share
  `frontend/dashboard/.next` and the build corrupts the dev server
  (`500 __webpack_modules__[moduleId] is not a function`, no self-recovery). Measure prod
  first, then restore dev, or use a second working copy.
- A backgrounded tab pauses CSS animations/rAF and cannot be foregrounded programmatically
  on this machine — ask the user to click the tab before trusting any animation measurement.

### Older context (still accurate)

- **The idle-poll re-render is already fixed and is NOT the remaining cause.** `refresh()` in `frontend/dashboard/app/page.tsx` used to call `setAgents(data)` unconditionally every 3s, re-rendering the whole table each tick. It now returns the previous array reference when the payload is unchanged so React bails out. Measured before/after over 10s idle: **1 × 60ms long task → 0 long tasks, 0ms blocking.**
- **Polling less often will not help.** Idle polls now cost ~0. Dropping 3s → 10s only reduces HTTP volume, at the cost of the sidebar's `currentPrompt` live feel (it is a ~2min Redis TTL "what's happening now" view). This was considered and rejected.
- **Dev-mode overhead is large and may be the whole story.** The page loads **~3 MB of JavaScript across ~70 requests** under `next dev` — unminified, unbundled, HMR, dev-only React checks. DOM is tiny (113 nodes), so the app itself is not heavy.

### Step 1 — establish whether this is even a real problem (do this first)

Build and serve production, then compare feel:

```powershell
$env:Path = "$env:LOCALAPPDATA\pnpm-shim;$env:Path"; pnpm --filter @tollgate/dashboard build
$env:Path = "$env:LOCALAPPDATA\pnpm-shim;$env:Path"; pnpm --filter @tollgate/dashboard start
```

If the lag disappears in a production build, **stop** — report that and do not micro-optimize dev mode. Only continue if it persists.

### Step 2 — profile properly

**Methodological trap that wasted real effort last session: a backgrounded Chrome tab pauses CSS transitions and `requestAnimationFrame`.** Measurements taken while `document.visibilityState === "hidden"` are invalid — animated elements stay frozen at their start value and read as "not animating". **Always assert `document.visibilityState === "visible"` before trusting any animation or interaction measurement**, and bring the window to the front first.

Then: React DevTools Profiler on open of each of `CreateAgentDialog` and `AgentPromptSidebar` to see what actually re-renders, plus a Chrome Performance trace to separate scripting from layout/paint.

### Candidate causes worth checking (unverified hypotheses, not conclusions)

1. **Mount cost of the dialog subtree.** `CreateAgentDialog` mounts `Select`, `SelectContent`, `Input`, etc. from Base UI only when opened. First open may also be pulling dev chunks over the network.
2. **`AgentPromptSidebar` re-rendering on every poll while open.** It reads the agent fresh from the polled list by design (see its prop doc comment). With the bail-out fix it should only re-render when data genuinely changes — confirm that holds when `currentPrompt` is actively updating.
3. **Animation contention.** Dialog/sidebar entry animations running while the table re-renders. The new column-width transition (300ms) is a candidate to check for overlap.
4. **`transpilePackages: ["@tollgate/shared"]`** in `next.config.ts` — raw TS transpiled on the fly in dev.

### Constraints

- The user explicitly said **do not aim for perfection** here. Prefer one or two high-value, low-risk changes over a broad refactor.
- Do not regress the live-updating behaviour of the sidebar's `currentPrompt` or the over-budget toast.

### Verification

- `pnpm typecheck` clean across all 4 workspaces; `pnpm -r test` 18/18.
- Re-measure long tasks / blocking time on open of both surfaces, **with a visible tab**, and report before/after numbers rather than impressions.

## Candidate next steps (secondary, not committed)

1. **Model-value mismatch in the create-agent dropdown.** It offers `opus`/`sonnet`/`haiku`, but the Claude adapter prices full model IDs like `claude-3-5-sonnet-20241022` (`backend/proxy/src/adapters/claude.ts:14`), so agents created with those values never match a price entry and meter at 0. Pre-existing; surfaced during the 2026-07-23 rebase.
2. **Orphaned `handleDeleted`** in `frontend/dashboard/app/page.tsx` — dead since the Actions column was removed (it was only passed to the deleted `DeleteAgentButton`). `handleBatchDeleted` is the live one. Typecheck does not flag it. One-line deletion.
3. **Rename the OpenAI adapter's slug from `openai` to `chatgpt`.** Would make the dashboard's assistant vocabulary and the proxy's adapter slugs identical, removing the need for the `assistantAdapterSlugs` bridge (`backend/proxy/src/adapters/registry.ts`). Riskier: touches the live `/openai/*` route path, `openai.ts`'s `slug`, the `.env` var name (`OPENAI_UPSTREAM_KEY` → `CHATGPT_UPSTREAM_KEY`), `openai-route.test.ts`, and `demo/hammer.sh`/`demo/README.md`.
4. **`DELETE /v1/agents/:id`** is still a `501` stub (`backend/api/src/routes/stubs.ts`).

## How to use this file

When the user gives a new task, replace the "Next task" section with a concise, concrete description before starting work, then update `docs/COMPLETION.md` once it ships (same format: problem, what changed, file:line references, verification, date).
