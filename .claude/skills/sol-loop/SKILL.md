---
name: sol-loop
description: Use when the user says "sol loop", and before you open or update a level 1 or level 2 pull request.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# sol-loop

You own the change; GPT Sol reviews it in a loop until you both agree or the budget ends. Sol is thorough and grabs onto a problem. Make the smallest change that answers each real finding. Watch for scope creep and push back with evidence.

[Review levels](../../../docs/technical/coderabbit.md#choose-the-review-level) say when a PR needs this loop. The owner can also say "sol loop" on any thread to run only the review.

## Budget

- Level 1: 3 rounds. Level 2: 5 rounds. The owner can raise either. Round 1 is full; later rounds check only changed code and open findings.
- Stop early when a round returns only nits. Declined nits and comment, doc or format-only fixes need no new round.
- One reviewer. Sol starts no subagents and no reviewers.
- Keep a ledger: id, severity, outcome, and the usage T3 reports for the round. Never guess usage; write "not exposed" when T3 shows none.

## 1. Scope

1. Run `git status --short`. Do not stash, discard or include unrelated changes. If the change paths do not separate cleanly from other work, stop and ask.
2. `git fetch origin`, then take the base: `git merge-base HEAD origin/main`. For an open PR, check that `HEAD` is the PR head (`gh pr view <n> --json headRefOid`) or ahead of it only by this change.
3. Commit the change locally. Sol reviews in its own worktree, which starts from your last local commit and does not see uncommitted edits. Do not push during the loop.
4. State the intent and what is out of scope in one or two sentences, and the PR's review level with its reason.
5. Run `bun run check:changed` and the focused tests that cover the change. Do not send code that this change breaks. Note missing or failing checks in the brief.

## 2. Start Sol

1. Call `orchestrator_capabilities`. Pick the newest `gpt-*-sol` model of the Codex provider unless the owner named one. Never hardcode a model id. Set `reasoningEffort: "high"` unless the owner asked for another effort, and record the effort.
2. Call `delegate_task` once per round with `role: "review"`, `mode: "async"`, `isolation: "worktree"`, the Codex `providerInstanceId`, the model, the options, and a new `clientRequestId` per round (`sol-loop-<branch>-r<round>`), stable across retries of that round. Save the `taskId`. The worktree is the read-only guard: T3 offers no read-only runtime mode for Codex, so Sol's edits, if any, stay in its own checkout. The prompt's "do not edit" is the second line.
3. The `childThreadId` is storage. Never continue a round with `t3_thread_send`, `create_threads` or `t3_thread_launch`.
4. End your turn and wait for the completion notice. Do not poll and do not start a second reviewer. Do not edit the scoped files while a round runs.
5. A timeout, an error or no reply is not approval. On a failure, `task_cancel`, confirm with `task_status` that it stopped, and restart the round with the ledger.
6. On a Sol rate limit or quota message, or when no Sol model is listed, ask the owner through `AskUserQuestion` with what blocks and the options. Never substitute another model.

Round 1 brief (a T3 child gets no history, so the brief carries everything):

```
Review only. Do not edit files, commit, push, comment on GitHub, or start subagents.
Repo: <worktree path> Base: <sha> Head: <sha> Review level: <1|2> (<reason>)
Intent: <intent> Out of scope: <scope> Checks run: <command: result, one per line>
Diff: git diff <base>..<head> [-- <paths>]
Product rules: read AGENTS.md first. Judge against it and these owner docs: <the virtue owner docs the diff touches, e.g. docs/technical/security.md for a permission>.
WerkFlow serves German SHK businesses: respect roles (admin, buero, employee), organization boundaries, and natural German UI copy with "du".
Read the surrounding code. Find bugs, broken callers, rule violations and mismatches with the intent.
Skip style unless it hides a bug. Hold to the smallest change: flag code, tests or guards the intent does not need.
Other paths, rare cases, small performance costs and extra compatibility are nits.
blocker = the intended case is wrong or a hard rule of AGENTS.md breaks. should = a real bug callers will hit, within the intent. nit = the rest.
Reply:
VERDICT: APPROVE or CHANGES
S1 [blocker|should|nit] <file>:<line> <claim>. Fix: <suggestion>   (stable ids across rounds)
```

## 3. Answer findings

Check each finding and its severity yourself against the source. Another path, a rare case or a small cost is a nit, whatever label it came with.

- **Agree**: make the smallest fix. Prefer deleting or narrowing code over a new lock, cache, helper or option. Add one focused test that fails without the fix when the intent needs it.
- **Disagree**: say why with evidence: `file:line`, a test, command output.
- **Out of scope or nit**: decline in one line and list it as a follow-up.

Update the ledger. Run the checks again and `git diff --shortstat <base>`. If review grew the diff, cut first. Do not agree only to end the loop.

## 4. Next round

Start one only while budget remains and a blocker or should is open, behavior code changed, or the last approval does not cover the current behavior diff. Commit locally first, then call `delegate_task` again with the round 1 brief, the ledger (`fixed:`, `disagree:`, `declined:` with evidence), the same base, the new head and the change since the last round. Tell Sol to check only open ids and changed code, and to mark each old id `resolved` or `still open: <reason>`.

## 5. Stop and record

- **Agreed**: APPROVE on the current behavior diff, no blocker or should open, and no concern of your own.
- **Stuck**: an item stays disputed after two replies, or the budget ends. Ask the owner through `AskUserQuestion`: each side in two or three plain sentences, your recommendation first. Budget end is not approval.

Put this line in the PR description, above the model line, with the values of the last round:

`Reviewed with sol-loop: <N> rounds with <model>. Sol verdict: <approved|not approved>. Usage: <what T3 reported per round, or "not exposed">.`

Write "not approved" whenever Sol did not approve the final diff; never soften it. Push only when the task includes pushing (a PR you are opening or updating, "full send", "full stop").

Report: rounds, model and effort, what Sol changed, diff size before and after, each finding fixed or declined with its reason, usage per round, and whether you pushed.
