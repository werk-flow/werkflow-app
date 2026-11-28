#!/usr/bin/env bash
# The newest commit whose migrations reached PROD, for the rollback's schema guard (rollback-target.sh).
# Usage: prod-migrations-commit.sh    Writes applied=<commit> to $GITHUB_OUTPUT (stdout outside Actions).
#
# release.yml applies a commit's migrations before it advances `production`, and `db push` applies them
# one file at a time, so a release that failed, even in that step, may have applied migrations
# `production` lacks. The answer is the newest of the head of `production` and the commit of the newest
# release run in which any attempt reached "Apply pending migrations to PROD", among the last 50 runs.
# A failed read, or a commit Git cannot place, fails the step: no target is safe without it.
# Needs GH_TOKEN, GH_REPO and the history of origin/production.
set -euo pipefail

applied="$(git rev-parse origin/production)"
runs="$(gh api "repos/${GH_REPO}/actions/workflows/release.yml/runs?per_page=50" --jq '.workflow_runs[] | "\(.id) \(.head_sha)"')" \
  || { echo "::error::GitHub did not list the release runs."; exit 1; }
while read -r run sha; do
  test -n "$run" || continue
  steps="$(gh api "repos/${GH_REPO}/actions/runs/${run}/jobs?filter=all&per_page=100" \
    --jq '[.jobs[].steps[]? | select(.name == "Apply pending migrations to PROD" and .status != "queued" and .conclusion != "skipped")] | length')" \
    || { echo "::error::GitHub did not list the jobs of release run ${run}."; exit 1; }
  if test "$steps" -gt 0; then
    # The newest such run; it counts when it is ahead of production, and Git must place it.
    git cat-file -e "${sha}^{commit}" 2> /dev/null \
      || { echo "::error::Release run ${run} reached the migrations at ${sha}, which this checkout lacks."; exit 1; }
    if git merge-base --is-ancestor "$applied" "$sha"; then applied="$sha"; fi
    break
  fi
done <<< "$runs"
echo "The newest commit whose migrations reached PROD: ${applied}."
echo "applied=${applied}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
