# The CI App whose check runs the gates trust beside GitHub Actions' (werk-flow/werkflow-planning#512).
# release-candidate.sh and main-full-run.sh source it. check-app.json beside it holds
# {"appId": <the App's id>}, or {"appId": null} while there is none; scripts/ci/publish-check.ts
# posts `Check` and `Full run / Check` as that App, and lib/testing/ci/check-app.ts reads the file alike.

# Sets CHECK_APP_ID to the App's id, or to nothing while none is configured. A missing or malformed
# file fails: it could stand for any App.
check_app_id() {
  local file id
  file="$(dirname "${BASH_SOURCE[0]}")/check-app.json"
  # --slurp: an empty file or a second value is no configuration either. The id goes into the
  # gates' jq filters, so only digits pass.
  if id="$(jq --slurp --raw-output 'if length == 1 and (.[0] | type) == "object" and (.[0] | keys) == ["appId"]
      and (.[0].appId == null or (.[0].appId | type == "number" and . == floor and . < 9007199254740992))
    then .[0].appId // "" else error("malformed") end' "$file" 2> /dev/null)" \
    && [[ "$id" =~ ^([1-9][0-9]*)?$ ]]; then
    CHECK_APP_ID="$id"
    return 0
  fi
  echo "::error::${file} names no CI App: it must hold {\"appId\": <a positive integer>} or {\"appId\": null}."
  return 1
}
