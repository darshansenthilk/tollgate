# PLANS.md

**Purpose:** Tracks the next task to work on for this branch. A fresh Claude session (after a context clear) should treat the "Next task" section below as its starting instruction, after reading `docs/COMPLETION.md` for history.

---

## Status as of 2026-07-23

Previous feature (Assistant category rename + real Claude adapter + assistant-enforcement gate — see `docs/COMPLETION.md`) is closed and shipped.

**The agent filter feature is cancelled.** It was documented as the next task on 2026-07-15 but never started, and the user has since dropped it. Do not implement it; do not treat the open questions that used to live here as pending work.

The task below has been planned in full and approved by the user. It is ready to implement.

## Next task

**Replace the per-row Actions column with an opt-in "Select agents" mode** in the dashboard.

### Why

There are two overlapping ways to stop or delete an agent today:

- A per-row **Actions** column (`frontend/dashboard/app/page.tsx:353` header, `:441-455` cells) holding `StopAgentButton` + `DeleteAgentButton`.
- Always-visible **checkboxes** (`page.tsx:340-347` select-all, `:376-382` per row) that reveal `SelectionToolbar`, which does the same two operations in batch.

The Actions column is redundant — ticking one agent's checkbox does everything it does. It also costs a permanent table column, and the checkboxes clutter the table even when you never intend to select anything.

**Target state:** no checkboxes and no Actions column by default. An amber **"Select agents"** button directly under "Create agent" enables selection mode, the checkboxes reappear with today's exact mechanics, and all stop / resume / delete work happens through the selection toolbar.

### The blocker — read before touching the Actions column

Deleting the Actions column naively **destroys the only way to resume a stopped agent**:

| | Single (Actions column) | Batch (toolbar) |
| --- | --- | --- |
| Delete | `DeleteAgentButton` → `deleteAgent(id)` | `BatchDeleteDialog` — **full parity** |
| Stop | `StopAgentButton` → `freezeAgent(id,"soft",token)` | `BatchStopDialog` — parity |
| **Resume** | `StopAgentButton` flips to "Resume" → `unfreezeAgent(id,token)` (`stop-agent-button.tsx:45-46,68-70`) | **missing** — `batch-stop-dialog.tsx:67` hardcodes `freezeAgent` |

Unfixed, any `soft_frozen`/`hard_frozen` agent — including ones auto-frozen for exceeding budget — becomes permanently unreactivatable from the UI. Step 4 below closes this.

### Decisions already made with the user — do not re-ask

- **Resume** — a separate **Resume** button beside Stop in the selection toolbar, shown only when at least one selected agent is stopped. Per-agent tokens still required; there is no master credential.
- **Toggle** — "Select agents" toggles selection mode, and mode also **auto-exits** once a batch stop or delete fully succeeds. Exiting always clears the selection.
- **Color** — reuse the existing `--amber: #f5b83d` token (`app/globals.css:14`). It is defined only in `:root` and never overridden in `.dark` (that block starts at line 96), so one value covers both themes. Pair with dark text — `#f5b83d` is too light for white.

### Steps

1. **`frontend/dashboard/lib/agent-status.ts`** (new). `FROZEN_STATUSES` is duplicated in `page.tsx:48-51` and `stop-agent-button.tsx:20-23`, and the toolbar now needs it too. Extract `STOPPED_STATUSES` + `isStopped(status)` once and point `page.tsx` at it.

2. **`components/ui/button.tsx`** — add an `amber` variant to `buttonVariants` (`:10-21`), following the existing `destructive` entry's shape:
   ```
   amber: "bg-[var(--amber)] text-[#1a1205] hover:bg-[color-mix(in_oklch,var(--amber),black_12%)] focus-visible:border-[var(--amber)] focus-visible:ring-[var(--amber)]/30",
   ```

3. **`components/batch-delete-dialog.tsx`** — add `onCompleted?: () => void`, invoked in the no-failures branch alongside `setOpen(false)` (`:67-69`). Deliberately *not* called on partial failure, so failed rows stay selected for retry.

4. **`components/batch-stop-dialog.tsx`** — parameterize stop vs resume. The two flows are structurally identical (collect a token per agent, loop, per-row success/error, carry successes forward on retry), so **do not clone the file**. Add:
   - `mode: "stop" | "resume"` driving the API call (`freezeAgent(id,"soft",token)` vs `unfreezeAgent(id,token)` — `lib/api.ts:128,141`), the trigger label/variant, the dialog title/description, and the per-row success text ("Stopped" / "Resumed").
   - `onCompleted?: () => void`, called where `allSucceeded` already triggers `setOpen(false)` (`:81-82`).

   Leave the existing retry and partial-failure semantics untouched.

