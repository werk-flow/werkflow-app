---
name: full-stop
description: Use when the owner says "full stop".
---

Adapted for WerkFlow from t3dotgg/tstack (MIT, [license](../LICENSE-tstack)).

# Full Stop

Do the work of `full-send`, but stop with the PR ready for the owner to merge. Never merge it.

Read [full-send](../full-send/SKILL.md) and follow its steps, proof, review, babysitting and asking rules. "full stop" grants what "full send" grants, including the testing permission and the request to commit and push, except the merge. The overrides below take precedence.

## No merging

Never merge, enable auto-merge, push to `main`, bypass the ruleset, or ask another agent to do one of these. Before work begins and before each push, check that auto-merge is off (`gh pr view <n> --json autoMergeRequest`), turn it off if it is on, and report that.

## Stop at the gate

Use [the merge gate](../../../docs/technical/coderabbit.md#the-merge-gate) as the readiness check, and replace full-send's merge and report steps with a handoff. Proof and review cover the final diff; check behavior changes and conflict fixes again before the handoff.

Fetch `origin/main` and read the live PR: head, base, checks, reviews, mergeability. Confirm it is open and not a draft. If someone else merged it, report that instead.

- **Ready to merge**: the gate passes. Leave the PR open and unmerged.
- **Blocked**: say what prevents readiness, what you tried and what is needed, through full-send's asking rules.

Call `unwatch_pull_request` before the handoff or a question. Report in plain language: the PR link, the final head, the review level and the sol-loop line, the proof, and the remaining risks. Say that the PR is open and waits for the owner's merge.
