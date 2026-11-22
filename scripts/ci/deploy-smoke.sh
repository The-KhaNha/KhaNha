#!/usr/bin/env bash
# The public smoke after a production deploy (P8 PR 07), through the same address phones use. Tested on every run of
# perf.yml against the compose stack, so the smoke is proven before it guards a deploy. No browser, no order:
# production gets no test orders.
# Usage: scripts/ci/deploy-smoke.sh <base-url> <git-commit> <supabase-url>
#   SMOKE_SECONDS (default 120): how long the new API may take to answer with this commit.
set -euo pipefail

base=${1:?usage: deploy-smoke.sh <base-url> <git-commit> <supabase-url>}
commit=${2:?usage: deploy-smoke.sh <base-url> <git-commit> <supabase-url>}
supabase=${3:?usage: deploy-smoke.sh <base-url> <git-commit> <supabase-url>}
base=${base%/}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "deploy-smoke: $*" >&2
  exit 1
}
# $1 path; prints the headers to $tmp/h and the body to $tmp/b, and the status code to stdout.
get() {
  curl -sS --max-time 10 -D "$tmp/h" -o "$tmp/b" -w '%{http_code}' "${@:2}" "$base$1"
}
# Never fails: a missing header is an empty string, which the checks below report.
header() { { grep -i "^$1:" "$tmp/h" || true; } | tail -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

# The host swaps containers in a few seconds; until then the old API (or none) answers.
deadline=$((SECONDS + ${SMOKE_SECONDS:-120}))
until [ "$(get /api/health 2>/dev/null)" = 200 ] && grep -q "\"commit\":\"$commit\"" "$tmp/b"; do
  [ "$SECONDS" -lt "$deadline" ] || fail "/api/health never reported commit $commit (last: $(cat "$tmp/b" 2>/dev/null))"
  sleep 3
done
echo "deploy-smoke: /api/health reports $commit"

[ "$(get /api/ready)" = 200 ] || fail "/api/ready is not 200: $(cat "$tmp/b")"

# index.html is never cached (a cached one would pin the old app), and the script it names loads, immutable.
[ "$(get /)" = 200 ] || fail "/ is not 200"
case $(header cache-control) in *no-cache* | *no-store*) ;; *) fail "/ is cacheable: $(header cache-control)" ;; esac
script=$({ grep -o 'src="/assets/[^"]*\.js"' "$tmp/b" || true; } | head -1 | cut -d'"' -f2)
[ -n "$script" ] || fail "/ names no script under /assets/"
[ "$(get "$script")" = 200 ] || fail "$script is not 200"
case $(header cache-control) in *immutable*) ;; *) fail "$script is not immutable: $(header cache-control)" ;; esac

[ "$(get /runtime-env.js)" = 200 ] || fail "/runtime-env.js is not 200"
grep -q "\"SUPABASE_URL\":\"$supabase\"" "$tmp/b" || fail "/runtime-env.js does not name $supabase"

# A public read, then the same read with its ETag: the 304 path phones poll on. An admin may change a flag in
# between (a 200 with a new ETag), so a few tries, each with the latest ETag.
[ "$(get /api/config)" = 200 ] || fail "/api/config is not 200"
for _ in 1 2 3; do
  etag=$(header etag)
  [ -n "$etag" ] || fail "/api/config has no ETag"
  code=$(get /api/config -H "If-None-Match: $etag")
  [ "$code" = 304 ] && break
  [ "$code" = 200 ] || fail "/api/config with its ETag is $code"
done
[ "$code" = 304 ] || fail "/api/config never answered 304 to its own ETag"

echo "deploy-smoke: passed at $base"
