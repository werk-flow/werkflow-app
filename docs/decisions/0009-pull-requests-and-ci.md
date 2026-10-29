# 0009 — Pull requests, CI as the gate, staging on main

- **Status:** accepted (2026-10-26) — supersedes [decision 0008](0008-development-workflow.md) and the publication gate of [decision 0007](0007-independent-test-groups.md)
- **Date:** 2026-10-26
- **Owner:** Product owner (Tamay), decided on 2026-10-25 after the research into how T3 Code runs its CI and pull-request flow
- **Affects:** every change, publish and release; `AGENTS.md` holds the always-on rules, [testing.md](../technical/testing.md) the CI gate, [environments.md](../technical/environments.md) the migration rule, release and rollback

## Reason for the change

Decision 0008 fit one developer on one checkout: local `main`, local gates, a push to publish. Coding agents now work in parallel, each in its own T3 Code worktree, and one checkout with one local `main` serializes them. The local publication gate grew to carry that load: an evidence ledger with a hash chain, review records and their coverage, deletion-pass and advisory-age conditions in the pre-push hook. It ran on the machine whose agents it judged, cost a full local verification and a CodeRabbit CLI review for every push, and still let the first push from Linux through when the hook lost its executable bit. Decision 0008 named the trigger: "a production incident caused by a push that skipped the gates: reconsider GitHub Actions as the enforcing robot." The repository is public, so GitHub Actions on GitHub-hosted runners and the CodeRabbit app cost nothing.

## Decision

| Branch | Role | Database | How it moves |
| --- | --- | --- | --- |
| a task branch | one task in its own worktree, one small pull request | the local stack (tests), DEV through `bun run env:dev` | the agent pushes it and opens the PR |
| `main` | the staging trunk | DEV | squash merge of a PR with a green `Check`; the owner merges |
| `production` | production | PROD | only the owner's `release` workflow fast-forwards it to a green `main` commit |

1. Every task is a worktree, a branch and a small pull request that solves one problem. Nobody commits to `main` directly. Merges are squash merges, so `main` stays linear.
2. CI on GitHub Actions is the gate. One aggregate job, `Check`, is the required status check. It runs every static gate, the unit suite, the component contracts, every SQL group against the Supabase CLI stack on the runner, and the browser groups the runner's own selection picks for the diff against the PR base. It fails open: an unreadable diff or a changed tooling input runs every browser group. A push to `main` and a nightly run take every browser group. `scripts/verify.ts` stays the engine, locally and in CI.
3. Wall-clock performance groups do not run on shared runners, whose load makes medians noise; they stay local release checks ([performance.md](../technical/performance.md)).
4. Reviews move to the CodeRabbit app on pull requests. The agent babysits its PR: it verifies every bot finding against the source, fixes the real ones, dismisses the false ones with a written reason, and stops when `Check` and the bots are green on the latest commit. `bun run review` stays as an optional local pre-check.
5. The local publication gate retires: the pre-push gate logic, the evidence ledger, the review records and their coverage, the advisory-age condition. Their guarantees move into CI as Tier 2, enforced by the required check. The deletion pass moves into the PR template and stays a Tier 3 review point.
6. Migrations: at most one per PR, with its regenerated types. CI applies every migration to its throwaway stack. DEV receives migrations only when a PR merges to `main`, from a workflow with DEV credentials, before staging deploys. PROD receives them only through the `release` workflow, before production deploys. Migrations are expand-only within a release; a drop or rename is a later release's contract step, so a Vercel Instant Rollback of the code is always safe.
7. A release happens only through the `release` workflow, which the owner starts, or an agent starts when the owner asks for a release in its thread.
8. The owner merges pull requests at first.

## Where the local gate's guarantees went

