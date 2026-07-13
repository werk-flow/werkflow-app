# CodeRabbit Reviews

Last reviewed: 2026-07-13

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
- `reviews.path_filters` excludes low-signal files such as lock files, generated Supabase types, `.agents/**`, `.cursor/rules/**`, and `docs/**`.
- `reviews.path_instructions` gives targeted review guidance for `app/**`, `components/**`, `lib/**`, inventory, document management, realtime, calendar, time tracking, jobs, middleware, and Next config.
- `reviews.pre_merge_checks.custom_checks` adds repo-specific warnings for tenant/role safety, product fit, German user-facing copy, and inventory ledger integrity.
- `knowledge_base.code_guidelines.enabled: true` allows CodeRabbit to use repo instruction files such as `AGENTS.md` and Cursor rules as review criteria.
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
- Auto-detected guideline files such as `AGENTS.md`, `.cursor/rules/*`, `CLAUDE.md`, and similar files.
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

## CLI Installation And Auth

Check whether the CLI exists:

```bash
coderabbit --version
# or
cr --version
```

`cr` is the official short alias for `coderabbit`; both commands are equivalent.

Install using the official script when the CLI is missing:

```bash
curl -fsSL https://cli.coderabbit.ai/install.sh | sh
```

On this Windows workstation, run the Linux CLI through Ubuntu in WSL. The native PowerShell PATH may not contain a CodeRabbit binary even when the WSL workflow is available.

Authenticate interactively:

```bash
coderabbit auth login
```

For Codex/agent workflows, prefer the structured auth commands:

```bash
coderabbit auth status --agent
coderabbit auth login --agent
coderabbit auth org --agent
```

Use `coderabbit doctor` if setup, auth, repository detection, or backend connectivity behaves strangely.

The CLI sends local diff/context to CodeRabbit. Before reviewing unpushed local work, make sure the user has approved sending those diffs to CodeRabbit.

## Running Reviews

Common commands:

```bash
# Agent-friendly structured output
coderabbit --agent

# Human-readable output
coderabbit --plain

# Lighter local review
coderabbit --light

# Only committed or uncommitted changes
coderabbit --agent --type committed
coderabbit --agent --type uncommitted

# Uncommitted inventory review with durable repo and feature context
coderabbit --agent --type uncommitted \
  -c AGENTS.md .coderabbit.yaml docs/features/inventory.md docs/technical/realtime-and-caching.md

# Review against a base branch or commit
coderabbit --agent --base main
coderabbit --agent --base-commit <sha>

# Replay stored findings from the most recent local review
coderabbit review findings

# Inspect saved prompts from the most recent local review
coderabbit review --show-prompts
```

Use committed/uncommitted/base scopes to keep reviews focused. For a huge branch, prefer reviewing sensible commits or a focused PR-sized diff. Do not split work just for ceremony; split when it improves review signal and makes fixes safer.

The local Codex CodeRabbit skill expects agent mode and parses JSON-line output. Once a CodeRabbit review starts, stay quiet while it runs. Report only completion, authentication/setup blockers, timeout, or failure. The official docs note that large reviews can take many minutes; if a review is too slow or quota-limited, narrow the scope or retry later.

## Interpreting Agent Output

`coderabbit --agent` emits one JSON object per line. Parse each line independently.

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

Rerun CodeRabbit once if the original findings were serious, the fix touched shared behavior, or the user asks for a review-fix-review loop.

## Plans, Free Use, And Limits

As of the last review date above, CodeRabbit docs say open-source projects get Pro+ features for unlimited public repositories without a paid subscription, but OSS reviews use a separate rate-limit tier. Free and OSS usage still has rolling review limits, so agents should expect quota or rate-limit messages sometimes.

If CodeRabbit reports a quota limit:

- Do not keep retrying in a tight loop.
- Report the limit to the user.
- Continue with manual Codex review only if the user explicitly asks for it.
- Retry CodeRabbit later or narrow the review scope when that still makes sense.

## WerkFlow-Specific Review Priorities

When asking CodeRabbit for a review, remind it indirectly through config and context to prioritize:

- Organization/tenant isolation.
- Intentional role behavior for `admin`, `buero`, and `employee`.
- German user-facing copy and German accessibility text.
- Document storage, trash, restore, versioning, audit, and cleanup safety.
- Calendar drag/drop correctness, parked job workflows, and Europe/Berlin date/time behavior.
- Time-tracking correctness for breaks, manual entries, approvals, stale sessions, and auditability.
- Inventory organization/role boundaries, atomic stock ledger updates, job/project material consistency, and import retry safety.
- Cache invalidation and Supabase Realtime freshness.
- Next.js server/client boundaries, Server Actions, redirects, cookies, and cache behavior.

Prefer findings that can cause user-visible bugs, data loss, privacy leaks, security issues, role confusion, or production instability. Avoid spending much time on pure style nits unless they hide a real defect.
