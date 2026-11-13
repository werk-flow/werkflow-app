# Sourced by the scripts and steps that call Vercel's REST API with VERCEL_TOKEN.
# Usage: vercel_api [curl options] <URL>
#
# Prints the body of a 2xx answer that arrived whole. On HTTP 429 it waits, retries and says
# why while the next retry would start within VERCEL_API_RETRY_SECONDS (default 1200) of the
# first request: after the retry-after header's seconds, else 60, 120, 240 and 480. Any other
# answer, or one that did not arrive, prints the HTTP status with Vercel's error code and
# message on stderr and returns 1, so no caller reads an id or a state out of a refusal. The
# caller decides whether that fails its step. The repository is public: it prints those two
# fields only, never a header, the token or the rest of the body.
vercel_api() {
  local work status sent reason retry pause delay=60 start
  start="$(date +%s)"
  work="$(mktemp -d)"
  while :; do
    sent=0
    status="$(curl --silent --show-error --max-time 60 --output "$work/body" --dump-header "$work/headers" \
      --write-out '%{http_code}' -H "Authorization: Bearer ${VERCEL_TOKEN}" "$@")" || sent=$?
    if test "$sent" != 0; then
      echo "Vercel's answer did not arrive (HTTP ${status:-000}, curl exit ${sent})." >&2
      rm -rf "$work"
      return 1
    fi
    case "$status" in
      2??)
        cat "$work/body"
        rm -rf "$work"
        return 0 ;;
    esac
    reason="$(jq -r '[.error.code, .error.message] | map(strings) | join(": ")' "$work/body" 2> /dev/null)" || reason=""
    if test "$status" = 429; then
      retry="$(tr -d '\r' < "$work/headers" | sed -n 's/^[Rr]etry-[Aa]fter: *\([1-9][0-9]*\)$/\1/p' | tail -n 1)"
      pause="${retry:-$delay}"
      if test $(($(date +%s) + pause - start)) -le "${VERCEL_API_RETRY_SECONDS:-1200}"; then
        echo "Vercel answered HTTP 429${reason:+ (${reason})}; retrying in ${pause} seconds." >&2
        sleep "$pause"
        delay=$((delay * 2))
        continue
      fi
      reason="${reason:-rate limited}, still after $(($(date +%s) - start)) seconds"
    fi
    echo "Vercel answered HTTP ${status}${reason:+ (${reason})}." >&2
    rm -rf "$work"
    return 1
  done
}
