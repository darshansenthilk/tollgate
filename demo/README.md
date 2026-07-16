# Tollgate live demo

A scripted walkthrough that proves the whole loop: create an agent, spend
against it through the real proxy, watch the dashboard track spend live, and
watch enforcement (budget or freeze) cut it off — before the request ever
reaches OpenAI.

Everything below reflects the **actual, verified** route shapes in this repo
(`backend/api/src/routes/agents.ts`, `backend/proxy/src/routes/proxy.ts`), and every script has
been run end-to-end against the real services as part of writing this doc —
not just written and hoped to work.

## Prerequisites

- `pnpm infra:up` — Postgres + Redis containers (`tollgate-postgres-1`,
  `tollgate-redis-1`) running and migrated.
- `pnpm dev` (or `dev:api` / `dev:proxy` / `dev:dashboard` individually) —
  api on `:4000`, proxy on `:8080`, dashboard on `:3000`.
- `docker`, `curl`, `node` on PATH. Scripts are POSIX shell — use Git Bash on
  Windows.

## The routes this demo drives (verified, not guessed)

| Call | Route | Notes |
|---|---|---|
| Create agent | `POST http://localhost:4000/v1/agents` | body `{ name, providerSlug, maxBudgetCents }` → `201` with `{ id, name, providerSlug, status, maxBudgetCents, token }`. **`token` is a one-time value — the api never returns it again.** |
| List agents | `GET http://localhost:4000/v1/agents` | → array of `{ id, name, providerSlug, status, maxBudgetCents, currentMonthSpendCents }`. `currentMonthSpendCents` is read live from Redis (the same counter the proxy enforces against), not aggregated from the Postgres audit log. |
| Spend | `POST http://localhost:8080/openai/v1/chat/completions` | Header `authorization: Bearer <token>`. This mirrors OpenAI's real path 1:1 under the `openai` provider slug — the proxy's adapter does **not** prepend its own `/v1`, the path you call already carries it. |
| Freeze | `POST http://localhost:4000/v1/agents/:id/freeze` | body `{ mode: "soft" \| "hard" }` → `{ id, status }`. Updates Postgres **and** a Redis fast-path flag in the same request — the very next proxy request sees it, no restart needed. |
| Unfreeze | `POST http://localhost:4000/v1/agents/:id/unfreeze` | no body → `{ id, status: "active" }`. |

## Real key vs. placeholder key — which this demo uses, and why

`OPENAI_UPSTREAM_KEY` in `.env` is currently a placeholder
(`sk-placeholder-not-a-real-key`). This matters for one specific reason:
**the proxy only meters a nonzero cost when the upstream response contains a
real `usage` object** (`backend/proxy/src/adapters/openai.ts` — `parseCost` returns
`{ costCents: 0 }` whenever the body has no `usage.prompt_tokens`, which is
exactly what an OpenAI auth-error body looks like). With a placeholder key,
every call gets a real `401 invalid_api_key` from OpenAI — proving Tollgate's
auth/budget gate ran and forwarded correctly — but spend **never climbs**,
because there's no real usage to meter.

That means with a placeholder key you can prove routing, auth, and the
*freeze* enforcement path, but not the *auto-hit-budget-exceeded-from-real-
spend* path — because spend can only climb from a real key with real credits
attached.

**Decision: this repo's dev environment doesn't have a real OpenAI key,
so the scripts below default to, and were verified against, the placeholder-
key path (step c uses the manual-freeze branch, proven live — see the
"what was actually tested" note below). If you have a real key, drop it into
`OPENAI_UPSTREAM_KEY` in `.env`, restart the proxy, and re-run — the *same*
scripts then also demonstrate spend climbing to a real `budget_exceeded`
without you touching Freeze at all.** Nothing in the routing/enforcement path
changes between the two modes; only whether real cost accrues.

If you do supply a real key: `demo-agent`'s `maxBudgetCents` is set to **2**
($0.02) on purpose. `gpt-4o-mini` is priced at 15¢/60¢ per 1M input/output
tokens (`backend/proxy/src/adapters/openai.ts`) — genuinely tiny, so hitting even a
couple of cents for real takes dozens of calls, not thousands, and the whole
demo's real-dollar cost is bounded at roughly $0.02 plus at most one call's
overshoot (Tollgate's budget check runs *before* metering the current call,
so the agent can exceed the ceiling by up to one call's cost before the
*next* request is denied — the documented "bounded overshoot" model for
metered-tier providers).

## Scripts

- **`seed.sh`** — wipes `agents`/`policies`/`spend_events` and any
  `spend:*`/`frozen:*` Redis keys (this is the local dev/demo DB, not
  production), then creates one agent named `demo-agent` (`providerSlug:
  "chatgpt"`, `maxBudgetCents: 2`), prints its one-time token, and saves
  `{id, token}` to `demo/.demo-agent.json` (gitignored) for the other scripts.
