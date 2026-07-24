# COMPLETION.md

**Purpose:** This file details the features and changes shipped on the current branch so far. It exists as context for Claude (or any future contributor) to pick up this branch's history without needing to re-derive it from scratch — read this before starting new work here.

**Branch note:** work moved `Eshaan` → `Eshaan-next` on 2026-07-23. `Eshaan` was rebased onto `origin/main`, fast-forwarded into it, and retired (`origin/Eshaan` deleted). `Eshaan-next` was cut from the new `origin/main` and tracks `origin/Eshaan-next`.

---

## Session summary — 2026-07-15

### Feature 1: "Assistant" category (renamed from "Provider")

**Problem:** The agent-creation form and agents table used the label "Provider" with options "OpenAI"/"Anthropic" — internal/company-facing naming rather than the consumer-facing product names users actually recognize.

**What changed:** Renamed the category to "Assistant" throughout the dashboard, and its two options to the product names ChatGPT/Claude, including the underlying stored values (not just display labels).

- `frontend/dashboard/components/create-agent-dialog.tsx:26-29` — `PROVIDERS` array values changed from `openai`/`anthropic` to `chatgpt`/`claude`; labels to "ChatGPT"/"Claude".
- `frontend/dashboard/components/create-agent-dialog.tsx:129` — field label changed "Provider" → "Assistant".
- `frontend/dashboard/components/create-agent-dialog.tsx:65-67` — validation error message updated to "Select an assistant".
- `frontend/dashboard/app/page.tsx:148` — agents table column header "Provider" → "Assistant".
- `backend/api/src/routes/agents.ts:27` — `ALLOWED_PROVIDER_SLUGS` allow-list updated to `["claude", "chatgpt"]` so agent creation accepts the new values.
- `demo/seed.sh`, `demo/README.md` — updated to create/describe the demo agent with `providerSlug: "chatgpt"` instead of `"openai"`, so the demo script still passes the new allow-list.
- Existing dev-DB rows normalized in place (`openai`→`chatgpt`, `anthropic`/`Claude`→`claude`) so the running dashboard didn't show stale values.

---

### Feature 2: Real Claude (Anthropic) adapter in the proxy

**Problem:** Before this, "Claude" was selectable as an agent's assistant, but no code actually existed to route a request to Anthropic's API — the proxy's adapter registry (`backend/proxy/src/adapters/registry.ts`) held only `openaiAdapter`. Any agent labeled "Claude" had no real destination at all.

**What changed:** Built a full `ProviderAdapter` implementation for Anthropic's Messages API and registered it, so `/claude/*` is now a genuinely working proxy route.

