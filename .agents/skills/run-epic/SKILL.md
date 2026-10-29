---
name: run-epic
description: Use when you lead an epic: a goal that needs several pull requests, planned as child issues in werkflow-planning and run as child threads.
---

# Run an epic

You are the lead thread: you plan, start children, merge and close. Children write the code. A delegated child cannot watch a PR, so you are each child PR's own thread: you watch it, label a level 2 child for [the CodeRabbit queue](../../../docs/technical/coderabbit.md#the-coderabbit-queue), and merge it.

The planning repo `werk-flow/werkflow-planning` is private. Its clone sits beside this repository's main checkout. This repo is public: never copy planning content into it. Cite an issue as `werk-flow/werkflow-planning#<n>`.

## 1. Plan

1. Read the brief, `AGENTS.md`, [the docs index](../../../docs/README.md), and the feature spec's **Current Product Baseline**.
2. Split the work into child PRs, one problem each. Give each a [review level](../../../docs/technical/coderabbit.md#choose-the-review-level) and a merge mode: "full send", or "full stop" where the owner must read the diff.
3. Order the children in stages. A stage runs in parallel and starts after the previous one merged. A child that changes a shared check or helper goes first, alone.
4. Open the epic issue: goal, targets, a table of children (stage, issue, level, merge mode), done-when.
5. Open one issue per child: "Part of <epic>. Stage <s>, level <l>, <merge mode>." Then **Do** (the scope, with file paths) and **Done when** (the commands that must pass and what the PR body reports).
6. Write one shared child brief in werkflow-planning: how to work, the style, the hand-back line, known flaky checks.

Done when every child issue has a stage, a level, a merge mode and a checkable done-when.

## 2. Approve once

1. Ask the owner through the question tool: the epic link, the children in order, and each open scope decision with your recommendation first. End your turn.
2. Comment the approval and every answer on the epic, and put each answer into the child issue it changes.

Never ask about the breakdown again. Decide later questions yourself and report them, unless they change scope or a hard rule.

## 3. Start children

Start each child of the current stage with `delegate_task` (`isolation: "worktree"`, `mode: "async"`). The prompt names the child issue and the shared brief, and says:

- Read the epic, the child issue and the brief before writing.
- Do the work yourself. Start no subagents.
- Update the **Current Product Baseline** of the feature spec in the same PR as the behavior.
- Run `bun run check:changed` and the done-when commands. Run `sol-loop` for level 1 and 2.
- Open the PR with `file-pr`. Do not watch or merge it.
- End with: `PR <full URL>, head <SHA>, checks and reviews <state>.`

End your turn. Each completion notice wakes you. Do not poll.

## 4. Merge in order

For each hand-back:

1. Call `link_pull_request` and `watch_pull_request` for the PR.
2. Read the diff against its issue. Fix small gaps yourself. Send a large one back as a new `delegate_task`.
3. Merge a child with `gh pr merge --squash` once [the merge gate](../../../docs/technical/coderabbit.md#the-merge-gate) passes. A "full stop" child, or one that changes `AGENTS.md`, waits for the owner's merge: call `unwatch_pull_request`, ask through the question tool, and end your turn.
4. Rebase the open siblings on the new `main`. Where two children edit the same lines, keep both sides.
5. Classify every failed job by [Failures](../../../docs/technical/testing.md#failures) before any rerun. Only an `environment` failure gets its one retry; cite its issue.
6. Close the child issue with "Merged in <PR>."

Start the next stage only after every child of this stage merged.

## 5. Close

1. On the merged `main`, run the feature's end-to-end journeys: `bun run test:verify --group <ids> --fresh` with its `golden:*` and `audit:*` groups from `lib/testing/selection/test-groups.ts`. A wave end adds `bun run test:verify --mode release`.
2. Check that each child updated the **Current Product Baseline** of every spec whose behavior it changed.
3. Check every done-when of the epic against `main`.
4. Comment the result on the epic: each child with its PR, targets before and after, decisions you made, anything unverified. Close the epic.
5. Report the same to the owner, outcome first.
