#!/bin/bash
# Resets the Mac's CI slot between runs (the machine runner's `reset`, docs/technical/machine-setup.md).
# Run on the Mac, the runner's own side: ci/slot/reset-colima.sh <trusted image archive>
# Every job holds the `ci` profile VM's Docker socket, so anything in the VM may be a job's work.
# The reset therefore deletes the whole VM and starts a new one at the size it had, without host
# mounts. It sets the stack's port range, makes the slot root and loads the trusted image from the
# archive on this side, which no job reaches.
set -euo pipefail
archive=${1:?the trusted image archive}
read -r cpus memory < <(colima list --profile ci --json | jq -r '"\(.cpus) \(.memory / 1073741824 | floor)"')
colima delete --profile ci --force
mkdir -p "$HOME/.colima-ci-empty"
colima start --profile ci --cpu "$cpus" --memory "$memory" --mount "$HOME/.colima-ci-empty"
colima ssh --profile ci -- sudo sh -c 'echo "net.ipv4.ip_local_port_range = 55000 65000" > /etc/sysctl.d/90-werkflow-ci.conf && sysctl --system > /dev/null'
colima ssh --profile ci -- sh -c 'sudo install -d -o "$(id -un)" /var/lib/werkflow-ci'
colima ssh --profile ci -- docker load --quiet < "$archive"
echo "reset: the ci profile is fresh"
