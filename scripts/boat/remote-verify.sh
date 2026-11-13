#!/usr/bin/env bash
# Runs on a Boat machine started from the verification snapshot, for lib/testing/boat/verify-on-boat.ts.
# Usage: remote-verify.sh <repository path> <HEAD commit> <main|linked> <test:verify arguments...>
#    or: remote-verify.sh <repository path> <HEAD commit> <main|linked> <focused script> <arguments...>
#    or: remote-verify.sh <repository path> <HEAD commit> <main|linked> test:audit:update-references <name> <arguments...>
#    or: remote-verify.sh <repository path> <HEAD commit> <main|linked> types:generate
#
# It rebuilds the workstation's checkout at the same absolute path, so every path in a report or a
# run manifest is the workstation's, starts the stack and, when the plan runs a browser group, the
# test server, as CI does, then runs `bun run test:verify` with the same arguments. A leading
# `test:audit:focused` or `test:golden:focused` runs that focused run instead
# (lib/testing/boat/focused-on-boat.ts), always with the test server; `test:audit:update-references`
# is the audit one with WERKFLOW_UPDATE_VISUAL_REFERENCES=1, and the references it rewrote or wrote
# join the evidence in the update folder the workstation named (lib/testing/boat/reference-updates.ts). A leading `types:generate` writes the
# types of this tree's migrations from the fresh stack instead (lib/testing/boat/types-on-boat.ts),
# without a server. It packs the evidence the run wrote into ~/results.tgz. Exit 90 means setup
# failed before the run started.
set -uo pipefail

repo="$1"
head="$2"
form="$3"
shift 3
script=test:verify
update=''
case "${1:-}" in
  test:audit:focused | test:golden:focused | types:generate)
    script="$1"
    shift
    ;;
  test:audit:update-references)
    script=test:audit:focused
    update="${2:-}"
    export WERKFLOW_UPDATE_VISUAL_REFERENCES=1
    shift 2
    ;;
esac
export PATH="$HOME/.bun/bin:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$HOME/.local/share/ms-playwright"
# Marks this machine as Boat's, so test:verify here never asks Boat again.
export WERKFLOW_BOAT_MACHINE=1

phase() { printf '[boat] %s (%ss)\n' "$1" "$SECONDS"; }
setup_failed() {
  printf '[boat] setup failed: %s\n' "$1" >&2
  exit 90
}

phase "checking out $head"
# The checkout takes the workstation's form: a linked worktree derives its ports from its path
# (lib/testing/runner/app-port.ts), and docs:check finds the siblings beside its main checkout.
if [ "$form" = linked ]; then
  main="$HOME/werkflow-app"
  workspace="$HOME"
else
  main="$repo"
  workspace="$(dirname "$repo")"
fi
sudo mkdir -p "$repo" && sudo chown "$(id -u):$(id -g)" "$repo" || setup_failed "cannot create $repo"
git clone --quiet --no-checkout "$HOME/werkflow-seed" "$main" || setup_failed "clone"
git -C "$main" remote set-url origin https://github.com/werk-flow/werkflow-app.git
git -C "$main" fetch --quiet origin main || setup_failed "fetch main"
if [ -f "$HOME/head.bundle" ]; then
  git -C "$main" fetch --quiet "$HOME/head.bundle" || setup_failed "fetch the local commits"
fi
if [ "$form" = linked ]; then
  git -C "$main" worktree add --quiet --detach "$repo" "$head" || setup_failed "worktree at $head"
else
  git -C "$main" checkout --quiet --detach "$head" || setup_failed "checkout $head"
fi
cd "$repo" || setup_failed "cd"
tar --extract --gzip --file "$HOME/tree.tgz" || setup_failed "unpack the working tree"
if [ -s "$HOME/deleted.txt" ]; then
  tr '\n' '\0' < "$HOME/deleted.txt" | xargs -0 rm -f --
fi
# docs:check reads the sibling clones beside the app. The private werkflow-business never comes to
# Boat; it is unchecked here, as in CI without its token.
sudo mkdir -p "$workspace/werkflow-website" && sudo chown "$(id -u):$(id -g)" "$workspace/werkflow-website"
git clone --quiet --depth 1 https://github.com/werk-flow/werkflow-website "$workspace/werkflow-website" ||
  setup_failed "clone werkflow-website"
export WERKFLOW_UNREADABLE_SIBLINGS=werkflow-business
mkdir -p .agent-logs
tar --extract --gzip --file "$HOME/evidence.tgz" || setup_failed "unpack the evidence"
find .agent-logs -mindepth 2 -maxdepth 2 -type d | sort > "$HOME/evidence-before.txt"

phase "installing dependencies"
bun install --frozen-lockfile > "$HOME/install.log" 2>&1 || { cat "$HOME/install.log"; setup_failed "bun install"; }
bun scripts/boat/check-tree.ts "$HOME/changed.json" || setup_failed "the rebuilt checkout differs from the workstation's"

phase "loading the stack images"
until docker info > /dev/null 2>&1; do sleep 1; done
docker load --quiet --input "$HOME/supabase-images.tar" > /dev/null || setup_failed "docker load"
phase "starting the stack"
# Loopback only, as in CI (.github/actions/local-stack/action.yml).
docker network inspect supabase_network_werkflow-app > /dev/null 2>&1 ||
  docker network create --label com.supabase.cli.project=werkflow-app \
    --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 supabase_network_werkflow-app > /dev/null
# A fresh stack applies this tree's migrations; the machine and its stack belong to this run alone.
SUPABASE_INTERNAL_IMAGE_REGISTRY=ghcr.io bunx supabase start --exclude studio,imgproxy > "$HOME/stack.log" 2>&1 ||
  { cat "$HOME/stack.log"; setup_failed "supabase start"; }
