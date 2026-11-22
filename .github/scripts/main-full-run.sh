#!/usr/bin/env bash
# The decision and the alert detail of .github/workflows/main-full-run.yml.
# Usage: main-full-run.sh decide
#        main-full-run.sh context
#
# A full run is ci.yml called from a job named `Full run` (nightly.yml, release.yml and
# main-full-run.yml). Its jobs show on their commit as the check runs `Full run / …`. A runner off
# GitHub Actions posts one check run `Full run / Check` as the CI App (scripts/ci/publish-check.ts).
#
# `decide` finds the newest full run on main's last commits, and any older one still running, and
# asks the repository's rule, scripts/ci/full-run.ts (lib/testing/ci/full-run.ts), which writes
# run=true|false and reason to $GITHUB_OUTPUT: at once after a tooling change, otherwise in a
# daytime slot every 3 hours, and never while a full run runs, for a commit that has one, or when
# only documentation landed. It needs a checkout of GITHUB_SHA with its history and the installed
# dependencies.
# `context` prints the alert's detail: the groups that this run's
# failed jobs report, and the commits since the newest green full run.
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA; `context` also GITHUB_RUN_ID and GITHUB_SERVER_URL.
set -euo pipefail

readonly DEPTH=100

# The sources whose `Full run / …` check runs count: GitHub Actions, and the CI App once
# check-app.json names one. A commit status, or another app's check of the same name, counts for nothing.
source "$(dirname "${BASH_SOURCE[0]}")/check-app.sh"
check_app_id || exit 1
trusted='.app.slug == "github-actions"'
test -z "$CHECK_APP_ID" || trusted="(${trusted} or .app.id == ${CHECK_APP_ID})"
readonly trusted

# The newest commits up to this run's, one `<sha> <subject>` per line.
commits() {
  gh api "repos/${GITHUB_REPOSITORY}/commits?sha=${GITHUB_SHA}&per_page=${DEPTH}" \
    --jq '.[] | "\(.sha) \(.commit.message | split("\n")[0])"' < /dev/null
}

# The full run on one commit as `<started> <state>`: the epoch its first job started, and the
# conclusion of `Full run / Check`, or `running` while any of its jobs runs or before that job ends.
# Nothing for a commit without one. Only the trusted sources' check runs count, so a run of one
# source still running holds the next back even after the other source's Check ended. GitHub Actions
# ends every job by its timeout, and the CI App posts only a completed `Full run / Check`, so no
# entry runs for ever.
full_run() {
  gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/$1/check-runs?per_page=100" \
    --jq '.check_runs[] | select('"${trusted}"' and (.name | startswith("Full run / ")))
      | {name, status, conclusion, started_at}' < /dev/null \
    | jq --slurp --raw-output 'select(length > 0)
      | "\([.[].started_at // empty | fromdateiso8601] | min // 0) \(
        if any(.[]; .status != "completed") then "running"
        else [.[] | select(.name == "Full run / Check")][0].conclusion // "running" end)"'
}

# Whether a commit had a green `Full run / Check` in any attempt; a later red attempt hides none.
passed() {
  gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/$1/check-runs?check_name=Full%20run%20%2F%20Check&filter=all&per_page=100" \
    --jq '.check_runs[] | select('"${trusted}"' and .name == "Full run / Check" and .conclusion == "success")
      | .id' < /dev/null \
    | grep --quiet .
}

decide() {
  local list commit state="" started conclusion decision run=() newest=""
  # A failed request fails the decision: a missing check run could be the newest full run.
  list="$(commits)"
  # A cancelled or timed-out full run tested nothing, so an older one decides. Past the newest
  # ended one, a full run still running on an older commit holds the next back too.
  while read -r commit _; do
    state="$(full_run "$commit")"
    read -r started conclusion <<< "${state:-0 none}"
    case "$conclusion" in
      running) run+=(--run "${commit},${started},running") && break ;;
      success | failure) test -n "$newest" || { newest="$commit" && run+=(--run "${commit},${started},ended"); } ;;
    esac
  done <<< "$list"
  decision="$(bun scripts/ci/full-run.ts due "${run[@]}")"
  echo "::notice title=Full run on main::${decision}"
}

context() {
  local jobs job log groups="" unread="" list commit subject range="" green=""
  jobs="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs?per_page=100" \
    --jq '.jobs[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out") | .id')"
  for job in $jobs; do
    # gh refuses a log with terminal escape sequences, and every browser log has them.
    if ! log="$(curl --fail --silent --show-error --location -H "Authorization: Bearer ${GH_TOKEN}" \
      "${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY}/actions/jobs/${job}/logs")"; then
      unread+="- The log of job ${job} could not be read."$'\n'
      continue
    fi
    groups+="$(grep --text --only-matching --extended-regexp '\[verify\] [^ ]+: failed' <<< "$log" \
      | sed -E 's/^\[verify\] (.+): failed$/- `\1`/' || true)"$'\n'
  done
  groups="$(LC_ALL=C sort -u <<< "$groups" | sed '/^$/d'; printf '%s' "$unread")"
  printf 'Failed groups:\n\n%s\n\n' "${groups:-None named in the logs; see the failed steps above.}"

  list="$(commits)"
  while read -r commit subject; do
    if passed "$commit"; then
      green="$commit"
      break
    fi
    range+="${commit:0:9} ${subject}"$'\n'
  done <<< "$list"
  if test -z "$green"; then
    printf 'No green full run on the last %s commits.\n' "$DEPTH"
    return
  fi
  # A code block, so no commit subject mentions a person or links an issue.
  printf 'Commits since the last green full run, on %s (%s/%s/compare/%s...%s):\n\n```text\n%s```\n' \
    "${green:0:9}" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$green" "$GITHUB_SHA" "$range"
}

case "$1" in
  decide) decide ;;
  context) context ;;
  *) echo "::error::Unknown action $1."; exit 1 ;;
esac
