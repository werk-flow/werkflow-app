#!/usr/bin/env bash
# The switch step of .github/workflows/rollback.yml: app.werk-flow.app serves exactly the planned build.
# Usage: rollback-switch.sh <deployment id>
#
# It checks again that the build is ready, then asks Vercel for an Instant Rollback to it, the call
# Vercel's own rollback makes. Unlike a promote, a rollback stops Vercel from assigning the domain to
# newer production builds, so a build still finishing from a failed release cannot take the traffic
# back; the next release promotes its own build explicitly (release-promote.sh). It never rebuilds.
# A build the domain serves already is left as it is, so a retry resumes. Then it waits until the
# domain serves the build. Every call goes through vercel-api.sh.
# Needs VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.
set -euo pipefail
source "$(dirname "$0")/vercel-api.sh"

id="$1"
readonly api=https://api.vercel.com domain=app.werk-flow.app
team="teamId=${VERCEL_TEAM_ID}"

served() {
  vercel_api "${api}/v4/aliases/${domain}?${team}" | jq -r '.deploymentId // empty'
}

state="$(vercel_api "${api}/v13/deployments/${id}?${team}" | jq -r '.readyState | strings')" \
  || { echo "::error::Vercel did not report the build ${id}."; exit 1; }
test "$state" = READY || { echo "::error::The build ${id} is ${state:-unknown}, not READY; the rollback switches only to a ready build."; exit 1; }

if test "$(served)" = "$id"; then
  echo "${domain} serves ${id} already."
  exit 0
fi
vercel_api -X POST "${api}/v1/projects/${VERCEL_PROJECT_ID}/rollback/${id}?${team}&description=rollback.yml" > /dev/null \
  || { echo "::error::Vercel refused the rollback to ${id}."; exit 1; }
deadline=$((SECONDS + 300))
until test "$(served || true)" = "$id"; do
  test $SECONDS -lt $deadline || { echo "::error::${domain} does not serve ${id} 5 minutes after the rollback."; exit 1; }
  sleep 10
done
echo "${domain} serves ${id}."
