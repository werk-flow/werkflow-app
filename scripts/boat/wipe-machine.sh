#!/usr/bin/env bash
# Runs on a Boat verification machine for lib/testing/boat/machine-reuse.ts, which sends this text as
# the command itself, so the script never lands on the machine's disk.
#
#   record                           On a fresh machine, before its first run: lists every path the
#                                    snapshot left in each place a run writes, and marks the time.
#   wipe <repository> <main|linked>  After a run: removes every process, container, volume, folder
#                                    and file the run brought or produced, then checks that nothing
#                                    the run wrote is left. Exit 0 only then; any other exit, or a
#                                    check that cannot complete, means the machine is deleted.
set -uo pipefail
# One byte order for every listing, so comm compares them line by line.
export LC_ALL=C

pristine=/var/lib/werkflow-pristine
# Its modification time is the moment `record` ran: a file changed later was written by a run, by
# Boat's machine agent or by the desktop session.
marker="$pristine/marker"
work="$pristine/work"
# The temporary folders: whatever a run adds or changes there goes, at any depth.
temporary=(/tmp /var/tmp /dev/shm)
# Boat's own log of each command's output; every log but the snapshot's and this command's goes.
processes="$HOME/.ascii/processes"
# Folders inside the snapshot's own that a run writes, kept whole as recorded and put back: the
# Supabase CLI's traces hold the SQL a run sent, the heavy-command slots hold its locks, and Next.js
# makes its telemetry folder with every build, an empty one even with NEXT_TELEMETRY_DISABLED.
restored=(.supabase .cache/werkflow-heavy .config/nextjs-nodejs)
# Stores a machine keeps none of, though no run uses them: the coding-agent CLI folders, into which
# Boat's machine agent writes a skill and a small config when it hands out a machine, the snapshot's
# base image included (no credential file by any CLI's name, decision 15); and the desktop session's
# keyring, which the session creates then, after `record`, with no daemon left running. A run's
# browsers keep their secrets in Playwright's basic store, never there. Removed, then checked gone.
unkept_stores=(.claude .claude.json .codex .gemini .cursor .pi .kimi-code .prime .vibe .config/opencode
  .local/share/opencode .config/amp .local/share/amp .local/share/keyrings)
# The only places in the home folder where a path may appear or change after `record` and stay: the
# npm packages Bun installed (public), Boat's machine agent and its desktop driver (pid file and
# version check), the snapshot's seed clone that Boat copies in while the run starts (a run only
# clones from it), and the desktop session's own state, its Chrome profile included: a run's browsers
# are Playwright's, with profiles under /tmp.
home_exceptions=(.bun/install/cache .ascii .cua-driver .cache/cua-driver werkflow-seed .cache/fontconfig
  .cache/openbox .cache/ibus .cache/dconf .config/sunshine .config/ibus .config/pulse .config/dconf
  .config/systemd .config/google-chrome .dbus .Xauthority .xsession-errors .xsession-errors.old)

fail() {
  printf '[boat] wipe failed: %s\n' "$1" >&2
  exit 1
}

# The find test for the entries the desktop session and systemd create at the top of /tmp while the
# machine starts, possibly after `record`: the X server's lock file, the sticky X socket folders and
# root's systemd-private folders. Only these exact forms are left alone, and only in /tmp.
system_tmp=(-regextype posix-extended '(' -type f -regex '/tmp/\.X[0-9]+-lock' ')'
  -o '(' -type d -perm -1000 -regex '/tmp/\.(X11|ICE|XIM|font|Test)-unix' ')'
  -o '(' -type d -user root -regex '/tmp/systemd-private-[0-9a-f]+-.+' ')')

# Sets `spared` to the find test for what a place's listing and checks leave aside.
spared_in() {
  local path
  spared=()
  case "$1" in
    "$HOME")
      for path in "${home_exceptions[@]}" "${restored[@]}" "${unkept_stores[@]}"; do
        spared+=(-path "$HOME/$path" -o)
      done
      spared+=(-false)
      ;;
    /tmp) spared=("${system_tmp[@]}") ;;
    *) spared=(-false) ;;
  esac
}

# Writes the paths in a place, relative to it, NUL-separated and sorted, to a file: only the top
# with `top`, else every depth. Fails when the place cannot be read.
list_into() {
  local place="$1" into="$2" depth=()
  [ "${3:-}" != top ] || depth=(-maxdepth 1)
  spared_in "$place"
  sudo find "$place" -xdev -mindepth 1 "${depth[@]}" '(' "${spared[@]}" ')' -prune -o -printf '%P\0' \
    > "$into.raw" || fail "cannot list $place"
  sort -z "$into.raw" > "$into" || fail "cannot sort the listing of $place"
}
record_of() { printf '%s/%s.%s' "$pristine" "$(printf '%s' "$1" | tr '/' '_')" "$2"; }

