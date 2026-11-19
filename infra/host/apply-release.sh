#!/bin/bash
# Applies a release on the host (P8 PR 04). With candidate tags, those; with none, the tags the release parameter
# names (the last release that passed: a replaced host comes up on it). Pulls, starts, and waits for /api/ready through
# nginx. If it never answers, it returns to the parameter's tags and exits non-zero. It never writes the parameter:
# the deploy workflow does, after its public smoke passes (PR 07).
#
# The release parameter /khanha/<environment>/release holds "<web-tag> <server-tag>".
# Usage: apply-release.sh <environment> <image-prefix> [<web-tag> <server-tag>]
#   image-prefix: <account>.dkr.ecr.<region>.amazonaws.com/khanha (production's repositories)
set -euo pipefail

environment=${1:?usage: apply-release.sh <environment> <image-prefix> [<web-tag> <server-tag>]}
image_prefix=${2:?usage: apply-release.sh <environment> <image-prefix> [<web-tag> <server-tag>]}
here=$(cd "$(dirname "$0")" && pwd)
tries=${READY_TRIES:-60}
pause=${READY_PAUSE:-2}
# Each wait is capped so a candidate wait plus the rollback wait fit the SSM command's 900 s timeout.
limit=${READY_SECONDS:-300}

# Missing (before the first deploy) reads as empty; any other failure stops before a container changes.
if ! released=$(aws ssm get-parameter --name "/khanha/$environment/release" --query Parameter.Value --output text 2>&1); then
  case $released in
    *ParameterNotFound*) released= ;;
    *) echo "apply-release: cannot read the release parameter: $released" >&2; exit 1 ;;
  esac
fi

if [ -n "${3:-}" ] && [ -n "${4:-}" ]; then
  candidate="$3 $4"
else
  candidate=$released
fi

if [ -z "$candidate" ]; then
  echo "apply-release: no candidate and no release yet; nothing to apply"
  exit 0
fi

"${RENDER_ENV:-$here/render-env.sh}" "$environment"
aws ecr get-login-password | docker login --username AWS --password-stdin "${image_prefix%%/*}"

# $1: "<web-tag> <server-tag>"
up() {
  local web server
  read -r web server <<<"$1"
  echo "apply-release: starting web $web, server $server"
  IMAGE_PREFIX=$image_prefix WEB_TAG=$web SERVER_TAG=$server \
    docker compose -f "$here/compose.prod.yml" up -d --pull missing --remove-orphans
}

ready() {
  local deadline=$((SECONDS + limit))
  for _ in $(seq "$tries"); do
    if curl -fsS --max-time 5 -o /dev/null http://127.0.0.1/api/ready; then return 0; fi
    [ "$SECONDS" -lt "$deadline" ] || break
    sleep "$pause"
  done
  return 1
}

if up "$candidate" && ready; then
  echo "apply-release: ready"
  exit 0
fi

echo "apply-release: $candidate never became ready" >&2
if [ -n "$released" ] && [ "$released" != "$candidate" ]; then
  up "$released"
  if ready; then echo "apply-release: back on $released" >&2; else echo "apply-release: $released is not ready either" >&2; fi
fi
exit 1
