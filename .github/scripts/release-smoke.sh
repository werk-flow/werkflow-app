#!/usr/bin/env bash
# The production smoke check at the end of .github/workflows/release.yml.
# Usage: release-smoke.sh [deployment id]
#
# It reads metadata only: Vercel's alias and request counts, the login page
# signed out, and the PROD health edge function with its token. No call returns
# a log message, a request or a row. With a deployment id (a release) production
# must serve that build; without one (a dry run) it checks the build that serves
# now. The repository is public, so a failure names a status code, the
# deployment id or an error count, never a response body. Every check runs; any
# failure fails the step.
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
loaded=0
status="$(curl --silent --max-time 30 --output "$page" --write-out '%{http_code}' "${APP_URL}/login")" || loaded=$?
if test "$status" != 200; then
  fail "The login page answered HTTP ${status}."
elif test "$loaded" != 0; then
  fail "The login page answered 200 but did not finish loading (curl exit ${loaded})."
elif ! grep -q '<title>Anmelden</title>' "$page" || ! grep -q 'type="password"' "$page"; then
  fail "The login page answered 200 without its title or password field."
else
  echo "The login page renders."
fi
rm -f "$page"

# The health edge function reports which PROD function secrets are missing, never their values.
if bash .github/scripts/health-check.sh prod supabase-function-prod endpoint HEALTH_CHECK_TOKEN "$HEALTH_URL"; then
  echo "The health edge function answers 200."
else
  failures=$((failures + 1))
fi

# The build's first minutes: let it serve, then count the requests it answered, per status.
# Vercel's request metric holds counts per status and code, never a message. This check's own
# login request falls in the window, so a response without any row is missing data, never
# zero errors.
echo "Waiting 5 minutes, then counting the server errors of ${served} in the last 15 minutes."
sleep 300
# jq, not GNU date -d, takes the window's minutes, so the unit test runs it on macOS too.
query="$(jq -cn --arg team "$VERCEL_TEAM_ID" --arg project "$VERCEL_PROJECT_ID" --arg id "$served" '
  def minute: strftime("%Y-%m-%dT%H:%M:00Z");
  now as $now | {
    scope: {ownerId: $team, projectIds: [$project]},
    timeRange: {start: ($now - 15 * 60 | minute), end: ($now | minute)}, bucketSeconds: 300,
    filter: "deploymentId:\($id)", groupBy: ["httpStatus"],
    metrics: {value: {metric: "vercel.request.count", aggregation: "count"}}, outputs: ["value"],
    seriesSelection: {limit: 100, mode: "exact", rankBy: [{metric: "value", direction: "desc"}]}}')"
response="$(curl --fail --silent --show-error --max-time 60 -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H 'Content-Type: application/json' --data "$query" "https://api.vercel.com/metrics/v1?teamId=${VERCEL_TEAM_ID}")" \
  || response=""
# Every row needs a status and a numeric count; anything else is unreadable, never zero.
count="$(jq -er '.summary | arrays | select(length > 0)
  | if all(.[]; (.dimensions.httpStatus | type) == "string" and (.values.value | type) == "number")
    then [.[] | select((.dimensions.httpStatus | tonumber) >= 500) | .values.value] | add // 0
    else error("unreadable row") end' <<< "$response" 2> /dev/null)" || count=""
if test -z "$count"; then
  if jq -e '.summary | arrays | length == 0' <<< "$response" > /dev/null 2>&1; then
    fail "Vercel counts no request of ${served} in the last 15 minutes, not even this check's login page, so its server errors are unknown."
  else
    fail "Vercel's request counts for ${served} could not be read."
  fi
elif test "$count" != 0; then
  fail "${served} answered ${count} requests with a server error in the last 15 minutes."
else
  echo "${served} answered no request with a server error in the last 15 minutes."
fi

test "$failures" = 0 || { echo "::error title=Production smoke check::${failures} of 4 checks failed for ${served}."; exit 1; }
echo "Production (${served}) passed the smoke check."
