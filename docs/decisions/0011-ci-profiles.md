# 0011 — Two CI profiles, same tests

- **Status:** accepted (2026-11-22)
- **Date:** 2026-11-22
- **Owner:** Product owner (Tamay), decided on 2026-11-22 (werk-flow/werkflow-planning#503)
- **Affects:** every CI run, queue batch and CI schedule; [decision 0009](0009-pull-requests-and-ci.md) keeps the gate, [testing.md](../technical/testing.md#ci) the CI rules

## Context

CI may run on many machines or on one. The design of the CI hill climb assumes many: a conductor, a merge queue that batches pull requests, a fast check per pull request, browser groups once in the queue, full runs of `main` every few hours and the date look-ahead in parallel. The one machine we have today is a MacBook, which runs one or two jobs at once. A design kept only for machines nobody uses decays unnoticed, and a design cut to fit one machine drops tests.

## Decision

1. **Two profiles.** `fleet` is Boat or GitHub Actions: the hill climb's design, with many machines and a conductor. `mac` is one MacBook: one or two jobs at once, the heavy schedules in a night window. Both are maintained.
2. **Same tests, same quality.** Every check, job and schedule runs in both profiles. A profile sets only the executor, the concurrency, the batching and the timing. What a run tests stays with the DAG (`lib/testing/ci/dag.ts`) and the planner (`lib/testing/selection/ci-plan.ts`).
3. **One inventory.** `lib/testing/ci/inventory.ts` lists everything CI must run: the DAG's jobs, the kinds of run, and every schedule, with the code and workflow jobs that define each. Test groups enter through the job that runs their kind. Every workflow job is an item's source or is named as no CI work.
4. **A profile maps the whole inventory.** `lib/testing/ci/profiles.ts` types each profile as a record over the inventory, so a missing item fails the type check, and `profiles.test.ts` checks the same at run time. `profile-plans.test.ts` plans a docs-only, a code and a tooling pull request, a queue batch, its landing and a full run without a machine, and fails when a profile places no item of the inventory or a plan is malformed.
5. **One switch.** `ci/profile.json` on `main` names the active profile, and only `activeProfile` reads it. `lib/conventions/ci-profile-switch.test.ts` fails on any other read of the file, and on a profile chosen by an environment variable, a flag or the profiles' names. The switch names `mac` while the MacBook is the only machine.
6. **The Mac's values wait for measurements.** The `mac` profile marks its values as placeholders until they are measured. Until a Mac executor exists, the switch sets only defaults: the jobs a conductor runs at once and the size of a queue batch.

## Add a group, a job or a schedule

1. Register a test group in `lib/testing/selection/test-groups.ts`. Its kind names its job in `GROUP_KIND_JOBS`. A new kind fails the type check until it names one.
2. Add a job to `CI_DAG` or a schedule to `SCHEDULES`. Both profiles must then place it, or the type check and the profile tests fail.
3. Give a new workflow job a place: a schedule's source, or `OUTSIDE_INVENTORY` with the reason.

## Rejected alternatives

- **One profile for the machine in use.** The other design decays until the day it is needed again.
- **A Mac profile that skips the slow schedules.** It runs fewer tests, which breaks rule 2.
- **A profile chosen by an environment variable.** Two conductors could then run different profiles from one `main`.

## Revisit triggers

- The measurements of the Mac's runs arrive: replace the placeholders.
- A third kind of machine needs CI: add a profile, which must map the whole inventory too.
