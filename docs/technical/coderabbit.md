# Pull-request reviews

Every PR to `main` gets the reviews its level needs ([decision 0009](../decisions/0009-pull-requests-and-ci.md)): your own read, a `sol-loop` review by GPT Sol, and for the riskiest changes one CodeRabbit app review. A reviewer is no authority. Check that a suggested fix keeps the SHK context, the role-specific workflows, the organization boundaries and field-worker usability.

`.coderabbit.yaml` points CodeRabbit at each virtue's owner doc. Automatic review is off. Change it only when an owner doc moves, a top-level folder needs its pointer, or the policy changes, and validate it against the schema its first line declares.

## How to work

### Choose the review level

Choose the level from the diff before you open the PR, and state it with its reason in the PR's Review section. The highest level any part of the diff reaches applies. The owner may raise a level; never go below the rule.

| Level | The diff | Reviews before ready |
| --- | --- | --- |
| 0 | No behavior effect: docs, comments, copy typos, agent instructions, formatting | Your own read of the diff |
| 1 | Changes behavior: product code, tests, CI logic, scripts. The default | `sol-loop` until Sol approves or its budget ends |
| 2 | Touches security, authentication, permissions and RLS, a migration, personal data, data deletion, the Zeitkonto, or time and payroll logic (for example `supabase/`, `lib/auth/`, `lib/org/`, `lib/security/`, `lib/storage/`, `lib/time-tracking/`, `lib/time-accounts/`, `lib/time-corrections/`) | `sol-loop`, then one CodeRabbit app review |

- Every level also needs `Check` green on the latest commit.
- Level 0 and 1 never request or wait for CodeRabbit.
- When the owner says "sol loop", run the `sol-loop` skill alone. It owns the review loop, its budget and its PR line.
- "full send" lets the agent merge; without it the owner merges.

Wrong turn: calling a change level 0 because it is small. A one-line change to a role check is level 2.

### Babysit a pull request

1. After `gh pr create`, call `link_pull_request`, handle the existing checks and comments, then call `watch_pull_request` and end your turn. T3 Code wakes you on a check result, a comment, a review or a conflict. Never poll, sleep or write a watcher.
2. On each wake, act only on news newer than your last push: the failed job (`gh run view <run-id> --log-failed`, its `evidence-<job>` artifact) or new comments (`gh pr view <number> --comments`, inline threads in `gh api repos/{owner}/{repo}/pulls/<number>/comments`). When a wake needs no action, end your turn without a message.
3. Verify each finding against the source before you change anything. A CI failure follows [testing.md, "Failures"](testing.md#failures): classify it before any repair, never rerun until green.
4. A level 2 PR gets one CodeRabbit app review, at the end: once Sol approved and `Check` is green, comment `@coderabbitai review` (the app skips repositories under ten stars by itself). Request it once per PR, never while its latest comment reports a rate limit: an early request restarts the window. When several PRs wait, request the security fixes first.
5. Fix a real finding in a new commit and push. Reply in its thread with what changed and the tier where its prevention landed ([decision 0005](../decisions/0005-enforcement-ladder.md)). Every comment follows the `leaving-pr-comments` skill.
6. Dismiss a false finding with the evidence that the code is right, and resolve the thread. Decline scope creep the same way and list it as a follow-up: unneeded tests, guards for cases that do not occur, extra compatibility. Every CodeRabbit finding gets a disposition.
7. "Stopped watching, could not read it" usually means GitHub's rate limit is spent (`gh api rate_limit --jq .resources.graphql`). Wait for `reset` with one background command, then watch again.
8. When the PR meets [the merge gate](#the-merge-gate), call `unwatch_pull_request` and hand back with the level and the reviews it got. Under "full send" you merge. Call `unwatch_pull_request` before every question to the owner too, so the thread reaches the owner's inbox.

Wrong turn: accepting a suggested diff verbatim. A reviewer sees the diff, not the product. A fix that weakens a role check or a German label to satisfy it is a regression.

### The merge gate

A PR is ready when all of these hold on its latest commit:

- `Check` is green.
- The proof covers every change in the diff.
- The level's reviews are done, and each finding is fixed or dismissed with a reason in its thread.
- GitHub reports the PR mergeable and not `DIRTY` (`gh pr view <n> --json mergeable,mergeStateStatus`).
- No commit that reached `main` after the last green run touches this PR's files. Otherwise merge `origin/main` into the branch, push, and wait for green again. The ruleset does not require an up-to-date branch, so this check is yours.

Merge only under "full send": `gh pr merge --squash`, after a fresh `git fetch` and a last look at the PR. Never use `--admin` or another bypass.

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

- Install the CLI only on a new machine ([environments](environments.md#set-up-a-new-machine)). On a missing binary or authentication, report it; only the owner signs in.
- Over CodeRabbit's file limit, review in passes, one `--dir` per pass.
- On a quota limit, report it. Never retry in a loop.
- The owner authorizes sending repository code and review context to CodeRabbit, uncommitted changes included. The authorization does not cover buying credits or a subscription.

## Review quality

- A useful finding names the behavior, the evidence and the consequence. Prefer bugs, data loss, privacy leaks, security issues and role confusion over style.
- Zero findings certify nothing. A failed review stays missing; never present a manual review as a CodeRabbit review.
- Batch related corrections into one push. Stop an unproductive loop.
- A CodeRabbit Deep Scan is a separately billed whole-repository scan, not part of any required review. Get the owner's approval for the cost first.
