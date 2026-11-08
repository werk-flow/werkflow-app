#!/usr/bin/env bash
# Runs on a fresh Boat machine for scripts/boat/build-snapshot.ts and leaves it ready to be saved
# as the verification snapshot (docs/technical/boat-verification.md): pinned Bun, the Playwright
# browser, a clone of the public repository with its dependencies, and the local Supabase stack
# created and running. Nothing of the owner's goes onto the machine.
set -euo pipefail

seed="$HOME/werkflow-seed"
log() { printf '[snapshot] %s\n' "$*"; }

# The base image signs coding-agent CLIs in on start. This machine needs none, and no agent
# credential may live on it.
log "agent CLI folders before removal:"
for path in ~/.claude ~/.claude.json ~/.codex ~/.gemini ~/.config/opencode ~/.local/share/opencode \
  ~/.cursor ~/.config/amp ~/.local/share/amp ~/.pi ~/.config/ascii/boat; do
  if [ -e "$path" ]; then
    log "  removing $path"
    rm -rf "$path"
  fi
done

# The base image carries an Android container image the runs never use.
for image in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -i redroid || true); do
  log "removing image $image"
  docker ps -aq --filter "ancestor=$image" | xargs -r docker rm -f >/dev/null
  docker rmi -f "$image" >/dev/null
done

# Playwright keeps browsers in ~/.cache by default, which a snapshot does not save.
if ! head -n 1 ~/.bashrc | grep -q PLAYWRIGHT_BROWSERS_PATH; then
  sed -i '1i export PLAYWRIGHT_BROWSERS_PATH="$HOME/.local/share/ms-playwright"' ~/.bashrc
fi
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.local/share/ms-playwright"

bun_version="$(cat "$HOME/bun-version")"
if [ "$(~/.bun/bin/bun --version 2>/dev/null || true)" != "$bun_version" ]; then
  log "installing Bun $bun_version"
  curl -fsSL https://bun.sh/install | bash -s "bun-v$bun_version" >/dev/null
fi
grep -q 'bun/bin' ~/.bashrc || sed -i '2i export PATH="$HOME/.bun/bin:$PATH"' ~/.bashrc
export PATH="$HOME/.bun/bin:$PATH"
log "bun $(bun --version), node $(node --version 2>/dev/null || echo missing), docker $(docker --version)"

# The stack's ports sit inside Linux's default ephemeral range; keep outgoing connections off them,
# as CI does (.github/actions/local-stack/action.yml).
echo 'net.ipv4.ip_local_port_range = 55000 65000' | sudo tee /etc/sysctl.d/60-werkflow-ports.conf >/dev/null
sudo sysctl -q -w net.ipv4.ip_local_port_range="55000 65000"

log "cloning the public repository"
rm -rf "$seed"
git clone --quiet https://github.com/werk-flow/werkflow-app.git "$seed"
cd "$seed"
git checkout --quiet --detach "$(cat "$HOME/seed-commit")"
bun install --frozen-lockfile >/dev/null
bunx playwright install --with-deps chromium >/dev/null

log "starting the local Supabase stack"
docker network inspect supabase_network_werkflow-app >/dev/null 2>&1 ||
  docker network create --label com.supabase.cli.project=werkflow-app \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 supabase_network_werkflow-app >/dev/null
SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io bunx supabase start --exclude studio,imgproxy >/dev/null

# Boat pulls a registry image again at every start, and it recreates a snapshot's containers late
# and on its own schedule, which would race a run's stack. So the snapshot keeps the stack's images
# as a file and no stack container; remote-verify.sh loads the file and starts a fresh stack.
log "saving the stack images and removing the stack"
docker ps --filter label=com.supabase.cli.project=werkflow-app --format '{{.Image}}' | sort -u > "$HOME/stack-images.txt"
xargs docker save --output "$HOME/supabase-images.tar" < "$HOME/stack-images.txt"
bunx supabase stop --no-backup >/dev/null
docker network rm supabase_network_werkflow-app >/dev/null 2>&1 || true
ls -l "$HOME/supabase-images.tar"
log "ready to save"
