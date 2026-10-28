---
name: sol-loop
description: Use when the user says "sol loop", and before you open or update a level 1 or level 2 pull request.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# sol-loop

You own the change. GPT Sol reviews it in rounds until you agree or the budget ends. Answer each real finding with the smallest change. Push back on scope creep with evidence.

## Budget

- 3 rounds, 5 for level 2. The owner can raise either. Round 1 reviews everything. Later rounds check changed code and open findings.
- Stop early when a round returns only nits.
- One reviewer. Sol starts no subagents.
- Keep a ledger: finding id, severity, outcome, and the usage T3 reports per round ("not exposed" when it shows none).

## 1. Scope

1. Run `git status --short`. Leave unrelated changes out. If they do not separate cleanly, ask.
2. Run `git fetch origin`. The base is `git merge-base HEAD origin/main`.
3. Commit locally. Sol's worktree starts from your last commit. Do not push during the loop.
4. Run `bun run check:changed` and the focused tests. Note any failure in the brief.

## 2. Start a round

1. Call `orchestrator_capabilities`. Pick the newest `gpt-*-sol` model of the Codex provider unless the owner named one. Set `reasoningEffort: "high"` unless told otherwise.
2. Call `delegate_task` with `role: "review"`, `mode: "async"`, `isolation: "worktree"`, the Codex `providerInstanceId`, the model, and `clientRequestId: "sol-loop-<branch>-r<round>"`.
3. End your turn and wait for the completion notice. Do not poll, and do not edit the scoped files while a round runs.
4. A timeout, an error or silence is not approval. Cancel with `task_cancel`, confirm with `task_status`, and restart the round.
5. On a rate limit, or when no Sol model is listed, ask the owner through the question tool. Never substitute another model.

Round 1 brief:

```
Review only. Do not edit files, commit, push, comment on GitHub, or start subagents.
Repo: <worktree path> Base: <sha> Head: <sha> Review level: <0|1|2> (<reason>)
Intent: <intent> Out of scope: <scope> Checks run: <command: result, one per line>
Diff: git diff <base>..<head> [-- <paths>]
Read AGENTS.md first. Judge against it and these owner docs: <docs the diff touches>.
Find bugs, broken callers, rule violations and mismatches with the intent. Skip style unless it hides a bug.
Flag code, tests or guards the intent does not need.
blocker = the intended case is wrong or a hard rule breaks. should = a real bug callers will hit. nit = the rest.
Reply:
VERDICT: APPROVE or CHANGES
S1 [blocker|should|nit] <file>:<line> <claim>. Fix: <suggestion>   (stable ids across rounds)
```

## 3. Answer findings

Check each finding against the source. Another path, a rare case or a small cost is a nit, whatever its label.

- **Agree:** make the smallest fix. Prefer deleting or narrowing code to a new lock, cache, helper or option.
- **Disagree:** give evidence: `file:line`, a test, command output.
- **Out of scope or nit:** decline in one line and note a follow-up.

Rerun the checks and `git diff --shortstat <base>`. If review grew the diff, cut first.

## 4. Next round

Start one only while budget remains and a blocker or should is open or behavior changed since the last approval. Commit, then send the round 1 brief plus the ledger (`fixed:`, `disagree:`, `declined:`), the same base and the new head. Ask Sol to mark each old id `resolved` or `still open: <reason>`.

## 5. Stop

- **Agreed:** APPROVE on the current behavior diff, no blocker or should open.
- **Stuck:** a finding stays disputed after two replies, or the budget ends. Ask the owner through the question tool: each side in plain sentences, your recommendation first.

Put this line in the PR description:

`Reviewed with sol-loop: <N> rounds with <model>. Sol verdict: <approved|not approved>. Usage: <per round, or "not exposed">.`

Write "not approved" whenever Sol did not approve the final diff.
