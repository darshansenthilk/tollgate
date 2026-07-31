# Self-hosting Tollgate — requirements & architecture

Internal engineering spec, not a public deployment guide — don't lift claims
out of this file onto a public page without checking they're still current;
`/security`'s honesty-first approach is why this distinction exists at all.

**Status (2026-07-31):** Dockerfiles for all three services, a working
`docker-compose.selfhost.yml`, the `api`-before-`proxy` health-gated startup
ordering, a private image registry, and signed activation-key licensing are
all DONE and verified end-to-end — see "What's built" and "Licensing" below.
Still open: Helm/Kubernetes, and actually pushing the first real version tag
(see "What's not built yet").

## Licensing

**Decision (2026-07-31):** Gated, not open-core. Self-host images are
private (`ghcr.io/darshansenthilk/tollgate-*` inherits this repo's
visibility — private repo, `GITHUB_TOKEN`-published packages default to
private) AND the running `api`/`proxy` services refuse to start without a
valid, signed activation key. Distribution being gated alone isn't enough —
someone who obtained an image some other way could otherwise run it forever
with no ongoing relationship to Tollgate; the runtime check closes that.

**No self-serve signup for self-hosting.** A company requests it (e.g.
through the contact form the marketing site already has), and Tollgate
mints a key by hand:

```
LICENSE_SIGNING_PRIVATE_KEY=<the private key — see below> \
  node scripts/generate-license-key.mjs --org "Acme Corp" --expires 2027-07-31
# or --no-expiry for a perpetual key
```

Send the printed key to the customer as `TOLLGATE_LICENSE_KEY` in their
`.env`. `docker-compose.selfhost.yml` already passes it through to `api`
and `proxy` via `env_file: .env`.

**How the check works** (`backend/shared/src/license.ts`,
`backend/api/docker-entrypoint.sh`, `backend/proxy/docker-entrypoint.sh`):
Ed25519-signed, verified fully offline (no phone-home — a real requirement
for air-gapped enterprise deployments, and a genuine selling point, not
just an implementation detail). Only the PUBLIC key ships in the product;
the PRIVATE signing key lives outside this repo entirely and is what
actually controls who can mint a valid key.

**Rotated 2026-07-31.** The original keypair's private half was generated
and used in a chat session/shell history and treated as provisionally
exposed rather than trusted to stay confidential — a fresh keypair replaced
it the same day, verified live (a key minted with the new private key
verifies; a key minted with the old, retired private key is correctly
rejected — `bad_signature`). The embedded public key in
`backend/shared/src/license.ts` is the new one. **The new private key has
the exact same exposure problem as the old one until it's moved** — it
still currently only exists in this conversation's history and this
session's shell history, and needs to go into a real secrets manager
immediately; nothing here fixes that on its own, rotation just replaces
"the exposed key is live" with "a different exposed key is live" until it
actually moves somewhere real.

The check runs ONLY in the Docker self-host images
(`docker-entrypoint.sh` → `check-license.ts`, before `pnpm start`) — never
in `backend/api/src/index.ts` or `backend/proxy/src/index.ts` themselves,
which the hosted deployment (Railway/Vercel, no Docker) also runs. This was
deliberate from the start, not a fix: putting the check in the shared
entrypoint would have required it to somehow know "am I hosted or
self-hosted," an easy way to accidentally lock yourself out of your own
production service.

## The four pieces

A self-hosted install is the same four workspace packages that make up the
hosted product, just run on the customer's own infrastructure instead of
ours:

| Package | Role | Talks to |
|---|---|---|
| `frontend/dashboard` (`@tollgate/dashboard`) | Next.js app — marketing site, sign-in, and the Agent Dashboard | `api` (browser fetches, cookie auth) |
| `backend/api` (`@tollgate/api`) | Auth authority (Better Auth), agent CRUD, org-scoped management plane | Postgres, Redis; owns migrations |
| `backend/proxy` (`@tollgate/proxy`) | The enforcement hot path — what agents actually call | Postgres (read), Redis (budget/freeze), upstream providers (OpenAI/Anthropic) |
| `backend/shared` (`@tollgate/shared`) | Types/constants shared by api and proxy | n/a — library, not a service |

