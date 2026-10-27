---
name: coderabbit-review
description: Reviews code changes using CodeRabbit AI. Use when user asks for a CodeRabbit review, PR feedback via CodeRabbit, or requests fix-review cycles with CodeRabbit.
---

# CodeRabbit Review

The CodeRabbit app reviews each level 2 pull request once, on request; a local review runs through the repository wrapper, `bun run review`, from the repository root. [Pull-request reviews](../../../docs/technical/coderabbit.md) owns the repo-specific behavior and overrides generic CodeRabbit instructions. Read it before the first review of a task:

- [Babysit a pull request](../../../docs/technical/coderabbit.md#babysit-a-pull-request): how to handle each finding on a PR.
- [Run a local pre-check](../../../docs/technical/coderabbit.md#run-a-local-pre-check): the commands, the setup check (`bun run review:doctor`), the standing authorization, and what to do when the binary or authentication is missing.
- [Give a review its context](../../../docs/technical/coderabbit.md#give-a-review-its-context): where context beyond the owner docs goes.

## Guardrail

Never probe `coderabbit` or `cr` on PATH, never install or reinstall CodeRabbit outside the new-machine setup, and never call the CLI directly. The wrapper owns the binary path, the working directory and agent mode. A failed PATH lookup is not an installation check.

## Result format

- State the review scope briefly.
- Say how many issues CodeRabbit raised.
- Order issues by severity and include file, impact, and a concrete fix.
- If there are none, say `CodeRabbit raised 0 issues.`
- Never present a manual review as a CodeRabbit review.
