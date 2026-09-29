#!/bin/sh
# Writes /runtime-env.js from the container's environment, so one image serves every environment. Runs from the
# nginx image's entrypoint (after the templates are rendered) and fails the start on a missing or unsafe value.
set -eu

fail() {
  echo "runtime-env: $1" >&2
  exit 1
}

check() {
  name=$1
  value=$2
  required=$3
  if [ -z "$value" ] && [ "$required" = yes ]; then fail "$name must be set"; fi
  case "$value" in
    *\"* | *\\* | *"<"* | *"'"*) fail "$name must not contain quotes, backslashes or <" ;;
  esac
}

check API_UPSTREAM "${API_UPSTREAM:-}" yes
check SUPABASE_URL "${SUPABASE_URL:-}" yes
check SUPABASE_PUBLISHABLE_KEY "${SUPABASE_PUBLISHABLE_KEY:-}" yes
check LOG_LEVEL "${LOG_LEVEL:-}" no
check REQUEST_TIMEOUT_MS "${REQUEST_TIMEOUT_MS:-}" no

mkdir -p /tmp/runtime-env
printf 'window.__RUNTIME_ENV__={"SUPABASE_URL":"%s","SUPABASE_PUBLISHABLE_KEY":"%s","LOG_LEVEL":"%s","REQUEST_TIMEOUT_MS":"%s"};\n' \
  "$SUPABASE_URL" "$SUPABASE_PUBLISHABLE_KEY" "${LOG_LEVEL:-}" "${REQUEST_TIMEOUT_MS:-}" \
  > /tmp/runtime-env/runtime-env.js
echo "runtime-env: wrote /tmp/runtime-env/runtime-env.js"