bunx supabase status --output env > "$HOME/stack.env" 2> /dev/null || setup_failed "supabase status"
set -a
# shellcheck disable=SC1091
. "$HOME/stack.env"
set +a
cat > .env.local-stack-backup <<EOF
NEXT_PUBLIC_SUPABASE_URL=$API_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
SUPABASE_SECRET_KEY=$SECRET_KEY
NEXT_PUBLIC_SITE_URL=http://localhost:3000
R2_ACCOUNT_ID=local
R2_ACCESS_KEY_ID=$S3_PROTOCOL_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=$S3_PROTOCOL_ACCESS_KEY_SECRET
R2_BUCKET_NAME=werkflow-documents-local
R2_ENDPOINT=$STORAGE_S3_URL
EOF
# The app reads this from the environment, so .env.local stays the same bytes as in CI.
EMAIL_OTP_HASH_SECRET="$(openssl rand -hex 32)"
export EMAIL_OTP_HASH_SECRET
bun run env:local > /dev/null || setup_failed "env:local"
bun scripts/boat/check-environment.ts "$HOME/backend-values.json" || setup_failed "the stack differs from the workstation's"
WERKFLOW_BOAT_PROOF_ENVIRONMENT="$(cat "$HOME/proof-environment")"
export WERKFLOW_BOAT_PROOF_ENVIRONMENT
bash .github/actions/local-stack/wait-for-edge-runtime.sh > "$HOME/edge.log" 2>&1 || { cat "$HOME/edge.log"; setup_failed "edge runtime"; }

# A focused capture has no plan and always needs the server. A plan is read whole first: grep -q on
# a pipe would stop the writer, and pipefail would hide the match.
serve=1
[ "$script" = types:generate ] && serve=0
if [ "$script" = test:verify ]; then
  bun run test:plan "$@" > "$HOME/plan.txt" 2> /dev/null || setup_failed "test:plan"
  grep -qE '^RUN +(golden|audit|canary):' "$HOME/plan.txt" || serve=0
fi
if [ "$serve" = 1 ]; then
  phase "building and serving the app"
  origin="$(sed -n 's/^NEXT_PUBLIC_SITE_URL=//p' .env.local)"
  nohup bun run test:server local > "$HOME/test-server.log" 2>&1 &
  server=$!
  deadline=$((SECONDS + 1200))
  until grep -q 'Serving the recorded local build' "$HOME/test-server.log" &&
    curl --silent --fail --output /dev/null "$origin/login"; do
    if ! kill -0 "$server" 2> /dev/null || [ "$SECONDS" -ge "$deadline" ]; then
      tail -n 40 "$HOME/test-server.log"
      setup_failed "test server"
    fi
    sleep 5
  done
fi

phase "running $script $*"
[ -z "$update" ] || bun scripts/boat/reference-updates.ts record "$HOME/references-before.json" ||
  setup_failed "hashing the visual references"
# The machine's peak memory use, so the run's size can be judged against its 16 GB.
while :; do free -m | awk '/^Mem:/ { print $3 }'; sleep 5; done > "$HOME/memory.log" &
sampler=$!
if [ "$script" = types:generate ]; then
  # The file returns with the evidence, from the folder types-on-boat.ts reads.
  bun run types:generate -- --local && mkdir -p .agent-logs/types/generated &&
    cp lib/supabase/database.types.ts .agent-logs/types/generated/
else
  bun run "$script" "$@"
fi
code=$?
kill "$sampler" 2> /dev/null
phase "$script exited $code; peak memory in use $(sort -n "$HOME/memory.log" | tail -n 1) MiB"

# The run's own evidence: every report and run folder that did not exist before, and the server log.
# A failed collection brings no reference back and fails the run, whatever the browser run's exit.
# A failed run's references come back marked, as evidence the workstation never places.
if [ -n "$update" ] && ! bun scripts/boat/reference-updates.ts collect "$HOME/references-before.json" \
  "$update" "$code"; then
  printf '[boat] collecting the rewritten visual references failed; none come back, and the run fails.\n'
  code=1
fi
find .agent-logs -mindepth 2 -maxdepth 2 -type d | sort > "$HOME/evidence-after.txt"
comm -13 "$HOME/evidence-before.txt" "$HOME/evidence-after.txt" > "$HOME/evidence-new.txt"
# A failed browser group's retained world dies with this machine: clean it here, so its manifest
# says so. A run without a retained world refuses the cleanup, which changes nothing.
grep '^\.agent-logs/playwright-runs/' "$HOME/evidence-new.txt" | while read -r run; do
  [ -f "$run/state/world.json" ] || continue
  if ! bun run test:runs cleanup "$(basename "$run")" > "$HOME/cleanup.log" 2>&1; then
    tail -n 3 "$HOME/cleanup.log"
    printf '[boat] the world of run %s could not be cleaned on the machine, which is now deleted. Run bun run test:runs cleanup %s on the workstation.\n' \
      "$(basename "$run")" "$(basename "$run")"
  fi
done
[ -d .agent-logs/test-server ] && echo .agent-logs/test-server >> "$HOME/evidence-new.txt"
# Only what the workstation reads comes back (lib/testing/boat/result-files.ts). If that choice
# fails, every new folder comes back whole.
if ! bun scripts/boat/result-files.ts "$HOME/evidence-new.txt" "$HOME/results.list"; then
  printf '[boat] choosing the result files failed; every new evidence folder comes back whole.\n'
  tr '\n' '\0' < "$HOME/evidence-new.txt" > "$HOME/results.list"
fi
tar --create --gzip --file "$HOME/results.tgz" --null --files-from "$HOME/results.list"
exit "$code"
