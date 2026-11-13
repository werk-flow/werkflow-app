---
name: sol-loop
description: Use when the user says "sol loop", and when you open or update a level 1 or level 2 pull request.
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# sol-loop

You own the change. GPT Sol reviews it in rounds until you agree or the budget ends. Answer each real finding with the smallest change. Push back on scope creep with evidence.

## Budget

- 3 rounds per PR, at every level, in [trial mode](../../../docs/technical/coderabbit.md#trial-mode-until-2026-11-27) too. It is a hard limit: no lead grants an extra round. Only the owner can raise it, for one PR.
- The order: round 1 reviews everything while CodeRabbit reviews the draft. One push answers both. Round 2 confirms that push. Round 3 runs only when round 2 left a blocker or should open, and checks its fix.
- Stop early when a round returns only nits.
- One reviewer. Sol starts no subagents.
- Keep a ledger: finding id, severity, outcome.

## 1. Scope

1. Run `git status --short`. Leave unrelated changes out. If they do not separate cleanly, ask.
2. Run `git fetch origin`. The base is `git merge-base HEAD origin/main`.
3. Commit locally. Sol's worktree starts from your last commit.
4. Run `bun run check:changed` and the focused tests. Note any failure in the brief.
5. Before round 1, push and open the PR as a draft (the `file-pr` skill). In [trial mode](../../../docs/technical/coderabbit.md#trial-mode-until-2026-11-27) it carries `needs-coderabbit` at once, so CodeRabbit reviews the draft while round 1 runs. Never push while a round runs.

## 2. Start a round

1. Call `orchestrator_capabilities`. Pick the newest `gpt-*-sol` model of the Codex provider unless the owner named one. Set `reasoningEffort: "high"` unless told otherwise.
2. Call `delegate_task` with `role: "review"`, `mode: "async"`, `isolation: "worktree"`, the Codex `providerInstanceId`, the model, and `clientRequestId: "sol-loop-<branch>-r<round>"`.
3. End your turn and wait for the round's completion notice. Do not poll, and do not edit the scoped files while a round runs. Only a delegated round wakes you this way; a shell run never does ([wait for a long run](../../../docs/technical/testing.md#wait-for-a-long-run)).
4. A timeout, an error or silence is not approval. Cancel with `task_cancel`, confirm with `task_status`, and restart the round.
5. A rate limit, or no listed Sol model, is an owner item ([Decide or ask](../../../AGENTS.md#decide-or-ask)). Never substitute another model.

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

Answer CodeRabbit's findings on the same commit in the same fix round. Rerun the checks and `git diff --shortstat <base>`. If review grew the diff, cut first. Then push the round once; in trial mode, add `needs-coderabbit` again.

## 4. Next round

Start one only while budget remains and a blocker or should is open or behavior changed since the last approval. After the round's push, send the round 1 brief plus the ledger (`fixed:`, `disagree:`, `declined:`), the same base and the new head. Ask Sol to mark each old id `resolved` or `still open: <reason>`.

Skip the round when the PR's own diff is unchanged since Sol's last round, as after a pure merge of `main` or a conflict resolution that keeps your side. Prove it before you skip. Compare the PR's diff at Sol's last head with the diff now, without hunk positions and blob hashes, which a merge changes:

```bash
git diff -U0 <last-round-base>..<last-round-head> | grep -Ev '^(@@|index )' > before.diff
git diff -U0 "$(git merge-base HEAD origin/main)"..HEAD | grep -Ev '^(@@|index )' > after.diff
cmp before.diff after.diff
```

Skip only when `cmp` prints nothing, and write that result in the ledger. A skipped round uses no budget. Never use `git range-diff` for this: it ignores merge commits, so it misses a conflict resolution.

## 5. Stop

- **Agreed:** APPROVE on the current behavior diff, no blocker or should open.
- **Disputed:** a finding is still disputed after the last round. Ask the owner through the question tool: the finding, Sol's side, your side with its evidence, and your recommendation first. A child hands the question to its lead, which asks. Keep working on what does not depend on it, and write the answer into the PR's Review section.
- **Budget ended:** name the commits Sol has not read and the open findings in the PR's Review section. A child hands back with them.

Put this line in the PR description:

`Reviewed with sol-loop: <N> rounds with <model>. Sol verdict: <approved|not approved>.`

Write "not approved" whenever Sol did not approve the final diff.
