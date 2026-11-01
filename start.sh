#!/bin/bash
# Starts the Food Pickup API, the job worker and the web app together.
#   ./start.sh          normal start
#   ./start.sh --seed   reset the sample data first (wipes existing orders)
# Press Ctrl+C once to stop all three.
#
# server/.env decides which Supabase project is used (APP_ENV=local or staging); the web app is started in the
# matching Vite mode so the browser signs in to the same project. It refuses APP_ENV=production.
#
# What it does, in order:
#   - fails fast if server/.env is missing, or (local) the Supabase stack is not running
#   - installs node_modules for server/ and client/ if they are missing
#   - frees the API, worker and web ports (PORT and WORKER_HEALTH_PORT in server/.env, VITE_DEV_PORT in the client's
#     env file; default 8000, 8001 and 5173): kills whatever is still listening there from an earlier run
#   - optionally reseeds (--seed)
#   - starts the API, the worker and the web app, logging to .logs/server.log, .logs/worker.log and .logs/client.log
#   - waits until the API, the worker's /health, the web app and GET /api/menu answer, then prints where to go
# It does NOT start Supabase or apply migrations; see README.md "Quick start" for the one-time setup.

set -u
cd "$(dirname "$0")"

RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

# 1. Is the server configured?
if [ ! -f server/.env ]; then
  echo "${RED}server/.env is missing.${OFF}"
  echo "Create it with:  cp server/.env.example server/.env"
  echo "The defaults in it use the local Supabase stack (start it with: cd server && npm run db:start)."
  exit 1
fi

# env_value <file> <NAME>: the last NAME= line of an env file, unquoted ("" when absent).
env_value() {
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' "
}

# 2. Which Supabase project, and is it reachable?
APP_ENV=$(env_value server/.env APP_ENV)
API_PORT=$(env_value server/.env PORT); API_PORT=${API_PORT:-8000}
WORKER_PORT=$(env_value server/.env WORKER_HEALTH_PORT); WORKER_PORT=${WORKER_PORT:-8001}
SUPABASE_URL=$(env_value server/.env SUPABASE_URL); SUPABASE_URL=${SUPABASE_URL%/}
case "$APP_ENV" in
  local)
    CLIENT_DEV_SCRIPT=dev
    CLIENT_ENV_FILE=client/.env.development
    if [ "$(curl -s -o /dev/null -w '%{http_code}' "$SUPABASE_URL/rest/v1/" 2>/dev/null)" = "000" ]; then
      echo "${RED}The local Supabase stack is not running.${OFF}"
      echo "Start it with:  cd server && npm run db:start   (needs Docker; the first run downloads images)"
      exit 1
    fi
    ;;
  staging)
    CLIENT_DEV_SCRIPT=dev:staging
    CLIENT_ENV_FILE=client/.env.staging
    ;;
  production)
    echo "${RED}server/.env has APP_ENV=production.${OFF} start.sh is for local and staging only."
    exit 1
    ;;
  *)
    echo "${RED}server/.env must set APP_ENV to local or staging${OFF} (found '${APP_ENV}'). See server/.env.example."
    exit 1
    ;;
esac
WEB_PORT=$(env_value "$CLIENT_ENV_FILE" VITE_DEV_PORT); WEB_PORT=${WEB_PORT:-5173}

# 3. Dependencies installed?
[ -d server/node_modules ] || (echo "${DIM}Installing server dependencies...${OFF}" && cd server && npm install --silent)
[ -d client/node_modules ] || (echo "${DIM}Installing web app dependencies...${OFF}" && cd client && npm install --silent)

# 4. Free the ports from any earlier run. Anything listening on the API, worker or web port is killed.
for port in "$API_PORT" "$WORKER_PORT" "$WEB_PORT"; do
  pids=$(lsof -ti:"$port" 2>/dev/null)
  [ -n "$pids" ] && echo "${DIM}Freeing port $port...${OFF}" && echo "$pids" | xargs kill 2>/dev/null
done
sleep 1

