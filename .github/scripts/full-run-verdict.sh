#!/usr/bin/env bash
# The newest full run on one main commit, as the release gate and the nightly read it.
# Sourced (release-candidate.sh): after check_app_id, `newest_full_run <sha>` prints
#   `<completed_at> <conclusion> <url>` of the newest one, or nothing while it has none, and
#   returns 1 after an ::error:: on stderr when a read fails or a row is malformed.
# Run (nightly.yml): full-run-verdict.sh head writes head_has_full_run=true to $GITHUB_OUTPUT when
#   the newest full run on GITHUB_SHA, a commit of main, is green, and false otherwise. A failed
#   read fails the step, and the nightly then runs.
# GitHub's REST API answers this public repository's runs and check runs without a token. GH_TOKEN,
# where set, goes along as a header: GitHub allows 60 anonymous requests an hour per IP address,
# which other tenants of a shared runner may spend. Every request goes to this repository on
# api.github.com, whatever the environment names, so no variable can send the token or the
# decision elsewhere.
source "$(dirname "${BASH_SOURCE[0]}")/check-app.sh"
source "$(dirname "${BASH_SOURCE[0]}")/curl-headers.sh"
readonly api=https://api.github.com/repos/werk-flow/werkflow-app

# The token's header line, or nothing without one.
authorization() {
  test -z "${GH_TOKEN:-}" || curl_headers <<< "Authorization: Bearer ${GH_TOKEN}"
}

# Prints each element of the <key> list of a GitHub answer, one JSON object per line, across the
# pages its Link header names. <path> carries a query already. Anything but a whole 200 that is
# one object holding the list fails, prints nothing of that page, and says on stderr whether
# GitHub's rate limit refused it: a missing page could hold the newest, failed run.
github_list() {
  local path="$1" key="$2" page=1 status sent items work
  work="$(mktemp -d)" || return 1
  while :; do
    sent=0
    status="$(curl --silent --show-error --max-time 30 --output "$work/body" --dump-header "$work/headers" \
      --write-out '%{http_code}' --config <(authorization) --header 'Accept: application/vnd.github+json' \
      "${api}/${path}&per_page=100&page=${page}")" || sent=$?
    if test "$sent" != 0 || test "$status" != 200; then
      if test "$status" = 429 || tr -d '\r' < "$work/headers" 2> /dev/null | grep -qix 'x-ratelimit-remaining: *0'; then
        echo "::error::GitHub's rate limit refused the read of ${path} (HTTP ${status}); the gate does not decide without it." >&2
      else
        echo "::error::GitHub did not answer the read of ${path} (HTTP ${status:-000}, curl exit ${sent}); the gate does not decide without it." >&2
      fi
      rm -rf "$work"
      return 1
    fi
    if ! items="$(jq -c --slurp --arg key "$key" \
      'if length == 1 and (.[0][$key] | type) == "array" then .[0][$key][] else error("no list") end' \
      "$work/body" 2> /dev/null)"; then
      echo "::error::GitHub's answer to ${path} is not one ${key} list; the gate does not decide without it." >&2
      rm -rf "$work"
      return 1
    fi
    test -z "$items" || printf '%s\n' "$items"
    if ! tr -d '\r' < "$work/headers" | grep -qi '^link:.*rel="next"'; then
      rm -rf "$work"
      return 0
    fi
    page=$((page + 1))
  done
}

# A `Full run / Check` of the commit as `<completed_at> <conclusion> <url>`, given its `url`, or
# nothing while GitHub names it waiting or running. A row with any other status, or a completed
# one without a real end time, a conclusion or a URL, could sort anywhere or hide a failure, so it
# stops the gate.
readonly full_run_row='if .status == "completed" then
    if (.completed_at | type) == "string"
      and (.completed_at | try (fromdateiso8601 | todateiso8601) catch "") == .completed_at
      and (.conclusion | type) == "string" and (.conclusion | test("\\A[a-z_]+\\z"))
      and (.url | type) == "string" and (.url | test("\\A\\S+\\z"))
    then "\(.completed_at) \(.conclusion) \(.url)" else error("malformed") end
  elif .status == "queued" or .status == "in_progress" or .status == "waiting" or .status == "requested"
    or .status == "pending" then empty else error("malformed") end'

