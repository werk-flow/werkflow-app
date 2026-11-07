#!/usr/bin/env bash
# One open issue per alert title, for health.yml, nightly.yml, release.yml and the recovery rehearsal: a failure opens
# it or updates it, and the next green run closes it. It only reports; no release decision
# reads it. docs/technical/recovery-and-incidents.md#monitoring says who picks it up.
#
# Usage: alert-issue.sh open <title> <body>
#        alert-issue.sh keep <title> <note>
#        alert-issue.sh close <title>
#        alert-issue.sh run <title> <job results> [<skip> <skip reason>]
#
# `run` decides from this run's `needs.*.result` and the skip of release-candidate.sh. Needs
# GH_TOKEN and GH_REPO; `run` needs `actions: read` to name the failed jobs.
#
# Assignment is the owner's one notification, so it is kept for a failure that affects
# production: the caller sets AFFECTS_PRODUCTION=true. Every other alert reaches a T3 thread
# only (ops/ci-alert.py in werkflow-planning). An open alert that turns into a production
# failure gains the owner; no update removes anyone.
set -euo pipefail

label=ci-alert
owner=tamaycbn
# A caller outside GitHub Actions names its run: ops/recovery-rehearsal.py in werkflow-planning.
run_url="${ALERT_RUN:-${GITHUB_SERVER_URL}/${GH_REPO}/actions/runs/${GITHUB_RUN_ID}}"

case "${AFFECTS_PRODUCTION:-false}" in
  true | false) ;;
  *) echo "::error::AFFECTS_PRODUCTION is true or false, not ${AFFECTS_PRODUCTION}."; exit 1 ;;
esac

affects_production() {
  test "${AFFECTS_PRODUCTION:-false}" = true
}

# Adds the owner to an open issue; the call does nothing when the owner is already assigned.
assign_owner() {
  if affects_production; then
    gh issue edit "$1" --add-assignee "$owner"
  fi
}

open_issues() {
  gh issue list --state open --label "$label" --json number,title \
    | jq -r --arg title "$1" '.[] | select(.title == $title) | .number'
}

open_alert() {
  local issue body
  issue="$(open_issues "$1" | sed -n 1p)"
  body="$(printf '%s\n\nRun: %s' "$2" "$run_url")"
  if test -n "$issue"; then
    gh issue edit "$issue" --body "$body"
    gh issue comment "$issue" --body "Still failing: ${run_url}"
    assign_owner "$issue"
  elif affects_production; then
    gh issue create --title "$1" --body "$body" --label "$label" --assignee "$owner"
  else
    gh issue create --title "$1" --body "$body" --label "$label"
  fi
}

# For a run that tested nothing: the open issue's body keeps what the last real run found.
keep_alert() {
  local issue
  issue="$(open_issues "$1" | sed -n 1p)"
  if test -n "$issue"; then
    gh issue comment "$issue" --body "$(printf '%s\n\nRun: %s' "$2" "$run_url")"
    assign_owner "$issue"
  else
    open_alert "$1" "$2"
  fi
}

# Every match: GitHub has no create-if-absent, so a race can leave a second issue of one title.
close_alert() {
  local issues issue
  issues="$(open_issues "$1")"
  for issue in $issues; do
    gh issue close "$issue" --comment "Green again: ${run_url}"
  done
}

# This run's jobs that ended badly, with the steps that did; a Static gates step names its groups.
failed_jobs() {
  gh api --paginate "repos/${GH_REPO}/actions/runs/${GITHUB_RUN_ID}/jobs?per_page=100" --jq '
    def ended_badly: .conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out";
    .jobs[] | select(ended_badly) | "- \(.name): \([.steps[] | select(ended_badly) | .name] | join(", "))"'
}

report_run() {
  local title="$1" results="$2" skip="${3:-}" reason="${4:-}"
  if grep -qE 'failure|cancelled' <<< "$results"; then
    open_alert "$title" "$(printf 'The run failed. Failed jobs:\n\n%s' "$(failed_jobs)")"
  elif test "$skip" = red-run; then
    open_alert "$title" "The scheduled release did not ship. ${reason}"
  elif test "$skip" != no-change; then
    close_alert "$title"
  fi
}

action="$1"
shift
case "$action" in
  open) open_alert "$@" ;;
  keep) keep_alert "$@" ;;
  close) close_alert "$@" ;;
  run) report_run "$@" ;;
  *) echo "::error::Unknown action ${action}."; exit 1 ;;
esac
