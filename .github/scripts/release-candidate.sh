#!/usr/bin/env bash
# The release decision for .github/workflows/release.yml, on the checked-out main commit.
# Usage: release-candidate.sh <manual|scheduled|dry-run>
#
# Writes sha, verified (a green full run exists), release (the run goes on) and, for a run
# that stops, skip and skip_reason to $GITHUB_OUTPUT. A manual release always goes on. A scheduled one goes on only when
# main moved since production and its newest full run is green, or it has none yet and
# the release runs its own. A dry run decides like a scheduled run and changes nothing.
# Needs GITHUB_REF and origin/production fetched. It reads GitHub without a token through
# full-run-verdict.sh, so a machine that holds none, such as a CI runner's release user
# (werk-flow/werkflow-planning#517), decides too.
set -euo pipefail

mode="$1"
case "$mode" in manual | scheduled | dry-run) ;; *) echo "::error::Unknown mode ${mode}."; exit 1 ;; esac
# The reader of the newest full run (shared with the nightly) sources check-app.sh and curl-headers.sh.
source "$(dirname "${BASH_SOURCE[0]}")/full-run-verdict.sh"
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

# The newest full run on the commit decides (full-run-verdict.sh); a failed read or a malformed row
# stops the gate.
latest="$(newest_full_run "$sha")" || exit 1
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
