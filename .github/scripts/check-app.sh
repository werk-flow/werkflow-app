# The CI App whose check runs the gates trust beside GitHub Actions' (werk-flow/werkflow-planning#512).
# release-candidate.sh and main-full-run.sh source it. check-app.json beside it holds
# {"appId": <the App's id>}, or {"appId": null} while there is none; scripts/ci/publish-check.ts
# posts `Check` and `Full run / Check` as that App. lib/testing/ci/check-app.ts matches the file
# with the same pattern, so no JSON parser's leniency decides which App counts.

# Sets CHECK_APP_ID to the App's id, or to nothing while none is configured. A missing or malformed
# file fails: it could stand for any App. The id goes into the gates' jq filters, so only digits pass.
check_app_id() {
  local file text space='[ '$'\t'$'\r'$'\n'']*'
  local pattern="^${space}\\{${space}\"appId\"${space}:${space}(null|[1-9][0-9]{0,14})${space}\\}${space}\$"
  file="$(dirname "${BASH_SOURCE[0]}")/check-app.json"
  # $(…) drops NUL bytes, so tr turns each into a byte the pattern refuses; the x keeps the file's
  # trailing newlines, which $(…) would strip.
  if text="$(LC_ALL=C tr '\000' '\001' 2> /dev/null < "$file" && echo x)" && [[ "${text%x}" =~ $pattern ]]; then
    CHECK_APP_ID="${BASH_REMATCH[1]#null}"
    return 0
  fi
  echo "::error::${file} names no CI App: it must hold {\"appId\": <a positive integer>} or {\"appId\": null}."
  return 1
}
