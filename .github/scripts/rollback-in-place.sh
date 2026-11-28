#!/usr/bin/env bash
# Whether a rollback is in place: the open issue "Rollback in place" that rollback.yml opens before it
# switches the domain, and that a release, or a person, closes. Writes issue=<number>, empty when none
# is open, to $GITHUB_OUTPUT (stdout outside Actions). A failed read fails the step, so nothing ships
# on a guess. Needs GH_TOKEN and GH_REPO.
set -euo pipefail
issue="$(gh issue list --state open --label ci-alert --limit 100 --json number,title \
  --jq '[.[] | select(.title == "Rollback in place") | .number][0] // empty')" \
  || { echo "::error::GitHub did not list the open ci-alert issues."; exit 1; }
test -z "$issue" || echo "A rollback is in place: #${issue}."
echo "issue=${issue}" >> "${GITHUB_OUTPUT:-/dev/stdout}"
