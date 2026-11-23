#!/bin/bash
# The machine runner's start probe (lib/testing/ci/container-slot.ts, probeCommand): run as a job is,
# with the slot's Docker socket, it must find none of the runner's sentinels, neither in its own view
# nor through a container that mounts the slot host's root, reach none of the runner's ports, and
# see the stack's ports outside the slot's ephemeral port range.
# Exit 0: the boundary holds. Usage: werkflow-ci-probe <token> <sentinel,...> <host:port,...>
set -uo pipefail
token=$1
IFS=, read -r -a sentinels <<< "$2"
IFS=, read -r -a ports <<< "${3:-}"
seen() { test -f "$1" && grep -qx "$token" "$1"; }
# The view through the socket must work at all, or its silence would prove nothing.
docker run --rm --volume /:/host --entrypoint sh "$WERKFLOW_PROBE_IMAGE" -c 'test -d /host/etc' \
  || { echo "probe: no container starts through the slot's socket" >&2; exit 2; }
for path in "${sentinels[@]}"; do
  if seen "$path"; then echo "probe: the job reads $path" >&2; exit 1; fi
  if docker run --rm --volume /:/host --entrypoint sh "$WERKFLOW_PROBE_IMAGE" -c "test -f '/host$path' && grep -qx '$token' '/host$path'"; then
    echo "probe: a container through the slot's socket reads $path" >&2
    exit 1
  fi
done
# The Supabase stack's ports (54321-54327) must lie outside the range outgoing connections take
# (scripts/ci/prepare.ts); the install sets it on the slot, and no job may change it.
read -r low high < "${WERKFLOW_PORT_RANGE_FILE:-/proc/sys/net/ipv4/ip_local_port_range}"
if test "$low" -le 54327 && test "$high" -ge 54321; then
  echo "probe: the slot's ip_local_port_range $low-$high covers the stack's ports 54321-54327" >&2
  exit 1
fi
for address in "${ports[@]}"; do
  test -n "$address" || continue
  if timeout 3 bash -c "exec 3<>/dev/tcp/${address%:*}/${address##*:}" 2> /dev/null; then
    echo "probe: the job reaches $address" >&2
    exit 1
  fi
done
echo "probe: the boundary holds"
