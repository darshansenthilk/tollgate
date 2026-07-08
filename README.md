# Tollgate

Spend-control and credentialing proxy for AI agents. This is **milestone 0**:
monorepo scaffolding with all three services booting and proving connectivity
to Redis and Postgres. No business logic yet.

## Layout

```
/backend/proxy      Fastify reverse proxy (data plane) — agents → Tollgate → upstream APIs
/backend/api        Fastify management API (control plane) — agent/policy CRUD, freeze/unfreeze
/frontend/dashboard Next.js (app router) + Tailwind — operator dashboard
/backend/shared     Shared TypeScript types (Agent, Policy, SpendEvent, Provider, ...)
```

## Prerequisites

- Node ≥ 20, pnpm ≥ 9 (`corepack enable`)
- Docker (for local Redis + Postgres)

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm infra:up      # starts Redis (AOF on) + Postgres via docker compose
pnpm dev           # starts proxy (:8080), api (:4000), dashboard (:3000) in parallel
```

Then open http://localhost:3000 — the status board should show both services
UP with green Redis/Postgres checks.

## Proof of life

- `GET http://localhost:8080/health` — proxy pings Redis + Postgres, bumps a
  Redis heartbeat counter.
- `GET http://localhost:4000/health` — same for the api; on boot the api also
  creates a `service_heartbeats` table and inserts a row (proves DDL/write).
- Dashboard fetches both `/health` endpoints server-side and renders them.
- Management routes exist as stubs returning `501` (e.g.
  `POST /v1/agents/:id/freeze`) to pin down the intended API shape.

## Scripts

| command            | what it does                              |
| ------------------ | ----------------------------------------- |
| `pnpm dev`         | run all three services in watch mode      |
| `pnpm dev:proxy`   | run only the proxy                        |
| `pnpm typecheck`   | `tsc --noEmit` across every package       |
| `pnpm infra:up`    | `docker compose up -d` (Redis + Postgres) |
| `pnpm infra:down`  | stop infra containers                     |

## Next milestones

1. Schema migrations: `agents`, `policies`, `spend_events`, audit log
2. Proxy hot path: token auth → Redis policy check → forward → meter → settle
3. Freeze/unfreeze wired through Redis pub/sub to the proxy
4. Dashboard: live agent list + exception queue via SSE
