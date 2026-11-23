#!/bin/bash
# The machine runner's start probe (lib/testing/ci/container-slot.ts, probeCommand): run as a job is,
# with the slot's Docker socket, it must find none of the runner's sentinels, neither in its own view
# nor through a container that mounts the slot host's root, and reach none of the runner's ports.
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
for address in "${ports[@]}"; do
  test -n "$address" || continue
  if timeout 3 bash -c "exec 3<>/dev/tcp/${address%:*}/${address##*:}" 2> /dev/null; then
    echo "probe: the job reaches $address" >&2
    exit 1
  fi
done
echo "probe: the boundary holds"
