---
name: coderabbit-review
description: Reviews code changes using CodeRabbit AI. Use when user asks for a CodeRabbit review, PR feedback via CodeRabbit, or requests fix-review cycles with CodeRabbit.
---

# CodeRabbit review

[Pull-request reviews](../../../docs/technical/coderabbit.md) owns the repo's CodeRabbit behavior and overrides generic instructions. Read it before the first review of a task.

- The CodeRabbit app reviews a level 2 PR once, on request.
- A local review runs through `bun run review` from the repository root. `bun run review:doctor` checks the setup.
- Never probe `coderabbit` or `cr` on PATH, install it, or call the CLI directly. The wrapper owns the binary, the directory and agent mode.

Report the review scope, the number of issues, and each issue by severity with file, impact and fix. With none, say `CodeRabbit raised 0 issues.` Never present a manual review as a CodeRabbit review.