| Pre-push condition | Now |
| --- | --- |
| A passing automatic plan on the pushed tree | Tier 2: `Check` on the PR, required by the ruleset on `main` and kept up to date with `main` before merge |
| A CodeRabbit review covering every pushed file | Tier 3: the CodeRabbit app reviews every PR; the babysit rule requires every finding answered before hand-back |
| A `Deletion pass:` line in every commit | Tier 3: the PR template's Deletion pass section, judged in review |
| A dependency advisory pass under 24 hours old | Tier 2: `static:dependencies` in every CI run |
| No shrink-only list grew | Tier 2: `lib/testing/publication/shrink-only-lists.test.ts` in CI's unit job, against the merge base with the trunk |
| A push to `main` needed the release plan and the canary | Tier 2: the `release` workflow requires a green `Check` on the `main` commit, which ran every browser group; the canary and the wall-clock groups stay Tier 3 release checks |
| A wall-clock group passed on pushed product files it measures | Tier 3: a local release check on a quiet machine |
| The evidence ledger, its hash chain and review records | Not needed: CI's evidence lives on GitHub, outside the machine whose agents it judges |
| The refusal of `--no-verify` and `core.hooksPath` overrides | Tier 1: the rulesets refuse a direct push to `main` or `production` on the server |

The edit guard stays where it protects a running local verification: it refuses an agent edit to a proof input while a test operation holds the workspace lock, and a stack reset while any worktree holds the stack.

## What was considered and rejected

- Keeping the local gate beside CI: two gates that disagree are worse than one, and the local gate's trust model (evidence on the machine whose agents it judges) does not improve with age.
- Blacksmith or Depot runners: faster, but GitHub-hosted runners are free for a public repository and fast enough while shards keep a typical PR well under 20 minutes. Revisit when CI time blocks merges.
- A merge queue: one owner merges; "branch up to date before merge" gives the same guarantee at this volume.
- Running wall-clock performance groups in CI: shared runners make their medians follow the neighbor's load.

## Configuration this decision needs

- GitHub (the repository owner account `werk-flow` sets it): a ruleset on `main` with pull requests, the required check `Check`, up-to-date branches, linear history, no force pushes and squash merges only; a ruleset on `production` that only the `release` workflow's deploy key bypasses; automatic deletion of merged branches; the Actions secrets the workflows name.
- Vercel: the production branch is `production`; Git deployments of `main` are off in `vercel.json`, so staging deploys from the workflow after DEV's migrations; pull-request previews stay automatic.

## Revisit triggers

- A second person merges: reconsider review requirements on the ruleset.
- CI time for a typical PR passes 20 minutes: more shards, or faster runners.
- The repository turns private: GitHub Actions minutes and the CodeRabbit plan cost money.

## Related Docs

- [testing.md](../technical/testing.md) — the CI gate and the local commands.
- [environments.md](../technical/environments.md) — the migration rule, release and rollback.
- [coderabbit.md](../technical/coderabbit.md) — reviews on pull requests.

## Amendment 2026-10-26: the owner can approve list growth

The table's ratchet row had no path for a list growth the owner approved, and the ruleset on `main` has no bypass. The owner adds the label `approved: list growth` to such a PR. CI's unit job then waives the growth, and the PR diff shows it. The owner owns the label: agents use the owner's GitHub account, so the label rule binds them only through review (Tier 3). [testing.md](../technical/testing.md#grow-a-shrink-only-list) holds the procedure.

## Amendment 2026-10-26: one CodeRabbit review per code pull request

