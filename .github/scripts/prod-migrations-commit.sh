#!/usr/bin/env bash
# The newest commit whose migrations reached PROD, for the rollback's schema guard (rollback-target.sh).
# Usage: prod-migrations-commit.sh    Writes applied=<commit> to $GITHUB_OUTPUT (stdout outside Actions).
#
# release.yml applies a commit's migrations before it advances `production`, so a release that failed
# later may have applied migrations `production` lacks. The answer is the newest of the head of
# `production` and the commit of the newest release run whose "Apply pending migrations to PROD" step
# succeeded, among the last 50 release runs. A failed read fails the step: no target is safe without it.
# Needs GH_TOKEN, GH_REPO and the history of origin/production.
set -euo pipefail

applied="$(git rev-parse origin/production)"
runs="$(gh api "repos/${GH_REPO}/actions/workflows/release.yml/runs?per_page=50" --jq '.workflow_runs[] | "\(.id) \(.head_sha)"')" \
  || { echo "::error::GitHub did not list the release runs."; exit 1; }
while read -r run sha; do
  test -n "$run" || continue
  steps="$(gh api "repos/${GH_REPO}/actions/runs/${run}/jobs?per_page=100" \
    --jq '[.jobs[].steps[]? | select(.name == "Apply pending migrations to PROD" and .conclusion == "success")] | length')" \
    || { echo "::error::GitHub did not list the jobs of release run ${run}."; exit 1; }
  if test "$steps" -gt 0; then
    # The newest such run; it counts only when it is ahead of production.
    if git merge-base --is-ancestor "$applied" "$sha" 2> /dev/null; then applied="$sha"; fi
    break
  fi
done <<< "$runs"
echo "The newest commit whose migrations reached PROD: ${applied}."
echo "applied=${applied}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
