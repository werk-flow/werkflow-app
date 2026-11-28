#!/usr/bin/env bash
# The daily ruleset watch of .github/workflows/rulesets.yml: the live GitHub rulesets still hold the
# protections decision 0012 rests on. A ruleset changed in the GitHub settings leaves no commit, so
# without this nobody would notice the merge queue off, `Check` no longer required, or GitHub Actions
# allowed to move `production`.
# Usage: ruleset-check.sh
#
# Exit 0: both rulesets hold. Exit 1: drift, one line per broken expectation. Exit 2: a ruleset could
# not be read, which proves nothing either way.
#
# What it cannot see: GitHub shows who may bypass a ruleset only to a caller with write access to it,
# so the full bypass list stays unread. It checks what the job's own token may bypass, which must be
# nothing: GitHub Actions bypassing `production` would let any workflow move it.
# Needs GH_TOKEN and GH_REPO.
set -euo pipefail

readonly main_ruleset=25878425 production_ruleset=25878432
drift=()

main="$(gh api "repos/${GH_REPO}/rulesets/${main_ruleset}")" \
  || { echo "::error::GitHub did not return the main ruleset ${main_ruleset}."; exit 2; }
production="$(gh api "repos/${GH_REPO}/rulesets/${production_ruleset}")" \
  || { echo "::error::GitHub did not return the production ruleset ${production_ruleset}."; exit 2; }
# An answer that is no ruleset, or that does not say what the job token may bypass, proves nothing.
for name in main production; do
  ruleset="$main"
  test "$name" = main || ruleset="$production"
  jq -e 'type == "object" and (.rules | type) == "array" and (.current_user_can_bypass | type) == "string"' <<< "$ruleset" > /dev/null 2>&1 \
    || { echo "::error::GitHub's answer for the ${name} ruleset is not a whole ruleset with the caller's bypass."; exit 2; }
done

# Adds "<name>: <expectation>" to the drift when the jq check is not true.
expect() {
  local ruleset="$1" name="$2" text="$3" check="$4"
  if test "$(jq -r "def rule(\$type): [.rules[] | select(.type == \$type)][0]; ${check}" <<< "$ruleset")" != true; then
    drift+=("${name}: ${text}")
  fi
}

for name in main production; do
  ruleset="$main"
  test "$name" = main || ruleset="$production"
  expect "$ruleset" "$name" 'is active' '.enforcement == "active"'
  expect "$ruleset" "$name" "targets refs/heads/${name} and excludes nothing" \
    "(.conditions.ref_name.include == [\"refs/heads/${name}\"]) and ((.conditions.ref_name.exclude // []) == [])"
  expect "$ruleset" "$name" 'lets GitHub Actions bypass nothing' '.current_user_can_bypass == "never"'
done
expect "$main" main 'refuses deletion and force pushes' 'rule("deletion") != null and rule("non_fast_forward") != null'
expect "$main" main 'requires a pull request that merges by squash only' \
  'rule("pull_request").parameters.allowed_merge_methods == ["squash"]'
expect "$main" main 'requires the check Check from GitHub Actions' \
  '[rule("required_status_checks").parameters.required_status_checks[]? | select(.context == "Check" and .integration_id == 15368)] | length == 1'
expect "$main" main 'lands every PR through the merge queue, each entry on its own green run (ALLGREEN, squash)' \
  'rule("merge_queue").parameters | . != null and .grouping_strategy == "ALLGREEN" and .merge_method == "SQUASH"'
expect "$production" production 'refuses every update, deletion and force push but a bypass' \
  'rule("update") != null and rule("deletion") != null and rule("non_fast_forward") != null'

if test "${#drift[@]}" -gt 0; then
  printf '%s\n' "${drift[@]}"
  exit 1
fi
echo "The main and production rulesets hold."
