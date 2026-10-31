#!/usr/bin/env bash
# The release decision for .github/workflows/release.yml, on the checked-out main commit.
# Usage: release-candidate.sh <manual|scheduled|dry-run>
#
# Writes sha, verified (a green full run exists) and release (the run goes on) to
# $GITHUB_OUTPUT. A manual release always goes on. A scheduled one goes on only when
# main moved since production and its newest full run is green, or it has none yet and
# the release runs its own. A dry run decides like a scheduled run and changes nothing.
# Needs GH_TOKEN, GITHUB_REF, GITHUB_REPOSITORY, and origin/production fetched.
set -euo pipefail

mode="$1"
case "$mode" in manual | scheduled | dry-run) ;; *) echo "::error::Unknown mode ${mode}."; exit 1 ;; esac

test "$GITHUB_REF" = refs/heads/main \
  || { echo "::error::A release starts on main, not ${GITHUB_REF}."; exit 1; }
sha="$(git rev-parse HEAD)"
echo "sha=$sha" >> "$GITHUB_OUTPUT"
git merge-base --is-ancestor origin/production "$sha" \
  || { echo "::error::production is not an ancestor of main; it only ever moves forward."; exit 1; }

skip() {
  echo "release=false" >> "$GITHUB_OUTPUT"
  echo "::notice title=No release::$1"
  exit 0
}

if test "$mode" != manual && test -z "$(git rev-list origin/production.."$sha")"; then
  skip "main (${sha}) equals production; nothing to release."
fi

# A full run is ci.yml called with `full` from a job named `Full run`, so its aggregate
# job is `Full run / Check` (.github/workflows/nightly.yml). Only a nightly or release run
# on main counts: their workflow files come from the commit itself, so no other branch
# can stand in for one. The newest completed full run decides; a later failure replaces a pass.
runs="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=${sha}&branch=main&per_page=100" \
  --jq '.workflow_runs[] | select(.head_branch == "main"
    and (.path == ".github/workflows/nightly.yml" or .path == ".github/workflows/release.yml")
    and (.event == "schedule" or .event == "workflow_dispatch")) | .id')"
# A failed request stops the gate: a missing run could be the newest, failed one.
latest="$(for run in $runs; do
  gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/runs/${run}/jobs?per_page=100" \
    --jq '.jobs[] | select(.name == "Full run / Check" and .status == "completed") | "\(.completed_at) \(.conclusion) \(.html_url)"' \
    || exit 1
done | sort | tail -n 1)"
echo "Newest full run on ${sha}: ${latest:-none}"
conclusion="$(echo "$latest" | cut -d ' ' -f 2)"

if test "$conclusion" = success; then
  verified=true
  plan="reuses its green full run"
elif test "$mode" != manual && test -n "$latest"; then
  # A scheduled release never reruns a red full run until it passes; main is repaired through a PR.
  skip "The newest full run on main (${sha}) ended ${conclusion}: $(echo "$latest" | cut -d ' ' -f 3)"
else
  verified=false
  plan="runs the full suite first and ships only on green"
fi
echo "verified=$verified" >> "$GITHUB_OUTPUT"
echo "release=true" >> "$GITHUB_OUTPUT"

if test "$mode" = dry-run; then
  echo "::notice title=Dry run::A scheduled release would ship ${sha}; it ${plan}."
else
  echo "The release of ${sha} ${plan}."
fi
echo "Commits since production:"
git log --oneline origin/production.."$sha"