# A full run is ci.yml called with `full` from a job named `Full run`, so its aggregate
# job is `Full run / Check` (.github/workflows/nightly.yml). Only a nightly, release or
# main-full-run run on main counts: their workflow files come from the commit itself, so no
# other branch can stand in for one, and no pull request starts them. A runner off GitHub
# Actions posts a full run's `Full run / Check` as the CI App (check-app.sh,
# scripts/ci/publish-check.ts), which only that runner can; another app's check run or a commit
# status of that name counts for nothing. Every source must name this commit as its head, so a
# run of another commit never stands in for it. Every attempt of a run counts, so a rerun still
# running never hides its failed attempt. The newest completed full run decides; a later failure
# replaces a pass, and so does one that ended in the same second.
newest_full_run() {
  local sha="$1" runs run list rows checks=""
  runs="$(github_list "actions/runs?head_sha=${sha}&branch=main" workflow_runs \
    | jq -r --arg sha "$sha" 'select(.head_sha == $sha and .head_branch == "main"
      and (.path == ".github/workflows/nightly.yml" or .path == ".github/workflows/release.yml"
        or .path == ".github/workflows/main-full-run.yml")
      and (.event == "schedule" or .event == "workflow_dispatch")) | .id')" || return 1
  for run in $runs; do
    list="$(github_list "actions/runs/${run}/jobs?filter=all" jobs)" || return 1
    rows="$(jq -r --arg sha "$sha" 'select(.head_sha == $sha and .name == "Full run / Check")
      | . + {url: .html_url} | '"${full_run_row}" <<< "$list" 2> /dev/null)" \
      || { malformed_full_run "full-run job" "$sha"; return 1; }
    checks+="${rows}"$'\n'
  done
  if test -n "$CHECK_APP_ID"; then
    list="$(github_list "commits/${sha}/check-runs?check_name=Full%20run%20%2F%20Check&filter=all&app_id=${CHECK_APP_ID}" check_runs)" \
      || return 1
    rows="$(jq -r --arg sha "$sha" --argjson app "$CHECK_APP_ID" 'select(.app.id == $app and .head_sha == $sha
      and .name == "Full run / Check") | . + {url: (.details_url // .html_url)} | '"${full_run_row}" <<< "$list" 2> /dev/null)" \
      || { malformed_full_run "CI App check run" "$sha"; return 1; }
    checks+="${rows}"$'\n'
  fi
  printf '%s\n' "$checks" | sed '/^$/d' | sort | awk '
    # Among the runs that ended last, a non-success wins: a tie never lets a pass hide a later failure.
    $1 != last { last = $1; pick = $0; next }
    $2 != "success" { pick = $0 }
    END { if (last != "") print pick }'
}

malformed_full_run() {
  echo "::error::GitHub lists a ${1} on ${2} without a valid status, end time, conclusion or URL; the gate does not decide on it." >&2
}

if test "${BASH_SOURCE[0]}" = "$0"; then
  set -euo pipefail
  test "${1:-}" = head || { echo "::error::Usage: full-run-verdict.sh head"; exit 1; }
  test "$GITHUB_REF" = refs/heads/main \
    || { echo "::error::The nightly asks for a commit of main, not ${GITHUB_REF}."; exit 1; }
  check_app_id || exit 1
  latest="$(newest_full_run "$GITHUB_SHA")" || exit 1
  echo "Newest full run on ${GITHUB_SHA}: ${latest:-none}"
  conclusion="$(cut -d ' ' -f 2 <<< "$latest")"
  echo "head_has_full_run=$(test "$conclusion" = success && echo true || echo false)" >> "$GITHUB_OUTPUT"
fi
