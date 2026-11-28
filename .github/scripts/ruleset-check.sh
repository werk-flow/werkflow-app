#!/usr/bin/env bash
# The daily ruleset watch of .github/workflows/rulesets.yml: the live GitHub rulesets still hold the
# protections decision 0012 rests on. A ruleset changed in the GitHub settings leaves no commit, so
# without this nobody would notice the merge queue off, `Check` no longer required, or a new actor
# allowed to move `production`.
# Usage: ruleset-check.sh
#
# It prints one line per drift and exits 1 when there is any. The job token reads every rule but not
# who may bypass a ruleset: that list needs a token with Administration read. With
# RULESET_ADMIN_TOKEN set, it also checks that nobody bypasses `main` and only a deploy key bypasses
# `production`; without it, it warns that the bypass lists went unchecked.
# Needs GH_TOKEN and GH_REPO.
set -euo pipefail

readonly main_ruleset=25878425 production_ruleset=25878432
drift=()

read_ruleset() {
  gh api "repos/${GH_REPO}/rulesets/$1"
}

# Prints each failed expectation of a ruleset as "<name>: <expectation>".
expect() {
  local ruleset="$1" name="$2" text="$3" check="$4"
  if test "$(jq -r "$check" <<< "$ruleset")" != true; then
    drift+=("${name}: ${text}")
  fi
}

main="$(read_ruleset "$main_ruleset")" || { echo "::error::GitHub did not return the main ruleset ${main_ruleset}."; exit 1; }
production="$(read_ruleset "$production_ruleset")" \
  || { echo "::error::GitHub did not return the production ruleset ${production_ruleset}."; exit 1; }

rule='def rule($type): [.rules[] | select(.type == $type)][0];'
expect "$main" main 'is active' '.enforcement == "active"'
expect "$main" main 'targets refs/heads/main' '.conditions.ref_name.include == ["refs/heads/main"]'
expect "$main" main 'refuses deletion and force pushes' "${rule} rule(\"deletion\") != null and rule(\"non_fast_forward\") != null"
expect "$main" main 'requires a pull request that merges by squash only' \
  "${rule} rule(\"pull_request\").parameters.allowed_merge_methods == [\"squash\"]"
expect "$main" main 'requires the check Check from GitHub Actions' \
  "${rule} [rule(\"required_status_checks\").parameters.required_status_checks[]? | select(.context == \"Check\" and .integration_id == 15368)] | length == 1"
expect "$main" main 'lands every PR through the merge queue, each entry on its own green run (ALLGREEN, squash)' \
  "${rule} rule(\"merge_queue\").parameters | . != null and .grouping_strategy == \"ALLGREEN\" and .merge_method == \"SQUASH\""
expect "$production" production 'is active' '.enforcement == "active"'
expect "$production" production 'targets refs/heads/production' '.conditions.ref_name.include == ["refs/heads/production"]'
expect "$production" production 'refuses every update, deletion and force push but a bypass' \
  "${rule} rule(\"update\") != null and rule(\"deletion\") != null and rule(\"non_fast_forward\") != null"

if test -n "${RULESET_ADMIN_TOKEN:-}"; then
  main="$(GH_TOKEN="$RULESET_ADMIN_TOKEN" read_ruleset "$main_ruleset")" \
    || { echo "::error::RULESET_ADMIN_TOKEN did not read the main ruleset."; exit 1; }
  production="$(GH_TOKEN="$RULESET_ADMIN_TOKEN" read_ruleset "$production_ruleset")" \
    || { echo "::error::RULESET_ADMIN_TOKEN did not read the production ruleset."; exit 1; }
  # A token without Administration read gets the rulesets without the list, which would pass unseen.
  expect "$main" main 'shows its bypass list to RULESET_ADMIN_TOKEN' 'has("bypass_actors")'
  expect "$main" main 'lets nobody bypass it' '(.bypass_actors // ["unread"]) == []'
  expect "$production" production 'lets only a deploy key bypass it, the release job'"'"'s' \
    '(.bypass_actors // []) | map({actor_type, bypass_mode}) == [{"actor_type": "DeployKey", "bypass_mode": "always"}]'
else
  echo "::warning::RULESET_ADMIN_TOKEN is not set, so who may bypass main and production went unchecked."
fi

if test "${#drift[@]}" -gt 0; then
  printf '%s\n' "${drift[@]}"
  exit 1
fi
echo "The main and production rulesets hold."
