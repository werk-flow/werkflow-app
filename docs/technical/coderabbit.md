# CodeRabbit reviews

Status: living — last reviewed 2026-09-01

This document explains how future agents should use CodeRabbit for WerkFlow code reviews. It is intentionally practical and repo-specific. For current product context, still start with `AGENTS.md`; for CodeRabbit behavior, start with `.coderabbit.yaml`.

## What CodeRabbit Is Used For Here

CodeRabbit is an AI code review service that can review pull requests, IDE changes, and local CLI changes. In this repo it is mainly useful as a second reviewer for larger feature branches before production: it can spot data integrity issues, role/tenant boundary mistakes, accessibility problems, unsafe storage behavior, and subtle workflow regressions that ordinary lint/build checks do not catch.

Treat CodeRabbit as a reviewer, not an authority. Every finding still needs engineering judgment. In WerkFlow especially, check whether a suggested fix preserves German SHK product context, role-specific workflows, organization boundaries, and practical field-worker usability.

## Official Docs

- CLI overview: https://docs.coderabbit.ai/cli
- CLI command reference: https://docs.coderabbit.ai/cli/reference
- Codex integration: https://docs.coderabbit.ai/cli/codex-integration
- YAML configuration: https://docs.coderabbit.ai/getting-started/yaml-configuration
- Configuration reference: https://docs.coderabbit.ai/reference/configuration
- Path instructions and filters: https://docs.coderabbit.ai/configuration/path-instructions
- Code guidelines context: https://docs.coderabbit.ai/knowledge-base/code-guidelines
- Knowledge base overview: https://docs.coderabbit.ai/knowledge-base/index
- Plans and rate limits: https://docs.coderabbit.ai/management/plans

## Repo Configuration

The root `.coderabbit.yaml` is the primary CodeRabbit configuration for WerkFlow. Keep it in the repo root; CodeRabbit detects the config from the branch under review.

Current important settings:

- `language: "en-US"` keeps review output and developer-facing review text in English.
- `tone_instructions` asks for direct, practical findings focused on correctness, security, data integrity, accessibility, and production risk.
- `reviews.profile: "assertive"` asks CodeRabbit to be more thorough.
- `reviews.enable_prompt_for_ai_agents: true` asks CodeRabbit to include agent-friendly fix prompts in review comments.
- `reviews.path_filters` excludes low-signal files such as lock files, generated Supabase types, `.agents/**`, and `docs/**`.
- `reviews.path_instructions` gives targeted review guidance for `app/**`, `components/**`, `lib/**`, inventory, document management, realtime, calendar, time tracking, jobs, middleware, and Next config.
- `reviews.pre_merge_checks.custom_checks` adds repo-specific warnings for tenant/role safety, product fit, German user-facing copy, and inventory ledger integrity.
- `knowledge_base.code_guidelines.enabled: true` allows CodeRabbit to use repo instruction files such as `AGENTS.md` as review criteria.
- `knowledge_base.learnings.scope: "local"` keeps CodeRabbit learnings scoped locally for this repository.

When changing `.coderabbit.yaml`, validate it against the schema declared at the top of the file:

```yaml
# yaml-language-server: $schema=https://coderabbit.ai/integrations/schema.v2.json
```

Use the official configuration reference for exact option names and limits. Avoid stuffing too much generic product strategy into `.coderabbit.yaml`; broad product context belongs in `AGENTS.md` or focused docs.

## How Context Works

CodeRabbit gets context from several places:

- The Git diff or pull request being reviewed.
- The root `.coderabbit.yaml` configuration.
- Path-specific review instructions in `.coderabbit.yaml`.
- Auto-detected guideline files such as `AGENTS.md`, `CLAUDE.md`, and similar files.
- CodeRabbit learnings from previous feedback, depending on plan and repository setup.
- For PR reviews, connected GitHub/issue/PR context when available.
- For some plans/features, broader knowledge-base sources such as linked repositories, MCP servers, and web search.

For this repo, the most important context files are:

- `AGENTS.md` for product direction, coding standards, Bun-first workflow, German UI language, and role/organization principles.
- `.coderabbit.yaml` for CodeRabbit-specific scope and review behavior.
- `docs/features/inventory.md` when reviewing inventory catalog, stock, import, or job/project material changes.
- `docs/features/document-management.md` when reviewing document-management changes.
- `docs/technical/realtime-and-caching.md` when reviewing cache, realtime, or freshness behavior.
- Generated Supabase types and live Supabase inspection when schema details matter.

