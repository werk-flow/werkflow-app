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

## Amendment 2026-11-23: a local executor runs PR runs

The container executor (`scripts/ci/container-executor.ts`) and the machine runner ([machine-runner.md](../technical/machine-setup.md#run-ci-on-the-owners-machines)) run each ready PR's run on the owner's machines: every job in a container of its own, the claim and the verdict on the CI App's `Check`. The revisit trigger for a local executor stays open for the rest: the queue host, the schedules' clocks and a queue-wait record off GitHub Actions.

## Amendment 2026-11-23: the claim is a lease ref, the verdict an integration run

Rule 3's claim is the ref `refs/leases/ci/<sha>`, swapped atomically with `git push --force-with-lease`; the pending `Check` only shows it. A machine posts `Check` only from the integration run of a head up to date with `main`, so the browser groups the plan selects are in it ([machine-setup.md](../technical/machine-setup.md#run-ci-on-the-owners-machines)).
