# The frozen `local` CI fallback

CI runs on the `fleet` profile, on GitHub Actions ([decision 0011](../decisions/0011-ci-profiles.md#amendment-2026-11-23-github-actions-is-the-ci-home-again)). The `local` profile, a runner on the owner's MacBook and PC, is frozen. This page lets an agent switch back to `local` if Actions fails again. Epic: werk-flow/werkflow-planning#503.

## Where the work is

- **The parked PR:** #603, branch `t3/machine-runner`, an unmerged draft. Its body holds the security model, the review ledger and the open risks. It contains P5, the claim as a lease ref (branch `t3/machine-runner-lease`), and P8, the machine windows (branch `t3/machine-runner-windows`).
- **The install steps:** `docs/technical/machine-setup.md`, section "Run CI on the owner's machines", on branch `t3/machine-runner`.
- **The archive:** werk-flow/werkflow-planning#546, folder `ops/ci-local-fallback/`: the design, the progress of each part, the measurements and the council's reviews.

## What exists

- **Merged:** the inventory (`lib/testing/ci/inventory.ts`), both profiles and the switch (`lib/testing/ci/profiles.ts`, `ci/profile.json`), and the midnight window per serial shard (#601), proven only with a faked clock.
- **Built, never run on a machine:** the machine runner, the container executor, the lease and the windows (#603).
- **Not built:** a quick check per PR on `local`, and the date look-ahead on `local`.

## Rebuild the machines

The `local` profile's CI is removed from all three machines. The archive paths below are folders in werkflow-planning.

### 1. The Mac

- **Removed:** the Colima profile `ci` and its disk, the stand-in's launchd jobs, its work roots and its private `R` folder.
- **Archive:** `ops/ci-local-fallback/mac-standin/`.
- **Rebuild, then switch on:**
  1. Create the Colima profile `ci` without host mounts.
  2. Check out #603's commit as the trusted checkout, and build the image.
  3. Install the CI App key (F1) by secret card.
  4. Install the launchd agent per machine-setup.md, and leave it stopped.
  5. Run the boundary probe.
  6. Switch it on at step 8 of [the switch back](#switch-back-from-fleet-to-local).

### 2. The PC

- **Removed:** the WSL distribution `werkflow-ci`, unregistered.
- **Archive:** `ops/ci-local-fallback/pc-workbench/`: `rootless-slot.sh`, the `wsl.conf`, the image recipe and the measurement drivers.
- **Stays:** `ci-alert.timer`, which watches the Actions alerts.
- **Rebuild, then switch on:**
  1. Import the official Ubuntu 24.04 root file system as `werkflow-ci`, after you check its SHA256 sum and GPG signature.
  2. Write the locked-down `wsl.conf`, then run `wsl.exe --terminate werkflow-ci`, never `--shutdown`.
  3. Set up the rootless Docker slot for user `cirunner`.
  4. Run #603's install per machine-setup.md, with the reset's sources.
  5. Install the CI App key by secret card.
  6. Install the systemd user unit, and leave it stopped.
  7. Switch it on at step 8 of [the switch back](#switch-back-from-fleet-to-local), outside Monday and Friday 06:00–17:00 Berlin.

### 3. The VM

- **Removed:** the conductor, the users `werkflowci` and `werkflowci-publisher`, and every `werkflow-ci-*` and `werkflowci-*` unit.
- **Archive:** `ops/ci-local-fallback/vm/`, and #546's `vm-orchestrator/`: the isolation's `apply.sh`, `verify.sh` and `rollback.sh`.
- **Kept installed and disabled:** `werkflow-release@` and `werkflow-dev-deploy`.
- **Keys:** every VM key is deleted. The release and DEV paths come back only as in [Put the VM release and DEV keys back](#put-the-vm-release-and-dev-keys-back).
- **Never** enable a VM timer while its GitHub twin, `release.yml` or `staging.yml`, is enabled.

### Order across machines

1. The VM's isolation (`apply.sh`, then `verify.sh`), only if the conductor is needed.
2. The PC and the Mac, installed and stopped.
3. [The switch back](#switch-back-from-fleet-to-local).

## What stays open

#603 serves PR integration runs only. Before `local` can carry CI unattended, from #603's open risks and the council's last shortest lists:

1. **Queue commit bundles.** The container executor cannot stage the queue's local integration commit, which GitHub never holds.
2. **One dispatcher per schedule.** `local` still plans clocks that no code fires. Each schedule needs its dispatcher and a first successful run before the cutover counts as complete.
3. **The release slot.** Reserve main's full run before the 03:30 release decision; ship the newest green full-run commit.
4. **The VM watcher.** It alerts on a ready PR without a lease, a dead machine and overdue scheduled work.
5. **A real machine run with drills:** a claim race, a moved head, a window edge, a restart, and measured PR-run times.
6. **The Mac's `colima ssh` argument check:** that the slot prefix hands each argument on unchanged, as the PC's check does.
7. **The accepted residuals:** a shared Docker daemon within one run, the App key readable by agents on the PC, and no queue-host failover. #603 records each.

## Put the VM release and DEV keys back

PROD changes only through the `release` workflow. The VM release path is an owner-approved route for when Actions cannot run `release.yml` (werk-flow/werkflow-planning#517). It is used only by the owner's decision and under the existing release hold. Where the VM only supplies the clock, it dispatches `release.yml`. The VM's release and DEV tokens and its `werkflow-vm-release` deploy key are deleted; their units stay installed and disabled.

1. Follow the phase 2 runbook `ops/release-credentials.md` in werkflow-planning: four `request_secret` cards with file delivery, a one-hour timeout and the hint "paste". `ops/release-credential-install.sh` installs them.
2. Run `ops/release-deploy-key.sh` for a new deploy key. The owner adds it to this repository with write access.
3. Plan about 15 minutes with the owner.
4. Before you enable a VM timer, disable its workflow and confirm that no run of it is left. `gh run list -R werk-flow/werkflow-app --workflow <file> --status in_progress` and the same with `--status queued` must both print nothing. Then enable `werkflow-dev-deploy.timer` after `staging.yml`, or `werkflow-release.timer` after `release.yml`. Never run both paths at once.

## Switch back from `fleet` to `local`

1. The owner decides.
2. Rebase #603 on `main`, finish its open review, and merge it with a green `fleet` `Check`.
3. [Rebuild the machines](#rebuild-the-machines), each runner service installed but stopped: the runner refuses to start while `main` names `fleet`.
4. Set `ci/profile.json` to `{ "profile": "local" }` in a PR, and merge it with a green `fleet` `Check`.
5. Pause merges: turn auto-merge off on every open PR, and merge nothing by hand.
6. Retire Actions: `gh workflow disable ci.yml -R werk-flow/werkflow-app`. Confirm that no run of it is left, as in step 4 of [the keys](#put-the-vm-release-and-dev-keys-back).
7. In the `main` ruleset, have the owner:
   - turn the merge queue off;
   - pin `Check` to App 5871705;
   - turn on "Require branches to be up to date before merging".
8. Start both runners. Watch the first PR a machine claims until its App-owned `Check` reaches its verdict.
9. Resume merges.
10. For the DEV deploy and, by the owner's decision, the release, follow [Put the VM release and DEV keys back](#put-the-vm-release-and-dev-keys-back).

If Actions is already completely unavailable, #603 and the profile switch cannot get a `Check` from it. Landing them then needs another trusted `Check`, which is the owner's decision.
