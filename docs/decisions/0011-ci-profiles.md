# 0011 — Two CI profiles, same tests

- **Status:** accepted (2026-11-22)
- **Date:** 2026-11-22
- **Owner:** Product owner (Tamay), decided on 2026-11-22 (werk-flow/werkflow-planning#503)
- **Affects:** every CI run, queue batch and CI schedule; [decision 0009](0009-pull-requests-and-ci.md) keeps the gate, [testing.md](../technical/testing.md#ci) the CI rules

## Context

CI may run on many machines or on few. The design of the CI hill climb assumes many: a conductor, a merge queue that batches pull requests, a fast check per pull request, browser groups once in the queue, full runs of `main` every few hours and the date look-ahead in parallel. Today CI runs on the owner's MacBook and PC, each of which runs one or two jobs at once. A design kept only for machines nobody uses decays unnoticed, and a design cut to fit a few machines drops tests.

## Decision

1. **Two profiles.** fleet = Boat or Actions; local = the owner's MacBook and PC. `fleet` is the hill climb's design, with many machines and a conductor. `local` runs one or two jobs at once and the heavy schedules in a night window; the PC runs CI in a WSL distro. Both are maintained.
2. **Same tests, same quality.** Every check, job and schedule runs in both profiles. A profile sets only the executor, the concurrency, the batching and the timing. What a run tests stays with the DAG (`lib/testing/ci/dag.ts`) and the planner (`lib/testing/selection/ci-plan.ts`).
3. **One machine per pull request in `local`.** A pull request's run goes from start to finish on one machine. That machine claims the run on GitHub with a pending `Check` that names it, and the other machine skips a claimed run. The machines share no channel besides GitHub.
4. **One inventory.** `lib/testing/ci/inventory.ts` lists everything CI must run: the DAG's jobs, the kinds of run, and every schedule, with the code and workflow jobs that define each. Test groups enter through the job that runs their kind. Every workflow job is an item's source or is named as no CI work.
   - Each schedule names the trigger that dispatches it (a workflow's cron or event, the conductor's clock, or both where they differ), and a cron run that waits names its hold apart from its dispatch. The inventory's tests hold each trigger and hold to its workflow, so a removed trigger fails.
   - Each check of `health.yml` is named keyed, which stays on GitHub's shared workflow, or key-free, which is an inventory item.
5. **A profile maps the whole inventory.** `lib/testing/ci/profiles.ts` types each profile as a record over the inventory, so a missing item fails the type check, and its tests check the same at run time. Dry plans without a machine, for pull requests, a queue batch and a full run, fail when a profile places no item, a plan is malformed, or a full run misses a registered group.
6. **Each timed placement names its active dispatcher.** The placement says which clock fires it, and its time must be that clock's. A profile's tests ask the scheduler (`scheduleDue`) which dispatcher is active and fail on any other.
7. **One switch, read from one snapshot of `main`.** `ci/profile.json` on `main` names the active profile, and only `activeProfile` reads it. It takes no argument, reads the switch at the commit `origin/main` names, and returns that commit too.
   - Run-commit and the queue fetch `main` explicitly before they read, so a single-branch clone of another branch still reads the real `main`. They read and validate the switch even when an override replaces its default.
   - The queue reads its base and the switch from the same commit, and the tick starts from that base.
   - Tests read a fixture clone's switch through a test-only seam. A convention test allows the seam only in test files, and fails on any other read of the switch and on a profile chosen by an environment variable, a flag or the profiles' names.
   - The switch names `local` while the owner's machines run CI.
8. **The local values wait for measurements.** The `local` profile marks its values as placeholders until they are measured, and only a placeholder profile may plan a clock that no code fires yet (`planned`). Until a local executor exists, the switch sets only defaults: the jobs a conductor runs at once and the size of a queue batch.
9. **A gap is named where a check cannot see.** When a check observes only some executors, as the queue-wait check observes only GitHub Actions jobs, each profile's placement names a "Not yet measured" gap for every kind of executor the check misses. A gap anywhere else fails the profile tests.

## Add a group, a job or a schedule

1. Register a test group in `lib/testing/selection/test-groups.ts`. Its kind names its job in `GROUP_KIND_JOBS`. A new kind fails the type check until it names one.
2. Add a job to `CI_DAG` or a schedule to `SCHEDULES`. Both profiles must then place it, or the type check and the profile tests fail.
3. Give a new workflow job a place: a schedule's source, or `OUTSIDE_INVENTORY` with the reason.

## Rejected alternatives

- **One profile for the machines in use.** The other design decays until the day it is needed again.
- **A local profile that skips the slow schedules.** It runs fewer tests, which breaks rule 2.
- **A profile chosen by an environment variable.** Two conductors could then run different profiles from one `main`.
- **A channel between the local machines.** GitHub's pending `Check` already says who runs a pull request, and a second channel can disagree with it.

## Revisit triggers

- The measurements of the local runs arrive: replace the placeholders.
- A local executor or a queue-wait record off GitHub Actions exists: close its gap.
- A third kind of machine needs CI: add a profile, which must map the whole inventory too.

## Amendment 2026-11-23: GitHub Actions is the CI home again

The owner decided on 2026-11-23 that CI runs on GitHub Actions again: `ci/profile.json` names `fleet`. Rule 7's last line no longer holds. The `local` profile stays maintained (rule 1) and frozen as a fallback; [ci-local-fallback.md](../technical/ci-local-fallback.md) holds its state, what stays open and the switch back. The machine runner is kept under the tag `archive/local-runner-2026-11-23`.

Under `fleet`, GitHub Actions starts every run and schedule. ci.yml's `pull_request`, `merge_group` and `push` events start the PR, queue and `main` runs. Each trigger of a workflow that calls ci.yml starts a full run, its `workflow_dispatch` included. ci.yml's own `workflow_dispatch` is the midnight proof, a path for branches only that selects the full tier. nightly.yml's cron runs the nightly, release.yml's cron the release, and main's full run starts only by `workflow_dispatch`: by day from `ci-alert.timer` (werkflow-planning `ops/ci-alert.py`), or by a person. No conductor's clock fires anything. `profiles.test.ts` fails on a trigger that no placement names.

Switch to `fleet`:

1. Pause merges: turn auto-merge off on every open PR. Stop each machine runner, so it claims nothing new.
2. Let every active run end or cancel it, and check that no lease under `refs/leases/ci/` is still held.
3. Enable the CI workflow: `gh workflow enable ci.yml -R werk-flow/werkflow-app`.
4. In the `main` ruleset, have the owner set:
   - the merge queue on, merging by squash, build concurrency 1, group size 1 to 4, 5 minutes' wait for a group, and "all entries must pass" (ALLGREEN);
   - a check timeout of 165 minutes;
   - `Check` required, from GitHub Actions;
   - "Require branches to be up to date before merging" off;
   - `Queue` not required.
5. Enabling `ci.yml` starts no run for a PR that is already open. Start one for the PR that sets `ci/profile.json` to `fleet`: `gh pr update-branch <number> -R werk-flow/werkflow-app`, or close and reopen the PR.
6. Merge that PR only with a green `Check` from GitHub Actions on its head. Then resume merges.

## Amendment 2026-11-28: the release is dispatched, not scheduled

`release.yml` has no cron. `ops/ci-alert.py` in `werk-flow/werkflow-planning` dispatches it with `scheduled=true` at 03:30 Berlin, Monday to Friday. This supersedes "release.yml's cron the release" in the amendment of 2026-11-23; [decision 0012](0012-pull-requests-ci-and-releases.md#releases) owns the release rule.
