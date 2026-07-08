#!/usr/bin/env bash
# Tollgate demo — step 3: cleanup.sh
#
# Removes the demo agent so repeated demo runs don't clutter the dashboard.
# There is no DELETE /v1/agents/:id endpoint yet (still a 501 stub in
# api/src/routes/stubs.ts), so this goes straight at Postgres/Redis — scoped
# to the exact agent id seed.sh recorded, not a name match, so it never
# touches an unrelated agent.
set -euo pipefail

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-tollgate-postgres-1}"
REDIS_CONTAINER="${REDIS_CONTAINER:-tollgate-redis-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.demo-agent.json"

echo "== Tollgate demo: cleanup =="

if [ ! -f "$STATE_FILE" ]; then
  echo "No $STATE_FILE found — nothing to clean up."
  exit 0
fi

AGENT_ID=$(cat "$STATE_FILE" | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).id))")
echo "Removing demo agent $AGENT_ID"

POLICY_ID=$(docker exec "$POSTGRES_CONTAINER" psql -U tollgate -d tollgate -tA \
  -c "SELECT policy_id FROM agents WHERE id = '$AGENT_ID';")

docker exec "$POSTGRES_CONTAINER" psql -U tollgate -d tollgate -q \
  -c "DELETE FROM spend_events WHERE agent_id = '$AGENT_ID';" \
  -c "DELETE FROM agents WHERE id = '$AGENT_ID';"

if [ -n "$POLICY_ID" ]; then
  docker exec "$POSTGRES_CONTAINER" psql -U tollgate -d tollgate -q \
    -c "DELETE FROM policies WHERE id = '$POLICY_ID';"
fi

CURRENT_MONTH=$(date -u +%Y-%m)
docker exec "$REDIS_CONTAINER" redis-cli DEL "spend:${AGENT_ID}:${CURRENT_MONTH}" "frozen:${AGENT_ID}" >/dev/null

rm -f "$STATE_FILE"

echo "Done. GET /v1/agents should now return an empty list."
