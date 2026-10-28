---
name: full-send
description: Use when the owner says "full send".
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# Full Send

The owner is not watching. Take the work from its current state to a merged PR on `main`. Without a clear "full send" in this thread, stop at ready, as `full-stop` does.

## The grant

- Commit, push and open the PR for this task's branch.
- Merge with `gh pr merge --squash` once [the merge gate](../../../docs/technical/coderabbit.md#the-merge-gate) passes.
- Run the app, drive a browser and take screenshots without asking.

It never covers PROD, a release, real personal data, payments, deleting data outside the local stack, another branch, or a harness approval prompt.

## Steps

1. Finish the change in the task's worktree and branch, never `main`. Fix the case that happened, not every case that could.
2. Prove it (below).
3. Choose the [review level](../../../docs/technical/coderabbit.md#choose-the-review-level). For level 1 and 2, run `sol-loop`.
4. File the PR with `file-pr`. Merge `origin/main` first if it moved.
5. Call `watch_pull_request` and babysit the PR ([pull-request reviews](../../../docs/technical/coderabbit.md)). Prove each fix before you push it. A behavior fix after Sol approved gets another `sol-loop` round while budget lasts.
6. Merge when the gate passes on the latest commit.
7. Report (below).

Never end your turn while checks or bots are pending without a watcher: nobody prompts you again. Call `unwatch_pull_request` before you stop short of the merge or ask a question.

## Proof

Proof is evidence you observed in this session.

- Reproduce the failure, apply the fix, watch the same reproduction pass.
- Run `bun run check:changed`, `bun run test:plan` and `bun run test:verify`.
- Add one focused test that fails without the fix, at the cheapest boundary.
- A permission change: a test that drives the real action with a foreign id, and `bun run test:verify --group sql:security`.
- UI: run the app and capture each changed screen as [werkflow-design](../werkflow-design/SKILL.md) "Verify your work" says. Embed the captures in the PR.

If you cannot prove the change, ask.

## Ask the owner

Call `unwatch_pull_request`, ask through the question tool, and end your turn. Include the PR link, what blocks you and the options, your recommendation first, in plain words for a non-developer. Ask only when:

- you cannot prove the change
- the gate cannot pass and you cannot fix it
- Sol hit a rate limit or stays disputed
- the next step is outside the grant
- the goal is ambiguous in a way that changes the result
- another PR makes this one obsolete

Decide everything else yourself and list the decisions in the report. If the question gets no answer, leave the PR open and unmerged.

## Report

Outcome first, in plain language: the PR link and merge commit, what changed for the user, the proof, the review level and the sol-loop line, your decisions, and anything unverified.
