#!/bin/bash
# Runs one CI job in its container (scripts/ci/container-executor.ts), in the checkout of its
# workspace: the commit's own environment steps (scripts/ci/prepare.ts for <job>), then its body
# (scripts/ci/job.ts <job>) with the variables the steps passed on. The `launched` marker tells the
# trusted side the body started; without it the job failed in its steps.
# Usage: werkflow-ci-job <job>
set -uo pipefail
job=$1
workspace=$(dirname "$PWD")
bun scripts/ci/prepare.ts for "$job" || exit $?
while IFS= read -r line; do
  case $line in
    CI_STACK_STARTED=* | GITHUB_ENV=*) ;;
    *=*) export "${line?}" ;;
  esac
done < "$GITHUB_ENV"
unset GITHUB_ENV
touch "$workspace/launched"
exec bun scripts/ci/job.ts "$job"
