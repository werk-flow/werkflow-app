#!/usr/bin/env bash
# The Ubuntu packages the host Chromium needs, installed without the package mirror whenever possible.
#
# `playwright install-deps` always runs `apt-get update`. On 2026-11-10 that update hung on the
# runner's mirror for about 42 minutes in seven Browser jobs, until each job's timeout cancelled
# it before any test ran. The runner image already holds every library Chromium links; Playwright
# adds only a few fonts. So:
#
#   find     Writes `missing=<packages>` to $GITHUB_OUTPUT: the ones `install-deps --dry-run`
#            reports absent. The simulation reads the image's package lists, not the network.
#   install  Installs the .deb files in $DEBS (the Actions cache) when they are there. Otherwise,
#            or when they do not install, downloads $MISSING from the mirror first; the files it
#            downloads into an empty $DEBS are what the cache keeps.
#
# Each apt-get call that reaches the mirror has its own deadline. A call past its deadline is a
# stalled mirror: it gets one fresh attempt, then the step fails with that cause. Any other apt
# failure ends the step at once.
set -uo pipefail

update_seconds="${APT_UPDATE_SECONDS:-150}"
download_seconds="${APT_DOWNLOAD_SECONDS:-300}"
attempts=2

# Runs one apt-get call under its deadline, with a fresh attempt for a stall only.
apt_bounded() {
  local seconds=$1 what=$2 code attempt
  shift 2
  for attempt in $(seq 1 "$attempts"); do
    sudo timeout --kill-after=10 "$seconds" apt-get "$@"
    code=$?
    if test "$code" -eq 0; then return 0; fi
    # 124: the deadline passed. 137: the call ignored the stop and was killed.
    if test "$code" -ne 124 && test "$code" -ne 137; then
      echo "::error::$what failed with exit code $code, not a stall; apt's message is above."
      return "$code"
    fi
    echo "::warning::$what: the package mirror did not finish within $seconds s (attempt $attempt of $attempts)."
  done
  echo "::error::$what stalled on the runner's package mirror in all $attempts attempts of $seconds s each. The mirror failed, not a test: rerun the job."
  return 124
}

# Prints the packages Playwright reports missing, one per line; fails when the simulation cannot answer.
missing_packages() {
  local report packages
  if report="$(bunx playwright install-deps --dry-run chromium 2>&1)"; then return 0; fi
  packages="$(sed --quiet 's/^  \([a-z0-9][a-z0-9.+-]*\)$/\1/p' <<< "$report")"
  if ! grep --quiet '^Missing system dependencies' <<< "$report" || test -z "$packages"; then
    echo "$report" >&2
    return 1
  fi
  echo "$packages"
}

find_missing() {
  local missing
  if ! missing="$(missing_packages)"; then
    echo "The runner's package lists cannot answer; reading them from the mirror."
    apt_bounded "$update_seconds" "apt-get update" update || exit 1
    missing="$(missing_packages)" || exit 1
  fi
  missing="$(paste --serial --delimiters ' ' <<< "$missing")"
  if test -z "$missing"; then
    echo "The runner image holds every package Chromium needs."
  else
    echo "Chromium needs these packages the runner image lacks: $missing"
  fi
  # The cache key: the same packages on the same image share their .deb files.
  {
    echo "missing=$missing"
    echo "key=playwright-debs-${ImageOS:-linux}-$(uname --machine)-$(sha256sum <<< "$missing" | cut --characters 1-16)"
  } >> "$GITHUB_OUTPUT"
}

# Installs every .deb in a folder; succeeds when every package named after it is then installed.
# It asks dpkg, not Playwright: after an `apt-get update` Playwright also lists libraries that have
# a newer version, and Chromium does not need those.
install_folder() {
  local folder=$1 remaining
  local -a files
  shift
  shopt -s nullglob
  files=("$folder"/*.deb)
  shopt -u nullglob
  test "${#files[@]}" -gt 0 || return 1
  sudo dpkg --install "${files[@]}" > /dev/null || return 1
  remaining="$(dpkg-query --show --showformat '${db:Status-Status} ${Package}\n' "$@" 2>&1 \
    | grep --invert-match '^installed ')"
  test -z "$remaining" || { echo "Still missing after the install: $remaining" >&2; return 1; }
}

install_missing() {
  local -a packages
  local target="$DEBS"
  read -r -a packages <<< "$MISSING"
  if install_folder "$DEBS" "${packages[@]}"; then
    echo "Installed Chromium's packages from the cache, without the package mirror."
    return 0
  fi
  # A restored cache that did not install stays as it is; the fresh download goes beside it.
  if compgen -G "$DEBS/*.deb" > /dev/null; then
    echo "::warning::The cached packages did not install; downloading them from the package mirror."
    target="$(mktemp --directory)"
  fi
  mkdir -p "$target/partial"
  apt_bounded "$update_seconds" "apt-get update" update || exit 1
  apt_bounded "$download_seconds" "The package download" install --yes --no-install-recommends \
    --download-only -o "Dir::Cache::Archives=$target" "${packages[@]}" || exit 1
  # apt wrote them as root; the cache step reads them as the runner user.
  sudo chown --recursive "$(id -u):$(id -g)" "$target"
  if ! install_folder "$target" "${packages[@]}"; then
    echo "::error::Chromium's packages ($MISSING) did not install from the files the mirror sent."
    exit 1
  fi
  echo "Installed Chromium's packages from the package mirror."
}

case "${1:-}" in
  find) find_missing ;;
  install) install_missing ;;
  *) echo "usage: system-packages.sh find|install" >&2; exit 2 ;;
esac
