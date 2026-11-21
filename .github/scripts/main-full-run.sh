#!/usr/bin/env bash
# The decision and the alert detail of .github/workflows/main-full-run.yml.
# Usage: main-full-run.sh decide
#        main-full-run.sh context
#
# A full run is ci.yml called from a job named `Full run` (nightly.yml, release.yml and
# main-full-run.yml). Its jobs show on their commit as the check runs `Full run / …`.
#
# `decide` finds the newest full run on main's last commits and asks the repository's rule,
# scripts/ci/full-run.ts (lib/testing/ci/full-run.ts), which writes run=true|false and reason to
# $GITHUB_OUTPUT: at once after a tooling change, otherwise in a daytime slot every 3 hours, and
# never while a full run runs, for a commit that has one, or when only documentation landed. It
# needs a checkout of GITHUB_SHA with its history and the installed dependencies.
# `context` prints the alert's detail: the groups that this run's
# failed jobs report, and the commits since the newest green full run.
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA; `context` also GITHUB_RUN_ID and GITHUB_SERVER_URL.
set -euo pipefail

readonly DEPTH=100

# The newest commits up to this run's, one `<sha> <subject>` per line.
commits() {
  gh api "repos/${GITHUB_REPOSITORY}/commits?sha=${GITHUB_SHA}&per_page=${DEPTH}" \
    --jq '.[] | "\(.sha) \(.commit.message | split("\n")[0])"' < /dev/null
}

# The full run on one commit as `<started> <state>`: the epoch its first job started, and the
# conclusion of `Full run / Check`, or `running` before that job ends. Nothing for a commit without one.
# Only GitHub Actions writes these check runs; another app's check of the same name counts for nothing.
full_run() {
  gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/$1/check-runs?per_page=100" \
    --jq '.check_runs[] | select(.app.slug == "github-actions" and (.name | startswith("Full run / ")))
      | {name, status, conclusion, started_at}' < /dev/null \
    | jq --slurp --raw-output 'select(length > 0)
      | "\([.[].started_at // empty | fromdateiso8601] | min // 0) \(
        [.[] | select(.name == "Full run / Check" and .status == "completed")][0].conclusion // "running")"'
}

# Whether a commit had a green `Full run / Check` in any attempt; a later red attempt hides none.
passed() {
  gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/$1/check-runs?check_name=Full%20run%20%2F%20Check&filter=all&per_page=100" \
    --jq '.check_runs[] | select(.app.slug == "github-actions" and .name == "Full run / Check" and .conclusion == "success")
      | .id' < /dev/null \
    | grep --quiet .
}

decide() {
  local list commit state="" started conclusion decision run=()
  # A failed request fails the decision: a missing check run could be the newest full run.
  list="$(commits)"
  # A cancelled or timed-out full run tested nothing, so an older one decides.
  while read -r commit _; do
    state="$(full_run "$commit")"
    read -r started conclusion <<< "${state:-0 none}"
    case "$conclusion" in
      running) run=(--run "${commit},${started},running") && break ;;
      success | failure) run=(--run "${commit},${started},ended") && break ;;
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