The owner narrowed rule 4. A pull request that changes product code, tests, migrations or security-relevant code gets one CodeRabbit app review, requested once at the end when `Check` is green, not after every fix. A pull request that changes only docs, agent instructions or CI workflow files merges on a green `Check` with the agent's own review. Requests after every fix spent the app's rate limit, and an early request restarts its window. [coderabbit.md](../technical/coderabbit.md#babysit-a-pull-request) owns the procedure, the rate-limit rule and the order when several pull requests wait.

## Amendment 2026-10-26: merges without an up-to-date branch

The owner turned off "require branches to be up to date before merging" on the `main` ruleset. A green `Check` on the PR's latest commit is enough to merge; the branch need not contain the newest `main`. This supersedes three statements above: the "kept up to date with `main` before merge" part of the plan row in "Where the local gate's guarantees went", the reason given for rejecting a merge queue, and "up-to-date branches" in the GitHub ruleset settings. Two checks catch a merge that breaks `main`: `Check` runs again on every push to `main` (`.github/workflows/ci.yml`), and the `release` workflow refuses a `main` commit without a successful `Check` (`.github/workflows/release.yml`). A merge queue stays rejected while one owner merges.

## Amendment 2026-10-26: review levels, sol-loop, and merges under "full send"

The owner replaced the code-or-docs split of the CodeRabbit amendment above with three review levels, and narrowed rule 8. CodeRabbit reviews were the slowest wait in the owner's day, and every ready PR waited for the owner's merge even when nothing in it needed the owner's eyes.

1. The agent chooses a PR's level from its diff and states it in the description; the owner may raise it, and the agent never goes below the rule. Level 0 is a change with no behavior effect (docs, comments, copy typos, agent instructions, formatting) and needs the agent's own read. Level 1, the default for every behavior change, needs a `sol-loop` review: GPT Sol, started through T3 Code's `delegate_task`, reviews the change in rounds before the PR opens. Level 2 (security, authentication, permissions and RLS, migrations, personal data, data deletion, the Zeitkonto, time and payroll logic) needs `sol-loop` and then one CodeRabbit app review, requested once after Sol approved and `Check` is green, never while the app reports a rate limit. Level 0 and 1 never request or wait for CodeRabbit.
2. Rule 8 now reads: the owner merges, unless the owner said "full send" in the task's thread. Then the agent merges with a squash merge once the merge gate passes, and never with an admin bypass. Without it, an agent stops when the PR is ready ("full stop" behavior). No skill releases, runs the `release` workflow or writes to PROD.
3. Each `sol-loop` records the usage T3 Code reports, or "not exposed", in the PR description, so the owner can judge whether the ChatGPT Plus plan suffices. On a Sol rate limit the agent asks the owner and substitutes no other model.

The skills `sol-loop`, `full-send`, `full-stop`, `file-pr` and `leaving-pr-comments`, adapted from t3dotgg/tstack under its MIT license, carry the procedures. [coderabbit.md](../technical/coderabbit.md#choose-the-review-level) owns the levels, the babysit procedure and the merge gate. The levels are Tier 3 until the check that the [enforcement-ladder backlog](../technical/enforcement-ladder-backlog.md#testing-and-review) describes lands.

## Amendment 2026-10-29: who merges and who releases

The owner aligned the rules with current practice.

1. Rule 8 now reads: the coordinator thread merges a PR that meets the merge gate, or the PR's own thread does when the owner said "full send" there. The owner may merge any PR. A "full stop" PR waits until the owner has read it. Nobody merges with an admin bypass.
2. Rule 7 now reads: a release runs when the owner or the coordinator thread asks for it ("release main"). The releasing thread checks production afterwards and rolls the app back through Vercel if it breaks. The database is never rolled back.

## Amendment 2026-10-29: main runs the diff selection, a full run gates the release

Every push to `main` ran every browser group in 14 shards, the free plan's whole job budget, so each merge queued behind the last one. The owner decided on 2026-10-29:

1. A push to `main` plans its browser groups by diff against the previous `main` commit, like a PR. A push whose previous commit git cannot read runs every browser group. This supersedes "A push to `main` and a nightly run take every browser group" in rule 2.
2. A full run is `ci.yml` called with `full` from a job named `Full run`: nightly on `main`, by hand, and in the release.
3. The `release` workflow ships a commit only when the newest `Full run / Check` of a nightly or release run on `main` at exactly that commit is green. It reuses a nightly or manual one; without one it runs the full suite first and ships only on green. This replaces "a green `Check` on the `main` commit" in the table row on the release plan and in the amendment on merges without an up-to-date branch. A merge that breaks a group its diff did not select now surfaces in the nightly run or at the release, not on the push.
