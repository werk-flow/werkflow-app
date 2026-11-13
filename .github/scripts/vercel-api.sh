# Sourced by the scripts and steps that call Vercel's REST API with VERCEL_TOKEN.
# Usage: vercel_api [curl options] <URL>
#
# Prints the body of a 2xx answer. On HTTP 429 it waits, retries and says why, until the
# next wait would pass VERCEL_API_RETRY_SECONDS (default 1200) in total: the retry-after
# header's seconds, else 60, 120, 240 and 480. Any other answer prints the HTTP status
# with Vercel's error code and message on stderr and returns 1, so no caller reads an id
# or a state out of a refusal. The repository is public: it prints those two fields only,
# never a header, the token or the rest of the body.
vercel_api() {
  local work status reason retry wait waited=0 delay=60
  work="$(mktemp -d)"
  while :; do
    status="$(curl --silent --show-error --max-time 60 --output "$work/body" --dump-header "$work/headers" \
      --write-out '%{http_code}' -H "Authorization: Bearer ${VERCEL_TOKEN}" "$@")" || true
    case "$status" in
      2??)
        cat "$work/body"
        rm -rf "$work"
        return 0 ;;
    esac
    reason="$(jq -r '[.error.code, .error.message] | map(strings) | join(": ")' "$work/body" 2> /dev/null)" || reason=""
    if test "$status" = 429; then
      retry="$(tr -d '\r' < "$work/headers" | sed -n 's/^[Rr]etry-[Aa]fter: *\([1-9][0-9]*\)$/\1/p' | tail -n 1)"
      wait="${retry:-$delay}"
      if test $((waited + wait)) -le "${VERCEL_API_RETRY_SECONDS:-1200}"; then
        echo "Vercel answered HTTP 429${reason:+ (${reason})}; retrying in ${wait} seconds." >&2
        sleep "$wait"
        waited=$((waited + wait))
        delay=$((delay * 2))
        continue
      fi
      reason="${reason:-rate limited}, still after ${waited} seconds of retries"
    fi
    echo "::error title=Vercel API::Vercel answered HTTP ${status:-000}${reason:+ (${reason})}." >&2
    rm -rf "$work"
    return 1
  done
}