- **`hammer.sh`** — loops `POST /openai/v1/chat/completions` with that token
  once a second, printing each call's real usage/cost (parsed from the
  unchanged upstream response) until Tollgate returns `403`, then stops.
  Safety-capped at 300 iterations; if it hits the cap without a `403` it
  prints exactly why (see "real key vs. placeholder" above) instead of
  hanging silently.
- **`cleanup.sh`** — deletes the demo agent by the exact id `seed.sh`
  recorded (not a name match), straight against Postgres/Redis. There's no
  `DELETE /v1/agents/:id` endpoint yet — it's still a `501` stub in
  `backend/api/src/routes/stubs.ts` — so this is the only way to actually remove one
  today.

Override any of these via env vars if your setup differs:
`API_URL`, `PROXY_URL`, `POSTGRES_CONTAINER`, `REDIS_CONTAINER`,
`DEMO_MAX_BUDGET_CENTS`, `MAX_ITERATIONS`, `SLEEP_SECONDS`.

## Walkthrough

**0. Reset to a clean, predictable state.**

```bash
bash demo/seed.sh
```

Prints the demo agent's id and its token — copy the token if you want to
narrate a manual `curl` call later. Open **http://localhost:3000**.

**a. Show the dashboard at $0 spend.**

The table has exactly one row: `demo-agent`, app name `chatgpt`, status
**Active**, `$0.00 / $0.02`, 0%. (`seed.sh` wiped everything else first, so
there's nothing else on screen to explain away.)

**b. Run the sample script; watch spend climb.**

```bash
bash demo/hammer.sh
```

Each line printed is one real, verified round trip through the proxy's hot
path (token auth → Redis budget check → forward to OpenAI → meter → settle).
With a real key, refresh eyes between the terminal and the dashboard — the
progress bar and `$` figure move within the 3s poll, crossing the amber
80%-warning line before the ceiling. With the placeholder key, the terminal
shows real `401`s from OpenAI and `$0 metered` each time (expected — see
above) while the dashboard stays at $0.00; this is the moment to explain
*why*, and move to step (c)'s manual branch.

**c. Cut it off — auto, or by hand.**

- *Real key, spend crossed the ceiling:* `hammer.sh` will print `403 from
  Tollgate — error: budget_exceeded` and exit on its own. Nothing to do.
- *Placeholder key (or you just want to show the freeze flow directly):*
  while `hammer.sh` is still looping, open the dashboard, click **Freeze** on
  `demo-agent`, confirm in the dialog. This is exactly `POST
  /v1/agents/:id/freeze` with `{"mode":"soft"}` — verified to update Postgres
  and the Redis flag in the same request.

**d. Show the denial and the badge.**

The very next line `hammer.sh` prints is `403 from Tollgate — error:
agent_frozen` (or `budget_exceeded`) — it exits right after. Point out that
this happened *before* any call reached OpenAI: Tollgate's gate runs first.
Back on the dashboard, the badge for `demo-agent` reads **Soft frozen** (or
the row's progress bar is fully red at 100%+) — no page reload needed, it's
there on the next 3s poll.

**Cleanup — always run this last.**

```bash
bash demo/cleanup.sh
```

Removes `demo-agent` so the next run of `seed.sh` starts from the same clean
slate, and doesn't leave a frozen/exhausted row cluttering the dashboard for
whoever opens it next.

## What was actually tested while writing this

Every script above was run for real against the live api/proxy/Postgres/
Redis in this repo, not just written:

- `seed.sh` — confirmed it wipes pre-existing agents (it found and removed 3
  real leftover agents from prior dev sessions on first run) and creates
  exactly one clean agent, visible via both `GET /v1/agents` and the
  dashboard.
- `hammer.sh` — confirmed it loops, forwards for real (genuine `401` from
  `api.openai.com` with the placeholder key), and prints the self-diagnosis
  message correctly when capped.
- The **freeze mid-run** path — confirmed end-to-end: 2 calls forwarded
  normally, froze the agent via the real api, and the very next call got a
  real `403 agent_frozen` from Tollgate, never reaching OpenAI.
- `cleanup.sh` — confirmed it leaves `agents`, `policies`, and
  `spend_events` all empty, and `GET /v1/agents` returns `[]`.

The one thing **not** tested end-to-end is the real-key "spend climbs to a
genuine `budget_exceeded`" path, since this dev environment has no real
OpenAI credential — that's the one gap called out above, and it's a
same-code-path difference (real `usage` data vs. none), not an unverified
route or an untested script.
