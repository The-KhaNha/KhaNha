#!/bin/bash
# Applies new files in supabase/migrations to a hosted Supabase project.
#   pnpm run db:push:staging [-- --dry-run]
#   pnpm run db:push:production [-- --dry-run]
# One-time: `pnpm exec supabase login` (opens the browser). The CLI asks for the project's database password,
# or reads it from SUPABASE_DB_PASSWORD. It lists the migrations it is about to apply and asks before applying them.

set -euo pipefail
cd "$(dirname "$0")/.."

# Project refs are not secret: they are the subdomain in each project's URL (https://<ref>.supabase.co).
STAGING_REF="xkddnlxeeizaqpefhqlv"
PRODUCTION_REF="" # set this after creating the production project (Project Settings → General → Project ID)

env="${1:-}"
shift || true
# `pnpm run db:push:staging -- --dry-run` forwards the `--` too: drop it, or the CLI ignores the flags after it.
[ "${1:-}" = "--" ] && shift
case "$env" in
  staging) ref="$STAGING_REF" ;;
  production) ref="$PRODUCTION_REF" ;;
  *) echo "Usage: $0 staging|production [supabase db push flags]"; exit 1 ;;
esac

if [ -z "$ref" ]; then
  echo "PRODUCTION_REF is empty. Create the production project, then set it in server/scripts/db-push.sh."
  exit 1
fi

if [ "$env" = "production" ]; then
  read -r -p "Push migrations to PRODUCTION ($ref)? Type 'production' to continue: " answer
  [ "$answer" = "production" ] || { echo "Cancelled."; exit 1; }
fi

# The CLI's own "Target: … · production" line is Supabase's name for a project's main database, staging's included;
# it is not our environment. This line is.
echo "Environment: $env ($ref)"
# --remote is required: without it, CLI 3 pushes to the local database.
pnpm exec supabase db push --remote="$ref" "$@"
