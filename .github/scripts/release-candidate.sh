#!/usr/bin/env bash
# The release decision for .github/workflows/release.yml, on the checked-out main commit.
# Usage: release-candidate.sh <manual|scheduled|dry-run>
#
# Writes sha, verified (a green full run exists), release (the run goes on) and, for a run
# that stops, skip and skip_reason to $GITHUB_OUTPUT. A manual release always goes on. A scheduled one goes on only when
# main moved since production and its newest full run is green, or it has none yet and
# the release runs its own. A dry run decides like a scheduled run and changes nothing.
# Needs GH_TOKEN, GITHUB_REF, GITHUB_REPOSITORY, and origin/production fetched.
set -euo pipefail

mode="$1"
case "$mode" in manual | scheduled | dry-run) ;; *) echo "::error::Unknown mode ${mode}."; exit 1 ;; esac
source "$(dirname "${BASH_SOURCE[0]}")/check-app.sh"
check_app_id || exit 1

test "$GITHUB_REF" = refs/heads/main \
  || { echo "::error::A release starts on main, not ${GITHUB_REF}."; exit 1; }
sha="$(git rev-parse HEAD)"
echo "sha=$sha" >> "$GITHUB_OUTPUT"

# Ends the run green. The skip, no-change or red-run, tells alert-issue.sh whether to speak.
skip() {
  {
    echo "release=false"
    echo "skip=$1"
    echo "skip_reason=$2"
  } >> "$GITHUB_OUTPUT"
  echo "::notice title=No release::$2"
  exit 0
}

# A scheduled run ships the commit it started on. A release that started later, or a rerun days
# on, may find production already past it: that run has nothing to do, and it is no failure.
if test "$mode" != manual && git merge-base --is-ancestor "$sha" origin/production; then
  if test "$sha" = "$(git rev-parse origin/production)"; then
    skip no-change "main (${sha}) equals production; nothing to release."
  fi
  skip no-change "production already contains ${sha}; a later release shipped it."
fi
git merge-base --is-ancestor origin/production "$sha" \
  || { echo "::error::production is not an ancestor of main; it only ever moves forward."; exit 1; }

# A full run is ci.yml called with `full` from a job named `Full run`, so its aggregate
# job is `Full run / Check` (.github/workflows/nightly.yml). Only a nightly, release or
# main-full-run run on main counts: their workflow files come from the commit itself, so no
# other branch can stand in for one, and no pull request starts them. The newest completed full
# run decides; a later failure replaces a pass, and so does one that ended in the same second. A
# runner off GitHub Actions posts a full run's `Full run / Check` as the CI App (check-app.sh,
# scripts/ci/publish-check.ts), which only that runner can; another app's check run or a commit
# status of that name counts for nothing.
runs="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/runs?head_sha=${sha}&branch=main&per_page=100" \
  --jq '.workflow_runs[] | select(.head_branch == "main"
    and (.path == ".github/workflows/nightly.yml" or .path == ".github/workflows/release.yml"
      or .path == ".github/workflows/main-full-run.yml")
    and (.event == "schedule" or .event == "workflow_dispatch")) | .id')"
# A failed request stops the gate: a missing run could be the newest, failed one.
app_checks=""
if test -n "$CHECK_APP_ID"; then
  app_checks="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/${sha}/check-runs?check_name=Full%20run%20%2F%20Check&filter=all&app_id=${CHECK_APP_ID}&per_page=100" \
    --jq '.check_runs[] | select(.app.id == '"${CHECK_APP_ID}"' and .name == "Full run / Check" and .status == "completed")
      | "\(.completed_at) \(.conclusion) \(.details_url // .html_url)"')"
fi
latest="$({
  for run in $runs; do
    gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/runs/${run}/jobs?per_page=100" \
      --jq '.jobs[] | select(.name == "Full run / Check" and .status == "completed") | "\(.completed_at) \(.conclusion) \(.html_url)"' \
      || exit 1
  done
  printf '%s\n' "$app_checks"
} | sed '/^$/d' | sort | awk '
  # Among the runs that ended last, a non-success wins: a tie never lets a pass hide a later failure.
  $1 != last { last = $1; pick = $0; next }
  $2 != "success" { pick = $0 }
  END { if (last != "") print pick }')"
echo "Newest full run on ${sha}: ${latest:-none}"
conclusion="$(echo "$latest" | cut -d ' ' -f 2)"

if test "$conclusion" = success; then
  verified=true
  plan="reuses its green full run"
elif test "$mode" != manual && test -n "$latest"; then
  # A scheduled release never reruns a red full run until it passes; main is repaired through a PR.
  skip red-run "The newest full run on main (${sha}) ended ${conclusion}: $(echo "$latest" | cut -d ' ' -f 3)"
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