- `backend/proxy/src/adapters/claude.ts` (new file) — implements auth via `x-api-key` + `anthropic-version` headers (Anthropic's real scheme, distinct from OpenAI's `Bearer` token), URL building against `https://api.anthropic.com`, and cost metering from Anthropic's real usage field names (`input_tokens`/`output_tokens`) against a hardcoded price table for `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, and `claude-3-opus-20240229`.
- `backend/proxy/src/adapters/registry.ts:27` — registry now built as `buildRegistry([openaiAdapter, claudeAdapter])`.
- `.env.example` and `.env` — added `CLAUDE_UPSTREAM_KEY` (the proxy's vault resolves upstream keys by `<SLUG>_UPSTREAM_KEY` convention, per `backend/proxy/src/lib/vault.ts`).
- `backend/proxy/test/claude-route.test.ts` (new file) — 8 tests mirroring the existing OpenAI route suite: forwarding, cost metering, spend accumulation, unrecognized-model-costs-zero, budget/freeze denial, bad-token rejection, and (after Feature 3 below) the provider-mismatch case.

**Verified live:** created a real agent labeled "claude" against the running dev proxy and confirmed the call reached the actual `api.anthropic.com` and got a genuine `authentication_error` back (expected, since only a placeholder key is configured locally) — proof the adapter is wired correctly end-to-end, not just unit-tested.

---

### Feature 3: Assistant enforcement gate (the big one)

**Problem:** An agent's "Assistant" label (Feature 1) was purely cosmetic — stored in Postgres but never read by the proxy's hot path. A token created for "ChatGPT" could be used to call the real Claude route and vice versa, with zero enforcement. The proxy's own agent lookup (`backend/proxy/src/lib/agents.ts`) didn't even `SELECT` the `provider_slug` column, so the data wasn't just unchecked — it wasn't available to the hot path at all.

**What changed:** The proxy now rejects any request where the calling agent's declared assistant doesn't correspond to the adapter the request resolved to.

- `backend/proxy/src/lib/agents.ts:15,35,43,58` — `AuthedAgent` and the Postgres query (`pgAgentStore`) now include `providerSlug`, so the hot path actually has this data.
- `backend/proxy/src/adapters/registry.ts:45-63` — new `assistantAdapterSlugs` map: `{"chatgpt": "openai", "claude": "claude"}`. This is the one place that bridges the dashboard's consumer-facing assistant vocabulary to the proxy's routing-slug vocabulary (they intentionally differ — "chatgpt" the label vs. "openai" the adapter slug).
- `backend/proxy/src/routes/proxy.ts:33-37` (interface), `95-105` (check) — new step 3 in the request pipeline: `if (deps.assistantAdapterSlugs.get(agent.providerSlug) !== adapter.slug)` → `403 {"error": "provider_mismatch", providerSlug, assistantSlug}`. Injected via `ProxyDeps` like the registry/vault/etc., so the route handler itself still hardcodes no provider names — later pipeline steps (freeze, budget, forward, meter, settle) renumbered 4-9.
- `backend/proxy/src/index.ts:6,48-61` — wired `assistantAdapterSlugs` into production.
- `backend/proxy/test/helpers.ts` — test harness extended with an `assistantAdapterSlugs` override (defaults to the production map).
- `backend/proxy/test/openai-route.test.ts`, `backend/proxy/test/claude-route.test.ts`, `backend/proxy/test/provider-agnostic.test.ts` — every existing fake agent now carries a matching `providerSlug`; each suite gained a `provider_mismatch` test case. `provider-agnostic.test.ts` specifically also proves the *new* gate is generic/injectable (via a fictional `acme-assistant` → `acme` mapping), not just the routing dispatch.

**Verified live:** created one ChatGPT-labeled and one Claude-labeled agent against the running dev server and exercised all four combinations — both matched pairs passed the gate and reached their real upstream (getting genuine auth errors back from OpenAI/Anthropic themselves); both mismatched pairs were blocked with `403 provider_mismatch` before any upstream call.

**Net result:** the Assistant field is no longer decorative — it is now the actual authorization boundary determining which upstream an agent's token can reach.

---

### Other session activity (non-feature)
- Started the local dev stack (Docker infra, `proxy`/`api` via `pnpm dev:proxy`/`dev:api`, `dashboard` via `pnpm dev:dashboard`) and fixed a one-time `corepack enable` setup issue (missing shim directory).
- Scope change (recorded in Claude's memory, not code): the branch moved from a strict backend/frontend ownership split to feature-based work — full-repo edits are now in scope, superseding an earlier "backend-only" restriction.

**Full test status as of this writing:** `pnpm --filter @tollgate/proxy test` → 18/18 passing. `pnpm --filter @tollgate/proxy typecheck` and `@tollgate/shared typecheck` → clean.

---

## Session summary — 2026-07-23

### Feature 4: Opt-in "Select agents" mode (replaces the Actions column)

**Shipped in commit `613ae0a`.**

**Problem:** The dashboard offered two overlapping ways to stop or delete an agent — a per-row **Actions** column and always-visible checkboxes feeding a batch `SelectionToolbar`. The Actions column was redundant (ticking one checkbox does the same thing), it cost a permanent table column, and the checkboxes cluttered the table even when you never intended to select anything.

**What changed:** The table now shows no checkboxes and no Actions column by default. An amber **"Select agents"** button under "Create agent" toggles selection mode.

- `frontend/dashboard/app/page.tsx` — added `selectionMode` state + `exitSelectionMode()`; checkbox column gated behind it; Actions `TableHead`/`TableCell` deleted; toolbar renders on `selectionMode && selectedAgents.length > 0`.
- `frontend/dashboard/components/ui/button.tsx` — new `amber` variant reusing the existing `--amber: #f5b83d` token (defined only in `:root`, never overridden in `.dark`, so one value covers both themes).
- `frontend/dashboard/components/batch-stop-dialog.tsx` — parameterized with `mode: "stop" | "resume"` rather than cloned, driving the API call (`freezeAgent` vs `unfreezeAgent`), labels, and copy. Added `onCompleted?: () => void`.
- `frontend/dashboard/components/batch-delete-dialog.tsx` — added the same `onCompleted`, fired only on full success so partial failures stay selected for retry.
- `frontend/dashboard/components/selection-toolbar.tsx` — splits the selection into `stoppable` / `resumable` (excluding `archived`), rendering **Stop** and **Resume** only when their subset is non-empty.
- `frontend/dashboard/lib/agent-status.ts` (new) — `STOPPED_STATUSES` / `isStopped()`, extracted from what had been duplicated in `page.tsx` and `stop-agent-button.tsx`.
- **Deleted** `components/stop-agent-button.tsx` and `components/delete-agent-button.tsx` — `page.tsx` was their only importer.

**The trap this design exists to avoid:** removing the Actions column naively would have destroyed the **only** path to resume a stopped agent. `StopAgentButton` was the sole caller of `unfreezeAgent`; `BatchStopDialog` hardcoded `freezeAgent`. Any `soft_frozen`/`hard_frozen` agent — including ones auto-frozen for exceeding budget — would have become permanently unreactivatable. Hence the toolbar Resume button. Delete needed no equivalent fix; `BatchDeleteDialog` was already at full parity.

**Verified live:** created a disposable agent, froze it via the API, resumed it *through the new UI* (API confirmed `status: active`), then deleted it through the UI — which doubled as the delete auto-exit test. Confirmed Stop-only for active selections, Resume-only for stopped, both for mixed, and that the Resume dialog scoped itself to just the stopped agent ("Resume 1 agent") when 2 were selected.

### Feature 5: Selection-mode animations

**Uncommitted as of this writing.** `frontend/dashboard/app/page.tsx` only.

- **Pop** — checkbox mounts with `animate-in fade-in zoom-in-75 duration-200` (scale 0.75 → 1 + fade, no overshoot).
- **Slide** — the checkbox column's width transitions `0 → 40px` over 300ms `ease-out`, so the other columns glide instead of snapping.
- `motion-reduce:` variants on both.

**Non-obvious constraint, documented in code comments:** the transition must live on a plain `<div>` *inside* the cell, not on the `<th>`/`<td>`. With `table-layout: auto` the browser derives column widths from content and **ignores a width set on the cell** (measured 16px when 40px was requested). The cell carries `w-0 p-0` so it shrink-wraps to that inner div — without `w-0`, auto-layout hands the new column a share of leftover table width and it opened to 76px instead of 40px.

**Verified by measurement:** collapsed 0px / expanded 40px, "Name" column shifts exactly 40px, returns to 0px with no drift.

### Feature 6: Heading, nav label, and poll re-render fix

**Uncommitted as of this writing.**

- `frontend/dashboard/app/page.tsx` — `<h1>` is now "Agent Dashboard" at `text-3xl` (30px, up from `text-2xl`/24px) with a white → `#9CA3AF` gradient via `bg-linear-to-r from-white to-[#9CA3AF] bg-clip-text text-transparent`. It is `inline-block` deliberately: as a block element the `h1` spans the full container, so the text would only ever sample the leftmost near-white slice of the ramp. Note Tailwind v4 renamed `bg-gradient-*` → `bg-linear-*`, and interpolates in oklab by default.
- `frontend/dashboard/app/layout.tsx:36` — nav link "Agents" → "Agent Dashboard" (href unchanged).
- `frontend/dashboard/app/page.tsx`, `refresh()` — **performance fix.** The 3s poll called `setAgents(data)` unconditionally with a fresh array, re-rendering the whole table every tick even when nothing changed; landing mid-animation, that was a visible frame hitch. Now returns the previous reference when the payload is unchanged so React bails out — the same pattern the selection pruning below it already used. **Measured: 1 × 60ms long task per 10s idle → 0 long tasks, 0ms blocking.**

### Other session activity (non-feature)
- `Eshaan` rebased onto `origin/main` (conflicts in `proxy.ts` and `create-agent-dialog.tsx`), fast-forwarded into `origin/main`, then retired in favour of `Eshaan-next`. Applied drizzle migrations `0002`/`0003` to the local dev DB.
- Rebase surfaced a latent bug git had auto-merged cleanly: `MODELS_BY_PROVIDER` was keyed `openai`/`anthropic` while `ProviderSlug` was `chatgpt`/`claude` — a type error and a runtime `undefined`. Rekeyed per `assistantAdapterSlugs`.

**Known open issue (pre-existing, not introduced here):** the create-agent model dropdown offers `opus`/`sonnet`/`haiku`, but the Claude adapter prices full model IDs like `claude-3-5-sonnet-20241022` (`backend/proxy/src/adapters/claude.ts:14`). Agents created with those values never match a price entry and meter at 0.

**Test status:** `pnpm -r test` → 18/18 passing. `pnpm typecheck` → clean across all 4 workspaces.

---

## Session summary — 2026-07-24

### Perf investigation: "Create agent" / sidebar lag — Step 1 result

**Not dev-mode-only. The plan's stop-condition did not trigger.** Production build
(`183 kB` First Load JS, 593 KB decoded JS / 31 requests, vs dev's ~3 MB / ~70) served on
:3100 while dev stayed on :3000:

| Interaction (production build) | Mount | Long task |
|---|---|---|
| "Create agent" dialog, cold trial 1 | 110 ms | 112 ms |
| "Create agent" dialog, cold trial 2 | 58 ms | 59 ms |
| Agent-info sidebar | 21 ms | none |
| Bare "Sort by" `Select` popup (no dialog) | 63 ms | 76 ms |

**Cause is Base UI's popup machinery, not app code and not dev overhead.** The clincher is
the last row — a plain 4-item `Select` with no dialog involved costs a 76 ms long task by
itself. That same `Select` cost 82 ms in dev vs 63 ms in prod (~1.3×), nowhere near the
~16× bundle-size gap; if dev overhead drove this, that ratio would be huge.

So PLANS.md hypothesis #1 (dialog subtree mount cost) is live; #2/#3/#4 are not implicated.
The sidebar at 21 ms / zero long tasks is already fine. **Still open:** whether the ~60 ms
is one-time popup init or per-open — untestable here because synthetic `.click()` cannot
close a Base UI popup, so every trial is a cold open.

**Measurement caveat:** taken with `document.visibilityState === "hidden"` (the tab cannot
be foregrounded programmatically on this machine). Only throttle-immune techniques were
used — synchronous timing around `click()`, `MutationObserver` for the async portal mount,
`PerformanceObserver` longtask. Hidden tabs skip paint, so these are a **lower bound**;
dev-vs-prod is apples-to-apples since both ran in the same tab.

**Environment gotcha found the hard way:** `next build` and `next dev` share
`frontend/dashboard/.next`, so building while the dev server runs corrupts it —
`500 __webpack_modules__[moduleId] is not a function` on every request, no self-recovery.
Fix: kill the dashboard process, delete `.next` (gitignored), relaunch.

### Feature 7: Edit agent

**Problem:** agents were immutable after creation. Fixing a typo or a wrong model meant
delete-and-recreate, which issues a **new token** and abandons the month's accumulated
spend. `PATCH /v1/agents/:id` was a 501 stub; only `maxBudgetCents` was reachable, via
`PATCH /v1/agents/:id/policy`.

**What changed:** a pen button at the right of every row opens a dialog mirroring "Create
agent", pre-filled, editing **Name / Model / Max budget**. The agent keeps its id, token,
and spend.

- `backend/api/src/routes/agents.ts` — new `PATCH /v1/agents/:id` plus `parseUpdateBody`
  (partial update: an absent key means "leave alone", which is why it can't reuse
  `parseCreateBody`, where absent and null both mean null). Name uniqueness reuses create's
  non-archived-scoped query plus `ne(agents.id, id)` so an agent can't collide with itself.
  Budget writes the same `policies` row `PATCH .../policy` targets. `findAgent` extended
  with `status` so archived agents 404.
- **`providerSlug` is rejected with `400 provider_slug_immutable`**, not silently ignored.
  Since Feature 3 it is the proxy's authorization boundary for which upstream an agent's
  token may reach, so editing it would silently repoint a live token at another vendor.
- `backend/api/src/routes/stubs.ts` — removed the `PATCH /v1/agents/:id` stub. **This was
  mandatory, not cleanup:** `registerStubRoutes` runs before `registerAgentRoutes`
  (`index.ts:37-38`) and Fastify throws on duplicate registration, so leaving it would have
  broken api boot. Noted in that file's doc comment.
- `frontend/dashboard/lib/agent-options.ts` (new) — `PROVIDERS` / `MODELS_BY_PROVIDER`
  extracted from `create-agent-dialog.tsx` now that two dialogs need them (same precedent as
  `lib/agent-status.ts`), plus `providerLabel()` / `modelsForProvider()` for safe lookup of
  a slug that arrives from the api as a plain `string`.
- `frontend/dashboard/components/edit-agent-dialog.tsx` (new) — **one dialog for the whole
  table, driven by an id, not one per row.** Given the 58–110 ms Base UI dialog mount
  measured above, a per-row instance would multiply that across every row. Seeds form state
  via React's render-time "adjusting state when a prop changes" pattern keyed on the agent's
  **id, not the object** — `agent` is re-derived from the 3 s poll every render, so keying on
  identity would wipe in-progress edits each tick. The snapshot deliberately survives close
  so the dialog doesn't blank mid close-animation. Sends only changed fields; Save disabled
  until dirty; duplicate-name check excludes the agent's own name.
- `frontend/dashboard/lib/api.ts` — `updateAgent()`, `UpdateAgentInput` (no `providerSlug`),
  `UpdateAgentResponse`, and a `provider_slug_immutable` friendly message.
- `frontend/dashboard/app/page.tsx` — `editingAgentId` state, `editingAgent` derived from
  the live list, `handleUpdated`, a rightmost edit column, and one `<EditAgentDialog>`.
  No `stopPropagation` needed: only the Name cell carries an `onClick`.
- `frontend/dashboard/app/globals.css` — `pen-shake` keyframe + `--animate-pen-shake`,
  nested inside `@theme` per Tailwind v4. Applied as
  `group-hover/button:animate-pen-shake motion-reduce:animate-none`, reusing the
  `group/button` class already in `button.tsx`'s base cva — no wrapper element needed.

**Icon:** lucide's `Pencil` (already a dependency) — the supplied icon minus the half-square.
`size-3.5` at `strokeWidth={1.75}` so it reads lighter than lucide's default 2.

**Verified live:** `PATCH` exercised directly — rename, model change, budget change, budget
→ null, multi-field, all 200. Negatives: duplicate name → 409 with a ready-to-display
message, `providerSlug` → 400 `provider_slug_immutable`, empty body → 400, negative budget →
400, blank name → 400, unknown id → 404, archived agent → 404. Renaming an agent to a
different case of its own name → 200 (self-collision correctly excluded), and a name freed
by archiving is reusable.

**Proxy enforcement proven end-to-end:** a probe agent at budget 100 passed the budget gate
and reached the real OpenAI (genuine `invalid_api_key`); immediately after
`PATCH maxBudgetCents → 0` the same call was denied `403 budget_exceeded` before any
upstream request — confirming edits take effect on the very next call, with no cache to bust
(`pgAgentStore.findByTokenHash` re-reads per request).

**Verified in the UI:** 7 columns with the edit button as the last cell of every row; pen
renders 2 paths at stroke-width 1.75; `pen-shake` keyframe confirmed present in the compiled
stylesheet. Dialog opens pre-filled with the assistant field **disabled**, Save **disabled
until dirty**, and clicking the pen does **not** open the sidebar. An edit through the UI
updated the row and **survived two 3 s poll ticks**, proving it persisted server-side rather
than only updating local state.

**Not verified:** the hover shake animation itself — a backgrounded tab pauses CSS
animations and the tab cannot be foregrounded programmatically here. Needs an eyeball.

**Test status:** `pnpm -r test` → 18/18 (unchanged; the api workspace still has no test
setup, by decision). `pnpm typecheck` → clean across all 4 workspaces.

### Feature 8: "Industrial glass" color + type overhaul

**Problem:** the dashboard used a cool neutral palette (gray/green/amber/red) and Geist
everywhere. The `docs/` style template defines a warm "industrial glass" identity — warm
near-black surfaces, a single coral accent, Space Grotesk / JetBrains Mono type, bracketed
mono labels. Requested: adopt that colorway + fonts only (no layout/component restructure).

**Design decisions (confirmed with the user):** coral **#ff4a3d** is "the orange"; it stays
**brand-only** (danger keeps its own red — the functional green→amber→red budget signal is
untouched); adopt Space Grotesk (headings) + JetBrains Mono (mono labels), keep Geist for
body; title becomes `[ Agent Dashboard ]`.

**What changed — almost entirely a token remap, so it cascades to every surface (Cards,
Dialogs, Selects, Badges, sidebar, and the `/status` page) with no per-component edits:**

- `frontend/dashboard/app/globals.css` —
  - `:root` custom tokens warmed: `--bg #0c0f12→#08080a`, `--ink #e8edf2→#ecebe6`,
    `--line` → `rgba(255,255,255,.09)`, `--panel #14181d→#121011`, `--ok #35d07f→#46c47f`,
    `--amber #f5b83d→#f0b03a`. `--err` kept (danger). New `--brand: #ff4a3d`.
  - `body` — added a fixed low-alpha coral `radial-gradient` ambient glow (switched
    `background`→`background-color` so the image isn't wiped).
  - `@theme inline` — `--font-heading` → Space Grotesk, added `--font-mono` → JetBrains
    Mono and `--color-brand` (enables `text-brand`/`bg-brand`/`to-brand`).
  - `.dark` — neutrals warmed with a whisper of chroma (~0.004 @ hue 60–80); `--primary`,
    `--ring`, `--sidebar-primary` set to coral; `--destructive` kept as danger red.
- `frontend/dashboard/app/layout.tsx` — load `Space_Grotesk` + `JetBrains_Mono` via
  `next/font/google` (variable-weight, no `weight` array), append their `.variable`s to
  `<html>`; nav gains a 10px sharp coral brand square and `hover:text-brand` links.
- `frontend/dashboard/app/page.tsx` — title wrapped as `[ Agent Dashboard ]`: coral mono
  brackets flanking the h1, whose gradient endpoint moved `#9CA3AF`→`--brand` (white→coral)
  and which now carries `font-heading` (Space Grotesk).

**Coral is confined to brand chrome** (nav mark, title, primary CTAs, focus rings) — never
functional status. Caveat noted in the CSS: coral and danger-red `#ff5c5c` are close in hue
but never co-occur in one component; deepen `--err` if it ever reads muddy.

**Verified (computed styles + `document.fonts`, valid in a hidden tab):** page bg
`rgb(8,8,10)`; body ambient glow present; title gradient `white → rgb(255,74,61)` in Space
Grotesk between `[` `]`; mono labels in JetBrains Mono; primary button, nav square, and
dialog submit all `rgb(255,74,61)`; dialog popover warmed (`oklch(0.205 0.004 60)`) with a
Space Grotesk title. `pnpm --filter @tollgate/dashboard typecheck` clean; dashboard serves
200 with no webpack error. **Not verified:** true perceived color/glyph rendering — a
backgrounded tab can't be judged for that and can't be foregrounded here; needs an eyeball.

**Test status:** `pnpm -r test` → 18/18 (no backend touched). `pnpm typecheck` → clean.

**Refinements after the initial overhaul (same `page.tsx`, all verified):**
- Title enlarged ~25%: h1 `text-3xl` → `text-[2.34rem]` (30px → 37.44px, measured 1.248×),
  brackets `text-2xl` → `text-3xl` to keep enclosing it.
- Subtitle copy → "Your group of agents, all managed in one place."
- Left bracket got `-ml-[6px]` so its glyph ink lines up under the subtitle's first
  character. Measured, not eyeballed: the monospace `[` ink sits +5px inset from its box
  while the sans first char sits −1px, a 6px gap → −6px closes it (residual 0px). Technique
  saved to the `browser-verification-gotchas` memory.

### Selection toolbar: always-visible, disabled-not-hidden actions, Clear removed

**Problem:** The batch-selection toolbar only rendered once at least one agent was selected
(`selectionMode && selectedAgents.length > 0`), so it popped in and out; Stop/Resume/Delete
were conditionally rendered per eligibility, so the bar changed shape as the selection
changed; and a "Clear" button duplicated what "Done"/deselecting already does.

**What was requested:** the action bar should show for the whole of selection mode (even with
nothing ticked); when an action doesn't apply, its button should be **greyed and unclickable**
(slight transparency) rather than vanish; and "Clear" should be removed.

**What changed (frontend only):**
- `frontend/dashboard/app/page.tsx:385` — toolbar render gate relaxed from
  `selectionMode && selectedAgents.length > 0` to just `selectionMode`; the now-unused
  `onClearSelection={clearSelection}` prop dropped from the render (`clearSelection` itself is
  still live — `exitSelectionMode` calls it).
- `frontend/dashboard/components/selection-toolbar.tsx` — removed the Clear `<Button>` (and the
  `Button` import and `onClearSelection` prop). Stop/Resume/Delete are now **always rendered**
  and passed `disabled` when their eligible subset is empty: `disabled={stoppable.length === 0}`
  / `resumable.length === 0` / `selectedAgents.length === 0`. Layout back to the simple
  `[N agents selected] …… [Stop][Resume][Delete]` split.
- `frontend/dashboard/components/batch-stop-dialog.tsx`, `batch-delete-dialog.tsx` — each gained
  an optional `disabled?: boolean` prop, threaded onto the `DialogTrigger`'s `<Button>`. The
  base `Button` already carries `disabled:opacity-50 disabled:pointer-events-none`
  (`components/ui/button.tsx:7`), so disabled = the exact "slightly transparent + unclickable"
  the request asked for, no new styling. `handleOpenChange` also guards `if (next && disabled)
  return` so no keyboard/programmatic path can open an empty-subset dialog.

**Design note:** Resume gets the same disabled-not-hidden treatment as Stop/Delete (disabled
when no *stopped* agent is selected) so the bar keeps a stable shape — the user named only Stop
and Delete, but hiding just Resume would reintroduce the shape-shifting the change is meant to
remove.

### Removed the "X agents need attention" banner

**What changed:** the red banner that listed stopped/over-budget agents at the top of the
dashboard was removed at the user's request — both the `needsAttention` computation and its
JSX block in `frontend/dashboard/app/page.tsx`. The `isStopped` / `isOverBudget` helpers stay
(still used by row rendering and `compareAgents`), as does the rest of the flagged plumbing
(the `Flag` icon on over-budget rows, flagged-first sort).

**Why / follow-up:** deliberately held back to be folded into a **planned flag feature** rather
than kept as a standalone banner. Saved to Claude's memory (`needs-attention-banner`) so the
concept — and the surviving `isOverBudget`/flag plumbing to build it on — is picked up when
that feature is built. **Verified:** typecheck clean; the banner text is absent from the
rendered dashboard (:3000), table still renders. Date: 2026-07-24.

### System status page overhaul + navbar hover fix

**Problem:** the `/status` page predated the "industrial glass" overhaul (Feature 8) and still
used raw `<section>`/`<div>` panels with inline styles, a plain `text-3xl` heading, a duplicate
"Tollgate" eyebrow, and bare `UP/DEGRADED/DOWN` mono text — visually a different product from
the dashboard. Separately, the navbar's "System status" link never highlighted coral on hover
the way "Agent Dashboard" does.

**Navbar hover fix — `frontend/dashboard/app/layout.tsx`:** the link already had
`hover:text-brand`, but also set its colour via an **inline `style` attribute**, which wins the
cascade over Tailwind's `:hover` class, so the hover never fired. Replaced the inline
`style={{ color: "var(--muted-foreground)" }}` with the `text-muted-foreground` utility class,
so `hover:text-brand` can take effect — now structurally identical to the working "Agent
Dashboard" link (`text-foreground … hover:text-brand`).

**Status page — `frontend/dashboard/app/status/page.tsx` (kept a server component; probe +
refresh-to-re-probe model unchanged):**
- Container widened to the dashboard's `max-w-5xl px-6 py-12`.
- Header adopts the bracketed title idiom copied from `app/page.tsx`: coral mono `[ ]` brackets
  (left one `-ml-[6px]`) flanking an `<h1>` with the white→`--brand` gradient, `bg-clip-text`,
  `font-heading` (Space Grotesk), `text-[2.34rem]`. The duplicate "Tollgate" eyebrow was
  removed (the nav already brands). Subtitle kept as a plain muted line with the health `Dot`.
- Each service is now a shared `Card` (`CardHeader`/`CardTitle`/`CardDescription`/`CardAction`/
  `CardContent`) instead of a hand-styled `<section>`, so it matches the dashboard's "All
  agents" surface. The `HealthBadge` sits in the `CardAction` (top-right).
- Inline styles swapped for utility classes (`text-muted-foreground`, `font-mono`,
  `divide-border`); `style` retained only for dynamic status colour (the `Dot`, the unreachable
  error line) — same idiom `AgentStatusBadge` uses.
- Added `formatUptime()` (uptimeSec → "1h 04m") and a footer "Last checked <time> · refresh to
  re-probe." from the report's newest `timestamp`.

**`frontend/dashboard/components/health-badge.tsx` (new):** the health-domain analogue of
`AgentStatusBadge` — an outline `Badge` tinted via `color-mix` from a functional token, mapping
`up→--ok` / `degraded→--amber` / `down→--err`, in `font-mono`. Marked **`"use client"`** because
`Badge` calls a hook (`useRender`) and the status page is a server component, so the badge must
be a client leaf across that boundary (`state` is a plain string, crosses cleanly).

**Design guardrail honoured:** brand coral stays title-only; the functional UP/DEGRADED/DOWN
chips and dep dots use the green/amber/red trio, kept away from the coral title (coral and
`--err` are close in hue — `globals.css` mandates they never share a component context).

**Verified:** `pnpm --filter @tollgate/dashboard typecheck` clean; `/status` serves 200. Via
computed styles on :3000/status (valid in a hidden tab — no animation): title is a
white→`rgb(255,74,61)` gradient in Space Grotesk between coral brackets; both service panels are
`Card`s on `oklch(0.205 0.004 60)` with the ring; UP badges render `--ok` green
(`rgb(70,196,127)`) with a color-mix border in JetBrains Mono; both fonts loaded; the "Tollgate"
eyebrow is absent from the page body. Navbar: the "System status" link's inline `style` is gone
and it now carries `text-muted-foreground transition-colors hover:text-brand`, matching the
Agent Dashboard link. **Not verified (needs an eyeball):** the actual coral-on-hover paint — a
hidden tab can't reliably trigger `:hover` — and perceived colour/glyph rendering. Date:
2026-07-24.

### Bracketed-title load animation (both titles)

**What:** on tab load / route switch, each coral bracket now glides inward to its resting
place — the left `[` enters from farther left, the right `]` from farther right, settling onto
the stationary title.

- `frontend/dashboard/app/page.tsx` and `frontend/dashboard/app/status/page.tsx` — both bracket
  `<span>`s gained `animate-in slide-in-from-left-6` / `slide-in-from-right-6` (±1.5rem/24px
  start offset), `duration-500 ease-out`, and `motion-reduce:animate-none`. Also added
  `inline-block` to each bracket span: `transform` (which the slide uses) is a no-op on inline
  boxes, so the spans must be block-level for the translate to apply. Reuses the existing
  `animate-in` family (same as the checkbox pop); no new keyframes. The `<h1>` stays put so the
  brackets converge onto it.
- Replays on client-side navigation (destination page remounts) and on hard load (CSS animation
  plays on first paint).

**Verified (structural — a hidden tab pauses CSS animations, so the motion itself needs an
eyeball):** on both `/` and `/status`, each bracket has `animation-name: enter`, `duration 0.5s`,
`ease-out`; the paused-at-start transform reads `translateX(-24px)` (left) / `translateX(+24px)`
(right) — proving the offset, direction, and that the transform applies (`display: block`). The
actual glide needs a foreground tab to watch. Date: 2026-07-24.

**Note:** the bracketed-title markup is now duplicated across the two pages (title + brackets +
animation). Extracting a shared `BracketedTitle` component is a reasonable future tidy-up (same
precedent as `lib/agent-status.ts` / `HealthBadge`) — not done here to keep this change focused.

### Table header row no longer highlights on hover

**Problem:** hovering the header row (Name / Assistant / Status / …) highlighted it exactly like
a data row. `TableRow` carries `hover:bg-muted/50` (`components/ui/table.tsx:60`) and the same
component renders both the header row and the body rows, so the header picked up an interactive
affordance it doesn't have.

**What changed — `frontend/dashboard/components/ui/table.tsx`:** `TableHeader` gained
`[&_tr]:hover:bg-transparent` alongside its existing `[&_tr]:border-b`, undoing the highlight for
rows inside `<thead>` only.

**Why scoped to `TableHeader` rather than the call site:** passing `hover:bg-transparent` to the
header's `<TableRow>` in `page.tsx` would put both utilities on the *same element* at equal
specificity `(0,2,0)`, leaving the winner to Tailwind's stylesheet order — fragile. As a
descendant rule it resolves to `.<class> tr:hover` at `(0,2,1)`, which strictly outranks
`.hover\:bg-muted\/50:hover` at `(0,2,0)`. It also makes any future table correct by default.

**Verified (CSSOM rule analysis — real `:hover` can't be triggered in a backgrounded tab):** the
generated rule resolves to `.[&_tr]:hover:bg-transparent tr:hover { background-color: transparent }`
inside `@media (hover: hover)` (supported here). Structural match test: the **header row** is
matched by both the transparent rule and the muted rule — transparent wins on specificity, so no
highlight; the **body row** is matched only by the muted rule, so data rows still highlight.
`pnpm --filter @tollgate/dashboard typecheck` clean. **Needs an eyeball** for the actual painted
hover. Date: 2026-07-24.

**Gotcha worth remembering:** Tailwind v4 emits this as a 4-level *nested* rule (class → `& tr` →
`&:hover` → `@media` → `CSSNestedDeclarations`), so a naive CSSOM walker that resolves `&` only
against the immediate parent's `selectorText` will fail to find the declaration and wrongly
report the rule missing. Also, dev-server CSS rebuilds lag the file edit — an immediately-queried
stylesheet can legitimately not contain a just-added utility yet.

### Dashboard UI restyle to match the reference mock

**Problem:** the dashboard's structure/iconography lagged the reference design. Palette, fonts,
ambient glow and the bracketed title already matched (Feature 8 + this session); the gaps were
13 specific deltas — see the root `PLAN.md`, which this implements. **Constraint honoured: the
mock is rendered at a much larger zoom, so its *design* was adopted but not its dimensions —
every existing size token is unchanged and new elements were sized to the current small scale.**

- **`components/main-nav.tsx` (new, client)** — the nav moved out of `layout.tsx` so it can call
  `usePathname()` for an active-tab coral underline (`after:-bottom-3`, which equals the nav's
  `py-3`, so the bar lands on the nav's bottom border). Active link is `text-foreground` +
  `aria-current="page"`; inactive keeps `text-muted-foreground … hover:text-brand`. `layout.tsx`
  stays a server component and just renders `<MainNav />`. Wordmark brightened to
  `text-foreground/90`. **Colour is set with classes, never an inline `style`** — an inline style
  outranks the hover variant and would re-break the hover fixed earlier today.
- **`components/ui/button.tsx`** — two variants added beside `amber`: `brandOutline` and
  `amberOutline` (coloured text + 45% `color-mix` border + 12% wash, hover → 20%), the mock's
  tinted-outline CTA treatment. Same `color-mix` construction as `AgentStatusBadge`/`HealthBadge`.
- **`components/create-agent-dialog.tsx`** — trigger → `variant="brandOutline"` with a `Plus`
  icon. **`app/page.tsx`** — "Select agents" → `amberOutline` + `Users` icon; the toggled "Done"
  state stays neutral `outline` so the amber pill reads as "not yet in selection mode".
- **`components/agent-status-badge.tsx`** — badges gained a leading dot using `bg-current`, so
  all five statuses inherit the right colour with no extra mapping.
- **`components/ui/table.tsx`** — `TableHead` is now `text-xs uppercase tracking-wider
  text-muted-foreground`. Done in CSS so the JSX keeps readable sentence-case strings.
- **`app/page.tsx`** — coral hairline across the card's top edge
  (`bg-linear-to-r from-transparent via-brand to-transparent`; note v4's `bg-linear-*` rename);
  a `size-9` coral-tinted icon tile beside "All agents"; a pulsing green dot after "Polling every
  3s" (`motion-reduce:animate-none`); the table wrapped in `overflow-hidden rounded-lg border`;
  a `size-7` coral-tinted `Bot` avatar per row; the edit pen changed from bare ghost to
  `variant="outline"`; and the spend cell restructured so the amount sits on its own line with
  the bar and `%` sharing a row beneath it.

**Verified** (`pnpm --filter @tollgate/dashboard typecheck` clean; computed styles on :3000):
nav — active link carries `aria-current="page"` with a 2px coral `::after`, inactive has
`display: none`, and the indicator correctly follows the route (checked on both `/` and
`/status`). Buttons — coral/amber text with matching 12%/45% `color-mix` fill and border, one
icon each. Card — gradient hairline present, icon tile 36px coral, green dot. Table — headers
compute `text-transform: uppercase` at 12px/0.6px tracking, row avatar 28px coral with an svg,
status badge has a green dot matching its text colour, edit button has a real border, container
radius 10px. Spend cell — amount above; bar and `%` vertically centred with `%` to the bar's
right. **Needs an eyeball:** overall fidelity to the mock, hover states, and the pulse/pen
animations. Date: 2026-07-24.

### Resume button is green

**What:** the batch **Resume** button was `variant="default"` — solid brand coral, which read as
generic-primary and clashed with coral's brand-only rule. It's now green, matching the **Active**
status badge, since resuming is exactly what returns an agent to that state.

- `components/ui/button.tsx` — new `okOutline` variant on `--ok` (45% `color-mix` border, 12%
  wash, 20% on hover), built identically to `brandOutline`/`amberOutline`. It's the affirmative
  counterpart to `destructive`: Resume vs. Delete.
- `components/batch-stop-dialog.tsx` — `MODE_COPY.resume` now uses `okOutline` for **both** the
  toolbar trigger and the dialog's confirm button, mirroring how `stop` uses `destructive` for
  both.

**Tinted, not solid:** its siblings in the toolbar are Stop (neutral outline) and Delete (tinted
`bg-destructive/10`), so a solid green fill would have shouted over the destructive action. The
tint also matches the Active badge's own treatment.

**Verified:** typecheck clean; in selection mode the Resume trigger computes
`color: rgb(70,196,127)` — byte-identical to both the Active badge's colour and the raw `--ok`
token — over a 12% green wash with a 45% green border. (Read while disabled, since both local
agents are Active; `disabled` only changes opacity, not the colour values.) Date: 2026-07-24.

### Select trigger highlights on hover

**Problem:** the "Sort by" control had `transition-colors` but no hover state, so it never
acknowledged the pointer — unlike every button around it.

**What changed — `components/ui/select.tsx`:** `SelectTrigger` gained `hover:bg-muted` +
`dark:hover:bg-input/50`, the *exact* pair the `outline` button variant uses. The two share the
same bordered, transparent-fill shape, so they now lift identically. Applied to the shared
primitive, so the dialogs' Assistant/Model selects get it too.

**Verified:** typecheck clean; the sort trigger and an `outline` button carry an identical hover
class pair with identical resting backgrounds (`oklab(1 0 0 / 0.045)`), so the lift is the same
0.045 → 0.075 alpha — deliberately slight. All three utility rules confirmed generated. A
`disabled:hover:` guard was written and then removed as redundant: `disabled:pointer-events-none`
already makes `:hover` unreachable. **Needs an eyeball** for the painted hover (a backgrounded tab
can't trigger `:hover`). Date: 2026-07-24.

**Process note (cost me a repair):** re-indenting the wrapped table block with PowerShell
`Get-Content | Set-Content -Encoding utf8` **corrupted every non-ASCII character** (em/en dashes
→ mojibake), including the user-visible `Name (A–Z)` sort labels — `Get-Content` decoded the
UTF-8 file as ANSI. Reversed by re-encoding through Windows-1252 back to UTF-8 and verified by
enumerating the file's non-ASCII inventory. **Use the Edit tool for source edits; if a bulk
rewrite is unavoidable, round-trip via `[System.IO.File]::ReadAllText/WriteAllText` with an
explicit UTF-8 encoding.**

**Verified:** `pnpm --filter @tollgate/dashboard typecheck` clean. In the running dashboard
(:3000), via computed styles (valid in a backgrounded tab — no animation involved): with
**0 selected** the toolbar is present, reads "0 agents selected", has **no Clear button**, and
Stop/Resume/Delete are all `disabled` with `opacity: 0.5` + `pointer-events: none`. Selecting
1 then 2 active agents flipped Stop and Delete to enabled while Resume stayed disabled (no
stopped agent in the selection) — confirming eligibility drives the disabled state. Resume's
enable path is the symmetric `resumable.length === 0` and was not exercised live (both test
agents were Active); an eyeball on the greyed styling is still worth a glance. Date: 2026-07-24.
