---
name: council
description: Use when the owner says "council", and for the review rounds of a hill climb toward a goal with a pass score.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# council

A council is a set of independent reviewers from two providers who rate a body of work against one goal. A hill climb uses it: you change things toward the goal, the council scores the result, you fix what moves the score, and the council rates again until every member reaches the pass score or the climb stops.

The council advises. You own the work and every decision about it. The climb must converge: a reviewer told to find problems always finds some, so a new round never means better work by itself.

The council is not the review of a pull request. Each PR still gets its [review level](../../../docs/technical/coderabbit.md#choose-the-review-level) and `sol-loop`.

## 1. Set up the climb before the first change

Write the set-up into the climb's issue or brief, and get the owner's yes on it:

- **Goal:** one sentence, for example "CI costs as few job-minutes per merged PR as possible without lowering quality".
- **Evidence:** how closeness to the goal is shown. Prefer a measurement (job-minutes, lab counts, timings, failure rates). Where none exists, such as UI and UX, name the rubric and the captures the council judges.
- **Pass score:** the overall score out of 10 that every member must give, for example 9.
- **Scope:** what may change and what stays out. Name the hard limits, such as "no lower coverage" or "no new paid service".
- **Members:** the default is two Claude Opus and two GPT Sol at their newest versions. The owner may name others.
- **Round budget:** at most 4 rounds unless the owner sets another number.

Only the owner changes the goal, the pass score, the scope or the budget, and only between rounds. A member never adds a goal.

## 2. Convene a round

Convene after a substantial batch of changes has landed, never for every small PR. Before a round, fix the known issues, answer open PR comments and run the relevant checks, so the council reviews the current state.

1. Call `orchestrator_capabilities`. Pick the newest `claude-opus-*` model of the Claude provider and the newest `gpt-*-sol` model of the Codex provider, unless the owner named members. A missing member is an owner item ([Decide or ask](../../../AGENTS.md#decide-or-ask)); never substitute another model.
2. Start every member at once with `delegate_task`: `role: "review"`, `mode: "async"`, `isolation: "worktree"`, `reasoningEffort: "high"`, and `clientRequestId: "council-<climb>-r<round>-<member>"`. Members never read each other's work.
3. Start fresh members every round. Give each the brief below, the previous round's reviews and the ledger, so it checks the old findings before it looks for new ones.
4. Do not edit what a member reads while it reviews. End your turn and wait for the completion notices. Do not poll.
5. A Codex usage limit gets the retry of [`sol-loop`, step 6 of "Start a round"](../sol-loop/SKILL.md#2-start-a-round). A timeout, an error or silence is no score: restart that member once, then record `no score`.
6. When the first result arrives, check its findings against the source while the others run. Do not wait idle.

Brief:

```
Review only. Do not edit files, commit, push, comment on GitHub, message other threads or start subagents.
Climb: <name>  Round: <N>  Repo: <worktree path>  Head: <sha>
Goal: <goal>
Evidence: <measurements, captures and files to judge, with paths>
Scope: <what may change>  Out of scope: <limits>
What changed since the last round: <list>
Previous reviews and ledger: <paths, or "none" in round 1>
Read AGENTS.md first.
1. Mark each earlier finding id resolved, or still open with the evidence.
2. Find what still keeps the work from the goal. Back each finding with a file and line, a command, or a number; mark estimates.
   blocker = the goal is not met or a hard rule breaks. should = a material, evidenced gap toward the goal. nit = the rest.
3. Score the work as a whole, 1 to 10, on its evidence now.
4. Name the shortest list of changes that would raise your score to <pass score>. A point not on that list cannot hold your score back later.
Write your review to <path> and reply:
SCORE: <n>/10
C1 [blocker|should|nit] <claim>. Evidence: <...>. Fix: <smallest change>. Gain: <expected effect on the goal>   (stable ids across rounds)
```

Tell members the goal, never the pass score.

## 3. Decide what to change

Keep a ledger: finding id, member, severity, decision, outcome. For each finding:

- **Fix** a blocker, and a should whose gain toward the goal is worth its cost. Make the smallest change that delivers it.
- **Decline** a nit, a finding outside the scope, and a should whose gain is small against its cost or risk. One line each, with the reason. Out-of-scope work becomes a follow-up issue, never part of the climb.
- **Disagree** with evidence when a finding is wrong.
- **Hold** a finding that needs the owner. Keep working on everything else and list it for the owner with your recommendation first.

Agreement between members raises a finding's weight; one member's opinion against the evidence does not. A fixed finding is not reopened without new evidence of a regression.

## 4. Converge or stop

Start the next round only while the budget lasts and you fixed something that should change a score. Stop when one of these holds:

- **Passed:** every member scored at least the pass score.
- **Budget ended:** the round budget is used.
- **Plateau:** the lowest score rose by less than 1 point since the last round, or a round opened more blockers and shoulds than it closed.
- **Blocked:** every open point needs the owner, data or compute the climb does not have, such as a measured week on new hardware.

At every stop except Passed, name each member's open points from its "shortest list" and why they stay open.

## 5. Report

Put the council table in the climb's final report and in the description of the PR that closes the climb. Put it before the model and harness line:

```markdown
## Council review

Goal: <goal>  Pass score: <n>/10  Rounds: <N>  Result: <passed|budget ended|plateau|blocked>

| Member | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus A | 6/10 | 8/10 |
| GPT Sol A | 5/10 | 8/10 |
```

Write `no score` where a member gave none. Never invent one. Edit an open PR's description; do not post a comment. Without a PR, put the table in the final reply.
