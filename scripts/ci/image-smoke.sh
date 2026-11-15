#!/usr/bin/env bash
# Smoke-tests the two images built as fp-api:ci and fp-web:ci, on whatever architecture this runner is: ci.yml's
# images job runs it on amd64 and on arm64 (the production host's architecture, P8 PR 03).
# Usage: scripts/ci/image-smoke.sh <git-commit>
set -euo pipefail

commit=${1:?usage: image-smoke.sh <git-commit>}
tmp=${RUNNER_TEMP:-$(mktemp -d)}

# /api/health never touches the database, so dummy Supabase values are enough.
docker run -d --name api -p 8000:8000 -e APP_ENV=local -e SUPABASE_URL=http://127.0.0.1:1 \
  -e SUPABASE_SECRET_KEY=sb_secret_ci fp-api:ci
docker run -d --name web -p 8080:8080 -e API_UPSTREAM=http://127.0.0.1:1 \
  -e SUPABASE_URL=https://ci.supabase.co -e SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci fp-web:ci

for url in localhost:8000/api/health localhost:8080/healthz localhost:8080/runtime-env.js; do
  for _ in $(seq 1 20); do curl -fs -o /dev/null "$url" && break; sleep 1; done
  curl -fsS -o /dev/null -w "$url %{http_code}\n" "$url"
done
curl -fsS localhost:8000/api/health | grep -q "\"commit\":\"$commit\"" ||
  { echo "/api/health does not report commit $commit"; exit 1; }

# The web manifest goes out as a manifest (nginx's own MIME table says octet-stream).
curl -fsSI localhost:8080/manifest.webmanifest | grep -qi '^content-type: application/manifest+json' ||
  { echo "manifest served with the wrong content type"; exit 1; }

# nginx refuses a body over the API's 100 kB limit itself, in the API's JSON envelope.
head -c 200000 /dev/zero | tr '\0' 'x' > "$tmp/big.json"
code=$(curl -s -o "$tmp/413.json" -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
  --data-binary @"$tmp/big.json" localhost:8080/api/orders)
if [ "$code" != 413 ] || ! grep -q '"PAYLOAD_TOO_LARGE"' "$tmp/413.json"; then
  echo "nginx body limit: got $code"; cat "$tmp/413.json"; exit 1
fi

# Both images send the browser-hardening headers (server/src/middleware/securityHeaders.ts, client/nginx/).
for url in localhost:8000/api/health localhost:8080/healthz; do
  curl -fsSI "$url" | grep -qi '^x-frame-options: DENY' || { echo "$url: no X-Frame-Options"; exit 1; }
  curl -fsSI "$url" | grep -qi '^x-content-type-options: nosniff' || { echo "$url: no nosniff"; exit 1; }
done

# Exact to 0.1 MB: a rounded "50 MB (budget 50 MB)" once hid a 50.4 MB image that failed the check.
check() {
  size=$(docker image inspect --format '{{.Size}}' "$1")
  awk -v n="$1" -v s="$size" -v b="$2" 'BEGIN { printf "%s: %.1f MB (budget %d MB)\n", n, s / 1e6, b }'
  [ "$size" -le $(($2 * 1000000)) ]
}
check fp-web:ci 50
check fp-api:ci 300

# The image must be the runner's architecture, or the checks above proved nothing about the host's.
want=$(docker version --format '{{.Server.Arch}}')
for img in fp-api:ci fp-web:ci; do
  got=$(docker image inspect --format '{{.Architecture}}' "$img")
  [ "$got" = "$want" ] || { echo "$img is $got, runner is $want"; exit 1; }
done
echo "image smoke passed on $want"
