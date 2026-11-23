#!/usr/bin/env bash
# The release's job `dev` (.github/workflows/release.yml), in a checkout of the candidate.
# Usage: dev-holds-migrations.sh
#
# DEV's migration ledger must hold the version of every migration in supabase/migrations.
# staging.yml applies them to DEV with the `supabase db push --include-all` the release then runs
# on PROD, so a migration that sorts before one already applied reaches PROD only after it reached
# DEV (docs/technical/environments.md, "The migration rule"). It reads DEV through the Management
# API's read-only query endpoint, which needs the token permission `database_read`. A failed read
# names the HTTP status and a fixed cause, never the response body: the repository is public.
# Anything but a list of 14-digit versions applies nothing to PROD.
# Needs SUPABASE_ACCESS_TOKEN and DEV_PROJECT_REF.
set -euo pipefail
source "$(dirname "$0")/curl-headers.sh"

fail() {
  echo "::error title=DEV migrations::$1"
  exit 1
}

unread() {
  fail "DEV's migration ledger could not be read (HTTP $1): $2 The release applies nothing to PROD."
}

committed="$(ls supabase/migrations | sed -nE 's/^([0-9]{14})_.+\.sql$/\1/p' | sort -u)"
test -n "$committed" || fail "supabase/migrations holds no migration."
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
sent=0
status="$(curl --silent --max-time 60 --output "$body" --write-out '%{http_code}' -X POST \
  --config <(curl_headers <<< "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}") -H 'Content-Type: application/json' \
  --data '{"query":"select version from supabase_migrations.schema_migrations order by version"}' \
  "https://api.supabase.com/v1/projects/${DEV_PROJECT_REF}/database/query/read-only")" || sent=$?
test "$sent" = 0 || unread "${status:-000}" "Supabase's answer did not arrive (curl exit ${sent}). Rerun the release once the Supabase API answers."
case "$status" in
  2??) ;;
  401) unread "$status" "Supabase rejected SUPABASE_ACCESS_TOKEN as expired, revoked or malformed. Replace the repository secret." ;;
  403) unread "$status" "SUPABASE_ACCESS_TOKEN may not run read-only queries on DEV. It needs the permission database_read on project ${DEV_PROJECT_REF}." ;;
  404) unread "$status" "Supabase found no project ${DEV_PROJECT_REF} or no read-only query endpoint for SUPABASE_ACCESS_TOKEN." ;;
  429) unread "$status" "Supabase rate-limited the token. Rerun the release in a few minutes." ;;
  5??) unread "$status" "Supabase failed to run the query. Rerun once; if it repeats, DEV's role supabase_read_only_user may lack access to supabase_migrations." ;;
  *) unread "$status" "Supabase gave an answer the release does not expect." ;;
esac
# Only a non-empty list of rows that each carry a 14-digit version counts as DEV's ledger.
ledger="$(jq -er 'if type == "array" and all(.[]; .version | type == "string" and test("^[0-9]{14}$")) then .[].version else error end' "$body" 2> /dev/null | sort -u)" \
  || unread "$status" "Supabase's answer holds no list of migration versions."
missing="$(comm -23 <(echo "$committed") <(echo "$ledger"))"
if test -n "$missing"; then
  fail "DEV lacks $(wc -l <<< "$missing" | tr -d ' ') migrations of this commit: $(paste -sd ' ' - <<< "$missing"). PROD receives a migration only after staging applied it to DEV. Wait for the staging run of this commit, or repair it, then release again."
fi
echo "DEV holds all $(wc -l <<< "$committed" | tr -d ' ') migrations of this commit."
