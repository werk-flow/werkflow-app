#!/usr/bin/env bash
# The decision and the alert detail of .github/workflows/main-full-run.yml.
# Usage: main-full-run.sh decide
#        main-full-run.sh context
#
# A full run is ci.yml called from a job named `Full run` (nightly.yml, release.yml and
# main-full-run.yml). Its jobs show on their commit as the check runs `Full run / …`.
#
# `decide` writes run=true|false and reason to $GITHUB_OUTPUT. A full run starts only from 06:00 to
# 20:00 Berlin, only when main moved since the newest full run, and only when that run has ended and
# started 3 hours ago or more. `context` prints the alert's detail: the groups that this run's failed
# jobs report, and the commits since the newest green full run.
# Needs GH_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA; `context` also GITHUB_RUN_ID and GITHUB_SERVER_URL.
set -euo pipefail

readonly FIRST=06:00 LAST=20:00 INTERVAL=$((3 * 3600)) DEPTH=100

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

answer() {
  {
    echo "run=$1"
    echo "reason=$2"
  } >> "$GITHUB_OUTPUT"
  echo "::notice title=Full run on main::$2"
  exit 0
}

decide() {
  local now clock list commit state="" behind=0 started conclusion
  now="$(date +%s)"
  # Python knows Berlin's clock changes, so the window stays right in summer and in winter.
  clock="$(python3 -c '
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

print(datetime.fromtimestamp(int(sys.argv[1]), ZoneInfo("Europe/Berlin")).strftime("%H:%M"))
' "$now")"
  if [[ "$clock" < "$FIRST" || ! "$clock" < "$LAST" ]]; then
    answer false "It is ${clock} in Berlin; full runs on main start from ${FIRST} to ${LAST}."
  fi
  # A failed request fails the decision: a missing check run could be the newest full run.
  list="$(commits)"
  while read -r commit _; do
    state="$(full_run "$commit")"
    test -z "$state" || break
    behind=$((behind + 1))
  done <<< "$list"
  test -n "$state" || answer true "No full run on the last ${DEPTH} commits."
  read -r started conclusion <<< "$state"
  test "$behind" -gt 0 || answer false "${GITHUB_SHA} already has a full run."
  test "$conclusion" != running \
    || answer false "The full run on ${commit} is still running; a later push or schedule takes the newer commits."
  test $((now - started)) -ge "$INTERVAL" \
    || answer false "The full run on ${commit} started $(((now - started) / 60)) min ago; the next starts 3 hours after it."
  answer true "main moved ${behind} commits since the full run on ${commit}."
}

context() {
  local jobs job log groups="" unread="" list commit subject state range="" green=""
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
    state="$(full_run "$commit")"
    if test "${state#* }" = success; then
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
