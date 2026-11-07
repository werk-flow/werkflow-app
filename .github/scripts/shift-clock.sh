#!/usr/bin/env bash
# Moves this disposable runner's kernel clock, for .github/workflows/date-lookahead.yml. Containers
# share the kernel's clock, so one step moves Bun, every child process, Chromium, the app and the
# Supabase stack together; a clock shifted per process leaves Postgres on today.
#
# Usage: shift-clock.sh set <instant>
#        shift-clock.sh restore
#
# `set` fails unless the shell, Bun and Postgres all show the instant: a leg that ran on the real
# clock would pass and prove nothing. `restore` puts the real clock back, and fails if the clock
# left the shift during the leg. Run everything that needs the network or the stack's images first:
# a certificate can be expired on a date weeks ahead.
set -euo pipefail

state="${RUNNER_TEMP}/shifted-clock"
stack=com.supabase.cli.project=werkflow-app
database=supabase_db_werkflow-app
# `set` restarts the stack before it reads the clocks; the bound holds that, and a slow runner.
set_tolerance=300
restore_tolerance=60

# Monotonic, so a clock step never moves it.
uptime_seconds() { cut -d. -f1 /proc/uptime; }

require_clock() {
  local name="$1" observed="$2" target="$3"
  # Written as the passing case, so a clock that cannot be read fails too.
  if test "$observed" -ge "$target" 2> /dev/null && test "$observed" -le "$((target + set_tolerance))"; then
    echo "${name}: $(date --utc --date="@${observed}" --iso-8601=seconds)"
  else
    echo "::error::${name} does not show the shifted clock, so this leg would prove nothing."
    exit 1
  fi
}

# `docker restart` returns before Postgres accepts connections.
wait_for_postgres() {
  local attempt
  for attempt in {1..60}; do
    docker exec "$database" pg_isready --quiet && return 0
    sleep 1
  done
  echo "::error::Postgres did not come back after ${attempt} attempts."
  exit 1
}

set_clock() {
  local target
  target="$(date --date="$1" +%s)"
  printf '%s %s %s\n' "$target" "$(date +%s)" "$(uptime_seconds)" > "$state"
  # The runner's time service would step the clock back.
  sudo systemctl stop chrony
  sudo date --utc --set="@${target}" > /dev/null
  # A long-running service may hold a clock of its own, so each starts on the new one.
  docker restart $(docker ps --quiet --filter "label=${stack}") > /dev/null
  wait_for_postgres
  bash .github/actions/local-stack/wait-for-edge-runtime.sh
  require_clock Shell "$(date +%s)" "$target"
  require_clock Bun "$(bun --eval 'console.log(Math.floor(Date.now() / 1000))')" "$target"
  require_clock Postgres "$(docker exec "$database" psql --username postgres --tuples-only --no-align \
    --command 'select floor(extract(epoch from now()))::bigint')" "$target"
}

restore_clock() {
  test -f "$state" || exit 0
  local target real started elapsed drift
  read -r target real started < "$state"
  elapsed="$(($(uptime_seconds) - started))"
  drift="$(($(date +%s) - target - elapsed))"
  sudo date --utc --set="@$((real + elapsed))" > /dev/null
  sudo systemctl start chrony
  if test "${drift#-}" -gt "$restore_tolerance"; then
    echo "::error::The clock left its shift by ${drift} s during this leg, so its result proves nothing."
    exit 1
  fi
}

action="$1"
shift
case "$action" in
  set) set_clock "$@" ;;
  restore) restore_clock ;;
  *) echo "::error::Unknown action ${action}."; exit 1 ;;
esac
