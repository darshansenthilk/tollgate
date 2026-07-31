# syntax=docker/dockerfile:1
#
# Build context MUST be the repo root, not this directory — a workspace-wide
# `pnpm install` is what resolves the @tollgate/shared workspace link
# (backend/shared ships raw TypeScript with no compiled dist; it's read
# directly by tsx, not built first — see SELF_HOSTING.md's "Running each
# service"). Build from the repo root:
#   docker build -f backend/proxy/Dockerfile -t tollgate-proxy .
# docker-compose.selfhost.yml already does this correctly.
FROM node:20-alpine
RUN corepack enable
WORKDIR /app

# Manifests first, installed in their own layer — editing application code
# below shouldn't bust this (much slower) install step on a rebuild.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/shared/package.json backend/shared/package.json
COPY backend/proxy/package.json backend/proxy/package.json
COPY backend/api/package.json backend/api/package.json
COPY frontend/dashboard/package.json frontend/dashboard/package.json
# @tollgate/proxy plus its workspace dependency (@tollgate/shared) only —
# not the whole monorepo, so api/dashboard-only deps never end up in this
# image. All four manifests above still have to be present for pnpm to
# resolve the workspace graph and validate the lockfile, even though only
# two packages' deps actually get installed.
RUN pnpm install --frozen-lockfile --filter @tollgate/proxy...

# shared has no build step — its source has to actually be in the image,
# not just resolvable via the node_modules symlink the install above made.
COPY backend/shared backend/shared
COPY backend/proxy backend/proxy

WORKDIR /app/backend/proxy
RUN chmod +x docker-entrypoint.sh
ENV NODE_ENV=production
EXPOSE 8080
# Shell form (not the JSON-array form) deliberately — that's what lets
# ${PROXY_PORT} expand against the container's actual runtime env instead
# of being baked in at build time, so overriding PROXY_PORT in .env doesn't
# silently break the healthcheck. 127.0.0.1, not localhost: this image's
# /etc/hosts resolves "localhost" to both 127.0.0.1 and ::1, and wget picks
# ::1 first — which nothing listens on, since the app binds 0.0.0.0
# (IPv4-only here), so "localhost" made every healthcheck fail with
# "Connection refused" despite the server actually being up.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:${PROXY_PORT:-8080}/health || exit 1
# docker-entrypoint.sh checks TOLLGATE_LICENSE_KEY before exec-ing
# `pnpm start` — see its own comment and check-license.ts. This is the
# self-host image's own gate; backend/proxy/src/index.ts itself has no
# concept of a license key at all, and the hosted deployment (which runs
# `pnpm start` directly, no Docker) never goes through this file.
ENTRYPOINT ["./docker-entrypoint.sh"]
