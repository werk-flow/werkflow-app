#!/usr/bin/env bash
# One read-only check of one credential for .github/workflows/health.yml.
# Usage: health-check.sh <check-id> <kind> <secret variable> [argument]
#
# The repository is public, so nothing here prints a value, a provider
# answer or a URL that carries a credential: a failure names the check and,
# at most, an HTTP status or the names of the endpoint's failed checks.
# When BREAK_CHECK equals <check-id>, the credential is swapped for an invalid
# one of the same kind first, to prove that a broken credential fails this step.
set -euo pipefail

check="$1"
kind="$2"
variable="$3"
argument="${4:-}"
value="${!variable:-}"

fail() {
  echo "::error title=${check}::$1"
  exit 1
}

test -n "$value" || fail "${variable} is not configured."

if test "${BREAK_CHECK:-}" = "$check"; then
  echo "::warning title=${check}::Manual proof run: ${variable} is replaced by an invalid value."
  case "$kind" in
    # The same host and user with a wrong password, so authentication is what fails.
    database) value="$(printf '%s' "$value" | sed -E 's#(://[^:/@]+:)[^@]*@#\1invalid@#')" ;;
    # A fresh key that GitHub does not know.
    deploy-key)
      ssh-keygen -q -t ed25519 -N '' -f "$RUNNER_TEMP/invalid-key" > /dev/null
      value="$(cat "$RUNNER_TEMP/invalid-key")" ;;
    *) value="invalid-$(openssl rand -hex 24)" ;;
  esac
fi

# Prints the HTTP status of a GET; the body goes to the file in $body.
body="$RUNNER_TEMP/${check}.json"
get() {
  curl --silent --max-time 30 --output "$body" --write-out '%{http_code}' "$@" || echo 000
}

case "$kind" in
  # A bearer token read: Supabase Management API, Vercel API, GitHub API.
  bearer)
    status="$(get -H "Authorization: Bearer ${value}" "$argument")"
    test "$status" = 200 || fail "${variable} was refused or unreachable (HTTP ${status})." ;;

  database)
    psql "$value" --no-psqlrc --quiet --tuples-only --command 'select 1' > /dev/null 2>&1 \
      || fail "${variable} could not run select 1." ;;

  deploy-key)
    key="$RUNNER_TEMP/deploy-key"
    printf '%s\n' "$value" > "$key"
    chmod 600 "$key"
    GIT_SSH_COMMAND="ssh -i ${key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
      git ls-remote --exit-code "$argument" refs/heads/production > /dev/null 2>&1 \
      || { rm -f "$key"; fail "${variable} could not read the production branch over SSH."; }
    rm -f "$key" ;;

  # An app or Supabase health endpoint: the token header, plus the Vercel
  # automation bypass for a protected deployment.
  endpoint | protected-endpoint)
    headers=(-H "x-health-check-token: ${value}")
    if test "$kind" = protected-endpoint; then
      test -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" || fail "VERCEL_AUTOMATION_BYPASS_SECRET is not configured."
      headers+=(-H "x-vercel-protection-bypass: ${VERCEL_AUTOMATION_BYPASS_SECRET}")
    fi
    status="$(get "${headers[@]}" "$argument")"
    case "$status" in
      200) ;;
      404) fail "The endpoint answered like an unknown route: ${variable} differs between GitHub and the deployment, or the deployment lacks it." ;;
      401 | 403) fail "The deployment refused the request before the app (HTTP ${status}): check VERCEL_AUTOMATION_BYPASS_SECRET." ;;
      503)
        # The body names checks only: {"ok":false,"checks":{"name":"ok"|"failed"}}.
        failed="$(jq -r '[.checks | to_entries[] | select(.value != "ok") | .key] | join(", ")' "$body" 2> /dev/null || true)"
        fail "Failed checks: ${failed:-unreadable report}." ;;
      *) fail "The endpoint answered HTTP ${status}." ;;
    esac ;;

  *) fail "Unknown check kind ${kind}." ;;
esac

echo "${check}: ok"
