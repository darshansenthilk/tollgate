# Tollgate

Spend-control and credentialing proxy for AI agents — a self-hosted gateway that sits between a company's AI agents and the LLM providers they call (OpenAI, Claude, Gemini, Azure OpenAI, Bedrock), enforcing per-agent budgets and freezes before every request reaches upstream.

## Layout

pnpm workspace, four packages:
- `backend/shared` — types and pure helpers shared by proxy and api (price tables, key derivation, status enums). No side effects; both other backend packages import from here.
- `backend/proxy` — the hot path. Authenticates an agent's token, checks freeze/budget, forwards to the right provider adapter, meters the cost, logs the outcome.
- `backend/api` — agent CRUD, org/auth, upstream key vaulting, dashboard-facing endpoints. Postgres via Drizzle.
- `frontend/dashboard` — Next.js app.

## Commands

- `pnpm dev` — run proxy + api + dashboard together
- `pnpm dev:proxy` / `dev:api` / `dev:dashboard` — run one
- `pnpm build` / `pnpm typecheck` — across all packages
- `pnpm --filter @tollgate/proxy test` — proxy's vitest suite (route tests live in `backend/proxy/test/`)
- `pnpm infra:up` / `infra:down` — docker compose for local Postgres/Redis

## Conventions

**The adapter pattern is the extension point.** Adding an LLM provider is always: one file in `backend/proxy/src/adapters/`, one line added to the `providers` array in `registry.ts`, one matching test file in `backend/proxy/test/` (see `bedrock-route.test.ts` as the template — every existing adapter has one). The route handler in `proxy.ts` never hardcodes a provider name; it only calls interface methods (`buildUpstreamRequest`, `parseCost`, `prepareRequestBody`) on whatever adapter the registry resolved. If you're adding a provider-specific `if` to `proxy.ts`, the logic belongs in the adapter instead.

**Everything in the hot path is injected** (see `ProxyDeps` in `routes/proxy.ts`) so route tests run against fakes, not real Redis/Postgres/network. New proxy dependencies should follow the same shape: an interface, a real implementation, a fake for tests.

**Comments explain *why*, not *what*.** This codebase leans on doc comments for non-obvious invariants (why a query string is sliced from `req.url` instead of rebuilt, why a frozen check reads both Postgres and a Redis fast-path). Match that — don't narrate what a function obviously does; explain the constraint that made it necessary.

**Denials are logged like successes.** Every rejected request (frozen, over budget) still writes a `spend_events` row via `recordDenial` / `spendLog.record`, with its own `decision` value, so the dashboard's activity log shows *why* a request was blocked instead of just going quiet. Any new gate should follow this same pattern rather than short-circuiting silently.

## Working with agents on this repo

Small team, no near-term hires — prefer extending an existing interface over introducing a new one, and keep PRs the size of a single adapter or a single dashboard feature.

- **One adapter = one unit of agent work.** It's self-contained (new file + one registry line + one test file) and has existing sibling test files to check parity against — a good task to hand to an agent end-to-end.
- **Parallelize with worktrees, not shared branches** — when two tasks don't overlap in files, run them as separate agent sessions with isolated worktrees so they don't collide, then review and merge each independently.
- **Security-sensitive code gets a real review pass, always.** That's most of `backend/proxy` — it handles vaulted upstream credentials and AWS SigV4 signing. Don't merge agent-authored changes there on a green test run alone; run a code review pass first, and use the heavier multi-agent review for anything touching `vault.ts`, `aws-sigv4.ts`, or credential handling in an adapter.
- **No speculative abstractions.** If a task only needs one provider or one feature, don't generalize for a second one that doesn't exist yet — three similar lines beat a premature interface, same as everywhere else in this codebase.
