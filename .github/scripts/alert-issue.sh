#!/usr/bin/env bash
# One open issue per alert title, for health.yml, nightly.yml and release.yml: a failure opens
# it or updates it, and the next green run closes it. It only reports; no release decision
# reads it. docs/technical/recovery-and-incidents.md#monitoring says who picks it up.
#
# Usage: alert-issue.sh open <title> <body>
#        alert-issue.sh close <title>
#        alert-issue.sh run <title> <job results> [<skip> <skip reason>]
#
# `run` decides from this run's `needs.*.result` and the skip of release-candidate.sh. Needs
# GH_TOKEN and GH_REPO; `run` needs `actions: read` to name the failed jobs.
set -euo pipefail

label=ci-alert
# The owner's account, assigned so a new alert reaches them beside the run's own mail.
assignee=tamaycbn
run_url="${GITHUB_SERVER_URL}/${GH_REPO}/actions/runs/${GITHUB_RUN_ID}"

open_issue() {
  gh issue list --state open --label "$label" --json number,title \
    | jq -r --arg title "$1" '[.[] | select(.title == $title)][0].number // empty'
}

open_alert() {
  local issue body
  issue="$(open_issue "$1")"
  body="$(printf '%s\n\nRun: %s' "$2" "$run_url")"
  if test -n "$issue"; then
    gh issue edit "$issue" --body "$body"
    gh issue comment "$issue" --body "Still failing: ${run_url}"
  else
    gh issue create --title "$1" --body "$body" --label "$label" --assignee "$assignee"
  fi
}

close_alert() {
  local issue
  issue="$(open_issue "$1")"
  if test -n "$issue"; then
    gh issue close "$issue" --comment "Green again: ${run_url}"
  fi
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
  close) close_alert "$@" ;;
  run) report_run "$@" ;;
  *) echo "::error::Unknown action ${action}."; exit 1 ;;
esac
