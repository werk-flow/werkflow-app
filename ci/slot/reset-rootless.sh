#!/bin/bash
# Resets the PC's rootless CI slot between runs (the machine runner's `reset`, docs/technical/machine-setup.md).
# Run as root in werkflow-ci: wsl.exe -d werkflow-ci -u root --exec /usr/local/sbin/werkflow-ci-reset cirunner
# Nothing a run wrote survives it: every process of the slot user ends, its runtime folder goes, and
# its home, with the Docker data root, and its files in /tmp, /var/tmp and /dev/shm (its subordinate
# ids' too) are wiped. Its units come back from root-owned copies in /etc/werkflow-ci, the git cache
# from the root-owned mirror /var/lib/werkflow-ci/git.git, and only then does the user start again:
# the daemon restarts and loads the trusted image from the root-owned archive /var/lib/werkflow-ci/image.tar.
set -euo pipefail
user=${1:?the slot user}
uid=$(id -u "$user")
# The slot user is an unprivileged account of its own: never a system account, never a sudoer.
if test "$uid" -lt 1000; then echo "reset: $user's uid $uid is a system account's" >&2; exit 1; fi
for group in $(id -nG "$user"); do
  case $group in sudo | wheel | admin) echo "reset: $user is in the $group group" >&2; exit 1 ;; esac
done
home=$(realpath -m "$(getent passwd "$user" | cut -d: -f6)")
case $home in /home/?*) ;; *) echo "reset: $user's home $home is no /home folder" >&2; exit 1 ;; esac
runtime=/run/user/$uid
read -r sub_start sub_count < <(awk -F: -v user="$user" '$1 == user { print $2, $3; exit }' "${WERKFLOW_SUBUID_FILE:-/etc/subuid}")
if test -z "${sub_count:-}"; then echo "reset: $user has no subordinate ids" >&2; exit 1; fi

# Every process of the user ends, its systemd manager and Docker daemon included, and its runtime
# folder with the daemon's socket goes: nothing a job started outlives the reset.
systemctl stop "user@$uid.service"
systemctl stop "user-runtime-dir@$uid.service"
pkill -KILL -u "$uid" || true
for _ in $(seq 1 30); do pgrep -u "$uid" > /dev/null || break; sleep 1; done
if pgrep -u "$uid" > /dev/null; then echo "reset: a process of $user outlives the stop" >&2; exit 1; fi
if test -e "$runtime"; then echo "reset: $runtime outlives the stop" >&2; exit 1; fi
# The data root holds files of the user's subordinate ids, which only root removes.
find "$home" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
find /tmp /var/tmp /dev/shm -xdev -mindepth 1 \( -uid "$uid" -o \( -uid +$((sub_start - 1)) -uid -$((sub_start + sub_count)) \) \) \
  -prune -exec rm -rf -- {} +

install -d -o "$user" -g "$user" -m 700 "$home/.config" "$home/.config/systemd" "$home/.config/systemd/user" \
  "$home/.config/systemd/user/docker.service.d" "$home/.config/docker" "$home/ci" "$home/ci/git"
install -o "$user" -g "$user" -m 600 /etc/werkflow-ci/docker.service "$home/.config/systemd/user/docker.service"
install -o "$user" -g "$user" -m 600 /etc/werkflow-ci/ports.conf "$home/.config/systemd/user/docker.service.d/ports.conf"
install -o "$user" -g "$user" -m 600 /etc/werkflow-ci/daemon.json "$home/.config/docker/daemon.json"
git -C /var/lib/werkflow-ci/git.git fetch --quiet --no-tags --prune https://github.com/werk-flow/werkflow-app.git '+refs/heads/*:refs/heads/*'
cp -a /var/lib/werkflow-ci/git.git "$home/ci/git/werkflow-app.git"
chown -R "$user:$user" "$home/ci"

systemctl start "user@$uid.service"
runuser -u "$user" -- env XDG_RUNTIME_DIR="$runtime" systemctl --user start docker.service
export DOCKER_HOST=unix://$runtime/docker.sock
for _ in $(seq 1 60); do docker info > /dev/null 2>&1 && break; sleep 1; done
docker load --quiet --input /var/lib/werkflow-ci/image.tar
echo "reset: $user's slot is fresh"
