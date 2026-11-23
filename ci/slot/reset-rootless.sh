#!/bin/bash
# Resets the PC's rootless CI slot between runs (the machine runner's `reset`, docs/technical/machine-setup.md).
# Run as root in werkflow-ci: wsl.exe -d werkflow-ci -u root --exec /usr/local/sbin/werkflow-ci-reset cirunner
# Nothing a run wrote survives it: the slot user's Docker data root and every writable file of the
# user are wiped, the user's units come back from root-owned copies in /etc/werkflow-ci, the daemon
# restarts, the trusted image is loaded from the root-owned archive /var/lib/werkflow-ci/image.tar,
# and the git cache is copied from the root-owned mirror /var/lib/werkflow-ci/git.git.
set -euo pipefail
user=${1:?the slot user}
uid=$(id -u "$user")
home=$(getent passwd "$user" | cut -d: -f6)
case $home in /home/?*) ;; *) echo "reset: $user's home $home is no /home folder" >&2; exit 1 ;; esac
export XDG_RUNTIME_DIR=/run/user/$uid
as_user() { runuser -u "$user" -- env XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" "$@"; }

# Every process of the user ends, its systemd manager and Docker daemon included: nothing a job
# started outlives the reset.
systemctl stop "user@$uid.service"
pkill -KILL -u "$uid" || true
for _ in $(seq 1 30); do pgrep -u "$uid" > /dev/null || break; sleep 1; done
if pgrep -u "$uid" > /dev/null; then echo "reset: a process of $user outlives the stop" >&2; exit 1; fi
# The data root holds files of the user's subordinate ids, which only root removes.
find "$home" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +

install -d -o "$user" -g "$user" -m 700 "$home/.config" "$home/.config/systemd" "$home/.config/systemd/user" \
  "$home/.config/systemd/user/docker.service.d" "$home/.config/docker" "$home/ci" "$home/ci/git"
install -o "$user" -g "$user" -m 600 /etc/werkflow-ci/docker.service "$home/.config/systemd/user/docker.service"
install -o "$user" -g "$user" -m 600 /etc/werkflow-ci/ports.conf "$home/.config/systemd/user/docker.service.d/ports.conf"
install -o "$user" -g "$user" -m 600 /etc/werkflow-ci/daemon.json "$home/.config/docker/daemon.json"

systemctl start "user@$uid.service"
as_user systemctl --user start docker.service
export DOCKER_HOST=unix://$XDG_RUNTIME_DIR/docker.sock
for _ in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
docker load --quiet --input /var/lib/werkflow-ci/image.tar

git -C /var/lib/werkflow-ci/git.git fetch --quiet --no-tags --prune https://github.com/werk-flow/werkflow-app.git '+refs/heads/*:refs/heads/*'
cp -a /var/lib/werkflow-ci/git.git "$home/ci/git/werkflow-app.git"
chown -R "$user:$user" "$home/ci"
echo "reset: $user's slot is fresh"
