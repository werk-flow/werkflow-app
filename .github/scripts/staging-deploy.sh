#!/usr/bin/env bash
# The staging deploy of .github/workflows/staging.yml.
# Usage: staging-deploy.sh <commit sha>
#
# Asks Vercel for a Git-source deployment of this commit, not of the branch head: a newer
# commit on main waits for its own run's migrations. Vercel builds it as a preview with the
# pre-production (DEV) variables and moves the branch alias of main, the stable staging URL,
# when it is ready. A refused request fails at once with Vercel's reason (vercel-api.sh), so
# no step polls a deployment that was never created.
# Needs VERCEL_TOKEN and GITHUB_REPOSITORY_ID.
set -euo pipefail
source "$(dirname "$0")/vercel-api.sh"

sha="$1"
team="teamId=team_B8v4QHjpjZWyFXo6wkhiXkgN"
request="$(jq -n --arg sha "$sha" --argjson repo "$GITHUB_REPOSITORY_ID" '{name: "werkflow-app",
  project: "prj_h5ZIXgvJqyy4A7Qqy8Z0j9Ovo86R",
  gitSource: {type: "github", repoId: $repo, ref: "main", sha: $sha}}')"
answer="$(vercel_api -X POST -H "Content-Type: application/json" --data "$request" \
  "https://api.vercel.com/v13/deployments?${team}")" \
  || { echo "::error::Vercel did not create the staging deployment of ${sha}."; exit 1; }
id="$(jq -r '.id | strings' <<< "$answer")"
test -n "$id" || { echo "::error::Vercel's answer names no staging deployment of ${sha}."; exit 1; }
echo "Staging deployment ${id} of ${sha}."

deadline=$((SECONDS + 1200))
while :; do
  answer="$(vercel_api "https://api.vercel.com/v13/deployments/${id}?${team}")" \
    || { echo "::error::Vercel did not report the staging build ${id}."; exit 1; }
  state="$(jq -r '.readyState | strings' <<< "$answer")"
  case "$state" in
    READY) echo "Staging serves ${sha}."; exit 0 ;;
    ERROR | CANCELED) echo "::error::The staging build ${id} ended ${state}."; exit 1 ;;
  esac
  test $SECONDS -lt $deadline || { echo "::error::Staging build ${id} not ready after 20 minutes."; exit 1; }
  sleep 15
done
