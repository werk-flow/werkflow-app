#!/usr/bin/env bash
# The plan step of .github/workflows/rollback.yml: which production build to go back to.
# Usage: rollback-target.sh [commit sha]
#
# Without a sha, the target is the newest ready production build older than the one the domain
# serves, with another commit: the previous release. With a sha, the target is the newest ready
# production build of exactly that commit, which `production` must contain, so only a commit that
# was released can come back. Either way the target is never the build that serves now, and it is
# among Vercel's newest 20 production builds, the ones release-promote.sh can find.
#
# It reads metadata only, through vercel-api.sh, and writes sha, deployment and served to
# $GITHUB_OUTPUT (stdout outside Actions). Needs VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID
# and origin/production fetched.
set -euo pipefail
source "$(dirname "$0")/vercel-api.sh"

wanted="${1:-}"
readonly api=https://api.vercel.com domain=app.werk-flow.app
team="teamId=${VERCEL_TEAM_ID}"

if test -n "$wanted"; then
  [[ "$wanted" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::Name the target as a full 40-character commit sha, not ${wanted}."; exit 1; }
  git merge-base --is-ancestor "$wanted" origin/production 2> /dev/null \
    || { echo "::error::production does not contain ${wanted}, so it was never released; a rollback only goes back to a released commit."; exit 1; }
fi

builds="$(vercel_api "${api}/v6/deployments?projectId=${VERCEL_PROJECT_ID}&${team}&target=production&limit=20")" \
  || { echo "::error::Vercel did not list the production builds."; exit 1; }
served="$(vercel_api "${api}/v4/aliases/${domain}?${team}" | jq -r '.deploymentId // empty')" \
  || { echo "::error::Vercel did not say which build ${domain} serves."; exit 1; }
test -n "$served" || { echo "::error::Vercel named no build for ${domain}."; exit 1; }

current="$(jq -c --arg id "$served" '[.deployments[] | select(.uid == $id)][0] // empty' <<< "$builds")"
test -n "$current" || { echo "::error::${domain} serves ${served}, which is not among the newest 20 production builds."; exit 1; }
current_sha="$(jq -r '.meta.githubCommitSha // empty' <<< "$current")"
current_created="$(jq -r '.created' <<< "$current")"

if test -n "$wanted"; then
  test "$wanted" != "$current_sha" || { echo "::error::${domain} already serves ${wanted} (${served})."; exit 1; }
  filter='select(.meta.githubCommitSha == $sha)'
else
  filter='select(.created < $created and (.meta.githubCommitSha // "") != "" and .meta.githubCommitSha != $current)'
fi
# Vercel lists the newest first.
target="$(jq -c --arg sha "$wanted" --arg current "$current_sha" --argjson created "$current_created" \
  "[.deployments[] | select(.state == \"READY\" or .readyState == \"READY\") | ${filter}][0] // empty" <<< "$builds")"
test -n "$target" || { echo "::error::No ready production build ${wanted:+of ${wanted} }among the newest 20 to go back to."; exit 1; }

sha="$(jq -r '.meta.githubCommitSha' <<< "$target")"
deployment="$(jq -r '.uid' <<< "$target")"
echo "${domain} serves ${current_sha} (${served}); the rollback goes back to ${sha} (${deployment})."
{
  echo "sha=${sha}"
  echo "deployment=${deployment}"
  echo "served=${served}"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
