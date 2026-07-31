#!/bin/sh
set -e

# Next.js inlines NEXT_PUBLIC_* into the built client JS at `next build`
# time — there's no way to make the *browser* read a real runtime env var,
# since the value has to already be a string literal in the bundle before
# it ever reaches a browser. That's normally fine for a one-deployment-per-
# build setup (Vercel), but it breaks a "build once, publish to a registry,
# let anyone `docker pull` it" image: every self-hoster has a different
# api/proxy URL, and only one can be baked in.
#
# Fix: the image is built with sentinel placeholders (see Dockerfile) baked
# in instead of real URLs. This entrypoint runs once per container start,
# finds those sentinels in the traced output, and replaces them with
# whatever NEXT_PUBLIC_API_URL/NEXT_PUBLIC_PROXY_URL are actually set to at
# runtime — before the server (which would otherwise serve the sentinel
# strings to every browser) ever starts.

: "${NEXT_PUBLIC_API_URL:?NEXT_PUBLIC_API_URL must be set at container runtime}"
: "${NEXT_PUBLIC_PROXY_URL:?NEXT_PUBLIC_PROXY_URL must be set at container runtime}"

# \. escaped: unescaped, sed's regex "." matches any character, not just a
# literal dot — harmless in practice given how specific the rest of each
# string is, but escaped anyway since it costs nothing to be exact.
find /app/frontend/dashboard -type f -name '*.js' -exec sed -i \
  -e "s#https://tollgate-runtime-placeholder-api\.invalid#${NEXT_PUBLIC_API_URL}#g" \
  -e "s#https://tollgate-runtime-placeholder-proxy\.invalid#${NEXT_PUBLIC_PROXY_URL}#g" \
  {} +

exec node frontend/dashboard/server.js
