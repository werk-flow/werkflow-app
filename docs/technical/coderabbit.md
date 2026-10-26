# Pull-request reviews

Status: living — last reviewed 2026-10-26

Every pull request to `main` gets the reviews its level needs ([decision 0009](../decisions/0009-pull-requests-and-ci.md)): the agent's own read, a `sol-loop` review by GPT Sol, and for the riskiest changes one CodeRabbit app review. Treat every reviewer as a reviewer, not as an authority. Every finding needs engineering judgment: check that a suggested fix keeps the SHK product context, the role-specific workflows, the organization boundaries and field-worker usability.

The root `.coderabbit.yaml` configures the CodeRabbit review. Its path instructions point at the owner doc of each virtue and leave generated files out; the rules themselves live in those docs, and `AGENTS.md` is read as a guideline file. Automatic review is off, so that a level 2 PR gets its one review on request ([step 4](#babysit-a-pull-request)). Change the file only when an owner doc moves, a new top-level folder needs its pointer or the review policy changes. Validate it against the schema its first line declares.

## How to work

### Choose the review level

Choose the level from the diff before you open the PR, and state it with its reason in the PR description's Review section. The highest level any part of the diff reaches applies. The owner may raise a level by saying so; never go below the rule.

| Level | The diff | Reviews before ready |
| --- | --- | --- |
| 0 | Has no behavior effect: docs, comments, copy typos, agent instructions, formatting | Your own read of the diff |
| 1 | Changes behavior: product code, tests, CI logic, scripts. The default | `sol-loop` until Sol approves or its budget ends |
| 2 | Touches security, authentication, permissions and RLS, a migration, personal data, data deletion, the Zeitkonto, or time and payroll logic, for example under `supabase/`, `lib/auth/`, `lib/org/`, `lib/security/`, `lib/storage/`, `lib/time-tracking/`, `lib/time-accounts/` or `lib/time-corrections/` | `sol-loop`, then one CodeRabbit app review |

Every level also needs `Check` green on the latest commit. Level 0 and 1 never request or wait for CodeRabbit. When the owner says "sol loop" on any thread, run the `sol-loop` skill alone. The `sol-loop` skill owns the review loop: its budget, its brief and the line it adds to the PR description. "full send" lets the agent merge the PR; without it the owner merges (the `full-send` and `full-stop` skills).

Wrong turn: calling a change level 0 because it is small. A one-line change to a role check is level 2.

### Babysit a pull request

1. After `gh pr create`, call `link_pull_request`, handle the checks and comments that already exist, then call `watch_pull_request` with the PR URL and end your turn. T3 Code wakes you when a check fails or passes, someone comments or reviews, or the branch conflicts. Do not poll, sleep or write a watcher.
2. On each wake, act only on news newer than your last push: the failed CI job (`gh run view <run-id> --log-failed`, its `evidence-<job>` artifact) or the new review comments (`gh pr view <number> --comments`, the inline threads in `gh api repos/{owner}/{repo}/pulls/<number>/comments`). When a wake needs no action, end your turn without a message; never post "still waiting".
3. Verify each finding against the source before you change anything. A CI failure follows [testing.md, "Failures"](testing.md#failures): classify it before any repair, never rerun until green.
4. A level 2 PR gets one CodeRabbit app review, at the end: once Sol approved and `Check` is green on the latest commit, comment `@coderabbitai review`, because the app does not review a repository with fewer than ten stars by itself. Request it once per PR, not after each fix, and never while the app's latest comment reports a rate limit: an early request restarts the limit's window. When several PRs wait, request the security fixes first.
5. Fix a real finding in a new commit on the branch and push. Reply in its thread with what changed and the tier where its prevention landed ([decision 0005](../decisions/0005-enforcement-ladder.md)). Every comment follows the `leaving-pr-comments` skill.
6. Dismiss a false finding with a written reason in its thread: the evidence that the code is right. Resolve the thread. Decline scope creep the same way and list it as a follow-up: tests the change does not need, guards for cases that do not occur, extra compatibility, small performance costs. A CodeRabbit finding on a level 2 PR always gets a disposition, including one that asks for human review.
7. While the app reports a rate limit, a level 2 PR can take the local review instead: `bun run review -- --committed --base-commit $(git merge-base origin/main HEAD)` covers the PR's changes. Handle each local finding like an app finding (steps 5 and 6), and list its disposition in a PR comment, since it has no thread.
8. "Stopped watching, could not read it" usually means GitHub's rate limit is spent. Run `gh api rate_limit --jq .resources.graphql` before you watch again. If `remaining` is near 0, wait for `reset` with one background command, then watch again; never in a tight loop.
9. When the PR meets [the merge gate](#the-merge-gate), call `unwatch_pull_request` and hand back, naming the level and the reviews it got: the owner merges. Under "full send" you merge. Call `unwatch_pull_request` before every question to the owner too, so the thread reaches the owner's inbox.

Wrong turn: accepting a suggested diff verbatim. A reviewer sees the diff, not the product; a fix that weakens a role check or a German label to satisfy it is a regression.

### The merge gate

A PR is ready when all of these hold on its latest commit:

- `Check` is green.
- The proof covers every change in the diff.
- The level's reviews are done, and each finding is fixed or dismissed with a reason in its thread.
- GitHub reports the PR mergeable and not `DIRTY` (`gh pr view <n> --json mergeable,mergeStateStatus`).
- No commit that reached `main` after the last green run touches this PR's files. Otherwise merge `origin/main` into the branch, push, and wait for green again. The ruleset does not require an up-to-date branch, so this check is yours.

Merge only under "full send", with `gh pr merge --squash`, after a fresh `git fetch` and a last look at the PR. Never use `--admin` or another bypass.

### Give a review its context

`AGENTS.md` and the owner docs carry the durable rules. When the diff needs context that no owner doc holds, such as the feature spec of the slice, link it in the PR description. A feature spec separates implemented behavior from planned scope; otherwise CodeRabbit recommends building a planned workflow or removing deliberate infrastructure.

### Run a local pre-check

`bun run review` runs the CodeRabbit CLI on local changes before you push. It is optional, except while the app is rate-limited: then it can replace a level 2 PR's app review ([step 7](#babysit-a-pull-request)).

```bash
bun run review:doctor                                   # the binary and its authentication
bun run review                                          # uncommitted changes, AGENTS.md as context
bun run review -- --committed --base-commit <commit>    # committed work since a commit
bun run review -- findings                              # replay the stored findings
```

The wrapper owns the binary path (`~/.local/bin/coderabbit`), the working directory and agent mode. Install the CLI only while you set up a new machine ([environments](environments.md#set-up-a-new-machine)). When the wrapper reports a missing binary or authentication, report it to the owner; only the owner signs in, with `coderabbit auth login`. When the diff exceeds CodeRabbit's file limit, review it in passes, one `--dir` per pass. The CLI plan limits the number of reviews; on a quota limit, report it and do not retry in a loop.

The owner has given standing authorization to send repository code and review context to CodeRabbit, including uncommitted and unpushed changes. The authorization does not cover buying credits or a subscription.

## Review quality

A useful finding names the affected behavior, the evidence and the consequence. Prefer findings that can cause user-visible bugs, data loss, privacy leaks, security issues, role confusion or production instability over style remarks.

A review with zero findings does not certify correctness, visual quality or runtime coverage. A missing or failed review stays missing. If CodeRabbit fails, report the actual failure. Do not present a manual review as a CodeRabbit review.

Batch related corrections into one push. No rule demands repeated passes until one reports no findings; stop an unproductive review loop.

## Dedicated security scanning

A pull-request review is not a CodeRabbit Deep Scan. Deep Scan is a whole-repository scan that starts from the Security area of the CodeRabbit dashboard and has separate usage billing ([security documentation](https://docs.coderabbit.ai/security)). No Deep Scan is part of a required review. Before anyone starts a chargeable scan, get the owner's approval for the cost. If the owner selects a scan, scan the current `main` commit and keep the exact scope and coverage report. Deep Scan performs no dependency analysis, so dependency auditing and live provider review remain separate evidence.

## Greptile and TREX evaluation

The owner deferred the evaluation of Greptile and TREX. The evaluation is no prerequisite for any work, and CodeRabbit remains the app review of level 2.