5. **`components/selection-toolbar.tsx`** — widen `selectedAgents` to `{ id, name, status }[]` (`AgentListItem` already carries `status`). Partition it, excluding `archived` from both — matching `stop-agent-button.tsx:43`'s guard:
   - `stoppable` = not stopped, not archived → `<BatchStopDialog mode="stop" agents={stoppable} />`
   - `resumable` = `isStopped(status)` → `<BatchStopDialog mode="resume" agents={resumable} />`

   Render each button only when its subset is non-empty, so a dialog never prompts for a token it has no use for. Layout: `Clear · Stop · Resume · Delete`. Thread `onCompleted` to both.

6. **`app/page.tsx`** — the visible change:
   - Add `selectionMode` state and an `exitSelectionMode()` that clears `selectedIds` and unsets the flag (reuse `clearSelection`, `:225`).
   - Header (`:253-264`): wrap `CreateAgentDialog` and the new button in `flex flex-col items-end gap-2` so the button sits directly under "Create agent". Label toggles "Select agents" ↔ "Done"; `variant="amber"` when inactive.
   - Gate the checkbox `TableHead` (`:340-347`) and per-row `TableCell` (`:376-382`) behind `selectionMode`. Mechanics — `toggleSelected`, `toggleSelectAll`, `allSelected`/`someSelected` indeterminate state — stay exactly as-is.
   - Delete the Actions `TableHead` (`:353`), its `TableCell` (`:441-455`), and the now-unused imports (`:34-35`).
   - Render the toolbar on `selectionMode && selectedAgents.length > 0`; pass `onCompleted={exitSelectionMode}`.
   - Keep `refresh()`'s pruning of stale `selectedIds` (`:136-147`) untouched.

7. **Delete `components/stop-agent-button.tsx` and `components/delete-agent-button.tsx`.** `page.tsx:34-35` are their only importers; both are dead once the batch path covers resume.

### Verification

1. `corepack pnpm typecheck` — clean across all 4 workspaces. This is what catches the widened `selectedAgents` prop and the new `mode` prop.
2. `corepack pnpm -r test` — 18 proxy tests still passing.
3. Bring the stack up: `corepack pnpm infra:up`, then `$env:Path = "$env:LOCALAPPDATA\pnpm-shim;$env:Path"; pnpm dev`. The shim is required — the root `dev` script re-invokes bare `pnpm`, which is not on PATH.
4. At `localhost:3000` (seed with `demo/seed.sh` if the table is empty):
   - Default view has **no checkboxes and no Actions column**; amber "Select agents" sits under "Create agent".
   - Click it → checkboxes appear; select-all and indeterminate still work.
   - Select a running agent → **Stop** shows, **Resume** does not. Stop it with its token.
   - Select the now-stopped agent → **Resume** shows, **Stop** does not. Resume it. **This is the regression this design exists to prevent — verify it explicitly.**
   - Select a mix of running and stopped → both buttons show, each prompting only for its own subset.
   - Delete a selection → rows vanish **and** selection mode exits on its own.
   - Toggle "Done" manually → checkboxes disappear, selection cleared.

## Candidate next steps (secondary, not committed, still open from the prior session)

1. **Rename the OpenAI adapter's slug from `openai` to `chatgpt`.** The dashboard's assistant labels/values are `chatgpt`/`claude`, but the proxy's real adapter slugs are `openai`/`claude` — bridged only by the `assistantAdapterSlugs` map (`backend/proxy/src/adapters/registry.ts`). Renaming would make the two vocabularies identical. Bigger/riskier change: touches the live `/openai/*` route path, `backend/proxy/src/adapters/openai.ts`'s `slug` field, the `.env`/`.env.example` var name (`OPENAI_UPSTREAM_KEY` → `CHATGPT_UPSTREAM_KEY`), the `openai-route.test.ts` suite, and `demo/hammer.sh`/`demo/README.md`'s hardcoded `/openai/...` calls.
2. **`DELETE /v1/agents/:id`** is still a `501` stub (`backend/api/src/routes/stubs.ts`) — noted while working in this area, not something introduced by recent work.
3. **Model-value mismatch in the create-agent dropdown.** It offers `opus`/`sonnet`/`haiku`, but the Claude adapter prices full model IDs like `claude-3-5-sonnet-20241022` (`backend/proxy/src/adapters/claude.ts:14`), so agents created with those values never match a price entry and meter at 0. Pre-existing, surfaced during the 2026-07-23 rebase.

## How to use this file

When the user gives a new task, replace the "Next task" section with a concise, concrete description before starting work, then update `docs/COMPLETION.md` once it ships (same format: problem, what changed, file:line references, verification, date).
