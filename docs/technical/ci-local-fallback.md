# The frozen `local` CI fallback

CI runs on the `fleet` profile, on GitHub Actions ([decision 0011](../decisions/0011-ci-profiles.md#amendment-2026-11-23-github-actions-is-the-ci-home-again)). The `local` profile, a runner on the owner's MacBook and PC, is frozen. This page lets an agent switch back to `local` if Actions fails again. Epic: werk-flow/werkflow-planning#503.

## Where the work is

- **The runner:** the tag `archive/local-runner-2026-11-23`. It holds the machine runner with the claim as a lease ref (P5) and the machine windows (P8). Its closed PR, #603, holds the security model, the review ledger and the open risks.
- **The install steps:** `docs/technical/machine-setup.md`, section "Run CI on the owner's machines", at that tag.
- **The archive:** werk-flow/werkflow-planning#546, folder `ops/ci-local-fallback/`: the design, the progress of each part, the measurements and the council's reviews.

## What exists

- **Merged:** the inventory (`lib/testing/ci/inventory.ts`), both profiles and the switch (`lib/testing/ci/profiles.ts`, `ci/profile.json`), and the midnight window per serial shard (#601), proven only with a faked clock.
- **Built, never run on a machine:** the machine runner, the container executor, the lease and the windows (the tag).
- **Not built:** a quick check per PR on `local`, and the date look-ahead on `local`.

## Rebuild the machines

The `local` profile's CI is removed from all three machines. The archive paths below are folders in werkflow-planning.

### 1. The Mac

- **Removed:** the Colima profile `ci` and its disk, the stand-in's launchd jobs, its work roots and its private `R` folder.
- **Archive:** `ops/ci-local-fallback/mac-standin/` (planning PR pending).
- **Rebuild, then switch on:**
  1. Create the Colima profile `ci` without host mounts.
  2. Check out the restored runner's reviewed commit as the trusted checkout, and build the image.
  3. Install the CI App key (F1) by secret card.
  4. Install the launchd agent per machine-setup.md, and leave it stopped.
  5. Run the boundary probe.
  6. Switch it on at step 8 of [the switch back](#switch-back-from-fleet-to-local).

### 2. The PC

- **Removed:** the WSL distribution `werkflow-ci`, unregistered.
- **Archive:** `ops/ci-local-fallback/pc-workbench/` (werk-flow/werkflow-planning#547): `rootless-slot.sh`, the `wsl.conf`, the image recipe and the measurement drivers.
- **Stays:** `ci-alert.timer` (werkflow-planning `ops/ci-alert.py`), which watches the Actions alerts and dispatches main's daytime full run.
- **Rebuild, then switch on:**
  1. Import the official Ubuntu 24.04 root file system as `werkflow-ci`, after you check its SHA256 sum and GPG signature.
  2. Write the locked-down `wsl.conf`, then run `wsl.exe --terminate werkflow-ci`, never `--shutdown`.
  3. Set up the rootless Docker slot for user `cirunner`.
  4. Run the runner's install per machine-setup.md, with the reset's sources.
  5. Install the CI App key by secret card.
  6. Install the systemd user unit, and leave it stopped.
  7. Switch it on at step 8 of [the switch back](#switch-back-from-fleet-to-local), outside Monday and Friday 06:00–17:00 Berlin.

### 3. The VM

- **Removed, done:** the conductor; the users `werkflowci` and `werkflowci-publisher`; every CI unit file; and `/srv/werkflowci`, `/etc/werkflowci`, `/usr/local/lib/werkflowci` and `/etc/werkflowci-publisher`.
- **Archive:** `ops/ci-local-fallback/vm/` (werk-flow/werkflow-planning#548), and werk-flow/werkflow-planning#546's `vm-orchestrator/`: the isolation's `apply.sh`, `verify.sh` and `rollback.sh`.
- **Kept installed and disabled, with no keys:** `werkflow-release@` and `werkflow-dev-deploy`.
- **Keys:** every VM key is deleted. The release and DEV paths come back only as in [Put the VM release and DEV keys back](#put-the-vm-release-and-dev-keys-back).
- **Never** enable a VM timer while its GitHub twin, `release.yml` or `staging.yml`, is enabled.

### Order across machines

1. The VM's isolation (`apply.sh`, then `verify.sh`), only if the conductor is needed.
2. The PC and the Mac, installed and stopped.
3. [The switch back](#switch-back-from-fleet-to-local).

## What stays open

The runner serves PR integration runs only. Before `local` can carry CI unattended, from #603's open risks and the council's last shortest lists:

1. **Queue commit bundles.** The container executor cannot stage the queue's local integration commit, which GitHub never holds.
2. **One dispatcher per schedule.** `local` still plans clocks that no code fires. Each schedule needs its dispatcher and a first successful run before the cutover counts as complete.
3. **The release slot.** Reserve main's full run before the 03:30 release decision; ship the newest green full-run commit.
4. **The VM watcher.** It alerts on a ready PR without a lease, a dead machine and overdue scheduled work.
5. **A real machine run with drills:** a claim race, a moved head, a window edge, a restart, and measured PR-run times.
6. **The Mac's `colima ssh` argument check:** that the slot prefix hands each argument on unchanged, as the PC's check does.
7. **The accepted residuals:** a shared Docker daemon within one run, the App key readable by agents on the PC, and no queue-host failover. #603 records each.

## Put the VM release and DEV keys back

For releases the VM is dispatch-only: when Actions works but needs a clock, the VM dispatches `release.yml`. The `werkflow-release@` path (werk-flow/werkflow-planning#517), which writes PROD through its own script, stays off. It could be used only after the owner changes AGENTS.md's rule "Never write to PROD outside the `release` workflow" and that rule's enforcement.

The VM's release and DEV tokens and its `werkflow-vm-release` deploy key are deleted; their units stay installed and disabled. The steps below restore the VM's credentials for the release dispatch and the DEV deploy, never for `werkflow-release@`:

1. Follow the phase 2 runbook `ops/release-credentials.md` in werkflow-planning: four `request_secret` cards with file delivery, a one-hour timeout and the hint "paste". `ops/release-credential-install.sh` installs them.
2. Run `ops/release-deploy-key.sh` for a new deploy key. The owner adds it to this repository with write access.
3. Plan about 15 minutes with the owner.
4. The release dispatch keeps `release.yml` enabled. For the DEV deploy, disable `staging.yml` and drain it before you enable `werkflow-dev-deploy.timer`. The drain reads every page of each status that is not completed. It holds only when the command exits 0 and prints nothing:

   ```bash
   (set -euo pipefail
    for status in requested queued pending waiting in_progress action_required; do
      gh api --paginate "repos/werk-flow/werkflow-app/actions/workflows/<file>/runs?status=$status&per_page=100" \
        --jq '.workflow_runs[] | "\(.id) \(.status)"'
    done)
   ```

   A failed or partial query counts as not drained. Never run a VM path and its GitHub workflow at once.

## Switch back from `fleet` to `local`

1. The owner decides.
2. Restore the runner from the tag `archive/local-runner-2026-11-23` onto a new branch from `main`, rebase it, finish the open items, and open a new PR. Merge it with a green `fleet` `Check`.
3. [Rebuild the machines](#rebuild-the-machines), each runner service installed but stopped: the runner refuses to start while `main` names `fleet`.
4. Set `ci/profile.json` to `{ "profile": "local" }` in a PR, and merge it with a green `fleet` `Check`.
5. Pause merges: turn auto-merge off on every open PR, and merge nothing by hand.
6. Retire Actions: `gh workflow disable ci.yml -R werk-flow/werkflow-app`. Drain it as in step 4 of [the keys](#put-the-vm-release-and-dev-keys-back).
7. In the `main` ruleset, have the owner:
   - turn the merge queue off;
   - pin `Check` to App 5871705;
   - turn on "Require branches to be up to date before merging".
8. Start both runners. Watch the first PR a machine claims until its App-owned `Check` reaches its verdict.
9. Resume merges.
10. For the DEV deploy and the release dispatch, follow [Put the VM release and DEV keys back](#put-the-vm-release-and-dev-keys-back).

If Actions is already completely unavailable, the runner's PR and the profile switch cannot get a `Check` from it. Landing them then needs another trusted `Check`, which is the owner's decision.
