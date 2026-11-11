#!/bin/bash
# Applies new files in supabase/migrations to a hosted Supabase project.
#   pnpm run db:push:staging
#   pnpm run db:push:production
# One-time: `pnpm exec supabase login` (opens the browser). The CLI asks for the project's database password,
# or reads it from SUPABASE_DB_PASSWORD. It lists the migrations it is about to apply and asks before applying them.

set -euo pipefail
cd "$(dirname "$0")/.."

# Project refs are not secret: they are the subdomain in each project's URL (https://<ref>.supabase.co).
STAGING_REF="xkddnlxeeizaqpefhqlv"
PRODUCTION_REF="" # set this after creating the production project (Project Settings → General → Project ID)

case "${1:-}" in
  staging) ref="$STAGING_REF" ;;
  production) ref="$PRODUCTION_REF" ;;
  *) echo "Usage: $0 staging|production"; exit 1 ;;
esac

if [ -z "$ref" ]; then
  echo "PRODUCTION_REF is empty. Create the production project, then set it in server/scripts/db-push.sh."
  exit 1
fi

if [ "$1" = "production" ]; then
  read -r -p "Push migrations to PRODUCTION ($ref)? Type 'production' to continue: " answer
  [ "$answer" = "production" ] || { echo "Cancelled."; exit 1; }
fi

pnpm exec supabase db push --project-ref "$ref"