# Writes the paths of a place that `record` did not list to a file, at the top or at every depth;
# for Boat's command logs, this command's own logs are spared.
added_into() {
  local place="$1" depth="$2" into="$3" record
  record="$(record_of "$place" "$depth")"
  [ -f "$record" ] || fail "no record of $place"
  list_into "$place" "$work/now" "$depth"
  comm -z -13 "$record" "$work/now" > "$into.all" || fail "cannot compare $place"
  if [ "$place" = "$processes" ]; then
    { grep -zv "^$$\." "$into.all" || [ $? -eq 1 ]; } > "$into" || fail "cannot filter $place"
  else
    mv "$into.all" "$into" || fail "cannot keep the comparison of $place"
  fi
}

# Writes every file of a place that changed after `record` to a file: not folders, whose times
# change as their contents go, and not symbolic links, which hold only a path and which Boat
# recreates while it copies the snapshot in. A path added since `record` is found by added_into,
# whatever its times.
changed_into() {
  local place="$1" into="$2"
  spared_in "$place"
  sudo find "$place" -xdev -mindepth 1 '(' "${spared[@]}" ')' -prune -o ! -type d ! -type l \
    -newer "$marker" -print0 > "$into" || fail "cannot search $place"
}

remove_unkept_stores() {
  local path
  for path in "${unkept_stores[@]}"; do
    sudo rm -rf -- "${HOME:?}/$path" || fail "cannot remove $path"
  done
}

# Ends every process an earlier command left behind, such as the test server or a browser. Boat runs
# each command in a cgroup scope of its own; each scope but this command's is killed as a unit, so a
# child forked meanwhile goes too, and must then hold no process.
kill_earlier_commands() {
  local own scope deadline left
  own="/sys/fs/cgroup$(sed -n 's/^0:://p' /proc/self/cgroup)" || fail "cannot read this command's cgroup"
  [ -f "$own/cgroup.kill" ] || fail "this machine has no cgroup v2 kill for its commands"
  sudo find /sys/fs/cgroup -type d -name 'ascii-cmd-*.scope' -print0 > "$work/scopes" ||
    fail "cannot list the command scopes"
  while IFS= read -r -d '' scope; do
    [ "$scope" != "$own" ] || continue
    # A scope that ended meanwhile is gone with its processes.
    [ ! -d "$scope" ] || echo 1 | sudo tee "$scope/cgroup.kill" > /dev/null || [ ! -d "$scope" ] ||
      fail "cannot kill $scope"
  done < "$work/scopes"
  deadline=$((SECONDS + 20))
  for (( ; ; )); do
    left=""
    while IFS= read -r -d '' scope; do
      [ "$scope" != "$own" ] && [ -d "$scope" ] || continue
      grep -qx 'populated 0' "$scope/cgroup.events" 2> /dev/null || [ ! -d "$scope" ] || left="$scope"
    done < "$work/scopes"
    [ -n "$left" ] || return 0
    [ "$SECONDS" -lt "$deadline" ] || fail "processes remain in $left"
    sleep 1
  done
}

record() {
  remove_unkept_stores
  sudo mkdir -p "$pristine" || fail "cannot create $pristine"
  sudo install -d -o "$(id -u)" "$work" || fail "cannot create $work"
  local place folder
  for place in "$HOME" "$processes"; do
    list_into "$place" "$work/listing" top
    sudo cp "$work/listing" "$(record_of "$place" top)" || fail "cannot record $place"
  done
  for place in "$HOME" "${temporary[@]}"; do
    list_into "$place" "$work/listing" all
    sudo cp "$work/listing" "$(record_of "$place" all)" || fail "cannot record $place"
  done
  for folder in "${restored[@]}"; do
    [ ! -e "$HOME/$folder" ] || sudo cp -a --parents "$HOME/$folder" "$pristine" || fail "cannot keep $folder"
  done
  sudo touch "$marker" || fail "cannot mark the time"
}

