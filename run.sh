#!/bin/bash
# Runs the images ./build.sh made: the API, the job worker and the web app, on their own compose network.
#   ./run.sh dev|staging          start (or update) and wait until all three are healthy
#   ./run.sh dev|staging down     stop and remove the containers and the network
#   ./run.sh dev|staging logs     follow the logs
#   ./run.sh dev|staging ps       status
#   ./run.sh dev|staging seed     reset the demo data through the image (wipes every order; asks first on staging)
# dev starts the local Supabase stack when it is not running. staging needs its migrations applied first
# (cd server && npm run db:push:staging).
set -euo pipefail
cd "$(dirname "$0")"
USAGE_EXTRA=' [up|down|logs|ps|seed]'
source scripts/docker-env.sh "${1:-}"

case "${2:-up}" in
  up)
    for image in "fp-api:$FP_ENV" "fp-web:$FP_ENV"; do
      docker image inspect "$image" > /dev/null 2>&1 || fail "$image is missing. Build it with: ./build.sh $FP_ENV"
    done
    if [ "$FP_ENV" = dev ] &&
      [ "$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' http://127.0.0.1:54321/rest/v1/)" = 000 ]; then
      echo "Starting the local Supabase stack…"
      (cd server && npm run db:start)
    fi
    "${COMPOSE[@]}" up -d --no-build --wait api worker web
    echo "Ready: http://localhost:$WEB_PORT (Supabase: $APP_ENV). Stop with: ./run.sh $FP_ENV down"
    ;;
  down) "${COMPOSE[@]}" down ;;
  logs) "${COMPOSE[@]}" logs -f ;;
  ps) "${COMPOSE[@]}" ps ;;
  seed)
    if [ "$FP_ENV" = staging ]; then
      read -r -p "Wipe every staging order and reset the demo data? Type 'staging' to continue: " answer
      [ "$answer" = staging ] || fail "Cancelled."
    fi
    "${COMPOSE[@]}" run --rm --no-deps api node dist/scripts/seed.js
    ;;
  *) fail "Usage: $0 dev|staging$USAGE_EXTRA" ;;
esac
