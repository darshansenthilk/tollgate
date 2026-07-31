# syntax=docker/dockerfile:1
#
# Build context MUST be the repo root — see backend/proxy/Dockerfile's
# comment, same reasoning applies here. Build from the repo root:
#   docker build -f backend/api/Dockerfile -t tollgate-api .
# docker-compose.selfhost.yml already does this correctly.
FROM node:20-alpine
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/shared/package.json backend/shared/package.json
COPY backend/proxy/package.json backend/proxy/package.json
COPY backend/api/package.json backend/api/package.json
COPY frontend/dashboard/package.json frontend/dashboard/package.json
RUN pnpm install --frozen-lockfile --filter @tollgate/api...

COPY backend/shared backend/shared
COPY backend/api backend/api

WORKDIR /app/backend/api
RUN chmod +x docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 4000
# api runs its own Postgres + Better Auth migrations on boot (index.ts's
# main()) — nothing extra to run here first, see SELF_HOSTING.md's
# "Migrations" section for why proxy's startup has to wait on this
# service's /health instead.
# Shell form deliberately, and 127.0.0.1 not localhost — see
# backend/proxy/Dockerfile's comment on both; same reasoning applies here.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:${API_PORT:-4000}/health || exit 1
# docker-entrypoint.sh checks TOLLGATE_LICENSE_KEY before exec-ing
# `pnpm start` — see its own comment and check-license.ts. This is the
# self-host image's own gate; backend/api/src/index.ts itself has no
# concept of a license key at all, and the hosted deployment (which runs
# `pnpm start` directly, no Docker) never goes through this file.
ENTRYPOINT ["./docker-entrypoint.sh"]
