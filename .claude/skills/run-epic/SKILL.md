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
4. List every kind-1 and kind-3 decision of [Decide or ask](../../../AGENTS.md#decide-or-ask) that the work can reach, each with your recommendation: scope edges, money, new personal data, a design direction with real alternatives, a residual exposure, a Willert question. Read the specs and the code until no child would have to stop for one.
5. Open the epic issue: goal, targets, a table of children (stage, issue, level, merge mode), the listed decisions, done-when, and the three lists of [section 4](#4-keep-the-three-lists), empty.
6. Open one issue per child: "Part of <epic>. Stage <s>, level <l>, <merge mode>." Then **Do** (the scope, with file paths) and **Done when** (the commands that must pass and what the PR body reports).
7. Write one shared child brief in werkflow-planning: how to work, the style, the hand-back line, known flaky checks.

Done when every child issue has a stage, a level, a merge mode and a checkable done-when, and the epic lists every owner decision you can foresee.

## 2. Approve once

1. Ask the owner through the question tool, in one batch: the epic link, the children in order, and every listed decision with your recommendation first. End your turn.
2. Comment the approval and every answer on the epic, and put each answer into the child issue it changes.

Never ask about the breakdown again. From here, [Decide or ask](../../../AGENTS.md#decide-or-ask) applies: decide, record, keep working.

## 3. Start children

Start each child of the current stage with `delegate_task` (`isolation: "worktree"`, `mode: "async"`). The prompt names the child issue and the shared brief, and says:

- Read the epic, the child issue and the brief before writing.
- Do the work yourself. Start no subagents.
- Decide by `AGENTS.md`, "Decide or ask", and never ask the owner. Write each decision with its reason into the PR body under "Decided without the owner". Report an owner item to the lead and keep working on what does not depend on it.
- Update the **Current Product Baseline** of the feature spec in the same PR as the behavior.
- Run `bun run check:changed` and the done-when commands. Run `sol-loop` for level 1 and 2.
- Open the PR with `file-pr`. Do not watch or merge it.
- Never end your turn while a shell run you wait on is going: your turn end is your hand-back ([wait for a long run](../../../docs/technical/testing.md#wait-for-a-long-run)).
- End with: `PR <full URL>, head <SHA>, checks and reviews <state>.`

End your turn. A child's completion notice wakes you, and so does a PR watch, so do not poll them. A shell run wakes nobody: [start it notified](../../../docs/technical/testing.md#wait-for-a-long-run).

## 4. Keep the three lists

The epic issue holds three lists ([Decide or ask](../../../AGENTS.md#decide-or-ask)).

- **Decided without the owner.** One line per decision, yours and each child's: what, why, the PR.
- **Owner queue.** One entry per owner item, posted once: what the owner decides or does, your recommendation first, numbered steps where the owner must act, and what waits for it. Keep every child going that does not depend on it. Use the question tool only when nothing else in the plan can move.
- **For the owner to look at.** Captures of the screens and copy you accepted ([rendered design acceptance](../../../docs/technical/standards-audit.md#rendered-design-acceptance)), each lab reference accepted with `lab-counts accept`, and where to try a user-visible speed change. Nothing waits for this list.

A kind-3 decision that turns up mid-build is a planning defect. Put it in the Owner queue, write on the epic what the plan missed, and read the rest of the plan for more before you start the next stage.

Trap: a capture linked from the PR. `.github/workflows/pr-screenshots.yml` deletes a PR's images when it closes, so commit each image to werkflow-planning and embed that copy.

## 5. Merge in order

For each hand-back:

1. Call `link_pull_request` and `watch_pull_request` for the PR.
2. Read the diff against its issue. Fix small gaps yourself. Send a large one back as a new `delegate_task`.
3. Merge a child with `gh pr merge --squash` once [the merge gate](../../../docs/technical/coderabbit.md#the-merge-gate) passes. A "full stop" child, or one that changes `AGENTS.md`, waits for the owner's merge: call `unwatch_pull_request`, post it under "Owner queue", and go on with the children that do not depend on it.
4. Rebase the open siblings on the new `main`. Where two children edit the same lines, keep both sides.
5. Classify every failed job by [Failures](../../../docs/technical/testing.md#failures) before any rerun. Only an `environment` failure gets its one retry; cite its issue.
6. Close the child issue with "Merged in <PR>."

Start the next stage only after every child of this stage merged.

## 6. Close

1. On the merged `main`, run the feature's end-to-end journeys: `bun run test:verify --group <ids> --fresh` with its `golden:*` and `audit:*` groups from `lib/testing/selection/test-groups.ts`. A wave end adds `bun run test:verify --mode release`. [Start each notified](../../../docs/technical/testing.md#wait-for-a-long-run).
2. Check that each child updated the **Current Product Baseline** of every spec whose behavior it changed.
3. Check every done-when of the epic against `main`.
4. Comment the result on the epic: each child with its PR, targets before and after, decisions you made, anything unverified. Close the epic.
5. Report the same to the owner, outcome first, with the open Owner queue entries.
