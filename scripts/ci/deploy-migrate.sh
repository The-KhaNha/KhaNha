#!/usr/bin/env bash
# Pushes a release's migrations to production's database (deploy-production.yml, after the approval, before the host
# deploy; docs/DEPLOYMENT.md "Applying migrations"). Migrations only go forwards: when the database already has
# versions the release does not contain (an older tag redeployed, a rollback) and the release has nothing pending,
# nothing is pushed or reverted and the run goes on. If the release also has migrations the database lacks, the code
# would ship without its migration, so the run stops with an error and pushes nothing.
# Usage: scripts/ci/deploy-migrate.sh --check
#        scripts/ci/deploy-migrate.sh <project-ref> <release-server-dir>
# Reads SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD from the environment, where the CLI finds them; neither is
# ever printed or passed on a command line. No `set -x` here, ever.
set -euo pipefail

summary=${GITHUB_STEP_SUMMARY:-/dev/null}

missing=()
[ -n "${SUPABASE_ACCESS_TOKEN:-}" ] || missing+=(SUPABASE_ACCESS_TOKEN)
[ -n "${SUPABASE_DB_PASSWORD:-}" ] || missing+=(SUPABASE_DB_PASSWORD)
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::Missing ${missing[*]}: add them as secrets of the production Environment (docs/DEPLOYMENT.md)." >&2
  exit 1
fi
[ "${1:-}" = --check ] && exit 0

ref=${1:?usage: deploy-migrate.sh <project-ref> <release-server-dir>}
dir=${2:?usage: deploy-migrate.sh <project-ref> <release-server-dir>}
cd "$dir" || exit 1

# The one place that reads the CLI's output: `migration list` in JSON is {"migrations": [{local, remote, time}]},
# and a row with an empty `local` is a version the database has and this release lacks. Output that is not that
# shape fails jq and stops here; rows without an empty `local` count as none, and then `db push` itself refuses
# ("Remote migration versions not found"), so a misread stops the deploy instead of skipping a migration.
list=$(supabase migration list --remote="$ref" --output-format json)
newer=$(jq -r '[.migrations[] | select(.local == "") | .remote] | join(" ")' <<<"$list")
pending=$(jq '[.migrations[] | select(.remote == "")] | length' <<<"$list")
if [ -n "$newer" ]; then
  if [ "$pending" -gt 0 ]; then
    missing_in_db=$(jq -r '[.migrations[] | select(.remote == "") | .local] | join(" ")' <<<"$list")
    echo "::error::The database has migrations this release lacks ($newer) and the release has migrations the database lacks ($missing_in_db): nothing pushed. Deploy a release cut from a newer base." >&2
    echo "Migrations stopped: the database has ($newer) which this release lacks, and this release has ($missing_in_db) which the database lacks. Nothing was pushed or reverted." >>"$summary"
    exit 1
  fi
  echo "deploy-migrate: the database has migrations this release lacks ($newer): a rollback, nothing pushed"
  echo "Migrations skipped: the database is ahead of this release ($newer). Nothing was reverted." >>"$summary"
  exit 0
fi

# --yes: a hosted change needs it (or SUPABASE_YES) when there is no prompt. The candidate's migrations are the ones
# in this directory.
supabase db push --remote="$ref" --yes
echo "Migrations: $pending new, pushed to $ref." >>"$summary"
