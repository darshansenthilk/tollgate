#!/usr/bin/env bash
# Tollgate demo — step 2: hammer.sh
#
# Repeatedly calls the proxy's real chat-completions route with the demo
# agent's token until Tollgate denies the request (403), or you freeze the
# agent by hand from the dashboard mid-run.
#
# Requires seed.sh to have been run first (reads demo/.demo-agent.json).
set -euo pipefail

PROXY_URL="${PROXY_URL:-http://localhost:8080}"
MAX_ITERATIONS="${MAX_ITERATIONS:-300}"
SLEEP_SECONDS="${SLEEP_SECONDS:-1}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$SCRIPT_DIR/.demo-agent.json"

if [ ! -f "$STATE_FILE" ]; then
  echo "ERROR: $STATE_FILE not found — run seed.sh first." >&2
  exit 1
fi

if ! curl -sf --max-time 3 "$PROXY_URL/health" >/dev/null; then
  echo "ERROR: proxy not reachable at $PROXY_URL/health." >&2
  echo "        Start it with 'pnpm dev:proxy' (or 'pnpm dev') and re-run this script." >&2
  exit 1
fi

# Read via stdin, not as a node -e path argument — see seed.sh for why
# (Git-Bash/MSYS mangles POSIX paths embedded inside a JS string literal).
TOKEN=$(cat "$STATE_FILE" | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).token))")

echo "== Tollgate demo: hammer =="
echo "POST $PROXY_URL/openai/v1/chat/completions repeatedly, using the demo token,"
echo "until Tollgate itself returns 403."
echo "Watch http://localhost:3000 — spend updates within its 3s poll."
echo ""

i=0
while [ "$i" -lt "$MAX_ITERATIONS" ]; do
  i=$((i + 1))

  RAW=$(curl -s -w '\n%{http_code}' -X POST "$PROXY_URL/openai/v1/chat/completions" \
    -H "content-type: application/json" \
    -H "authorization: Bearer $TOKEN" \
    -d '{"model":"gpt-4o-mini","max_tokens":300,"messages":[{"role":"user","content":"List three interesting facts about the ocean."}]}')
  STATUS=$(echo "$RAW" | tail -n1)
  BODY=$(echo "$RAW" | sed '$d')

  if [ "$STATUS" = "403" ]; then
    ERR=$(echo "$BODY" | node -e "process.stdin.once('data', d => { try { console.log(JSON.parse(d).error) } catch { console.log('?') } })")
    echo "[$i] 403 from Tollgate — error: $ERR"
    echo ""
    echo "Request denied before it ever reached OpenAI. Demo complete."
    exit 0
  fi

  SUMMARY=$(echo "$BODY" | node "$SCRIPT_DIR/parse-usage.mjs")
  echo "[$i] Tollgate allowed it — upstream HTTP $STATUS — $SUMMARY"
  sleep "$SLEEP_SECONDS"
done

echo ""
echo "Reached $MAX_ITERATIONS calls without a 403."
echo "If OPENAI_UPSTREAM_KEY in .env isn't a real, working key, every upstream call"
echo "is an OpenAI auth-error response with no 'usage' field, so Tollgate always"
echo "meters \$0 cost — spend can never cross the budget purely by looping. Either:"
echo "  1. put a real OPENAI_UPSTREAM_KEY in .env, restart the proxy, and re-run; or"
echo "  2. open http://localhost:3000 and click Freeze on demo-agent by hand —"
echo "     the very next call this script makes will then get a real 403."
exit 1
