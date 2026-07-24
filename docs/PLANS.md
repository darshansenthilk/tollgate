# PLANS.md

**Purpose:** Tracks the next task to work on for this branch. A fresh Claude session (after a context clear) should treat the "Next task" section below as its starting instruction, after reading `docs/COMPLETION.md` for history.

---

## Status as of 2026-07-23

Branch is `Eshaan-next` (tracks `origin/Eshaan-next`; merges into `main` are done manually by the user — never push a feature branch to `main` on their behalf).

Shipped and closed: the opt-in "Select agents" mode, its pop/slide animations, the "Agent Dashboard" heading + nav rename, and a poll re-render fix. See `docs/COMPLETION.md` (Features 4–6) for the full detail.

**The agent filter feature is cancelled** — documented 2026-07-15, never started, dropped by the user. Do not implement it.

## Next task

**Make the "Create agent" dialog and the agent-info sidebar open smoothly.** Both still feel laggy on open; the whole app hitches a frame or two.

### What is already known — do not re-derive

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
