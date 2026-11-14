#!/usr/bin/env bash
# The release's job `dev` (.github/workflows/release.yml), in a checkout of the candidate.
# Usage: dev-holds-migrations.sh
#
# DEV's migration ledger must hold the version of every migration in supabase/migrations.
# staging.yml applies them to DEV with the `supabase db push --include-all` the release then runs
# on PROD, so a migration that sorts before one already applied reaches PROD only after it reached
# DEV (docs/technical/environments.md, "The migration rule"). It reads DEV through the Management
# API's read-only query endpoint and prints versions only, never a response body: the repository
# is public. Needs SUPABASE_ACCESS_TOKEN and DEV_PROJECT_REF.
set -euo pipefail

committed="$(ls supabase/migrations | sed -nE 's/^([0-9]{14})_.+\.sql$/\1/p' | sort -u)"
test -n "$committed" || { echo "::error title=DEV migrations::supabase/migrations holds no migration."; exit 1; }
if ! ledger="$(curl --fail --silent --max-time 60 -X POST \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
  --data '{"query":"select version from supabase_migrations.schema_migrations order by version"}' \
  "https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query/read-only" \
  | jq -r '.[].version' 2> /dev/null | sort -u)"; then
  echo "::error title=DEV migrations::DEV's migration ledger could not be read, so the release applies nothing to PROD. Rerun the release once the Supabase API answers."
  exit 1
fi
missing="$(comm -23 <(echo "$committed") <(echo "$ledger"))"
if test -n "$missing"; then
  echo "::error title=DEV migrations::DEV lacks $(wc -l <<< "$missing" | tr -d ' ') migrations of this commit: $(paste -sd ' ' - <<< "$missing"). PROD receives a migration only after staging applied it to DEV. Wait for the staging run of this commit, or repair it, then release again."
  exit 1
fi
echo "DEV holds all $(wc -l <<< "$committed" | tr -d ' ') migrations of this commit."
