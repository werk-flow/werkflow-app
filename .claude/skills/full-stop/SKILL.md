---
name: full-stop
description: Use when the owner says "full stop".
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# Full Stop

Follow [full-send](../full-send/SKILL.md) with its grant, proof, review and asking rules, but stop with the PR ready. The owner reads it and merges it.

- Never merge, enable auto-merge, push to `main`, bypass the ruleset, or ask another agent to.
- Before work and before each push, check `gh pr view <n> --json autoMergeRequest`. Turn auto-merge off if it is on, and report it.
- Use [the merge gate](../../../docs/technical/coderabbit.md#the-merge-gate) as the readiness check. Proof and review cover the final diff.
- Before the handoff, fetch `origin/main` and read the live PR: head, checks, reviews, mergeability. Confirm it is open and not a draft.
- Call `unwatch_pull_request` before the handoff or a question.

Report the PR link, the final head, the review level and the sol-loop line, the proof and the remaining risks. Say that the PR waits for the owner's merge, or what blocks it.