wipe() {
  local repo="$1" form="$2"
  [ -f "$marker" ] && [ -d "$work" ] || fail "the machine has no record of its fresh state"
  case "$repo" in
    /?*) ;;
    *) fail "the repository path is not absolute" ;;
  esac
  case "$HOME/" in "${repo%/}"/*) fail "the repository path holds the home folder" ;; esac

  kill_earlier_commands

  # The local stack with its data: the snapshot holds no container, no volume and no own network.
  local containers volumes
  containers="$(docker ps -aq)" || fail "docker ps"
  [ -z "$containers" ] || xargs docker rm --force --volumes <<< "$containers" > /dev/null || fail "docker rm"
  volumes="$(docker volume ls -q)" || fail "docker volume ls"
  [ -z "$volumes" ] || xargs docker volume rm --force <<< "$volumes" > /dev/null || fail "docker volume rm"
  docker network prune --force > /dev/null || fail "docker network prune"

  # The checkout, the clones beside it and the folders made for them; a linked worktree's main clone
  # and website clone lie in the home folder and go below.
  local workspace="$HOME"
  [ "$form" = linked ] || workspace="$(dirname "$repo")"
  sudo rm -rf -- "$repo" "$workspace/werkflow-website" || fail "cannot remove the checkout"
  sudo rmdir -p --ignore-fail-on-non-empty "$(dirname "$repo")" 2> /dev/null

  # What the run added at the top of the home folder and of the command logs: uploads, results, logs,
  # clones, command output. Below the top, an addition to the home folder fails the check instead.
  local place name
  for place in "$HOME" "$processes"; do
    added_into "$place" top "$work/added"
    while IFS= read -r -d '' name; do
      sudo rm -rf -- "${place:?}/$name" || fail "cannot remove $place/$name"
    done < "$work/added"
  done
  # In the temporary folders, every path added since `record`, at any depth and whatever its times,
  # and every file changed since.
  for place in "${temporary[@]}"; do
    added_into "$place" all "$work/added"
    while IFS= read -r -d '' name; do
      sudo rm -rf -- "${place:?}/$name" || fail "cannot remove $place/$name"
    done < "$work/added"
    changed_into "$place" "$work/changed"
    xargs -0 -r sudo rm -f -- < "$work/changed" || fail "cannot remove the files the run changed in $place"
  done
  local folder
  for folder in "${restored[@]}"; do
    sudo rm -rf -- "${HOME:?}/$folder" || fail "cannot remove $folder"
    [ ! -e "$pristine/$HOME/$folder" ] || sudo cp -a "$pristine/$HOME/$folder" "$HOME/$folder" ||
      fail "cannot put back $folder"
  done
  remove_unkept_stores

  # The check: no path added and no file changed since `record` remains outside the exceptions, the
  # home folder still holds the snapshot's files, and the stack is gone.
  local path shown
  for path in "${unkept_stores[@]}"; do
    [ ! -e "$HOME/$path" ] || fail "$path came back"
  done
  for folder in "${restored[@]}"; do
    if [ -e "$pristine/$HOME/$folder" ]; then
      sudo diff -r --no-dereference "$pristine/$HOME/$folder" "$HOME/$folder" > /dev/null ||
        fail "$folder differs from the snapshot's"
    else
      [ ! -e "$HOME/$folder" ] || fail "$folder remains"
    fi
  done
  added_into "$processes" top "$work/added"
  [ ! -s "$work/added" ] || fail "$processes still holds: $(head -c 300 "$work/added" | tr '\0' ' ')"
  for place in "$HOME" "${temporary[@]}"; do
    added_into "$place" all "$work/added"
    shown="$(head -c 300 "$work/added" | tr '\0' ' ')"
    [ ! -s "$work/added" ] || fail "paths added in $place: $shown"
    changed_into "$place" "$work/changed"
    shown="$(head -c 300 "$work/changed" | tr '\0' ' ')"
    [ ! -s "$work/changed" ] || fail "files changed in $place: $shown"
  done
  list_into "$HOME" "$work/now" top
  comm -z -23 "$(record_of "$HOME" top)" "$work/now" > "$work/missing" || fail "cannot compare $HOME"
  [ ! -s "$work/missing" ] || fail "$HOME lost what the snapshot holds: $(tr '\0' ' ' < "$work/missing")"
  [ ! -e "$repo" ] || fail "$repo remains"
  containers="$(docker ps -aq)" || fail "docker ps"
  volumes="$(docker volume ls -q)" || fail "docker volume ls"
  [ -z "$containers$volumes" ] || fail "a container or volume remains"
}

case "${1:-}" in
  record) record ;;
  wipe) wipe "${2:?repository}" "${3:?form}" ;;
  *) fail "usage: record | wipe <repository> <main|linked>" ;;
esac
