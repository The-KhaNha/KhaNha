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
check MEDIA_UPSTREAM "${MEDIA_UPSTREAM:-}" yes
check MEDIA_UPLOAD_ORIGIN "${MEDIA_UPLOAD_ORIGIN:-}" no
check SUPABASE_URL "${SUPABASE_URL:-}" yes
check SUPABASE_PUBLISHABLE_KEY "${SUPABASE_PUBLISHABLE_KEY:-}" yes
check LOG_LEVEL "${LOG_LEVEL:-}" no
check REQUEST_TIMEOUT_MS "${REQUEST_TIMEOUT_MS:-}" no
# The three hosts (lib/hosts.ts), compared with location.host: a lower-case name and an optional port, never a URL.
# Unset, every section shares one origin.
for name in CUSTOMER_HOST STAFF_HOST ADMIN_HOST; do
  eval "value=\${$name:-}"
  # grep matches line by line, so a value with a line break could pass on its first line: refuse any line break first.
  case "$value" in *"
"*) fail "$name must be a host such as staff.example.com (one line)" ;; esac
  if [ -n "$value" ] && ! printf '%s' "$value" | grep -Eqx '[a-z0-9.-]+(:[0-9]+)?'; then
    fail "$name must be a host such as staff.example.com (no scheme, path or capitals)"
  fi
done

mkdir -p /tmp/runtime-env
printf 'window.__RUNTIME_ENV__={"SUPABASE_URL":"%s","SUPABASE_PUBLISHABLE_KEY":"%s","LOG_LEVEL":"%s","REQUEST_TIMEOUT_MS":"%s","CUSTOMER_HOST":"%s","STAFF_HOST":"%s","ADMIN_HOST":"%s"};\n' \
  "$SUPABASE_URL" "$SUPABASE_PUBLISHABLE_KEY" "${LOG_LEVEL:-}" "${REQUEST_TIMEOUT_MS:-}" \
  "${CUSTOMER_HOST:-}" "${STAFF_HOST:-}" "${ADMIN_HOST:-}" \
  > /tmp/runtime-env/runtime-env.js
echo "runtime-env: wrote /tmp/runtime-env/runtime-env.js"
