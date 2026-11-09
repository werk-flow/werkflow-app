#!/usr/bin/env bash
# The Ignored Build Step check of .github/workflows/health.yml: the Vercel project's
# `commandForIgnoringBuildStep` must equal the command line of .github/vercel/ignored-build-step.sh,
# so the project keeps building only production and staging (docs/technical/environments.md#vercel).
# Usage: vercel-build-step.sh <project API URL>
#
# Reads the project's metadata with VERCEL_TOKEN and keeps one field. The repository is public, so
# a failure names an HTTP status or whether the setting is missing or differs, never the token,
# the provider answer or the live command.
# BREAK_CHECK=vercel-build-step expects a changed command, to prove that drift fails this step.
set -euo pipefail

check=vercel-build-step
url="$1"
command_file="$(dirname "$0")/../vercel/ignored-build-step.sh"

fail() {
  echo "::error title=${check}::$1"
  exit 1
}

# A drifted setting can stop production builds, so a failure assigns the owner (alert-issue.sh).
echo "environment=prod" >> "${GITHUB_OUTPUT:-/dev/null}"
test -n "${VERCEL_TOKEN:-}" || fail "VERCEL_TOKEN is not configured."

expected="$(grep -v '^#' "$command_file")"
if test "${BREAK_CHECK:-}" = "$check"; then
  echo "::warning title=${check}::Manual proof run: the expected command is changed."
  expected="${expected} # proof"
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
body="$work/project.json"
status="$(curl --silent --max-time 30 --output "$body" --write-out '%{http_code}' \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" "$url" || true)"
test "$status" = 200 || fail "VERCEL_TOKEN could not read the project (HTTP ${status})."
actual="$(jq -r '.commandForIgnoringBuildStep // empty' "$body" 2> /dev/null)" \
  || fail "The project answer was not readable."

test -n "$actual" || fail "The project has no Ignored Build Step, so every pushed branch builds. Set it to the command line of .github/vercel/ignored-build-step.sh."
test "$actual" = "$expected" || fail "The project's Ignored Build Step differs from .github/vercel/ignored-build-step.sh. Change the setting and the file together."
echo "${check}: ok"