Plus two infra dependencies, both stateful:

- **Postgres 16+** — system of record (agents, orgs, spend audit log, Better
  Auth's own tables). One database, shared by `api` and `proxy`.
- **Redis 7+ with AOF persistence enabled** — NOT a disposable cache here.
  It holds the freeze fast-path flag and the current-month budget counters
  proxy.ts checks on every single forwarded request
  (`backend/proxy/src/routes/proxy.ts`). Losing it isn't "slower," it's
  "budget enforcement forgets what's already been spent this month" — the
  existing `docker-compose.yml` already runs it with
  `--appendonly yes` for exactly this reason; any self-host deployment must
  do the same (a managed Redis with persistence off, or an ephemeral
  container, is not an acceptable substitute).

## Request flow (why the topology matters)

```
Agent  ──(Bearer tg_live_…)──▶  proxy  ──(vaulted real key)──▶  OpenAI / Anthropic
                                  │  ▲
                                  ▼  │
                              Postgres, Redis
                                  ▲  │
                                  │  ▼
Browser ──(session cookie)──▶  api  ◀── dashboard (Next.js, server + client)
```

`proxy` is server-to-server only — no CORS, no browser traffic, agents
authenticate with a Tollgate-issued token (see `/security` for what that
means for key custody). `api` is what the dashboard's browser talks to, so
it needs CORS locked to the dashboard's real origin and a session-cookie
domain that matches. These have different exposure profiles and should be
treated differently on the network (see "Networking" below), not just
identical services behind the same load balancer.

## Configuration

The root `.env.example` is already the authoritative reference — copy it to
`.env`, every var and its purpose is documented inline there, including the
exact commands to generate `VAULT_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET`.
Summary of what a self-hoster has to actually decide (not just copy
defaults for):

- **`VAULT_ENCRYPTION_KEY`** — must be identical on `api` (encrypts BYOK
  org keys) and `proxy` (decrypts them to forward requests). A mismatch
  doesn't silently degrade — `proxy` fails closed and denies every request
  for the affected org (`backend/proxy/src/lib/vault.ts`,
  `upstream-key-crypto.ts`). Generate once, store in whatever secrets
  manager the deployment target uses, inject identically into both services.
- **`OPENAI_UPSTREAM_KEY` / `CLAUDE_UPSTREAM_KEY`** — the deployment-wide
  fallback key per provider, used for any org that hasn't configured its own
  BYOK key. A self-hoster who wants every org to bring their own key can
  leave these unset; requests for orgs without a stored key then fail rather
  than silently using a key that doesn't exist.
- **`BETTER_AUTH_SECRET`** — signs/encrypts sessions. A real secret, not the
  dev default, and it must not change across a redeploy or every existing
  session invalidates.
- **`AUTH_COOKIE_DOMAIN`** — only needed if `dashboard` and `api` end up on
  different subdomains of the same root domain in the customer's
  deployment (their internal convention, not ours to assume).
- **`DASHBOARD_ORIGIN`** — must exactly match wherever the dashboard is
  actually reachable, or `api`'s CORS + Better Auth's trusted-origins check
  both reject the dashboard's requests outright.

## Migrations

`api` runs its own migrations (`runMigrations` + `runAuthMigrations`, both
in `backend/api/src/db/`) automatically on boot (`backend/api/src/index.ts`
`main()`) — there is no separate migration step to orchestrate. Critically,
**`proxy` has zero migration logic of its own** and reads tables `api`
creates (agents, org_upstream_keys, spend log). Startup order matters:
`api` must reach a healthy state (`GET /health` returns `ok: true`) before
`proxy` starts serving traffic against a schema that might not exist yet.
`api`'s current behavior on migration failure is to log a warning and keep
starting rather than crash (`index.ts`'s `main()` — deliberately, so
`/health` can report the real Postgres failure instead of the container
just refusing to start) — a self-host deploy's own orchestration should
still gate `proxy`'s startup on `api`'s `/health` reporting healthy, not
just on the process having started.

## Running each service

None of the three services have a real compiled build — `"build": "tsc
--noEmit"` in both `backend/proxy` and `backend/api`'s `package.json` is a
type-check, not a bundle step. Both already run their TypeScript directly
via `tsx` in `"start"` (`tsx src/index.ts`) — that's also what a production
container should run; there's no separate artifact to produce first.

- `backend/proxy`: `tsx src/index.ts`, listens on `PROXY_PORT` (default
  8080), binds `0.0.0.0`.
- `backend/api`: `tsx src/index.ts`, listens on `API_PORT` (default 4000),
  binds `0.0.0.0`, runs its own migrations on boot (above).
- `frontend/dashboard`: standard Next.js — `next build` then `next start`,
  needs `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_PROXY_URL` set at build time
  (they're baked into the client bundle, not read at runtime, being
  `NEXT_PUBLIC_*`).

All three need `backend/shared` built/resolvable first since they depend on
it as a workspace package (`workspace:*` in each `package.json`) — a
container build has to either run `pnpm install` at the workspace root (so
the workspace link resolves) or vendor shared's compiled output in, not
`pnpm install` from inside each service's own directory in isolation.

## Networking & security guidance for a self-hoster

- **TLS is not handled by any of the three services** — Fastify/Next.js
  here all serve plain HTTP. A self-host deployment needs its own
  TLS-terminating reverse proxy or load balancer in front (nginx, Caddy, an
  ALB, whatever their platform already uses) — this isn't optional, agent
  tokens and session cookies would otherwise cross the network in the
  clear.
- **`proxy` doesn't need to be public-internet-facing in every deployment
  shape** — only wherever the customer's agents actually run needs to reach
  it. An enterprise running agents inside their own VPC could keep `proxy`
  on an internal network entirely, which shrinks the attack surface
  meaningfully beyond what the hosted version can offer (this is a real
  self-hosting advantage worth stating plainly once this becomes public
  content).
- **`api` must be reachable by the dashboard's users' browsers** — it's the
  session/auth surface, so it needs a real public (or at least
  corporate-network-reachable) origin, matching `DASHBOARD_ORIGIN` and
  `BETTER_AUTH_URL` exactly.

## Scaling notes

- `proxy` and `api` are both stateless per-instance (all durable state is
  in Postgres/Redis) — horizontally scaling either is just running more
  instances behind a load balancer, no sticky sessions or instance-local
  state to worry about.
- Redis is the actual bottleneck to watch under load, since every proxied
  request touches it for the budget/freeze check
  (`backend/proxy/src/routes/proxy.ts` steps 4–5) — size and monitor it
  like the hot-path dependency it is, not like an optional cache.
- Postgres load is dominated by the audit-log write per request
  (`spendLog.record`, fire-and-forget so it doesn't block the response) and
  the vault lookup per BYOK org — both are already indexed single-row
  operations per the existing code, not a query pattern that needs
  redesigning to scale.

## What's built

- `backend/proxy/Dockerfile`, `backend/api/Dockerfile`,
  `frontend/dashboard/Dockerfile` — all three build clean, no separate
  compile step needed for proxy/api (they run `tsx` directly, same as dev);
  dashboard uses `next build` with `output: "standalone"`
  (`frontend/dashboard/next.config.ts`) so the runtime image only needs the
  traced `.next/standalone` output, not the whole pnpm workspace.
- `docker-compose.selfhost.yml` — the actual deployable bundle (Postgres +
  Redis + `api` + `proxy` + `dashboard`), distinct from the existing root
  `docker-compose.yml` (dev-only, infra deps only). `proxy`'s `depends_on`
  is gated on `api` reporting `service_healthy`, not just started — the
  ordering requirement described above under "Migrations" is real and
  enforced now, not just documented.
- Verified live: built all three images, brought up the full stack, watched
  `api` run its migrations and become healthy, watched `proxy` correctly
  wait for that before starting, hit both `/health` endpoints from outside
  the containers, and confirmed the dashboard serves the real app (right
  page title, static assets loading). Two real bugs were caught and fixed
  in the process — `localhost` resolving to `::1` inside the containers and
  failing every healthcheck despite the app being up, and the compose
  file's port mappings not staying in sync when `API_PORT`/`PROXY_PORT` are
  overridden.
- **The dashboard image is a genuinely generic, publishable artifact now** —
  it no longer bakes `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_PROXY_URL` in at
  build time (which would have made one published image only work for
  whoever's api/proxy happen to be at the exact URLs baked into it).
  `frontend/dashboard/Dockerfile` builds with syntactically-valid sentinel
  URLs (`https://tollgate-runtime-placeholder-{api,proxy}.invalid` — had to
  be real URLs, not just distinctive strings, because `lib/auth-client.ts`
  constructs a real `URL` from this value at module scope and `next build`
  evaluates that during static prerendering, not just in the browser);
  `docker-entrypoint.sh` substitutes the real runtime values into the
  traced output before the server starts. Verified this actually works by
  running the *same built image* twice with different URLs and confirming
  each container only ever contains its own value — zero cross-
  contamination, zero leftover sentinels.
- `.github/workflows/publish-images.yml` — builds and pushes all three
  images to `ghcr.io/darshansenthilk/tollgate-{proxy,api,dashboard}` on a
  version-tag push (`v[0-9]+.[0-9]+.[0-9]+`) or manual dispatch, tagged with
  both the version and `latest`. Private by inheritance (see "Licensing").
  YAML-validated, but **not yet exercised for real** — nothing has actually
  been pushed to the registry, since that means tagging and pushing a real
  git tag, a visible/public action outside local verification.
  `docker-compose.selfhost.yml`'s `image:` fields already point at these
  paths, so `docker compose ... pull` will start working the moment a tag
  is actually pushed.
- **Signed activation-key licensing** (see "Licensing" above for the full
  design) — `backend/shared/src/license.ts` (Ed25519 verify, offline, no
  phone-home), `scripts/generate-license-key.mjs` (the internal minting
  tool), and `backend/api/docker-entrypoint.sh` /
  `backend/proxy/docker-entrypoint.sh` (the actual gate — refuses to
  `exec pnpm start` without a valid key). Verified live in Docker: built
  real images and confirmed all four cases behave correctly — no key
  (refuses, exit 1), tampered key (refuses), expired key (refuses), valid
  key (starts, runs migrations, serves `/health` correctly, logs which org
  it's licensed to). Caught and fixed a real bug in the process: putting
  the license code in `backend/shared/src/index.ts` (the package's main
  export) broke the live dashboard dev server with a 500, because that
  file is reachable from the dashboard's browser bundle and webpack can't
  bundle `node:crypto` for the browser — moved it to its own
  `@tollgate/shared/license` subpath export that only server-only
  `check-license.ts` files import, never anything client-side.

## What's not built yet

Being upfront about this matters more than sounding finished — see
`/security`'s own "What we haven't done yet" for why.

- **The registry has never actually been published to** — the workflow
  exists and is believed correct, but "believed correct" isn't "verified,"
  and won't be until a real version tag triggers it. First real self-host
  customer should probably not be the first real test of this pipeline.
- **The license signing private key needs to move to a real secrets
  manager immediately** — right now it only exists in this session's
  history (see "Licensing" above). Treat it as provisionally exposed;
  rotating before relying on it for a real customer is the safer default.
- No Helm chart / Kubernetes manifests — `docker-compose.selfhost.yml`
  covers single-host Docker deployments only.
- No public deployment guide — this doc is still internal-only; turning it
  into real customer-facing docs is its own task, not just a copy-paste,
  since it should probably be trimmed and given the same honest framing
  `/security` uses rather than dumped as-is.
- No way to revoke an already-issued key short of it hitting its expiry —
  every key is checked purely offline against the embedded public key,
  which is what makes air-gapped deployment possible, but it also means
  there's no kill switch for a specific customer's key short of shipping a
  new public key in a future image version (which would invalidate every
  previously-issued key, not just one). Worth deciding whether that's
  acceptable before this scales past a handful of customers.

## Suggested next engineering steps

1. Move the private signing key to a real secrets manager (see "What's not
   built yet") — before anything else here, since every other step assumes
   it stays confidential.
2. Push a real version tag (e.g. `v0.1.0`) to confirm the publish workflow
   actually works end-to-end against the real registry, not just
   YAML-validated locally.
3. A real public deployment guide, once 1–2 are settled.
4. Helm chart / K8s manifests, for self-hosters who aren't single-host
   Docker Compose shops — lower priority until there's a real prospect
   asking for it.
