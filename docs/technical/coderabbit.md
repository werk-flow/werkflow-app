# Pull-request reviews

CodeRabbit is the only review bot on this repository. Every PR to `main` gets the reviews its level needs ([decision 0009](../decisions/0009-pull-requests-and-ci.md)): your own read, a `sol-loop` review by GPT Sol, and for the riskiest changes one CodeRabbit app review. A reviewer is no authority. Check that a suggested fix keeps the SHK context, the role-specific workflows, the organization boundaries and field-worker usability.

`.coderabbit.yaml` points CodeRabbit at each virtue's owner doc. Automatic review is off. Change it only when an owner doc moves, a top-level folder needs its pointer, or the policy changes, and validate it against the schema its first line declares.

## How to work

### Choose the review level

Choose the level from the diff before you open the PR, and state it in the PR's Review section as one line, `Review level: <0|1|2>, because <reason>`. The CodeRabbit queue reads that line. The highest level any part of the diff reaches applies. The owner may raise a level; never go below the rule.

| Level | The diff | Reviews before ready |
| --- | --- | --- |
| 0 | No behavior effect: docs, comments, copy typos, agent instructions, formatting | Your own read of the diff |
| 1 | Changes behavior: product code, tests, CI logic, scripts. The default | `sol-loop` until Sol approves or its budget ends |
| 2 | Touches security, authentication, permissions and RLS, a migration, personal data, data deletion, the Zeitkonto, or time and payroll logic (for example `supabase/`, `lib/auth/`, `lib/org/`, `lib/security/`, `lib/storage/`, `lib/time-tracking/`, `lib/time-accounts/`, `lib/time-corrections/`) | `sol-loop`, then one CodeRabbit app review per PR |

- Every level also needs `Check` green on the latest commit.
- Level 0 and 1 never request or wait for CodeRabbit.
- When the owner says "sol loop", run the `sol-loop` skill alone. It owns the review loop, its budget and its PR line.
- A PR's own thread merges it once it meets the merge gate. A "full stop" PR, or one that changes `AGENTS.md`, waits until the owner has read and merged it. The owner may merge any PR.

Wrong turn: calling a change level 0 because it is small. A one-line change to a role check is level 2.

### Trial mode until 2026-11-27

The organization `werk-flow` has its own CodeRabbit Advanced trial until 2026-11-27, during which reviews beyond the rate limits are free (owner decision 29 in `werk-flow/werkflow-planning`). These overrides apply until the queue's `TRIAL_ENDS` cutoff in `ops/coderabbit-queue.py` in `werk-flow/werkflow-planning`. From that cutoff, ignore this section even if it remains; the table above applies again. Level definitions stay unchanged.

| Level | Trial reviews |
| --- | --- |
| 0 | Your own read plus one CodeRabbit review |
| 1 | CodeRabbit plus `sol-loop`, budget 1 round |
| 2 | CodeRabbit plus `sol-loop`, full budget |

Open the draft and add `needs-coderabbit` before Sol's first round, so the queue requests CodeRabbit's review of the draft while that round runs. Fix both reviewers' findings in one push. The queue swaps the label for `coderabbit-requested` when it asks; after the push that answers a complete round, add `needs-coderabbit` again for the next review. A push without the label gets no review.

The merge gate stays unchanged, except every level requires the CodeRabbit review.

### Babysit a pull request

