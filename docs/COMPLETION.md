# COMPLETION.md

**Purpose:** This file details the features and changes shipped on the current branch (`Eshaan`) so far. It exists as context for Claude (or any future contributor) to pick up this branch's history without needing to re-derive it from scratch — read this before starting new work here.

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
