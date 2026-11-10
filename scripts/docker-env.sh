# Sourced by build.sh and run.sh: picks an environment's env files and sets the variables compose.yaml reads.
#   dev      the local Supabase stack, server/.env (APP_ENV=local), http://localhost:8080
#   staging  the staging project, server/.env.staging (APP_ENV=staging), http://localhost:8081
# Each runs as its own compose project (fp-dev, fp-staging) with its own containers, network and port, so both can
# run side by side.

fail() {
  echo "$*" >&2
  exit 1
}

# env_value <file> <NAME>: the last NAME= line of an env file, unquoted ("" when absent).
env_value() {
  grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' "
}

FP_ENV=${1:-}
case "$FP_ENV" in
  dev) API_ENV_FILE=server/.env CLIENT_ENV_FILE=client/.env.development APP_ENV=local WEB_PORT=8080 ;;
  staging) API_ENV_FILE=server/.env.staging CLIENT_ENV_FILE=client/.env.staging APP_ENV=staging WEB_PORT=8081 ;;
  *) fail "Usage: $0 dev|staging${USAGE_EXTRA:-}" ;;
esac

[ -f "$API_ENV_FILE" ] || fail "$API_ENV_FILE is missing (template: server/.env.example)."
# A placeholder secret fails at start; a placeholder SEED_* password would seed accounts with a known password.
if grep -nE '^[^#]*REPLACE_' "$API_ENV_FILE" | cut -d= -f1 | grep .; then
  fail "$API_ENV_FILE still has placeholder values (the lines above)."
fi
[ "$(env_value "$API_ENV_FILE" APP_ENV)" = "$APP_ENV" ] ||
  fail "$API_ENV_FILE must set APP_ENV=$APP_ENV for '$FP_ENV'."

SUPABASE_PUBLISHABLE_KEY=$(env_value "$CLIENT_ENV_FILE" VITE_SUPABASE_PUBLISHABLE_KEY)
[ -n "$SUPABASE_PUBLISHABLE_KEY" ] || fail "$CLIENT_ENV_FILE has no VITE_SUPABASE_PUBLISHABLE_KEY."
case "$SUPABASE_PUBLISHABLE_KEY" in
  *REPLACE_*) fail "$CLIENT_ENV_FILE has a placeholder VITE_SUPABASE_PUBLISHABLE_KEY." ;;
esac

unset API_SUPABASE_URL API_SUPABASE_JWKS_URL BROWSER_SUPABASE_URL
if [ "$FP_ENV" = staging ]; then
  API_SUPABASE_URL=$(env_value "$API_ENV_FILE" SUPABASE_URL)
  BROWSER_SUPABASE_URL=$(env_value "$CLIENT_ENV_FILE" VITE_SUPABASE_URL)
  # Two projects would make the API reject every sign-in (docs/DEPLOYMENT.md).
  # Empty on both sides would pass the equality and fall back to the local stack's URL in compose.yaml.
  [ -n "$API_SUPABASE_URL" ] || fail "$API_ENV_FILE has no SUPABASE_URL."
  [ "$API_SUPABASE_URL" = "$BROWSER_SUPABASE_URL" ] ||
    fail "$API_ENV_FILE and $CLIENT_ENV_FILE point at different Supabase projects."
  # Empty means unset: the API derives the signing keys' URL from an https SUPABASE_URL itself.
  API_SUPABASE_JWKS_URL=
  export API_SUPABASE_URL API_SUPABASE_JWKS_URL BROWSER_SUPABASE_URL
fi
export FP_ENV API_ENV_FILE WEB_PORT SUPABASE_PUBLISHABLE_KEY

docker info > /dev/null 2>&1 || fail "Docker is not running. Start Docker Desktop and try again."
COMPOSE=(docker compose -p "fp-$FP_ENV")
