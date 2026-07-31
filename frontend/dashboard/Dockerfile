# syntax=docker/dockerfile:1
#
# Build context MUST be the repo root — see backend/proxy/Dockerfile's
# comment. Build from the repo root:
#   docker build -f frontend/dashboard/Dockerfile -t tollgate-dashboard .
# docker-compose.selfhost.yml already does this correctly. Unlike an
# earlier version of this Dockerfile, NEXT_PUBLIC_API_URL/
# NEXT_PUBLIC_PROXY_URL are NOT build args anymore — see
# docker-entrypoint.sh for why baking real URLs in at build time makes the
# image unpublishable (every self-hoster needs a different value). This
# image builds once with sentinel placeholders and is generic; the real
# URLs are supplied as ordinary runtime env vars, same as proxy/api.
#
# Two stages: `builder` runs `next build` inside the full pnpm workspace
# (needed for @tollgate/shared to resolve); `runner` only copies out
# .next/standalone's self-contained server (next.config.ts's
# output: "standalone") — that sidesteps hand-copying pnpm's symlinked
# node_modules across build stages, which standalone mode already solves
# for us.
FROM node:20-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/shared/package.json backend/shared/package.json
COPY backend/proxy/package.json backend/proxy/package.json
COPY backend/api/package.json backend/api/package.json
COPY frontend/dashboard/package.json frontend/dashboard/package.json
RUN pnpm install --frozen-lockfile --filter @tollgate/dashboard...

COPY backend/shared backend/shared
COPY frontend/dashboard frontend/dashboard

# Sentinels, not real values — docker-entrypoint.sh substitutes these for
# the real NEXT_PUBLIC_API_URL/NEXT_PUBLIC_PROXY_URL at container startup.
# Have to be syntactically valid URLs, not just distinctive strings: several
# places (lib/auth-client.ts's createAuthClient, lib/api.ts) construct a
# real URL from this value at module scope, which better-auth validates
# with `new URL(...)` — that runs during `next build`'s static prerendering
# too (not just in the browser), so an obviously-fake token like
# "__PLACEHOLDER__" throws ERR_INVALID_URL and fails the build outright.
# ".invalid" is the RFC 2606 reserved TLD guaranteed never to resolve to a
# real domain, so this parses fine while staying unambiguous as a
# placeholder.
ENV NEXT_PUBLIC_API_URL=https://tollgate-runtime-placeholder-api.invalid
ENV NEXT_PUBLIC_PROXY_URL=https://tollgate-runtime-placeholder-proxy.invalid

WORKDIR /app/frontend/dashboard
RUN pnpm build

# ---- runtime: only the traced standalone output, not the whole workspace ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/frontend/dashboard/.next/standalone ./
COPY --from=builder /app/frontend/dashboard/.next/static ./frontend/dashboard/.next/static
COPY --from=builder /app/frontend/dashboard/public ./frontend/dashboard/public
COPY frontend/dashboard/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
# 127.0.0.1, not localhost — see backend/proxy/Dockerfile's comment;
# "localhost" resolves to ::1 first in this image and the app doesn't
# listen there.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -q --spider http://127.0.0.1:3000/ || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]
