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
