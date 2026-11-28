# 0012 — Pull requests, CI, review and releases

- **Status:** accepted (2026-11-28), supersedes [decision 0009](0009-pull-requests-and-ci.md) and the release cron of [decision 0011](0011-ci-profiles.md)
- **Date:** 2026-11-28
- **Owner:** Product owner (Tamay), decided on 2026-11-28 as a restatement of the rules then in force
- **Affects:** every change, merge and release; [coderabbit.md](../technical/coderabbit.md) holds review levels, babysitting and the merge gate, [testing.md](../technical/testing.md#ci) the CI tiers and selection, [environments.md](../technical/environments.md#release-and-rollback) release and rollback

## Context

Decision 0009 grew to a base decision and about 40 dated amendments, many of which replaced earlier ones. An agent could not tell the current rule without reading all of it. This record states the rules in force on 2026-11-28 in one place. Decision 0009 and Git keep the history and the measurements behind each change.

## Decision

| Branch | Role | Database | How it moves |
| --- | --- | --- | --- |
| a task branch | one task in its own worktree, one small pull request | the local stack for tests, DEV through `bun run env:dev` | its thread pushes it and opens a draft PR |
| `main` | the staging trunk | DEV | the GitHub merge queue squash-merges a PR whose queue run passed |
| `production` | production | PROD | only the `release` workflow fast-forwards it to a green `main` commit |

### Pull requests

1. Every task is a worktree, a branch and one small PR that solves one problem. Nobody commits to `main`. Small PRs keep parallel agents out of each other's way and keep a review readable.
2. A change of a few lines with no behavior effect rides along in a PR that has to run anyway. It gets its own PR only when none is open.
3. A PR opens as a draft, before its first `sol-loop` round. Marking it ready (`gh pr ready`) means "enter the queue".
4. At most one migration per PR, with its regenerated types, expand-only ([the migration rule](../technical/environments.md#the-migration-rule)). Expand-only keeps a code rollback safe, because the older code still fits the newer schema.
5. The PR template's Deletion pass section is a Tier 3 review point (`.github/pull_request_template.md`).

### CI

6. GitHub Actions runs CI, on the `fleet` profile that `ci/profile.json` names. The frozen `local` profile on the owner's machines is the fallback; [decision 0011](0011-ci-profiles.md) owns the profiles and [ci-local-fallback.md](../technical/ci-local-fallback.md) the switch back. The stand-in queue `scripts/ci/queue.ts` belongs to that fallback and is not in use.
7. `Check` is the one required status check, from GitHub Actions. It is the aggregate job of `.github/workflows/ci.yml` and fails closed (`lib/testing/ci/check.ts`). `scripts/verify.ts` is the engine, locally and in CI.
8. A PR's run is the fast tier, draft or ready. Only a new head starts it (`pull_request` `opened` and `synchronize`): a title, body or label change would displace the head's green `Check`. Marking a PR ready starts no run. `list-growth.yml` reruns the fast tier when the `approved: list growth` label changes.
9. The queue's run is the integration run. It adds the component contracts and the browser groups that `lib/testing/selection/ci-plan.ts` selects against the queue's base. Browser groups are the slow part, so each PR runs them once, on top of the newest `main`. `bun run test:verify` on Boat is the agent's early warning before ready.
10. A push to `main` reuses the queue run of the same landing, the same tree, base and planned work, and runs nothing again (`lib/testing/ci/reuse.ts`). Without such a run it plans by its diff.
11. A full run is `ci.yml` called from a job named `Full run`, and runs every browser group. It runs nightly (`nightly.yml`, which skips a head that already has a green full run), on `main` at most every 6 hours from 06:00 to 20:00 Berlin when more than docs landed (`main-full-run.yml`, rule in `lib/testing/ci/full-run.ts`), and in the release when no green one exists. Full runs prove the wall-clock `audit:performance:*` steps without their timing gate. A shared runner's load makes a median noise, so wall-clock timing and the cloud canary stay local release checks ([performance.md](../technical/performance.md)).
12. Every runner runs the limits the repository sets. No timeout or budget factor carries over to a new runner without its own decision, and `test-hygiene/no-fixed-time-limit` fails on a fixed wall-clock limit in a test.
13. GitHub secret scanning alerts and does not block: push protection stays off, because test data could stop an agent mid-push.

### Review

14. The agent picks a PR's level from its diff and states it in the PR. The owner may raise a level; an agent never goes below the rule. [coderabbit.md](../technical/coderabbit.md#choose-the-review-level) owns the table and the procedure.
    - **Level 0**, no behavior effect (docs, comments, agent instructions, formatting): the agent's own read.
    - **Level 1**, any behavior change, the default: `sol-loop`, at most 3 rounds.
    - **Level 2**, security, authentication, permissions and RLS, migrations, personal data, deletion, time, the Zeitkonto, payroll, and money (prices, billing, Stripe, invoices): `sol-loop`, at most 5 rounds, then the external review that the broker assigns.
15. The external review comes last, once Sol is done, `Check` is green and the head is final. Each vendor review is scarce and a later push wastes it. The thread labels the PR `needs-coderabbit` and never asks a vendor itself. The broker, `ops/coderabbit-queue.py` in `werk-flow/werkflow-planning`, assigns CodeRabbit, Greptile or both by the PR's rank and each vendor's budget. CodeRabbit runs on the Essentials plan. Greptile's trial ends on 2026-12-11, then the free Starter plan applies. Automatic review is off for both.
16. No lead grants an extra Sol round; only the owner can, for one PR. A finding still disputed after the last round goes to the owner through the question tool, with each side and a recommendation. On a Sol usage limit the agent waits or asks the owner, and never substitutes another model. The `sol-loop` skill owns the loop.
17. The levels stay Tier 3 until the check in the [enforcement-ladder backlog](../technical/enforcement-ladder-backlog.md#testing-and-review) lands.

### Merging and the merge queue

18. A PR's own thread merges it once [the merge gate](../technical/coderabbit.md#the-merge-gate) holds, with `gh pr merge <n> --squash --auto`. A PR that changes `AGENTS.md`, or a "full stop" PR, waits for the owner's read and merge. The owner may merge any PR. Nobody merges with `--admin` or another bypass. Threads merging their own PRs means no coordinator thread has to stay alive.
19. The GitHub merge queue lands every PR. It tests each PR on top of `main` and the PRs ahead of it, so a branch need not be up to date before it queues, and a PR merges `origin/main` only to resolve a conflict. Each entry's own run must pass (ALLGREEN), so a failure names its PR and no PR lands on another entry's result.
20. The owner's `approved: list growth` label waives a shrink-only list's growth for that PR alone. A queue run waives growth only when each commit above `main` that grows a list belongs to a PR with the label (`scripts/ci/prepare.ts`, `approval`). Agents act through the owner's GitHub account, so the label binds them through review (Tier 3). [testing.md](../technical/testing.md#grow-a-shrink-only-list) holds the procedure.

### Releases

21. Code reaches PROD only through `.github/workflows/release.yml`. It ships a `main` commit only when the newest `Full run / Check` at exactly that commit passed, else it runs one and ships on green. It checks that DEV holds every migration, applies PROD's migrations, deploys the edge functions, advances `production`, promotes the build and checks production without reading its data.
22. PROD is live by 05:00 Berlin every weekday, because field workers clock in early. `ops/ci-alert.py` in `werk-flow/werkflow-planning` dispatches `release.yml` with `scheduled=true` at 03:30 Berlin, Monday to Friday. The workflow has no cron, because GitHub starts scheduled runs up to 10 hours late (`lib/testing/ci-schedule.test.ts` holds the times). A scheduled run ships only when `main` moved since `production` and is green; otherwise it changes nothing.
23. Any agent may start a release by hand when `main` is green and a change that is not risky should not wait, such as a bug fix. The `production` environment has no approval step.
24. DEV receives migrations only from `staging.yml` when a PR lands on `main`, before staging deploys. Vercel deploys from Git only the `production` branch (`git.deploymentEnabled` in `vercel.json`). PR branches never deploy, so the owner tries a user-visible change on staging after its merge.
25. [environments.md, "Release and rollback"](../technical/environments.md#release-and-rollback) owns the way back.

## Configuration this decision needs

An owner of the GitHub organization `werk-flow` sets these:

- The `main` ruleset: pull requests, squash merges only, linear history, no deletion or force push, and the required check `Check` from GitHub Actions, not strict. Its merge queue merges by squash with ALLGREEN, builds at most 2 entries and merges at most 2 at once, waits up to 5 minutes to fill a group of 2, and drops an entry after a 150-minute check timeout. The notifier wakes the PR's lead when the queue drops a PR without a failed run ([coderabbit.md](../technical/coderabbit.md#the-merge-gate)).
- The `production` ruleset: only a deploy key may update the branch, and the one deploy key is `werkflow-actions-release`, which the release job uses.
- Automatic deletion of merged branches, secret scanning on, push protection off, and the Actions secrets the workflows name.

## Rejected alternatives

- **A local gate beside CI.** Two gates that disagree are worse than one, and a gate that keeps its evidence on the machine whose agents it judges proves little.
- **A release cron.** GitHub starts it hours late, and a run that held a runner until 03:30 cost hours of job-minutes.
- **Browser groups on every PR push.** Most PR runs were cancelled by a newer push, and the queue tests the same groups on the newer `main` anyway.
- **Vercel previews of PR branches.** They spent the daily deployment limit, and staging on DEV shows the same change after merge.
- **The external review during Sol's first round.** Its fixes reran CI, and the vendor's budget went to a head that was about to change.

## Revisit triggers

- The queue regularly waits over an hour: raise the build concurrency. The weekly `CI queue` check in `health.yml` fails: lower it.
- GitHub Actions fails for the organization again: switch to `local` per [ci-local-fallback.md](../technical/ci-local-fallback.md).
- Greptile's trial ends on 2026-12-11: the broker's Greptile budget falls to the Starter plan.
- The repository turns private: Actions minutes and the review plans cost money.
- A second person merges: reconsider required reviews on the ruleset.
