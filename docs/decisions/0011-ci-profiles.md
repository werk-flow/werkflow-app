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
   - Each schedule names the trigger that dispatches it: a workflow's cron or GitHub event, the conductor's clock (`CLOCK_WORK` or the full-run slots), or both where they differ. A cron run that waits names its hold apart from its dispatch: `release.yml`'s cron dispatches at 17:00 Berlin, and its hold job waits until 03:30. `inventory.test.ts` holds each trigger and hold to its workflow, so a removed cron fails.
   - `HEALTH_CHECKS` names each check of `health.yml` as keyed, which stays on GitHub's shared workflow, or key-free, which is an inventory item.
5. **A profile maps the whole inventory.** `lib/testing/ci/profiles.ts` types each profile as a record over the inventory, so a missing item fails the type check, and `profiles.test.ts` checks the same at run time. `profile-plans.test.ts` plans a docs-only, a code and a tooling pull request, a queue batch, its landing and a full run without a machine. It fails when a profile places no item of the inventory, a plan is malformed, or the full run of the real registry misses a registered group.
6. **Each timed placement names its active dispatcher.** The placement says which clock fires it, and its time must be that clock's. The conductor dispatches the release only while `release.yml` has no cron (`scheduleDue`), so a profile names the cron while one exists. `profiles.test.ts` asks `scheduleDue` and fails on any other dispatcher.
7. **One switch, read from one snapshot of `main`.** `ci/profile.json` on `main` names the active profile, and only `activeProfile` reads it. It takes no argument, reads the switch at the commit `origin/main` names, and returns that commit too.
   - Run-commit and the queue fetch `+refs/heads/main:refs/remotes/origin/main` before they read, so a single-branch clone of another branch still reads the real `main`. They read the switch even when `CI_PARALLEL` or `--max-batch` overrides its default.
   - The queue reads its base and the switch from the same commit, and the tick starts from that base.
   - Tests read a fixture clone's switch through `profileOnMainIn`. `lib/conventions/ci-profile-switch.test.ts` allows it only in test files, and fails on any other read of the file and on a profile chosen by an environment variable, a flag or the profiles' names.
   - The switch names `local` while the owner's machines run CI.
8. **The local values wait for measurements.** The `local` profile marks its values as placeholders until they are measured, and only a placeholder profile may plan a clock that no code fires yet (`planned`). Until a local executor exists, the switch sets only defaults: the jobs a conductor runs at once and the size of a queue batch.
9. **A gap is named where a check cannot see.** The queue-wait check (`.github/scripts/ci-queue.sh`) reads only the GitHub Actions jobs of this repository's `ci.yml`. Each profile lists the kinds of executor its jobs run on, and its queue-wait placement names a "Not yet measured" gap for each kind the check does not observe. `fleet`'s check covers only its Actions-run jobs, not the CI mirror's repository or Boat. `local`'s covers none of its jobs. A gap anywhere else fails `profiles.test.ts`.

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