Run CodeRabbit from the repository root so it can resolve the Git repo, `.coderabbit.yaml`, and guideline files correctly.

### Persistent Versus Review-Specific Context

Do not rewrite `.coderabbit.yaml` for every feature review. Keep durable review behavior and stable path-level invariants there, such as tenant boundaries, role rules, inventory ledger integrity, or document storage safety. Keep broad product and coding guidance in root `AGENTS.md`, which CodeRabbit auto-detects as a code-guideline file.

Use the CLI `-c` / `--config` option to attach the smallest set of feature documents that explains the current review. This keeps temporary or highly specific context out of the persistent YAML. Feature docs must clearly distinguish implemented behavior from future scope so CodeRabbit does not recommend building a future workflow or removing deliberate V1 infrastructure.

## CLI prerequisite and authentication

The CLI is installed in WSL Ubuntu at `/root/.local/bin/coderabbit` and authenticated with the `werk-flow` GitHub account. The repository wrapper is the only supported invocation path:

```bash
bun run review:doctor
```

This command checks the exact configured binary and agent authentication. A failed native PowerShell or WSL PATH lookup is not an installation check and must never trigger an installer. Do not install or reinstall CodeRabbit. If the wrapper reports that the exact binary is missing or authentication is unavailable, report the host problem to the owner.

The workstation also provides `coderabbit` and `cr` host shims for interactive convenience, plus a WSL PATH link. Those shims prevent familiar diagnostic commands from producing false negatives, but agents must still use the repository wrapper because it owns the distribution, absolute path, repository working directory, agent mode, and failure policy.

When capturing agent output to a file, write it inside the repository in a gitignored location. WSL temporary paths do not persist reliably across separate invocations. If output is lost, replay the stored findings through the wrapper instead of rerunning the review.

Claude Code note: there is no CodeRabbit plugin for Claude Code. Its repo-local skill is `.claude/skills/coderabbit-review/SKILL.md`; both Codex and Claude must follow the same wrapper-only workflow.

The CLI sends local diff/context to CodeRabbit. Before reviewing unpushed local work, make sure the user has approved sending those diffs to CodeRabbit.

## Running reviews

Common commands:

```bash
# Default agent review of approved uncommitted changes
bun run review -- --approve-uncommitted

# Only committed or uncommitted changes
bun run review -- --type committed
bun run review -- --approve-uncommitted --type uncommitted

# Include files that are not yet tracked by git (new modules, new scripts).
# Without this, brand-new files are invisible to an uncommitted-changes review.
bun run review -- --approve-uncommitted --type uncommitted --include-untracked

# Uncommitted inventory review with durable repo and feature context
bun run review -- --approve-uncommitted --type uncommitted \
  -c AGENTS.md .coderabbit.yaml docs/features/inventory.md docs/technical/realtime-and-caching.md

# Review against a base branch or commit
bun run review -- --base main
bun run review -- --base-commit <sha>

# Replay stored findings from the most recent local review
bun run review -- findings

# Inspect saved prompts from the most recent local review
bun run review -- --show-prompts
```

Use committed/uncommitted/base scopes to keep reviews focused. For a huge branch, prefer reviewing sensible commits or a focused PR-sized diff. Do not split work just for ceremony; split when it improves review signal and makes fixes safer.

The local Codex CodeRabbit skill expects agent mode and parses JSON-line output. Once a CodeRabbit review starts, stay quiet while it runs. Report only completion, authentication/setup blockers, timeout, or failure. The official docs note that large reviews can take many minutes; if a review is too slow or quota-limited, narrow the scope or retry later.

## Interpreting Agent Output

`bun run review` emits one JSON object per line in agent mode. The wrapper-only `--approve-uncommitted` flag records that the owner approved sending a local diff and is removed before CodeRabbit runs. Parse each output line independently.

Important event types:

- `finding`: an actual review issue. Use `severity`, `fileName`, `codegenInstructions`, `suggestions`, and `comment`.
- `review_context`: context about the review scope.
- `status`: progress or skipped-review status.
- `heartbeat`: keep-alive; ignore except for timeout handling.
- `complete`: final result and finding count.
- `error`: failure to review.

Present findings by severity and include impact plus a concrete fix direction. Do not claim a manual review came from CodeRabbit. If CodeRabbit fails, report the actual failure instead of silently substituting a Codex/manual review.

After implementing fixes, run local verification such as:

```bash
bun run lint
bun run build
```