1. Open the PR as a draft after `bun run check:changed` and before Sol's first round (the `file-pr` and `sol-loop` skills). A draft runs every CI job except the browser shards, and its `Check` fails, with no action needed, while the plan holds browser groups ([testing.md, "CI"](testing.md#ci)). After `gh pr create`, call `link_pull_request`, handle the existing checks and comments, then call `watch_pull_request` and end your turn. T3 Code wakes you on a check result, a comment, a review or a conflict. Never poll, sleep or write a watcher.
2. On each wake, act only on news newer than your last push: the failed job (`gh run view <run-id> --log-failed`, its `evidence-<job>` artifact) or new comments (`gh pr view <number> --comments`, inline threads in `gh api repos/{owner}/{repo}/pulls/<number>/comments`). When a wake needs no action, end your turn without a message.
3. Verify each finding against the source before you change anything. A CI failure follows [testing.md, "Failures"](testing.md#failures): classify it before any repair, never rerun until green.
4. In [trial mode](#trial-mode-until-2026-11-27), label every PR at creation; otherwise, a level 2 PR gets one CodeRabbit app review, at the end, from [the queue](#the-coderabbit-queue): once Sol approved, or its budget ended with the open findings in the PR's Review section, and every CI job except `Browser`, `Midnight wait` and `Check` passed, run `gh pr edit <n> --add-label needs-coderabbit` once, then keep watching. A push after that review gets no second one: answer each finding in its thread. Never comment `@coderabbitai review` yourself: a request outside the queue restarts the app's rate-limit window for every waiting PR. The queue requests the review and messages your thread; the review itself wakes you too.
5. Fix a real finding in a new commit. Collect every finding of a round, Sol's and CodeRabbit's, and answer the round in one push; never push mid-round. Reply in its thread with what changed and the tier where its prevention landed ([decision 0005](../decisions/0005-enforcement-ladder.md)). Every comment follows the `leaving-pr-comments` skill.
6. Dismiss a false finding with the evidence that the code is right, and resolve the thread. Decline scope creep the same way and list it as a follow-up: unneeded tests, guards for cases that do not occur, extra compatibility. Every CodeRabbit finding gets a disposition.
7. "Stopped watching, could not read it" usually means GitHub's rate limit is spent (`gh api rate_limit --jq .resources.graphql`). Wait for `reset` with one background command, then watch again.
8. When the level's reviews are done and every finding has a disposition, mark the PR ready: `gh pr ready <n>`. That run adds the plan's browser groups. On a UI-heavy diff, pass them on Boat first: `bun run test:plan`, then `bun run test:verify`. A push to a ready PR runs everything; for another review round, `gh pr ready <n> --undo` makes it a draft again, which starts no run.
9. When the PR meets [the merge gate](#the-merge-gate), merge it, call `unwatch_pull_request`, and report the level and the reviews it got. A "full stop" PR, or one that changes `AGENTS.md`, you hand back unmerged for the owner. Call `unwatch_pull_request` before every question to the owner too, so the thread reaches the owner's inbox.

Wrong turn: accepting a suggested diff verbatim. A reviewer sees the diff, not the product. A fix that weakens a role check or a German label to satisfy it is a regression.

### The merge gate

A PR is ready when all of these hold on its latest commit:

- The PR is no draft, and `Check` is green.
- The proof covers every change in the diff.
- The level's reviews are done, and each finding is fixed or dismissed with a reason in its thread.
- GitHub reports the PR mergeable and not `DIRTY` (`gh pr view <n> --json mergeable,mergeStateStatus`). On `DIRTY`, merge `origin/main` into the branch, resolve the conflict, push, and wait for green again. Without a conflict, never merge `origin/main` to freshen the branch: the merge queue tests the PR on the newest `main`.
- Each group this PR selects that an open `ci-alert` issue's run failed has passed on the branch. List the failed groups of each alert's run (`gh run view <run> --log-failed | grep -E '\[verify\] [^ ]+: failed'`), using the full run a release alert links, and compare them with `bun run test:plan`. Pass the overlap with `bun run test:verify --group <ids>`. A red run in other groups never blocks a merge.

Merge with `gh pr merge <n> --squash --auto`, after a fresh `git fetch` and a last look at the PR. The merge queue runs `ci.yml` on the PR on top of `main` and of the PRs ahead of it, and lands the PR when that run's `Check` passes ([decision 0009](../decisions/0009-pull-requests-and-ci.md)). Keep watching until `gh pr view <n> --json state` reports `MERGED`. When the queue's run fails, GitHub takes the PR out of the queue and your watch wakes: classify the failure ([testing.md, "Failures"](testing.md#failures)), fix it in a push, and run the merge command again once the gate holds. Never use `--admin` or another bypass.

### The CodeRabbit queue

`ops/coderabbit-queue.py` in `werk-flow/werkflow-planning` runs every 10 minutes on [the PC and the Mac](machine-setup.md#background-jobs), so no thread has to stay alive to hand out reviews. Each pass on the machine that holds its lease:

1. Lists the open PRs labelled `needs-coderabbit`. It skips a level 0 or 1 PR, and a PR that already got a CodeRabbit review or a request that is still good. A request is asked again when CodeRabbit answered it with a rate limit, "Review limit reached" or "Head commit changed", or with nothing for three hours, so a PR never waits for a review that will not come. A PR whose body states no review level, or two different ones, is refused, never guessed, and told so once in a comment.
2. Waits, because CodeRabbit Essentials has no paid overage and its hourly review limit falls as the rolling 7-day review count rises ([rate limits](https://docs.coderabbit.ai/management/rate-limits)). It counts CodeRabbit's "Review finished" notes of the last 7 days. Below 50, it does nothing within 20 minutes of a CodeRabbit review, "Review finished" note or request on any PR; from 50, within 65 minutes. A rate-limit notice pauses it 65 minutes, or until the notice's "available in N minutes" ends.
3. Selects the PR labelled longest ago, one per pass. Comments `@coderabbitai review` on it, swaps its label for `coderabbit-requested`, and sends one sentence to the PR's T3 thread on that machine: the one on its head branch, else the newest that links the PR, such as an epic's lead. A thread on the other machine hears of the review through its own watch.

In [trial mode](#trial-mode-until-2026-11-27), before `TRIAL_ENDS`, the queue instead requests up to ten labelled PRs per pass at any level, without waiting, once per label: a PR labelled again after its fix round gets the next review. Drafts are served, because the review comes before `gh pr ready`.

Each machine logs its passes to `~/.local/state/coderabbit-queue.log`. Automatic review is off, so a PR without the label gets no CodeRabbit review.

### Give a review its context

When the diff needs context no owner doc holds, such as the slice's feature spec, link it in the PR description. A feature spec states only implemented behavior, so name a deliberate limit in the PR description. Otherwise CodeRabbit recommends building a planned workflow or removing deliberate infrastructure.

### Run a local pre-check

`bun run review` runs the CodeRabbit CLI on local changes. It is optional and never replaces a level 2 PR's app review.

```bash
bun run review:doctor                                   # the binary and its authentication
bun run review                                          # uncommitted changes, AGENTS.md as context
bun run review -- --committed --base-commit <commit>    # committed work since a commit
bun run review -- findings                              # replay the stored findings
```

- Install the CLI only on a new machine ([machine setup](machine-setup.md#set-up-a-new-machine)). On a missing binary or authentication, report it; only the owner signs in.
- Over CodeRabbit's file limit, review in passes, one `--dir` per pass.
- On a quota limit, report it. Never retry in a loop.
- The owner authorizes sending repository code and review context to CodeRabbit, uncommitted changes included. The authorization does not cover buying credits or a subscription.

## Review quality

- A useful finding names the behavior, the evidence and the consequence. Prefer bugs, data loss, privacy leaks, security issues and role confusion over style.
- Zero findings certify nothing. A failed review stays missing; never present a manual review as a CodeRabbit review.
- Batch related corrections into one push. Stop an unproductive loop.
- A CodeRabbit Deep Scan is a separately billed whole-repository scan, not part of any required review. Get the owner's approval for the cost first. Its settings live in the dashboard, not in `.coderabbit.yaml`: it skips `temporary-transcripts/**`, `tests/**`, `docs/**` and `.agents/**`, and it has a short repository context.
