# The frozen `local` CI fallback

CI runs on the `fleet` profile, on GitHub Actions ([decision 0011](../decisions/0011-ci-profiles.md#amendment-2026-11-23-github-actions-is-the-ci-home-again)). The `local` profile, a runner on the owner's MacBook and PC, is frozen. This page lets an agent switch back to `local` if Actions fails again. Epic: werk-flow/werkflow-planning#503.

## Where the work is

- **The parked PR:** #603, branch `t3/machine-runner` at `64d200b6a`, an unmerged draft. Its body holds the security model, the review ledger and the open risks. It contains the two branches below.
- **P5, the lease ref:** branch `t3/machine-runner-lease` at `c99f18556`.
- **P8, the machine windows:** branch `t3/machine-runner-windows` at `ab4f1bb9e`.
- **The install steps:** `docs/technical/machine-setup.md`, section "Run CI on the owner's machines", on branch `t3/machine-runner`.
- **The archive:** werk-flow/werkflow-planning#546, folder `ops/ci-local-fallback/`.

## State of each part

| Part | State | Source |
| --- | --- | --- |
| P1, the inventory | Built and proven | `lib/testing/ci/inventory.ts` (#598) |
| P2, the profiles and the switch | Built and proven | `lib/testing/ci/profiles.ts`, `ci/profile.json` (#598) |
| P3, the measurements | Partly measured | See [Measurements](#measurements) |
| P4, the machine runner and container executor | Built, never run on a machine | #603 |
| P5, the claim as a lease ref with compare-and-swap | Built, never run on a machine | `t3/machine-runner-lease`, in #603 |
| P6, a quick check per PR on `local` | Not built | |
| P7, the date look-ahead on `local` | Not built | |
| P8, the machine windows | Built, never run on a machine | `t3/machine-runner-windows`, in #603 |
| P9, the light items on the VM | Partly | See [The VM](#the-vm) |
| P10, the council | Two rounds, scores 5/4/4/4 then 5/5/5/5, against a pass score of 9 | #503 |
| The midnight window per serial shard | Merged, proven only with a faked clock | #601 |

P7's evidence: libfaketime works on the PC, and a QEMU/KVM guest on the PC can shift its own clock.

### Measurements

- Mac at 4 CPU / 6 GiB, full run: 178 min (2 runs).
- Mac at 8 CPU / 8 GiB, selected plan of 105 groups: 34 min (#601).
- PC, rootless Docker, full run: 202 min, 199 of 199 groups.
- Not measured: the container executor's cost per job. Both full runs predate it.

### The machines

- **The PC:** WSL distribution `werkflow-ci` with a rootless Docker slot for user `cirunner`. Stopped; no runner installed. The install brief exists and never ran.
- **The Mac:** the stand-in's private supervisor, stopped at the switch to `fleet`. The Colima profile `ci` was never created.
- **The keys:** neither machine's CI App key was ever made.

### The VM

The `werkflow-ci-*` units on the netcup VM are installed, disabled and inactive, both as system and as user units, with no timer scheduled: `orchestrator` and `queue` (services), and `date-lookahead`, `health`, `notice-main-green`, `notice-merge-queue` and `pr-screenshots` (timer and service each). The system scope also holds `werkflow-ci-verify.service`. Check with `systemctl list-unit-files 'werkflow-ci*'` and `systemctl --user list-unit-files 'werkflow-ci*'`.

## What stays open

Before `local` can carry CI unattended, from #603's open risks and the council's round-2 shortest lists:

1. **Queue commit bundles.** The container executor cannot stage the queue's local integration commit, which GitHub never holds.
2. **One dispatcher per schedule.** `local` still plans clocks that no code fires.
3. **The release slot.** Reserve main's full run before the 03:30 release decision; ship the newest green full-run commit.
4. **The VM watcher.** It alerts on a ready PR without a lease, a dead machine and overdue scheduled work.
5. **A real machine run with drills:** a claim race, a moved head, a window edge, a restart, and measured PR-run times.
6. **The Mac's `colima ssh` argument check:** that the slot prefix hands each argument on unchanged, as the PC's check does.
7. **The accepted residuals:** shared Docker daemon within one run, the App key readable by agents on the PC, and no queue-host failover. Each stays recorded in #603.

## Put the VM release and DEV keys back

Releases run in `release.yml` and the DEV deploy in `staging.yml`. The VM's release and DEV tokens and its `werkflow-vm-release` deploy key are deleted. Their units stay installed and disabled (werk-flow/werkflow-planning#517 and #503).

1. Follow the phase 2 runbook `ops/release-credentials.md` in werkflow-planning: four `request_secret` cards with file delivery, a one-hour timeout and the hint "paste". `ops/release-credential-install.sh` installs them.
2. Run `ops/release-deploy-key.sh` for a new deploy key. The owner adds it to this repository with write access.
3. Plan about 15 minutes with the owner.
4. Enable `werkflow-dev-deploy.timer` only after `staging.yml` is disabled, and `werkflow-release.timer` only after `release.yml` is disabled. Never run both paths at once.

## Switch back from `fleet` to `local`

1. The owner decides.
2. Rebase #603 on `main`, finish its open review, and merge it.
3. Make the keys by secret card: the Mac's (F1) first, then the PC's.
4. Install the runner on the PC per machine-setup.md.
5. Create the Mac's Colima profile `ci` and install the runner there.
6. In the `main` ruleset, have the owner:
   - turn the merge queue off;
   - pin `Check` to App 5871705;
   - turn on "Require branches to be up to date before merging".
7. Disable the Actions workflows the machines replace:
   - `gh workflow disable ci.yml -R werk-flow/werkflow-app`.
   - `staging.yml` and `release.yml` stay enabled until the VM holds its keys again ([above](#put-the-vm-release-and-dev-keys-back)). Then disable each before you enable its VM timer.
8. Set `ci/profile.json` to `{ "profile": "local" }` in a PR and merge it.
9. Watch the first PR a machine claims until its verdict.
