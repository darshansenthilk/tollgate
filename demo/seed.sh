#!/usr/bin/env bash
# Tollgate demo — step 1: seed.sh
#
# Resets the demo Postgres/Redis to a clean slate and creates ONE demo agent
# (app name "chatgpt", a small maxBudgetCents so hammer.sh can exhaust it
# quickly), printing its one-time Tollgate token.
#
# Requires: docker (with the tollgate-postgres-1 / tollgate-redis-1 containers
# from `pnpm infra:up`), curl, node. The api service must be running and
# reachable (default http://localhost:4000 — `pnpm dev:api` or `pnpm dev`).
set -euo pipefail

API_URL="${API_URL:-http://localhost:4000}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-tollgate-postgres-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-tollgate-redis-1}"
DEMO_MAX_BUDGET_CENTS="${DEMO_MAX_BUDGET_CENTS:-2}"
DEMO_EMAIL="${DEMO_EMAIL:-demo@tollgate.local}"
DEMO_PASSWORD="${DEMO_PASSWORD:-tollgate-demo-password}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.demo-agent.json"
COOKIE_JAR="$SCRIPT_DIR/.demo-cookies.txt"

echo "== Tollgate demo: seed =="
echo ""

# --- Preflight: fail loud and early, not halfway through, with a clear fix ---
for bin in docker curl node; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "ERROR: '$bin' is required on PATH but wasn't found." >&2
    exit 1
  fi
done

if ! docker inspect "$POSTGRES_CONTAINER" >/dev/null 2>&1; then
  echo "ERROR: container '$POSTGRES_CONTAINER' not found. Run 'pnpm infra:up' first." >&2
  exit 1
fi
if ! docker inspect "$REDIS_CONTAINER" >/dev/null 2>&1; then
  echo "ERROR: container '$REDIS_CONTAINER' not found. Run 'pnpm infra:up' first." >&2
  exit 1
fi

if ! curl -sf --max-time 3 "$API_URL/health" >/dev/null; then
  echo "ERROR: api not reachable at $API_URL/health." >&2
  echo "        Start it with 'pnpm dev:api' (or 'pnpm dev') and re-run this script." >&2
  exit 1
fi

# --- Clean slate: this is the local dev/demo database, not shared/production.
#     Repeated demo runs must not accumulate agents from prior sessions. ---
echo "-- Wiping existing agents/policies/spend_events (dev DB only) --"
EXISTING=$(docker exec "$POSTGRES_CONTAINER" psql -U tollgate -d tollgate -tA -c "SELECT count(*) FROM agents;")
echo "   found $EXISTING pre-existing agent(s); removing"
docker exec "$POSTGRES_CONTAINER" psql -U tollgate -d tollgate -q \
  -c "DELETE FROM spend_events;" \
  -c "DELETE FROM agents;" \
  -c "DELETE FROM policies;"
docker exec "$REDIS_CONTAINER" sh -c "redis-cli --scan --pattern 'spend:*' | xargs -r redis-cli del" >/dev/null
docker exec "$REDIS_CONTAINER" sh -c "redis-cli --scan --pattern 'frozen:*' | xargs -r redis-cli del" >/dev/null
echo "   done"
echo ""

# --- Authenticate as a standing demo user. POST /v1/agents is session-gated
# and org/dashboard-scoped (requireAuth + resolveDashboardId), so a bare,
# unauthenticated create no longer works — it did when this script was first
# written, before dashboard scoping landed. Sign-in is tried first so reruns
# reuse the same user/org/dashboard rather than accumulating a new one per
# run; sign-up is the fallback for a genuinely first run. ---
echo "-- Authenticating as demo user ($DEMO_EMAIL) --"
rm -f "$COOKIE_JAR"
SIGNIN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" \
  -X POST "$API_URL/api/auth/sign-in/email" \
  -H "content-type: application/json" \
  -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}")
if [ "$SIGNIN_STATUS" != "200" ]; then
  echo "   no existing demo user; creating one"
  curl -sf -c "$COOKIE_JAR" -X POST "$API_URL/api/auth/sign-up/email" \
    -H "content-type: application/json" \
    -d "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\",\"name\":\"Demo\"}" >/dev/null
fi
echo "   done"
echo ""

# --- Resolve (or create) the demo dashboard. Every agent now belongs to one
# explicitly (see routes/agents.ts's resolveDashboardId) — there's no implicit
# "current" dashboard on the server side. ---
echo "-- Resolving demo dashboard --"
ACTIVE=$(curl -sf -b "$COOKIE_JAR" "$API_URL/v1/dashboards/active")
DASHBOARD_ID=$(echo "$ACTIVE" | node -e "process.stdin.once('data', d => { const v = JSON.parse(d).dashboard; console.log(v ? v.id : ''); })")
if [ -z "$DASHBOARD_ID" ]; then
  CREATED=$(curl -sf -b "$COOKIE_JAR" -X POST "$API_URL/v1/dashboards" \
    -H "content-type: application/json" \
    -d '{"name":"Demo"}')
  DASHBOARD_ID=$(echo "$CREATED" | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).id))")
  echo "   created dashboard $DASHBOARD_ID"
else
  echo "   reusing dashboard $DASHBOARD_ID"
fi
echo ""

# --- Create the demo agent ---
echo "-- Creating demo agent (providerSlug: chatgpt, maxBudgetCents: $DEMO_MAX_BUDGET_CENTS) --"
RESPONSE=$(curl -sf -b "$COOKIE_JAR" -X POST "$API_URL/v1/agents" \
  -H "content-type: application/json" \
  -d "{\"name\":\"demo-agent\",\"providerSlug\":\"chatgpt\",\"maxBudgetCents\":$DEMO_MAX_BUDGET_CENTS,\"dashboardId\":\"$DASHBOARD_ID\"}")

echo "$RESPONSE" > "$STATE_FILE"

# Parsed from $RESPONSE via stdin, not a file path argument — passing a
# Git-Bash POSIX path as a literal string into `node -e` gets mangled by
# MSYS's path translation (e.g. "/c/Users/..." -> "C:\c\Users\...").
AGENT_ID=$(echo "$RESPONSE" | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).id))")
TOKEN=$(echo "$RESPONSE" | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).token))")

echo ""
echo "=========================================================================="
echo " Demo agent created"
echo "   id:             $AGENT_ID"
echo "   maxBudgetCents:  $DEMO_MAX_BUDGET_CENTS  (\$0.0$DEMO_MAX_BUDGET_CENTS)"
echo ""
echo "   TOKEN (shown once — the api never returns it again):"
echo ""
echo "     $TOKEN"
echo "=========================================================================="
echo ""
echo "Saved to $STATE_FILE — hammer.sh and cleanup.sh pick it up automatically."
echo "Open http://localhost:3000 now: the dashboard should show exactly one"
echo "agent, 'demo-agent', at \$0.00 spend."
