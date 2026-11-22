// A `curl` that answers like GitHub's REST API for the release gate (.github/scripts/release-candidate.sh).
//
// It answers from files in $STUB: `actions/runs?` from runs.json, `/jobs?` from jobs.json and
// `/check-runs?` from check-runs.json, whatever the query asks, so only the gate's own filters
// choose. `@commit` in a file reads as $COMMIT, the commit under test. A page past the first answers
// `<name>.<page>.json`, or empty lists, and a page whose next file exists names it in a Link header.
// $STUB/github-status, when present, holds the status of every answer, and $STUB/github-headers
// its header lines. Each URL lands in $STUB/curl.log, and each
// config curl read in $STUB/curl-config.
export const GITHUB_CURL_STUB = `#!/usr/bin/env bash
output=
headers=
previous=
for argument in "$@"; do
  if test "$previous" = --output; then output="$argument"; fi
  if test "$previous" = --dump-header; then headers="$argument"; fi
  if test "$previous" = --config; then cat "$argument" >> "$STUB/curl-config"; fi
  previous="$argument"
done
url="\${!#}"
echo "$url" >> "$STUB/curl.log"
case "$url" in
  *'/check-runs?'*) name=check-runs ;;
  *'/jobs?'*) name=jobs ;;
  *'/actions/runs?'*) name=runs ;;
  *) printf 000; exit 7 ;;
esac
page="$(sed -n 's/.*[?&]page=\\([0-9]*\\).*/\\1/p' <<< "$url")"
file="$STUB/$name.json"
test "\${page:-1}" = 1 || file="$STUB/$name.$page.json"
if test -f "$file"; then
  sed "s/@commit/\${COMMIT:-@commit}/g" "$file" > "$output"
else
  echo '{"workflow_runs": [], "jobs": [], "check_runs": []}' > "$output"
fi
status=200
test ! -f "$STUB/github-status" || status="$(cat "$STUB/github-status")"
{
  echo "HTTP/2 $status"
  cat "$STUB/github-headers" 2> /dev/null || true
  next=$((\${page:-1} + 1))
  test ! -f "$STUB/$name.$next.json" || echo "link: <\${url%&page=*}&page=$next>; rel=\\"next\\""
} > "$headers"
printf '%s' "$status"
`;
