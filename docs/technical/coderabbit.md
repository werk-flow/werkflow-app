# CodeRabbit reviews

Status: living — last reviewed 2026-10-26

The CodeRabbit GitHub app reviews each code pull request to `main` once, on request ([decision 0009](../decisions/0009-pull-requests-and-ci.md)). Treat it as a reviewer, not as an authority. Every finding needs engineering judgment: check that a suggested fix keeps the SHK product context, the role-specific workflows, the organization boundaries and field-worker usability.

The root `.coderabbit.yaml` configures the review. Its path instructions point at the owner doc of each virtue and leave generated files out; the rules themselves live in those docs, and `AGENTS.md` is read as a guideline file. Automatic review is off, so that a code PR gets its one review on request ([step 4](#babysit-a-pull-request)). Change the file only when an owner doc moves, a new top-level folder needs its pointer or the review policy changes. Validate it against the schema its first line declares.

## How to work

### Babysit a pull request

A PR that changes only docs, agent instructions or CI workflow files is a docs PR. Every other PR, including any that touches product code, tests, migrations or security-relevant code, is a code PR.

1. After `gh pr create`, call `watch_pull_request` with the PR URL and end your turn. T3 Code wakes you when a check fails or passes, someone comments or reviews, or the branch conflicts. Do not poll or sleep.
2. On each wake, read what is new: the failed CI job (`gh run view <run-id> --log-failed`, its `evidence-<job>` artifact) or the new review comments (`gh pr view <number> --comments`, the inline threads in `gh api repos/{owner}/{repo}/pulls/<number>/comments`).
3. Verify each finding against the source before you change anything. A CI failure follows [testing.md, "Failures"](testing.md#failures): classify it before any repair, never rerun until green.
4. A docs PR gets your own review of its diff and no app review. A code PR gets one app review, at the end: once `Check` is green on the latest commit, comment `@coderabbitai review`, because the app does not review a repository with fewer than ten stars by itself. Request it once per PR, not after each fix, and never while the app's latest comment reports a rate limit: an early request restarts the limit's window. When several PRs wait, request the security fixes first.
5. Fix a real finding in a new commit on the branch and push. Reply in its thread with what changed and the tier where its prevention landed ([decision 0005](../decisions/0005-enforcement-ladder.md)).
6. Dismiss a false finding with a written reason in its thread: the evidence that the code is right. Resolve the thread.
7. While the app reports a rate limit, a code PR can take the local review instead: `bun run review -- --committed --base-commit $(git merge-base origin/main HEAD)` covers the PR's changes. Handle each local finding like an app finding (steps 5 and 6), and list its disposition in a PR comment, since it has no thread.
8. Stay quiet when nothing is new. A docs PR is ready when `Check` is green on the latest commit. A code PR is ready when `Check` is green on the latest commit and its app review or local review is clean: every finding fixed or dismissed with a reason. Then call `unwatch_pull_request` and hand back, naming the PR's kind and the review it got: the owner merges.

Wrong turn: accepting a suggested diff verbatim. CodeRabbit sees the diff, not the product; a fix that weakens a role check or a German label to satisfy it is a regression.

### Give a review its context

`AGENTS.md` and the owner docs carry the durable rules. When the diff needs context that no owner doc holds, such as the feature spec of the slice, link it in the PR description. A feature spec separates implemented behavior from planned scope; otherwise CodeRabbit recommends building a planned workflow or removing deliberate infrastructure.

### Run a local pre-check

`bun run review` runs the CodeRabbit CLI on local changes before you push. It is optional, except while the app is rate-limited: then it can replace a code PR's app review ([step 7](#babysit-a-pull-request)).

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

A pull-request review is not a CodeRabbit Deep Scan. Deep Scan is a whole-repository scan that starts from the Security area of the CodeRabbit dashboard and has separate usage billing ([security documentation](https://docs.coderabbit.ai/security)). No Deep Scan is part of the required review. Before anyone starts a chargeable scan, get the owner's approval for the cost. If the owner selects a scan, scan the current `main` commit and keep the exact scope and coverage report. Deep Scan performs no dependency analysis, so dependency auditing and live provider review remain separate evidence.

## Greptile and TREX evaluation

The owner deferred the evaluation of Greptile and TREX. The evaluation is no prerequisite for any work, and CodeRabbit remains the required review.
