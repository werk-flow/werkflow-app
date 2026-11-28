#!/usr/bin/env bash
# The commit app.werk-flow.app serves, for the release gate (.github/scripts/release-candidate.sh):
# after a rollback it differs from the head of `production`, and a scheduled release holds.
# Usage: served-commit.sh    Writes sha=<commit> to $GITHUB_OUTPUT (stdout outside Actions).
# Metadata only, through vercel-api.sh. Needs VERCEL_TOKEN and VERCEL_TEAM_ID.
set -euo pipefail
source "$(dirname "$0")/vercel-api.sh"

readonly api=https://api.vercel.com domain=app.werk-flow.app
team="teamId=${VERCEL_TEAM_ID}"
id="$(vercel_api "${api}/v4/aliases/${domain}?${team}" | jq -r '.deploymentId // empty')" \
  || { echo "::error::Vercel did not say which build ${domain} serves."; exit 1; }
test -n "$id" || { echo "::error::Vercel named no build for ${domain}."; exit 1; }
sha="$(vercel_api "${api}/v13/deployments/${id}?${team}" | jq -r '.meta.githubCommitSha // empty')" \
  || { echo "::error::Vercel did not report the build ${id}."; exit 1; }
test -n "$sha" || { echo "::error::The build ${id} names no commit."; exit 1; }
echo "${domain} serves ${sha} (${id})."
echo "sha=${sha}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
