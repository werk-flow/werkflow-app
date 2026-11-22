#!/usr/bin/env bash
# The promotion step of .github/workflows/release.yml, after it advanced production.
# Usage: release-promote.sh <commit sha>
#
# Vercel builds production from the production branch. After an Instant Rollback it stops
# assigning the domain to new production builds, so the release promotes explicitly. The script
# waits for the production build of the commit; a failed or canceled build gets one redeploy, whose
# own id it then waits for: a rerun of the release pushes the same commit, which starts no build,
# and lands here too. Then it promotes the build, unless production already serves it, and waits
# until the domain serves it. The deployment id is its last line of output.
#
# Every call is Vercel's REST API through vercel-api.sh, which hands the token over as a config on
# a file descriptor (curl-headers.sh). No Vercel CLI runs: it would hold the token in a process that runs
# third-party code. A refused call fails with Vercel's reason, never leaves an empty id or state to poll.
# Needs VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.
set -euo pipefail
source "$(dirname "$0")/vercel-api.sh"

sha="$1"
readonly api=https://api.vercel.com domain=app.werk-flow.app
team="teamId=${VERCEL_TEAM_ID}"
query="projectId=${VERCEL_PROJECT_ID}&${team}&target=production&limit=20"

deadline=$((SECONDS + 1800))
id=""
redeployed=false
while :; do
  if test -z "$id"; then
    answer="$(vercel_api "${api}/v6/deployments?${query}")" \
      || { echo "::error::Vercel did not list the production builds."; exit 1; }
    id="$(jq -r --arg sha "$sha" '[.deployments[] | select(.meta.githubCommitSha == $sha)][0].uid // empty' <<< "$answer")"
  fi
  # The production build may not be listed yet; keep polling with an empty state.
  state=""
  if test -n "$id"; then
    answer="$(vercel_api "${api}/v13/deployments/${id}?${team}")" \
      || { echo "::error::Vercel did not report the production build ${id}."; exit 1; }
    state="$(jq -r '.readyState | strings' <<< "$answer")"
  fi
  case "$state" in
    READY) break ;;
    ERROR | CANCELED)
      if $redeployed; then echo "::error::The production build of ${sha} failed twice (${id})."; exit 1; fi
      echo "::warning::Production build ${id} ended ${state}; redeploying it once."
      request="$(jq -nc --arg id "$id" --arg project "$VERCEL_PROJECT_ID" \
        '{name: "werkflow-app", project: $project, deploymentId: $id, target: "production"}')"
      answer="$(vercel_api -X POST -H "Content-Type: application/json" --data "$request" \
        "${api}/v13/deployments?${team}&forceNew=1")" \
        || { echo "::error::Vercel did not redeploy ${id}."; exit 1; }
      id="$(jq -r '.id | strings' <<< "$answer")"
      test -n "$id" || { echo "::error::Vercel's answer names no redeploy of ${sha}."; exit 1; }
      redeployed=true ;;
  esac
  test $SECONDS -lt $deadline || { echo "::error::No ready production build of ${sha} after 30 minutes."; exit 1; }
  sleep 15
done

# The deployment the domain serves, or nothing when Vercel does not say. Optional: no rate-limit
# retries, so a 429 here never spends the job's time before the promote.
served() {
  VERCEL_API_RETRY_SECONDS=0 vercel_api "${api}/v4/aliases/${domain}?${team}" | jq -r '.deploymentId // empty'
}

# Vercel may already have assigned the domain to this build, and promoting the current production
# deployment fails with 409. A lookup that fails promotes as before.
if test "$(served || true)" = "$id"; then
  echo "Production already serves ${sha} (${id})."
else
  vercel_api -X POST "${api}/v10/projects/${VERCEL_PROJECT_ID}/promote/${id}?${team}" > /dev/null \
    || { echo "::error::Vercel did not promote ${id}."; exit 1; }
  # The promote answers before the domain moves; the smoke check expects it to serve the build.
  deadline=$((SECONDS + 300))
  until test "$(served || true)" = "$id"; do
    test $SECONDS -lt $deadline || { echo "::error::${domain} does not serve ${id} 5 minutes after the promote."; exit 1; }
    sleep 10
  done
  echo "Production serves ${sha} (${id})."
fi
echo "$id"
