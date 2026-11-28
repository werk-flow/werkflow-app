#!/usr/bin/env bash
# The plan step of .github/workflows/rollback.yml: which production build to go back to.
# Usage: rollback-target.sh [commit sha]
#
# Only a build that served production qualifies: Vercel marks each one a rollback candidate. Without
# a sha, the target is the newest candidate older than the build the domain serves, with another
# commit: the previous release. With a sha, the target is that commit's newest candidate, and
# `production` must contain the commit. A sha whose build serves already resumes a rollback whose
# edge functions failed. Either way the target is among Vercel's newest 20 candidates.
#
# The database never rolls back, and a migration marked `-- @destructive: after release <commit>`
# may drop what code before that commit still uses (docs/technical/environments.md, "The migration
# rule"). Every marked migration on main counts, applied to PROD or not, so a target that lacks a
# named commit is refused.
#
# It reads metadata only, through vercel-api.sh, and writes sha, deployment, served and resume to
# $GITHUB_OUTPUT (stdout outside Actions). Needs VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID,
# origin/production fetched and main checked out.
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

candidates="$(vercel_api "${api}/v6/deployments?projectId=${VERCEL_PROJECT_ID}&${team}&target=production&state=READY&rollbackCandidate=true&limit=20")" \
  || { echo "::error::Vercel did not list the production builds."; exit 1; }
served="$(vercel_api "${api}/v4/aliases/${domain}?${team}" | jq -r '.deploymentId // empty')" \
  || { echo "::error::Vercel did not say which build ${domain} serves."; exit 1; }
test -n "$served" || { echo "::error::Vercel named no build for ${domain}."; exit 1; }

current="$(jq -c --arg id "$served" '[.deployments[] | select(.uid == $id)][0] // empty' <<< "$candidates")"
test -n "$current" || { echo "::error::${domain} serves ${served}, which is not among the newest 20 production builds."; exit 1; }
current_sha="$(jq -r '.meta.githubCommitSha // empty' <<< "$current")"
current_created="$(jq -r '.created' <<< "$current")"

# Vercel lists the newest first.
if test -n "$wanted"; then
  filter='select(.meta.githubCommitSha == $sha)'
else
  filter='select(.created < $created and (.meta.githubCommitSha // "") != "" and .meta.githubCommitSha != $current)'
fi
target="$(jq -c --arg sha "$wanted" --arg current "$current_sha" --argjson created "$current_created" \
  "[.deployments[] | select(.isRollbackCandidate == true) | ${filter}][0] // empty" <<< "$candidates")"
test -n "$target" || { echo "::error::No production build ${wanted:+of ${wanted} }that served before is among the newest 20 to go back to."; exit 1; }
sha="$(jq -r '.meta.githubCommitSha' <<< "$target")"
deployment="$(jq -r '.uid' <<< "$target")"
# A named sha whose build serves is a retry: the domain stays, the edge functions deploy again.
resume=false
if test "$deployment" = "$served"; then resume=true; fi

# Each `@destructive: after release <commit>` marker on main names a commit the target must contain.
while IFS= read -r marker; do
  test -n "$marker" || continue
  file="${marker%%:*}"
  after="$(sed -E 's/.*@destructive: after release ([0-9a-f]{7,40}).*/\1/' <<< "${marker#*:}")"
  if ! git merge-base --is-ancestor "$after" "$sha" 2> /dev/null; then
    echo "::error::${file} drops what code before ${after} may use, and ${sha} lacks ${after}; go back no further than a release that contains it."
    exit 1
  fi
done < <(git grep -E -e '-- @destructive: after release [0-9a-f]{7,40}' HEAD -- supabase/migrations | sed 's/^HEAD://' || true)

if $resume; then
  echo "${domain} serves ${sha} (${deployment}) already; the rollback resumes with its edge functions."
else
  echo "${domain} serves ${current_sha} (${served}); the rollback goes back to ${sha} (${deployment})."
fi
{
  echo "sha=${sha}"
  echo "deployment=${deployment}"
  echo "served=${served}"
  echo "resume=${resume}"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
