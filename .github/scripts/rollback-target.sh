#!/usr/bin/env bash
# The plan of .github/workflows/rollback.yml: which production build to go back to.
# Usage: rollback-target.sh [commit sha]
#
# A target is a released commit, one `production` contains, with a build that served production:
# Vercel marks each such build a rollback candidate. Without a sha, the target is the nearest
# released ancestor of the commit the domain serves that has such a build: the previous release.
# With a sha, the target is that commit; when its build serves already, the run resumes on that
# build, whose edge functions may have failed. The build must be among Vercel's newest 20 candidates.
#
# The database never rolls back, and a migration marked `-- @destructive: after release <commit>`
# may drop what code before that commit still uses (docs/technical/environments.md, "The migration
# rule"). APPLIED_SHA is the newest commit whose migrations reached PROD (rollback.yml reads it from
# the release runs); every marker in its migrations names a commit the target must contain.
#
# It reads metadata only, through vercel-api.sh, and writes sha, deployment and served to
# $GITHUB_OUTPUT (stdout outside Actions). Needs VERCEL_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID,
# APPLIED_SHA and the history of origin/production and APPLIED_SHA.
set -euo pipefail
source "$(dirname "$0")/vercel-api.sh"

wanted="${1:-}"
readonly api=https://api.vercel.com domain=app.werk-flow.app
team="teamId=${VERCEL_TEAM_ID}"

released() {
  git merge-base --is-ancestor "$1" origin/production 2> /dev/null
}

if test -n "$wanted"; then
  [[ "$wanted" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::Name the target as a full 40-character commit sha, not ${wanted}."; exit 1; }
  released "$wanted" \
    || { echo "::error::production does not contain ${wanted}, so it was never released; a rollback only goes back to a released commit."; exit 1; }
fi
test -n "${APPLIED_SHA:-}" || { echo "::error::The newest commit whose migrations reached PROD is unknown; no target is safe without it."; exit 1; }

candidates="$(vercel_api "${api}/v6/deployments?projectId=${VERCEL_PROJECT_ID}&${team}&target=production&state=READY&rollbackCandidate=true&limit=20")" \
  || { echo "::error::Vercel did not list the production builds."; exit 1; }
served="$(vercel_api "${api}/v4/aliases/${domain}?${team}" | jq -r '.deploymentId // empty')" \
  || { echo "::error::Vercel did not say which build ${domain} serves."; exit 1; }
test -n "$served" || { echo "::error::Vercel named no build for ${domain}."; exit 1; }
current_sha="$(jq -r --arg id "$served" '[.deployments[] | select(.uid == $id)][0].meta.githubCommitSha // empty' <<< "$candidates")"
test -n "$current_sha" || { echo "::error::${domain} serves ${served}, which is not among the newest 20 production builds."; exit 1; }

# The newest build of a commit that served production, or the served build when it is of that commit.
build_of() {
  jq -r --arg sha "$1" --arg served "$served" \
    '[.deployments[] | select(.isRollbackCandidate == true and .meta.githubCommitSha == $sha) | .uid]
     | if index($served) then $served else (.[0] // empty) end' <<< "$candidates"
}

if test -n "$wanted"; then
  sha="$wanted"
  deployment="$(build_of "$sha")"
else
  # production only moves forward, so the served commit's ancestors are the earlier releases, nearest first.
  deployment=""
  while IFS= read -r sha; do
    released "$sha" || continue
    deployment="$(build_of "$sha")"
    test -z "$deployment" || break
  done < <(git rev-list "${current_sha}^" 2> /dev/null || true)
fi
test -n "$deployment" || { echo "::error::No released commit ${wanted:+${wanted} }has a build that served production among the newest 20 to go back to."; exit 1; }

# Each `@destructive: after release <commit>` marker (the syntax of lib/security/destructive-migrations.test.ts)
# in the migrations that reached PROD names a commit the target must contain. git grep exits 1 when
# nothing matches and higher when the scan fails.
status=0
markers="$(git grep -h -o -E -e '--[[:space:]]*@destructive:[[:space:]]*after release [0-9a-f]{7,40}' "$APPLIED_SHA" -- supabase/migrations)" || status=$?
test "$status" -le 1 || { echo "::error::The migrations of ${APPLIED_SHA} could not be read; no target is safe without them."; exit 1; }
for after in $(sed -E 's/.*after release ([0-9a-f]{7,40})$/\1/' <<< "$markers" | sort -u); do
  if ! git merge-base --is-ancestor "$after" "$sha" 2> /dev/null; then
    echo "::error::A migration in PROD drops what code before ${after} may use, and ${sha} lacks ${after}; go back no further than a release that contains it."
    exit 1
  fi
done

if test "$deployment" = "$served"; then
  echo "${domain} serves ${sha} (${deployment}) already; the rollback resumes with its edge functions."
else
  echo "${domain} serves ${current_sha} (${served}); the rollback goes back to ${sha} (${deployment})."
fi
{
  echo "sha=${sha}"
  echo "deployment=${deployment}"
  echo "served=${served}"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
