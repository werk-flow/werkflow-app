#!/usr/bin/env bash
# The CI queue check of .github/workflows/health.yml: how long ci.yml's jobs waited for a runner
# over the past 7 days, for pull request runs and for pushes to main.
# Usage: ci-queue.sh <ceiling in minutes>
#
# A job's queue is started_at - created_at; a job that never got a runner is left out. The step
# summary gets p50 and p90 per kind, and the check fails when either p90 exceeds the ceiling, so a
# rise reaches the weekly health issue (werk-flow/werkflow-planning#291 measured the baseline).
# BREAK_CHECK=ci-queue lowers the ceiling below zero, to prove that a rise fails this step.
# Needs GH_TOKEN with actions: read, and GITHUB_REPOSITORY. Reads only run metadata of a public repository.
set -euo pipefail

ceiling="$1"
check=ci-queue
if test "${BREAK_CHECK:-}" = "$check"; then
  echo "::warning title=${check}::Manual proof run: the ceiling is below zero."
  ceiling=-1
fi

# jq, not GNU date --date, so the unit test runs on macOS too.
since="$(jq --null-input --raw-output 'now - 7 * 86400 | strftime("%Y-%m-%dT%H:%M:%SZ")')"
workflow_runs="repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?created=>=${since}&per_page=100"

# Writes the queue in seconds of each job of one run that got a runner, one per line, to <folder>/<run>.
run_queues() {
  gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/runs/${2}/jobs?filter=all&per_page=100" \
    --jq '.jobs[] | select(.runner_name != null and .runner_name != "" and .started_at != null)
      | (.started_at | fromdateiso8601) - (.created_at | fromdateiso8601) | select(. >= 0)' > "$1/$2"
}
export -f run_queues
export GITHUB_REPOSITORY

# Lists one kind's runs into <work>/<kind>.runs and their job queues into <work>/<kind>/, eight
# runs at a time. A failed request fails the check: a missing run could hold the longest waits.
measure() {
  mkdir "$work/$1"
  gh api --paginate "${workflow_runs}&$2" --jq '.workflow_runs[].id' > "$work/$1.runs"
  xargs --no-run-if-empty --max-procs 8 --max-args 1 bash -c 'run_queues "$0" "$1"' "$work/$1" < "$work/$1.runs"
}

# "<runs> <jobs> <p50> <p90>" of one kind, in minutes with one decimal by nearest rank; "0 - -" for the jobs when it has none.
summary() {
  printf '%s ' "$(wc -l < "$work/$1.runs")"
  find "$work/$1" -type f -exec cat {} + | jq --slurp --raw-output 'sort as $s | ($s | length) as $n
    | def at($p): $s[([(($n * $p / 100) | ceil) - 1, 0] | max)] / 60 * 10 | round / 10;
    if $n == 0 then "0 - -" else "\($n) \(at(50)) \(at(90))" end'
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
measure pull_requests 'event=pull_request'
measure main 'event=push&branch=main'
pull_requests="$(summary pull_requests)"
main="$(summary main)"
read -r pr_runs pr_jobs pr_p50 pr_p90 <<< "$pull_requests"
read -r main_runs main_jobs main_p50 main_p90 <<< "$main"

report="$(printf '### CI queue since %s\n\n| Kind | Runs | Jobs | Queue p50 | Queue p90 |\n| --- | --- | --- | --- | --- |\n| Pull requests | %s | %s | %s min | %s min |\n| Pushes to main | %s | %s | %s min | %s min |\n\nA job queues from its creation until a runner starts it. The check fails above %s min at p90.\n' \
  "$since" "$pr_runs" "$pr_jobs" "$pr_p50" "$pr_p90" "$main_runs" "$main_jobs" "$main_p50" "$main_p90" "$ceiling")"
echo "$report"
echo "$report" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

above() {
  test "$1" != - && jq --null-input --exit-status --argjson value "$1" --argjson ceiling "$ceiling" '$value > $ceiling' > /dev/null
}
failed=()
if above "$pr_p90"; then failed+=("pull requests ${pr_p90} min"); fi
if above "$main_p90"; then failed+=("pushes to main ${main_p90} min"); fi
if test "${#failed[@]}" -gt 0; then
  message="$(printf '%s; ' "${failed[@]}")"
  echo "::error title=${check}::CI jobs waited longer for a runner than ${ceiling} min at p90: ${message%; }."
  exit 1
fi
echo "${check}: ok"
