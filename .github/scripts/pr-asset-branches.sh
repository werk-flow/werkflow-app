#!/usr/bin/env bash
# The PR asset branch check of .github/workflows/health.yml: no branch of this repository holds
# PR-only images. A PR embeds its images as assets of the `pr-screenshots` prerelease instead
# (the file-pr skill), so a `pr-assets/*` branch fails this check until its PR's owner deletes it.
# Needs GH_TOKEN with contents: read, and GITHUB_REPOSITORY.
# BREAK_CHECK=pr-asset-branches looks for `main` instead, to prove that a found branch fails this step.
set -euo pipefail

check=pr-asset-branches
prefix=pr-assets/
if test "${BREAK_CHECK:-}" = "$check"; then
  echo "::warning title=${check}::Manual proof run: main counts as a PR asset branch."
  prefix=main
fi

echo "environment=dev" >> "${GITHUB_OUTPUT:-/dev/null}"
# matching-refs lists every ref that starts with the prefix; a failed request fails the check.
branches="$(gh api "repos/${GITHUB_REPOSITORY}/git/matching-refs/heads/${prefix}" --jq '.[].ref | ltrimstr("refs/heads/")')"
if test -n "$branches"; then
  echo "::error title=${check}::PR images belong in the pr-screenshots prerelease, not in a branch. Delete: $(paste -sd ' ' <<< "$branches")"
  exit 1
fi
echo "${check}: ok"
