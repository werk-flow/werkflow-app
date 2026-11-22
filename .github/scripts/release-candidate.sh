#!/usr/bin/env bash
# The release decision for .github/workflows/release.yml, on the checked-out main commit.
# Usage: release-candidate.sh <manual|scheduled|dry-run>
#
# Writes sha, verified (a green full run exists), release (the run goes on) and, for a run
# that stops, skip and skip_reason to $GITHUB_OUTPUT. A manual release always goes on. A scheduled one goes on only when
# main moved since production and its newest full run is green, or it has none yet and
# the release runs its own. A dry run decides like a scheduled run and changes nothing.
# Needs GITHUB_REF and origin/production fetched. GitHub's REST API answers this public
# repository's runs and check runs without a token, so a machine that holds none, such as a CI
# runner's release user (werk-flow/werkflow-planning#517), decides too. GH_TOKEN, where set, goes
# along as a header: GitHub allows 60 anonymous requests an hour per IP address, which other
# tenants of a shared runner may spend. GITHUB_API_URL and GITHUB_REPOSITORY default to this
# repository on github.com.
set -euo pipefail

mode="$1"
case "$mode" in manual | scheduled | dry-run) ;; *) echo "::error::Unknown mode ${mode}."; exit 1 ;; esac
source "$(dirname "${BASH_SOURCE[0]}")/check-app.sh"
source "$(dirname "${BASH_SOURCE[0]}")/curl-headers.sh"
check_app_id || exit 1
readonly api="${GITHUB_API_URL:-https://api.github.com}/repos/${GITHUB_REPOSITORY:-werk-flow/werkflow-app}"

test "$GITHUB_REF" = refs/heads/main \
  || { echo "::error::A release starts on main, not ${GITHUB_REF}."; exit 1; }
sha="$(git rev-parse HEAD)"
echo "sha=$sha" >> "$GITHUB_OUTPUT"

# Ends the run green. The skip, no-change or red-run, tells alert-issue.sh whether to speak.
skip() {
  {
    echo "release=false"
    echo "skip=$1"
    echo "skip_reason=$2"
  } >> "$GITHUB_OUTPUT"
  echo "::notice title=No release::$2"
  exit 0
}

# A scheduled run ships the commit it started on. A release that started later, or a rerun days
# on, may find production already past it: that run has nothing to do, and it is no failure.
if test "$mode" != manual && git merge-base --is-ancestor "$sha" origin/production; then
  if test "$sha" = "$(git rev-parse origin/production)"; then
    skip no-change "main (${sha}) equals production; nothing to release."
  fi
  skip no-change "production already contains ${sha}; a later release shipped it."
fi
git merge-base --is-ancestor origin/production "$sha" \
  || { echo "::error::production is not an ancestor of main; it only ever moves forward."; exit 1; }

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
        echo "::error::GitHub's rate limit refused the read of ${path} (HTTP ${status}); the release does not decide without it." >&2
      else
        echo "::error::GitHub did not answer the read of ${path} (HTTP ${status:-000}, curl exit ${sent}); the release does not decide without it." >&2
      fi
      rm -rf "$work"
      return 1
    fi
    if ! items="$(jq -c --slurp --arg key "$key" \
      'if length == 1 and (.[0][$key] | type) == "array" then .[0][$key][] else error("no list") end' \
      "$work/body" 2> /dev/null)"; then
      echo "::error::GitHub's answer to ${path} is not one ${key} list; the release does not decide without it." >&2
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

# A full run is ci.yml called with `full` from a job named `Full run`, so its aggregate
# job is `Full run / Check` (.github/workflows/nightly.yml). Only a nightly, release or
# main-full-run run on main counts: their workflow files come from the commit itself, so no
# other branch can stand in for one, and no pull request starts them. A runner off GitHub
# Actions posts a full run's `Full run / Check` as the CI App (check-app.sh,
# scripts/ci/publish-check.ts), which only that runner can; another app's check run or a commit
# status of that name counts for nothing. Every source must name this commit as its head, so a
# run of another commit never stands in for it. A failed read stops the gate (github_list).
runs="$(github_list "actions/runs?head_sha=${sha}&branch=main" workflow_runs \
  | jq -r --arg sha "$sha" 'select(.head_sha == $sha and .head_branch == "main"
    and (.path == ".github/workflows/nightly.yml" or .path == ".github/workflows/release.yml"
      or .path == ".github/workflows/main-full-run.yml")
    and (.event == "schedule" or .event == "workflow_dispatch")) | .id')"
# Each completed `Full run / Check` as `<completed_at> <conclusion> <url>`, one per line. Every
# attempt of a run counts, so a rerun still running never hides its failed attempt.
checks=""
for run in $runs; do
  checks+="$(github_list "actions/runs/${run}/jobs?filter=all" jobs \
    | jq -r --arg sha "$sha" 'select(.head_sha == $sha and .name == "Full run / Check" and .status == "completed")
      | "\(.completed_at) \(.conclusion) \(.html_url)"')"
  checks+="
"
done
if test -n "$CHECK_APP_ID"; then
  checks+="$(github_list "commits/${sha}/check-runs?check_name=Full%20run%20%2F%20Check&filter=all&app_id=${CHECK_APP_ID}" check_runs \
    | jq -r --arg sha "$sha" --argjson app "$CHECK_APP_ID" 'select(.app.id == $app and .head_sha == $sha
      and .name == "Full run / Check" and .status == "completed")
      | "\(.completed_at) \(.conclusion) \(.details_url // .html_url)"')"
fi
# A completed check without an end time or conclusion could sort anywhere, so it stops the gate.
malformed="$(printf '%s\n' "$checks" | sed '/^$/d' \
  | grep -Ev '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z [a-z_]+ [^ ]+$' || true)"
test -z "$malformed" \
  || { echo "::error::A completed full run on ${sha} names no end time or conclusion: ${malformed}"; exit 1; }
# The newest completed full run decides; a later failure replaces a pass, and so does one that
# ended in the same second.
latest="$(printf '%s\n' "$checks" | sed '/^$/d' | sort | awk '
  # Among the runs that ended last, a non-success wins: a tie never lets a pass hide a later failure.
  $1 != last { last = $1; pick = $0; next }
  $2 != "success" { pick = $0 }
  END { if (last != "") print pick }')"
echo "Newest full run on ${sha}: ${latest:-none}"
conclusion="$(echo "$latest" | cut -d ' ' -f 2)"

if test "$conclusion" = success; then
  verified=true
  plan="reuses its green full run"
elif test "$mode" != manual && test -n "$latest"; then
  # A scheduled release never reruns a red full run until it passes; main is repaired through a PR.
  skip red-run "The newest full run on main (${sha}) ended ${conclusion}: $(echo "$latest" | cut -d ' ' -f 3)"
else
  verified=false
  plan="runs the full suite first and ships only on green"
fi
echo "verified=$verified" >> "$GITHUB_OUTPUT"
echo "release=true" >> "$GITHUB_OUTPUT"

if test "$mode" = dry-run; then
  echo "::notice title=Dry run::A scheduled release would ship ${sha}; it ${plan}."
else
  echo "The release of ${sha} ${plan}."
fi
echo "Commits since production:"
git log --oneline origin/production.."$sha"
