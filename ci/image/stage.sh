#!/bin/bash
# Makes a run's one workspace on the slot (scripts/ci/container-executor.ts): the trusted side's
# inputs from the tar on standard input (the public sibling clone, the results so far, the GitHub
# snapshot and the variables the trusted sibling step passed on), then a clone of the commit under
# test from the slot's git cache of GitHub, with `origin` set to GitHub as on GitHub Actions.
# Usage: werkflow-ci-stage <workspace> <build folder> <git cache> <commit> <GitHub URL>
set -euo pipefail
workspace=$1 build=$2 cache=$3 commit=$4 url=$5
mkdir -p "$workspace" "$build"
tar -x -C "$workspace" -f -
mkdir -p "$workspace/results" "$workspace/tmp" "$workspace/cache" "$(dirname "$cache")"
# One stage at a time updates the cache.
exec 9> "$cache.lock"
flock 9
test -d "$cache" || git init --quiet --bare "$cache"
git -C "$cache" fetch --quiet --no-tags --prune "$url" '+refs/heads/*:refs/heads/*'
# A pull request's head is reachable on GitHub without a branch of its own.
git -C "$cache" cat-file -e "$commit^{commit}" 2> /dev/null || git -C "$cache" fetch --quiet --no-tags "$url" "$commit"
git -C "$cache" cat-file -e "$commit^{commit}"
flock -u 9
git clone --quiet --shared --no-checkout "$cache" "$workspace/werkflow-app"
git -C "$workspace/werkflow-app" remote set-url origin "$url"
git -C "$workspace/werkflow-app" checkout --quiet --detach "$commit"