Rerun CodeRabbit once if the original findings were serious, the fix touched shared behavior, or the user asks for a review-fix-review loop. If you are unsure if you should run it again, it is generally speaking better to let it run once more than not to. However CLI reviews are rate-limited by plan (as of early August 2026 the repo was on the free plan with 3 CLI reviews per hour; verify the current plan before assuming a higher limit), so beware of that when running multiple subsequent reviews during a specific task.

## Plans, Free Use, And Limits

As of the last review date above, CodeRabbit docs say open-source projects get Pro+ features for unlimited public repositories without a paid subscription, but OSS reviews use a separate rate-limit tier. Free and OSS usage still has rolling review limits, so agents should expect quota or rate-limit messages sometimes.

If CodeRabbit reports a quota limit:

- Do not keep retrying in a tight loop.
- Report the limit to the user.
- Continue with manual Codex review only if the user explicitly asks for it.
- Retry CodeRabbit later or narrow the review scope when that still makes sense.

## Per-Slice Review Protocol

After each Phase 1 vertical slice, run a CodeRabbit review before the slice is marked complete. The standing prompt for this lives here so it stays current; the product owner may paste it verbatim into a session.

An explicit CodeRabbit workflow supplied by the user for the current task takes precedence over the regular workflow in this document, including its review scope, branch, commit, and publication instructions. Use the regular workflow only for details the custom workflow does not specify, and do not carry custom mechanics from an earlier task into a later one.

Key rules the prompt encodes:

1. **Do not rewrite `.coderabbit.yaml` per review.** The yaml holds durable, repo-wide review behavior only. Touch it only when the slice changed a durable boundary it describes (a new `lib/` domain, a changed role model, a new storage/tenant invariant) — then add or adjust the matching `path_instructions` entry and keep the wording timeless.
2. **Per-review context goes on the command line** with `-c`: always `AGENTS.md` and `.coderabbit.yaml`, plus the primary feature spec(s) the slice touched, plus the matching technical doc when caching/Realtime/storage behavior changed. Smallest set that explains the diff.
3. **Scope to the slice's diff**: `--type committed --base-commit <commit before the slice>` for committed work, or `--type uncommitted --include-untracked` for local work.
4. Findings are verified against the code before fixing; invalid findings are skipped with a stated reason; after fixes, lint/typecheck and the slice's golden-gate spec are rerun.
5. **Every intended review pass happens before the confirmation gate run** — CodeRabbit fixes, self-review, and any quality/skill checklists (React patterns, design review) included. Once the post-review full suite is green, only documentation may change; a later application-code change invalidates that evidence and forces another build + full run (this cost the P1-05 cycle an extra build and two full-suite runs).
6. **Post-freeze review fixes are batched, not ping-ponged.** The pre-freeze review phase has no pass cap — run review-fix-review until the findings converge; the passes pay for themselves. But once the confirmation phase has begun and browser evidence forces an application fix, do not launch a review pass per individual fix: first prove the fix at the failed stage (focused or diagnostic lane), accumulate any further fixes from the same investigation, then run ONE delta-scoped CodeRabbit pass over all of them before freezing the next build. The only exception is a fix that touches authorization or data integrity — that warrants an immediate, non-batched pass. Everything still gets reviewed before the commit; this rule only removes the review↔rebuild↔rerun oscillation that dominated the P1-16 cycle (six interleaved passes, each restarting the browser ladder).

## WerkFlow-Specific Review Priorities

When asking CodeRabbit for a review, remind it indirectly through config and context to prioritize:

- Organization/tenant isolation.
- Intentional role behavior for `admin`, `buero`, and `employee`.
- German user-facing copy and German accessibility text.
- Document storage safety: direct-to-R2 signed upload/download flow (ticket + finalize authorization, server-recomputed storage keys, no bytes through Server Actions), trash, restore, versioning, audit, and cleanup safety.
- Calendar drag/drop correctness, parked job workflows, and Europe/Berlin date/time behavior.
- Time-tracking correctness for breaks, manual entries, approvals, stale sessions, and auditability.
- Inventory organization/role boundaries, atomic stock ledger updates, job/project material consistency, and import retry safety.
- Cache invalidation and Supabase Realtime freshness.
- Next.js server/client boundaries, Server Actions, redirects, cookies, and cache behavior.

Prefer findings that can cause user-visible bugs, data loss, privacy leaks, security issues, role confusion, or production instability. Avoid spending much time on pure style nits unless they hide a real defect.
