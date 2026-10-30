#!/usr/bin/env bash
# Waits, bounded, for the answer the test server's preflight wants: 204 to an OPTIONS request of
# send-invite-email. Each attempt is bounded, so a hung request cannot outlast the deadline.
#
# The CLI gives the edge-runtime container no restart policy, and its process is the container's
# PID 1. When that process exits, Kong answers 502, then 503 at once for the rest of the job,
# because the container's name stops resolving. On that state the wait prints the container's
# exit state and log and starts the container once. A failure prints every attempt, the state,
# the resource use and the Kong and runtime logs.
set -uo pipefail
runtime=supabase_edge_runtime_werkflow-app

state() {
  docker inspect --format 'Runtime container: running={{.State.Running}} exit={{.State.ExitCode}} oom_killed={{.State.OOMKilled}} error={{.State.Error}} finished={{.State.FinishedAt}}' "$runtime"
}

deadline=$((SECONDS + 180))
attempts=""
restarted=false
until answer="$(curl --silent --max-time 10 --output /dev/null --write-out '%{http_code} %{time_total}s' \
  --request OPTIONS http://127.0.0.1:54321/functions/v1/send-invite-email)"; test "${answer%% *}" = 204; do
  attempts+="${SECONDS}s: ${answer}"$'\n'
  if test "$restarted" = false && test "$(docker inspect --format '{{.State.Running}}' "$runtime")" = false; then
    echo "::warning::The edge runtime exited after ${SECONDS} s; starting it once."
    state
    docker logs --timestamps "$runtime"
    docker start "$runtime" > /dev/null
    restarted=true
    attempts+="${SECONDS}s: started the stopped runtime"$'\n'
  fi
  if test $SECONDS -ge $deadline; then
    echo "::error::The edge runtime did not answer 204 within 180 s."
    printf 'Attempts (time since the step started: status, request time):\n%s' "$attempts"
    state
    docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}'
    docker logs --timestamps "$runtime"
    docker logs --timestamps --tail 40 supabase_kong_werkflow-app
    exit 1
  fi
  sleep 3
done
echo "The edge runtime answered 204 after ${SECONDS} s (${answer#* })."
if test "$restarted" = true; then
  printf 'Attempts (time since the step started: status, request time):\n%s' "$attempts"
fi
