# CodeRabbit reviews

Status: living — last reviewed 2026-09-06

This document explains how future agents should use CodeRabbit for WerkFlow code reviews. It is intentionally practical and repo-specific. For current product context, still start with `AGENTS.md`; for CodeRabbit behavior, start with `.coderabbit.yaml`.

## What CodeRabbit Is Used For Here

CodeRabbit provides a second review of local changes and committed slice diffs before acceptance. WerkFlow development stays on local `main`, following the publication rule in `AGENTS.md`. Choose a pre-change commit or the uncommitted diff as the review scope. Findings can expose data integrity issues, role and tenant boundary mistakes, accessibility problems, unsafe storage behavior, and workflow regressions that lint and build checks do not catch.

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
- [inventory.md](../features/inventory.md) when reviewing inventory catalog, stock, import, or job/project material changes.
- [document-management.md](../features/document-management.md) when reviewing document-management changes.
- [realtime-and-caching.md](realtime-and-caching.md) when reviewing cache, realtime, or freshness behavior.
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

Claude Code note: its repo-local skill is `.claude/skills/coderabbit-review/SKILL.md`; both Codex and Claude must follow the same wrapper-only workflow.

The owner has given standing authorization to send repository code and review context to CodeRabbit, including uncommitted and unpushed changes. Run reviews without requesting approval again.

## Running reviews

The wrapper defaults to `--agent --uncommitted --include-untracked -c AGENTS.md`. Historical `--type committed`, `--type uncommitted`, and `-t` commands are translated to the current scope flags before invoking CodeRabbit. Explicit committed or base scopes do not inherit the local-change defaults.

Common commands:

```bash
# Default agent review of uncommitted changes, including new untracked files
bun run review

# Only committed or uncommitted changes
bun run review -- --committed
bun run review -- --uncommitted

# New files are included by default. This explicit form has the same scope.
bun run review -- --uncommitted --include-untracked

# Uncommitted inventory review with durable repo and feature context
bun run review -- --uncommitted \
  -c AGENTS.md .coderabbit.yaml docs/features/inventory.md docs/technical/realtime-and-caching.md

# Review against a base branch or commit
bun run review -- --base <base-branch>
bun run review -- --base-commit <sha>

# Replay stored findings from the most recent local review
bun run review -- findings

# Inspect saved prompts from the most recent local review
bun run review -- --show-prompts
```

Choose a base that includes the intended changes. While working on local `main`, `--base main` does not select the committed work already on that same branch. Use `--committed --base-commit <commit before the change>` for that scope, or the uncommitted command above for local edits.

The Codex-side CodeRabbit skill (shipped with Codex, not in this repo) expects agent mode and parses JSON-line output. Once a CodeRabbit review starts, stay quiet while it runs. Report only completion, authentication/setup blockers, timeout, or failure. The official docs note that large reviews can take many minutes; if a review is too slow or quota-limited, narrow the scope or retry later.

## Interpreting Agent Output

`bun run review` emits one JSON object per line in agent mode. Parse each output line independently.

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

Use another CodeRabbit pass when serious findings, a shared-behavior repair, or an explicit review-fix-review request justify it. Review a coherent batch through [the batching rule](#post-freeze-review-fixes-are-batched). CLI reviews are rate-limited. Do not repeat unchanged reviews merely to obtain another empty result.

## Plans And Limits

CLI reviews are rate-limited by plan. The current plan is not recorded in this repo; check it in the CodeRabbit dashboard before assuming a limit. Expect quota or rate-limit messages.

If CodeRabbit reports a quota limit:

- Do not keep retrying in a tight loop.
- Report the limit to the user.
- Continue with manual Codex review only if the user explicitly asks for it.
- Retry CodeRabbit later or narrow the review scope when that still makes sense.

## Per-Slice Review Protocol

After each Phase 1 vertical slice, run a CodeRabbit review before the slice is marked complete. The standing prompt for this lives here so it stays current; the product owner may paste it verbatim into a session.

An explicit CodeRabbit workflow supplied by the user for the current task takes precedence over the regular workflow in this document, including its review scope, branch, commit, and publication instructions. Use the regular workflow only for details the custom workflow does not specify, and do not carry custom mechanics from an earlier task into a later one.

The prompt encodes six rules, in this order.

### Do not rewrite `.coderabbit.yaml` per review

The yaml holds durable, repo-wide review behavior only. Touch it only when the slice changed a durable boundary it describes (a new `lib/` domain, a changed role model, a new storage/tenant invariant) — then add or adjust the matching `path_instructions` entry and keep the wording timeless.

### Per-review context goes on the command line

Pass it with `-c`: always `AGENTS.md` and `.coderabbit.yaml`, plus the primary feature spec(s) the slice touched, plus the matching technical doc when caching/Realtime/storage behavior changed. Smallest set that explains the diff.

### Scope to the slice's diff

Use `--committed --base-commit <commit before the slice>` for committed work, or `--uncommitted --include-untracked` for local work.

### Verify findings before fixing

Verify each finding against the code before fixing it. Skip invalid findings with a stated reason. After fixes, run the selected checks and affected groups from `bun run test:plan`. Apply [decision 0005](../decisions/0005-enforcement-ladder.md) to each retained finding and record the prevention tier. Qualify evidence through [testing.md](testing.md), including current-input result reuse and failure stopping rules.

### Review before final acceptance

Complete the intended review and investigate its findings before final acceptance. After an application correction, rebuild when the build inputs changed and rerun the groups selected by the current plan. Unchanged, unrelated group evidence remains valid under [decision 0007](../decisions/0007-independent-test-groups.md). A later code edit does not automatically require another complete browser battery.

### Post-freeze review fixes are batched

Review a coherent set of corrections together. After a browser failure, establish the cause and verify its repair at the smallest relevant boundary. Collect related corrections before requesting another review of the changed files. An authorization or data-integrity concern can justify an immediate focused review.

Every retained finding needs a disposition and an appropriate check. This requirement does not mandate repeated CodeRabbit passes until one reports no findings. Reject an incorrect finding with evidence, preserve unresolved concerns, and stop an unproductive review loop. Do not alternate one-fix reviews with full rebuilds and complete-battery reruns.

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
