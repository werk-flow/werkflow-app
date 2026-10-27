---
name: full-send
description: Use when the owner says "full send".
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# Full Send

The owner said "full send" because they are not watching this thread. They want the work done end to end without them: your updates and your final message go unread until long after you stop. You own the work from its current state to a merged PR on `main`.

If the owner did not clearly say "full send" in this thread, do not assume this autonomy. Without it, agents stop at ready, as `full-stop` does.

## What "full send" grants

- Commit, push and open the PR for this task's own branch. "full send" is the owner's request to commit and push.
- Merge the PR into `main` once [the merge gate](../../../docs/technical/coderabbit.md#the-merge-gate) passes, with `gh pr merge --squash`.
- Use the test methods that proof needs without asking first: run the app and a dev server, drive a browser, take screenshots, use computer use.

Rules about how to test still apply: the commands, fixtures and groups the owner docs name. The grant removes only the ask-first step. It never covers PROD, the `release` workflow, a release, real personal data, payments, deleting data outside the local stack, another branch, or a harness approval prompt.

The owner's rule of thumb: full send for docs, tests, CI and small fixes; full stop for level 2 work. It is not a block. When "full send" meets level 2 work, merge only after its CodeRabbit review, as the gate says, and name the level in the report.

## Steps

1. **Finish the change.** In the task's worktree (wait for `.t3/setup-done`) and on its own branch, never `main`. Complete the owner's goal with the smallest change that works. Fix the case that happened, not every case that could.
2. **Prove it.** Get proof for every change in the diff (see Proof).
3. **Choose the review level** from the diff by [the rule](../../../docs/technical/coderabbit.md#choose-the-review-level). For level 1 and 2, run the `sol-loop` skill.
4. **File the PR** with the `file-pr` skill. Merge `origin/main` into the branch first if it moved. The description says in one line how you proved the change.
5. **Babysit the PR** as [Babysit a pull request](../../../docs/technical/coderabbit.md#babysit-a-pull-request) describes. Fix real findings and CI failures, and prove each fix before you push it. A fix that changes behavior after Sol approved goes through another `sol-loop` round while its budget lasts.
6. **Merge** when the merge gate passes on the latest commit.
7. **Report** in plain language (see Report).

Stay active from step 1 to step 7. If you end your turn without a watcher while checks or bots are pending, the work stops, because nobody prompts you again. Wait with `watch_pull_request`. Before you stop short of the merge, or ask a question, call `unwatch_pull_request`.

## Proof

Proof is evidence you observed yourself in this session: command output, a reproduction, a screenshot. Use the most direct proof the change allows:

- Reproduce the original failure, apply the fix, then watch the same reproduction pass.
- Run `bun run check:changed`, then `bun run test:plan` and `bun run test:verify`, or the `bun run test:verify --group <id>` groups the plan selects for the diff.
- Add one focused test that fails without the fix when the behavior has none, at the cheapest boundary ([testing](../../../docs/technical/testing.md#how-to-work)).
- A permission, role or organization change: a SQL test or a unit test that drives the real action with a foreign id, and `bun run test:verify --group sql:security`.
- UI: run the app and look at it. Take the `@ACCEPT` captures of each changed screen before and after, in both themes, at 375 px and desktop, with the empty, loading and error states ([werkflow-design](../werkflow-design/SKILL.md)). Embed them in the PR. Green mocked tests do not prove the experience.

When you cannot prove a change, you do not have full confidence. Ask the owner.

## Asking the owner

A question in a normal message goes unseen, and the thread looks done. Call `unwatch_pull_request`, then ask through your harness's question tool (`AskUserQuestion` in Claude Code, the user-input tool in Codex) and end your turn. Put all the context in the question: the PR link, what blocks you, and the options with your recommendation first. Write for a non-developer: lead with the outcome, plain words, no jargon, no em dashes.

Ask only when you cannot continue alone:

- You cannot prove the change.
- The merge gate cannot pass and you cannot fix that yourself.
- Sol hit a rate limit or stays in dispute after its budget.
- The next step is outside the grant: PROD, a release, deleting data, real personal data, money, closing a PR, another branch.
- The goal is ambiguous in a way that changes the result.
- Another PR makes this one obsolete.

Decide everything else with the option you would recommend, and list those decisions in the report. If the question tool returns no answer, take the safe path: leave the PR open and unmerged, and open your final message with the question.

## Report

Plain language for the owner, outcome first. The PR link and the merge commit, what changed for the user, the proof in one or two lines, the review level and the sol-loop line, each decision you made for the owner, and anything you could not verify.
