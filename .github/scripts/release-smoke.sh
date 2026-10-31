#!/usr/bin/env bash
# The production smoke check at the end of .github/workflows/release.yml.
# Usage: release-smoke.sh [deployment id]
#
# It calls only data-free endpoints: Vercel's alias and runtime-log APIs, the
# login page signed out, and the PROD health edge function with its token. With
# a deployment id (a release) production must serve that build; without one (a
# dry run) it checks the build that serves now. The repository is public, so a
# failure names a status code, the deployment id or an error count, never a
# response body or a log message. Every check runs; any failure fails the step.
# Needs VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID, APP_URL, HEALTH_URL and
# HEALTH_CHECK_TOKEN.
set -euo pipefail

expected="${1:-}"
failures=0
fail() {
  echo "::error title=Production smoke check::$1"
  failures=$((failures + 1))
}

served="$(curl --fail --silent --show-error --max-time 30 -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v4/aliases/${APP_URL#https://}?teamId=${VERCEL_TEAM_ID}" | jq -r '.deploymentId // empty')" \
  || served=""
test -n "$served" || { echo "::error title=Production smoke check::Vercel named no deployment for ${APP_URL}."; exit 1; }
echo "${APP_URL} serves ${served}."
if test -n "$expected" && test "$served" != "$expected"; then
  fail "${APP_URL} serves ${served}, not the released ${expected}."
fi

# Signed out, the login page reads no data. It renders when the title and the password field are there.
page="$RUNNER_TEMP/login.html"
status="$(curl --silent --max-time 30 --output "$page" --write-out '%{http_code}' "${APP_URL}/login" || true)"
if test "$status" != 200; then
  fail "The login page answered HTTP ${status}."
elif ! grep -q '<title>Anmelden</title>' "$page" || ! grep -q 'type="password"' "$page"; then
  fail "The login page answered 200 without its title or password field."
else
  echo "The login page renders."
fi
rm -f "$page"

# The health edge function reports which PROD function secrets are missing, never their values.
if bash .github/scripts/health-check.sh supabase-function-prod endpoint HEALTH_CHECK_TOKEN "$HEALTH_URL"; then
  echo "The health edge function answers 200."
else
  failures=$((failures + 1))
fi

# The build's first minutes: let it serve, then count its runtime errors. Hobby log
# retention is short, so the window stays inside the last hour.
echo "Counting runtime errors of ${served} in 5 minutes."
sleep 300
report="$(npx --yes vercel@65 logs --project "$VERCEL_PROJECT_ID" --scope werkflows-projects --token "$VERCEL_TOKEN" \
  --deployment "$served" --query 'level:error OR level:fatal' --since 10m --limit 100 --json 2> /dev/null \
  | jq -c 'select(.type == "summary") | {count: .recordsReturned, more: .pagination.hasMore, gaps: (.excludedIntervals | length)}')" \
  || report=""
if test -z "$report"; then
  fail "Vercel's runtime-log report for ${served} could not be read."
else
  count="$(jq -r .count <<< "$report")"
  test "$(jq -r .more <<< "$report")" = false || count="more than ${count}"
  if test "$(jq -r .gaps <<< "$report")" != 0; then
    fail "Vercel's runtime-log report for ${served} leaves out intervals, so its error count (${count}) is incomplete."
  elif test "$count" != 0; then
    fail "${served} logged ${count} runtime errors in its last 10 minutes."
  else
    echo "${served} logged no runtime error in its last 10 minutes."
  fi
fi

test "$failures" = 0 || { echo "::error title=Production smoke check::${failures} of 4 checks failed for ${served}."; exit 1; }
echo "Production (${served}) passed the smoke check."
