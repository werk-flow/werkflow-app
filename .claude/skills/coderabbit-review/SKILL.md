---
name: coderabbit-review
description: Reviews code changes using CodeRabbit AI. Use when user asks for a CodeRabbit review, PR feedback via CodeRabbit, or requests fix-review cycles with CodeRabbit.
---

# CodeRabbit Review

Run every CodeRabbit operation through the repository wrapper, `bun run review`, from the repository root. [CodeRabbit reviews](../../../docs/technical/coderabbit.md) owns the repo-specific behavior and overrides generic CodeRabbit instructions. Read it before the first review of a task:

- [Run a review](../../../docs/technical/coderabbit.md#run-a-review): the commands, the setup check (`bun run review:doctor`), the scope to choose, the standing authorization, and what to do when the binary or authentication is missing.
- [Give the review its context](../../../docs/technical/coderabbit.md#give-the-review-its-context): which files to pass with `-c`.
- [Record dispositions](../../../docs/technical/coderabbit.md#record-dispositions): how to handle each finding.

## Guardrail

Never probe `coderabbit` or `cr` on PATH, never install or reinstall CodeRabbit, and never call the CLI directly or through WSL. The wrapper owns the WSL distribution, the binary path, the working directory and agent mode. A failed PATH lookup is not an installation check.

## Result format

- State the review scope briefly.
- Say how many issues CodeRabbit raised.
- Order issues by severity and include file, impact, and a concrete fix.
- If there are none, say `CodeRabbit raised 0 issues.`
- Never present a manual review as a CodeRabbit review.