# 5. Optional reseed.
if [ "${1:-}" = "--seed" ]; then
  echo "${DIM}Reseeding sample data...${OFF}"
  (cd server && npm run seed) || { echo "${RED}Seeding failed.${OFF} Has the database been created and migrated? See README.md."; exit 1; }
fi

# 6. Start the API, the worker and the web app.
mkdir -p .logs
(cd server && npm run dev > ../.logs/server.log 2>&1) &
SERVER_PID=$!
(cd server && npm run dev:worker > ../.logs/worker.log 2>&1) &
WORKER_PID=$!
# The dev proxy follows the API's port unless the client's env file names its own target.
(cd client && VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://localhost:$API_PORT}" \
  npm run "$CLIENT_DEV_SCRIPT" > ../.logs/client.log 2>&1) &
CLIENT_PID=$!

# kill_tree <pid>: the process and everything under it (npm → sh → tsx watch → node). Killing only the top and the
# port's listener left `tsx watch` behind, and a later file save restarted a hidden API or worker.
kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null
}

# cleanup [exit-code]: stops all three, then exits (0 on Ctrl+C, non-zero on a failed start).
cleanup() {
  echo ""
  echo "${DIM}Stopping...${OFF}"
  for pid in $SERVER_PID $WORKER_PID $CLIENT_PID; do kill_tree "$pid"; done
  for port in "$API_PORT" "$WORKER_PORT" "$WEB_PORT"; do lsof -ti:"$port" 2>/dev/null | xargs kill 2>/dev/null; done
  exit "${1:-0}"
}
trap cleanup INT TERM

http_status() {
  curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null
}

# 7. Wait for all three to answer.
api_ok=""; worker_ok=""; web_ok=""
for i in $(seq 1 45); do
  api_ok=$(http_status http://localhost:$API_PORT/api/health)
  worker_ok=$(http_status http://localhost:$WORKER_PORT/health)
  web_ok=$(http_status http://localhost:$WEB_PORT/)
  [ "$api_ok" = "200" ] && [ "$worker_ok" = "200" ] && [ "$web_ok" = "200" ] && break
  sleep 1
done

if [ "$api_ok" != "200" ] || [ "$worker_ok" != "200" ] || [ "$web_ok" != "200" ]; then
  echo "${RED}Something did not start.${OFF} Check .logs/server.log, .logs/worker.log and .logs/client.log"
  echo "${DIM}Common causes: server/.env is missing SUPABASE_URL / SUPABASE_SECRET_KEY, or a port is still busy.${OFF}"
  cleanup 1
fi

# 8. The API is up, but is the database there and seeded? /api/menu needs the store and its items.
menu_ok=""
for i in 1 2 3; do
  menu_ok=$(http_status http://localhost:$API_PORT/api/menu)
  [ "$menu_ok" = "200" ] && break
  sleep 1
done

if [ "$menu_ok" != "200" ]; then
  echo "${RED}Database looks empty or unreachable — run ./start.sh --seed${OFF}"
  echo "${DIM}(GET /api/menu answered $menu_ok. First time on staging? Apply the migrations with 'cd server && npm run db:push:staging' first. Details in .logs/server.log)${OFF}"
  cleanup 1
fi

echo ""
echo "  ${BOLD}Food Pickup is running${OFF} ${DIM}(Supabase: $APP_ENV)${OFF}"
echo ""
echo "  ${GREEN}Customer app${OFF}      http://localhost:$WEB_PORT"
echo "  ${GREEN}Staff dashboard${OFF}   http://localhost:$WEB_PORT/staff"
echo "  ${DIM}API${OFF}               http://localhost:$API_PORT"
echo "  ${DIM}Worker health${OFF}     http://localhost:$WORKER_PORT/health"
echo ""
echo "  ${DIM}Customer login${OFF}    anishka@example.com / test1234"
echo "  ${DIM}Staff login${OFF}       staff@campuscafe.local / staff123"
echo ""
echo "  ${DIM}Logs: .logs/server.log, .logs/worker.log and .logs/client.log${OFF}"
echo "  ${DIM}Press Ctrl+C to stop.${OFF}"
echo ""

wait
