#!/bin/bash
# Starts the Food Pickup API and web app together.
#   ./start.sh          normal start
#   ./start.sh --seed   reset the sample data first (wipes existing orders)
# Press Ctrl+C once to stop both.
#
# What it does, in order:
#   - fails fast if server/.env is missing or PostgreSQL is not running
#   - installs node_modules for server/ and client/ if they are missing
#   - frees ports 8000 and 5173 (kills whatever is still listening there from an earlier run)
#   - optionally reseeds (--seed)
#   - starts both dev servers, logging to .logs/server.log and .logs/client.log
#   - waits until the API, the web app and GET /api/menu answer, then prints where to go
# It does NOT create the database or run migrations; see README.md "Quick start" for the one-time setup.

set -u
cd "$(dirname "$0")"

RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

# 1. Is the server configured?
if [ ! -f server/.env ]; then
  echo "${RED}server/.env is missing.${OFF}"
  echo "Create it with:  cp server/.env.example server/.env"
  echo "then set DATABASE_URL (your Mac username, see 'whoami') and JWT_SECRET (e.g. 'openssl rand -hex 32')."
  exit 1
fi

# 2. Is PostgreSQL up?
if ! pg_isready -q 2>/dev/null; then
  echo "${RED}PostgreSQL is not running.${OFF}"
  echo "Start it with:  brew services start postgresql@18   (or open Postgres.app)"
  exit 1
fi

# 3. Dependencies installed?
[ -d server/node_modules ] || (echo "${DIM}Installing server dependencies...${OFF}" && cd server && npm install --silent)
[ -d client/node_modules ] || (echo "${DIM}Installing web app dependencies...${OFF}" && cd client && npm install --silent)

# 4. Free the ports from any earlier run. Anything listening on 8000 or 5173 is killed.
for port in 8000 5173; do
  pids=$(lsof -ti:"$port" 2>/dev/null)
  [ -n "$pids" ] && echo "${DIM}Freeing port $port...${OFF}" && echo "$pids" | xargs kill 2>/dev/null
done
sleep 1

# 5. Optional reseed.
if [ "${1:-}" = "--seed" ]; then
  echo "${DIM}Reseeding sample data...${OFF}"
  (cd server && npm run seed) || { echo "${RED}Seeding failed.${OFF} Has the database been created and migrated? See README.md."; exit 1; }
fi

# 6. Start both servers.
mkdir -p .logs
(cd server && npm run dev > ../.logs/server.log 2>&1) &
SERVER_PID=$!
(cd client && npm run dev > ../.logs/client.log 2>&1) &
CLIENT_PID=$!

# cleanup [exit-code]: stops both servers, then exits (0 on Ctrl+C, non-zero on a failed start).
cleanup() {
  echo ""
  echo "${DIM}Stopping...${OFF}"
  kill $SERVER_PID $CLIENT_PID 2>/dev/null
  for port in 8000 5173; do lsof -ti:"$port" 2>/dev/null | xargs kill 2>/dev/null; done
  exit "${1:-0}"
}
trap cleanup INT TERM

http_status() {
  curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null
}

# 7. Wait for both servers to answer.
api_ok=""; web_ok=""
for i in $(seq 1 45); do
  api_ok=$(http_status http://localhost:8000/api/health)
  web_ok=$(http_status http://localhost:5173/)
  [ "$api_ok" = "200" ] && [ "$web_ok" = "200" ] && break
  sleep 1
done

if [ "$api_ok" != "200" ] || [ "$web_ok" != "200" ]; then
  echo "${RED}Something did not start.${OFF} Check .logs/server.log and .logs/client.log"
  echo "${DIM}Common causes: server/.env has a bad DATABASE_URL or the placeholder JWT_SECRET, or a port is still busy.${OFF}"
  cleanup 1
fi

# 8. The API is up, but is the database there and seeded? /api/menu needs the store and its items.
menu_ok=""
for i in 1 2 3; do
  menu_ok=$(http_status http://localhost:8000/api/menu)
  [ "$menu_ok" = "200" ] && break
  sleep 1
done

if [ "$menu_ok" != "200" ]; then
  echo "${RED}Database looks empty or unreachable — run ./start.sh --seed${OFF}"
  echo "${DIM}(GET /api/menu answered $menu_ok. First time here? Run 'createdb food_pickup' and, in server/, 'npx prisma migrate dev' first. Details in .logs/server.log)${OFF}"
  cleanup 1
fi

echo ""
echo "  ${BOLD}Food Pickup is running${OFF}"
echo ""
echo "  ${GREEN}Customer app${OFF}      http://localhost:5173"
echo "  ${GREEN}Staff dashboard${OFF}   http://localhost:5173/staff"
echo "  ${DIM}API${OFF}               http://localhost:8000"
echo ""
echo "  ${DIM}Customer login${OFF}    anishka@example.com / test1234"
echo "  ${DIM}Staff login${OFF}       staff@campuscafe.local / staff123"
echo ""
echo "  ${DIM}Logs: .logs/server.log and .logs/client.log${OFF}"
echo "  ${DIM}Press Ctrl+C to stop.${OFF}"
echo ""

wait
