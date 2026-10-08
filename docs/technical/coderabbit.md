# CodeRabbit reviews

Status: living — last reviewed 2026-10-05

CodeRabbit gives a second review of local changes and slice diffs before acceptance. Treat it as a reviewer, not as an authority. Every finding needs engineering judgment: check that a suggested fix keeps the SHK product context, the role-specific workflows, the organization boundaries and field-worker usability.

The root `.coderabbit.yaml` configures the review. The Claude skill `.claude/skills/coderabbit-review/SKILL.md` routes here. Codex and Claude follow the same workflow.

## Run a review

Run every review through the repository wrapper, from the repository root:

```bash
# Check the configured binary and its authentication
bun run review:doctor

# Review uncommitted changes, including new untracked files, with AGENTS.md as context
bun run review

# Review committed work since a commit
bun run review -- --committed --base-commit <commit before the change>

# Add the context that explains the diff
bun run review -- --uncommitted -c AGENTS.md .coderabbit.yaml docs/features/inventory.md

# Replay the stored findings of the most recent review without a new review
bun run review -- findings
```

The wrapper is the only supported way to start a review. It owns the WSL distribution, the binary path, the working directory, agent mode and the failure policy. A failed PowerShell or WSL PATH lookup is not an installation check. Never install or reinstall CodeRabbit. If the wrapper reports that the binary is missing or the authentication is unavailable, report the host problem to the owner.

The owner has given standing authorization to send repository code and review context to CodeRabbit, including uncommitted and unpushed changes. Run reviews without requesting approval again. The authorization does not cover buying credits or a subscription.

Choose a scope that contains the intended change:

- For local edits, use the default uncommitted scope.
- For committed work on local `main`, use `--committed --base-commit <commit before the change>`. `--base main` selects nothing, because the work is already on that branch.
- When the diff exceeds CodeRabbit's file limit, review it in directory passes, one `--dir` per pass (`--dir app`, then `--dir components`, then `--dir lib`). CodeRabbit reviews only the last `--dir` of a command, so the wrapper refuses a second one. Name the directories that the review did not cover.

An explicit CodeRabbit workflow that the user supplies for the current task takes precedence over this document. Use this document for the details that the custom workflow leaves open. Do not carry custom mechanics from an earlier task into a later one.

Stay quiet while a review runs. Report only completion, a setup or authentication blocker, a timeout, or a failure. A large review can take many minutes. If a review is too slow, narrow the scope.

When you capture the output in a file, write it to a gitignored location inside the repository. WSL temporary paths do not persist across invocations. If the output is lost, replay the stored findings instead of running the review again.

A finished review writes its own record under `.agent-logs/review/` with the content digest of each file its scope covered. `.githooks/pre-push` refuses a push unless these digests match every changed file that is not documentation, as it is now, so an edit after a review needs a new review of that file. The [publication gate](testing.md#publication-gate) owns the rule.

## Give the review its context

`.coderabbit.yaml` holds durable, repository-wide review behavior: stable path instructions and invariants such as tenant boundaries, role rules, inventory ledger integrity and document storage safety. Change it only when a change moves a durable boundary that the file describes, for example a new `lib/` domain, a changed role model, or a new storage or tenant invariant. Keep the wording timeless and validate the file against the schema that its first line declares. Broad product context belongs in `AGENTS.md`, which CodeRabbit detects as a guideline file.

Per-review context goes on the command line with `-c`. Pass `AGENTS.md` and `.coderabbit.yaml`, the feature specs that the diff touches, and the matching technical doc when cache, Realtime or storage behavior changed. Pass the smallest set that explains the diff. A feature spec must separate implemented behavior from planned scope. Otherwise CodeRabbit recommends building a planned workflow or removing deliberate infrastructure.

## Review quality and required use

Run CodeRabbit before you accept a substantial application or testing-system change. This includes every Phase 1 slice, shared behavior repairs, and redesigns outside a numbered slice. The [protocol](../plans/phase-1/protocol.md) owns the place of the review in slice closure. Documentation-only edits need no review unless the owner requests one. Every other change needs a completed review before it can be pushed.

A useful review names the affected behavior, the evidence and the consequence. Prefer findings that can cause user-visible bugs, data loss, privacy leaks, security issues, role confusion or production instability over style remarks.

A completed review with zero findings does not certify correctness, visual quality or runtime coverage. A missing or failed review stays missing. If CodeRabbit fails, report the actual failure. Do not present a manual review as a CodeRabbit review.

Complete the review and investigate its findings before final acceptance. Run another pass when serious findings, a shared-behavior repair, or an explicit request for a review-fix-review cycle justify it. Do not repeat an unchanged review to obtain another empty result.

## Record dispositions

1. Verify each finding against the code before you change anything.
2. Give every finding one disposition: repaired, declined with the evidence, or deferred with its owner. Keep an unresolved concern visible.
3. For each kept finding, apply [decision 0005](../decisions/0005-enforcement-ladder.md) and name the tier its prevention landed on.
4. Record the dispositions in the slice record under `## Deletion Pass And Review`, as the [protocol](../plans/phase-1/protocol.md) describes. For work outside a slice, report them to the owner.
5. After the fixes, run `bun run test:verify` under [testing.md](testing.md). A lint or build pass alone is not acceptance evidence.

### Batch the corrections

Review a coherent set of corrections together. After a browser failure, find the cause and verify the repair at the smallest relevant boundary. Collect related corrections before you request another review of the changed files. An authorization or data-integrity concern can justify an immediate focused review.

Every kept finding needs a disposition and a matching check. No rule demands repeated passes until one reports no findings. Stop an unproductive review loop. Do not alternate one-fix reviews with full rebuilds and complete plan runs.

## Quota limits

The plan limits the number of CLI reviews. The repository does not record the current plan, so check the CodeRabbit dashboard before you assume a limit. When CodeRabbit reports a quota limit:

- Report the limit to the user and do not retry in a loop.
- Retry later or narrow the scope.
- Continue with a manual review only when the user asks for one.

## Dedicated security scanning

A `bun run review` run is not a CodeRabbit Deep Scan. Deep Scan is a whole-repository scan that starts from the Security area of the CodeRabbit dashboard and has separate usage billing. The [security documentation](https://docs.coderabbit.ai/security) describes it.

No Deep Scan is part of the required review. Before anyone starts a chargeable scan, check the dashboard entitlement and the visible scan estimate, and get the owner's approval for the cost. If the owner selects a scan, scan the current `partner-preview` commit and keep the exact scope and coverage report. A scan can finish with incomplete coverage. Deep Scan performs no dependency analysis, so dependency auditing and live provider review remain separate evidence.

## Greptile and TREX evaluation

The owner deferred the evaluation of Greptile and TREX. The evaluation is no prerequisite for any work, and CodeRabbit remains the required review.
