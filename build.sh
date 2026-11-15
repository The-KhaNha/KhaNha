#!/bin/bash
# Builds the API and web images for an environment: fp-api:<env> and fp-web:<env>.
#   ./build.sh dev        images for the local Supabase stack
#   ./build.sh staging    images for the staging project
# Then start them with ./run.sh <env>.
#
# The images are the same code for every environment (the env file is applied by run.sh at start, never baked in);
# building per environment checks that environment's env files first and keeps its tag apart. The images install
# their own dependencies (pnpm install inside the Dockerfiles). The host needs node_modules only for the local Supabase CLI,
# so `dev` installs server/ when it is missing.
set -euo pipefail
cd "$(dirname "$0")"
source scripts/docker-env.sh "${1:-}"

if [ "$FP_ENV" = dev ] && [ ! -d server/node_modules ]; then
  (cd server && pnpm install --frozen-lockfile)
fi

# The commit GET /api/health reports; -dirty when the tree has uncommitted changes.
GIT_COMMIT=$(git rev-parse --short HEAD)
git diff --quiet HEAD || GIT_COMMIT+=-dirty
export GIT_COMMIT

"${COMPOSE[@]}" build api web
echo "Built fp-api:$FP_ENV and fp-web:$FP_ENV at $GIT_COMMIT. Start them with: ./run.sh $FP_ENV"
