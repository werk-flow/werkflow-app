#!/usr/bin/env bash
# Deploys the edge functions to a Supabase project: DEV from staging.yml, PROD from release.yml and rollback.yml.
# Usage: deploy-edge-functions.sh <project ref> [--present-only]
#
# The functions are named: each checks its own caller (the mail functions a secret key, health
# its token), so none needs a JWT. A new function deploys only once it is named here, and
# lib/security/edge-functions.test.ts fails until it is. --use-api bundles on Supabase's side, so
# the runner pulls no Docker image and meets no registry rate limit.
#
# It deploys the source in ./supabase/functions. A rollback puts an older commit's source there,
# which may lack a function added since: --present-only skips that one with a warning, and it
# keeps serving its newer version, which the older code does not call. A release names every one.
# Needs SUPABASE_ACCESS_TOKEN and the Supabase CLI.
set -euo pipefail

ref="$1"
mode="${2:-}"
names=(send-invite-email send-email-change-current-otp health)

deploy=()
for name in "${names[@]}"; do
  if test -d "supabase/functions/${name}"; then
    deploy+=("$name")
  elif test "$mode" = --present-only; then
    echo "::warning::supabase/functions/${name} is not in this source; ${name} keeps its deployed version."
  else
    echo "::error::supabase/functions/${name} is missing."
    exit 1
  fi
done
test "${#deploy[@]}" -gt 0 || { echo "::error::No edge function to deploy."; exit 1; }
supabase functions deploy "${deploy[@]}" --project-ref "$ref" --use-api --no-verify-jwt
