# Environments

Status: living — last reviewed 2026-10-25

WerkFlow runs on two separate cloud backends ([decision 0003](../decisions/0003-dev-prod-environment-split.md)) and a local Supabase stack for the application tests ([decision 0006](../decisions/0006-testing-architecture.md)). This page owns which backend is which, who owns which env file, how tools reach each project, the migration rule, how worktrees share the local stack, and how to set up a new machine.

## The two cloud backends

|  | Production | Dev |
| --- | --- | --- |
| Supabase project | `jbgaqpdjauzoocplgdsn` | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev") |
| Supabase organization | "WerkFlow" (`svxdwqapsmvfkchswonc`), Pro plan | The same organization |
| Region | AWS eu-central-1 | The same region, on purpose |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod` | `werkflow-documents-dev` (CORS allows localhost and the partner-preview URL) |
| Serves | The deployed app on Vercel and real customers | Local development, the cloud canary, the partner preview, and explicitly scoped provider checks |
| Auth site URL | `https://app.werk-flow.app` | `http://localhost:3000` |

Both projects deploy the edge functions from `supabase/functions/`. Each project's secret store holds its own Resend key. The production key never leaves production.

Both projects run Micro compute. Query latency on that tier rises steeply with concurrent requests. The owner accepts this while one beta business is the only production traffic and raises the production tier when traffic grows. Do not read cloud canary timings as capacity proof.

### Vercel

Every variable exists twice: one row for Production and one for all pre-production environments. Production rows carry the PROD project, the production bucket and the production domain. Pre-production rows carry the DEV project, the dev bucket and the partner-preview branch URL as `NEXT_PUBLIC_SITE_URL`. The names are the ones `lib/env/public.ts`, `lib/env/server.ts` and `lib/storage/r2.ts` read, each with one value per backend. `SUPABASE_ACCESS_TOKEN` is never on Vercel. DEV's auth redirect list must allow the partner-preview URL so that invite and password links work on the preview. Recheck the scopes when deployment configuration changes.

### Provider configuration

Project configuration (auth settings, mail templates, SMTP, rate limits) is not schema, and no migration carries it. Both projects carry the same posture so that DEV mirrors PROD. Read the current values through the Management API or the dashboard. `bun scripts/sync-dev-auth-from-prod.ts` prints the difference between the two auth configurations and, with `--apply`, copies the mail fields from PROD to DEV. Run it after every auth change on the production dashboard. `bun run auth:check` compares DEV's Auth configuration with the reviewed security posture in `lib/security/supabase-project-checks.ts` and fails on a difference. Change a setting and its posture entry together.

Decided and in force: leaked-password protection, custom SMTP through Resend, SSL enforcement for direct database connections, the organization spend cap, daily backups from the plan, anonymous sign-in off, Vercel Authentication on every deployment except the custom domain.

Not adopted, each a future owner decision: point-in-time recovery, database network restrictions, Supabase branching, the GitHub deploy integration. Signup CAPTCHA stays off while the rate limits cover sign-up; it turns on when public sign-up opens. Owner duties that no API covers: MFA on the Supabase account and a second organization owner.

## The local test stack

The application test groups run against the Supabase CLI's Docker composition on the development machine: Docker Engine in WSL Ubuntu on the Windows laptop, Docker Desktop on a Mac. Every repository command runs inside Linux or macOS; no command calls a Windows tool. `supabase/config.toml` owns its ports, auth posture, storage bucket and mail capture.

- `supabase db reset` replays the committed migration history. A failing reset is a finding about that history.
- The keys are the CLI's shared local defaults. They are not secrets.
- Auth mail lands in Mailpit, never in a real inbox. Cloud functions reject the local capture configuration.
- Analytics is off, so the stack runs without the Logflare and Vector containers and Studio has no log explorer. Logflare stored every request in the `_supabase` database without a limit and filled the disk; nothing reads it. The lab recorder reads Kong's access log through `docker logs` instead (`tests/audit/support/lab-recorder.ts`).
- Leaked-password protection needs the internet and has no local equivalent. The canary owns that check.
- PostgREST truncates a response at its row limit without an error, locally and on the hosted projects. A read that can exceed the limit reads in pages and reports an overflow ([Realtime and caching](realtime-and-caching.md) owns the rule). Do not raise the limit to hide the bound.

Facts for the development machine:

- The stack answers on `http://127.0.0.1:54321`. `bun run env:local` writes that origin and this checkout's test-server origin (`NEXT_PUBLIC_SITE_URL`, so invite and password links reach the server that sent them) into `.env.local`. Rebuild before the next browser run after a switch, because `NEXT_PUBLIC_*` values are baked into the build.
- `bun run test:server local` waits for the stack to become healthy before it builds. Keep that process alive while you verify.
- Node's default heap on a machine with less than 16 GB is too small for this repository's type check. `bun run typecheck`, `bun run build` and `check:changed` give it 4 GB.
- `supabase db reset` can leave the edge-runtime container stopped. The preflight detects it and prints the remedy.
- A restarted edge-runtime container keeps its old configuration. After you change `[edge_runtime.secrets]`, reload the runtime through the local Supabase CLI and verify the capture endpoint before an email browser group.

## Dependency installation

`vercel.json` installs with `bun install --frozen-lockfile`, which resolves from `bun.lock`. The application runtime stays Node. Keep the existing `package-lock.json` without regenerating it.

## Env-file ownership

The repository selects its backend through the gitignored `.env.local`. Three gitignored backups sit beside it: `.env.local-stack-backup`, `.env.dev-backup` and `.env.live-backup`. Next.js loads none of the backups.

```bash
bun run env:local  # .env.local -> the local Supabase stack (application tests)
bun run env:dev    # .env.local -> the cloud dev backend (canary, live inspection)
bun run env:prod   # .env.local -> PRODUCTION (loud warning; no tests)
```

Vercel holds its own variables, so a local file never affects the deployed app. Never run the test harness or a destructive script while `.env.local` points at production. Switch back as soon as the production task is done. The test preflight refuses a run whose `.env.local` does not match the requested target.

## Which tool reaches what

| Access path | Prod | Dev | Notes |
| --- | --- | --- | --- |
| claude.ai Supabase connector (OAuth) | not in the agents | not in the agents | Scoped to the whole "WerkFlow" organization, so Claude Code denies it (`deniedMcpServers` in `~/.claude/settings.json`) and agents use the scoped servers below. The owner keeps it on claude.ai. |
| Supabase MCP server (`supabase` in the user configuration of Claude Code and Codex) | never | read and write | The hosted server at `https://mcp.supabase.com/mcp?project_ref=mbkkzuqjbdvzelqvuzcn`, signed in with the owner's Supabase account (OAuth). The `project_ref` scope keeps it on DEV. |
| Supabase MCP server `supabase-prod-readonly` (same configuration) | read only | never | The hosted server at `https://mcp.supabase.com/mcp?project_ref=jbgaqpdjauzoocplgdsn&read_only=true`. Its queries run as a read-only database user. |
| Supabase CLI (`bunx supabase`) | never link or push | yes | The repository links to the DEV ref only. |
| Management API | yes | yes | Read-only production inspection and DEV configuration. |
| R2 tokens | prod bucket only | dev bucket only | Each backup carries its own bucket-scoped credentials. Runtime tokens cannot manage bucket settings. `scripts/setup-r2-cors.ts` needs a bucket-admin token. |
| Local stack | n/a | n/a | The Supabase CLI and psql through `docker exec`. MCP does not reach it. |

## The migration rule

This section is the one home of the rule. Skills and decision records link here.

1. Every schema change is a committed file in `supabase/migrations/` first. No DDL exists only in a database.
2. A migration that creates a table follows [add a table](security.md#add-a-table): RLS, policies and explicit grants in the same file.
3. Apply to DEV with `bunx supabase db push`. The push records the committed file's exact version in the remote history. If a migration reached DEV through MCP `apply_migration` instead, align its history key to the committed file name afterwards, because MCP stamps its own version. `bun run migrations:check` and the canary fail on a divergence.
4. Run `bun run types:generate` after the push and commit the result. `bun run types:check` fails when the committed types differ from a fresh DEV generation. `bun run advisors:check` runs the DEV security and performance advisors and fails on a warning, an error or a security finding without a reviewed exception in `lib/security/supabase-project-checks.ts`, and on an exception the advisor no longer reports.
5. Apply to PROD only as part of a production release that the owner requested ([decision 0008](../decisions/0008-development-workflow.md)): MCP `apply_migration` against the production ref with the identical SQL, inside the maintenance window, before `origin/main` advances. Compare name and statement, then align the history key to the committed file name. Never `supabase link` or `db push` against production.
6. The `*baseline*` repair migrations reconcile drift from before the split. Never edit them.
7. Coordinate a schema change that the running app cannot tolerate with the app release that consumes it. For a change of a Realtime transport: pause writes, drain requests from the old app, change the database, deploy the compatible app, make open tabs reload, verify an authorized receiver, then reopen writes. A rollback keeps app and database compatible.
8. A migration never drops or changes the signature of a function, column or table that the deployed build still uses. Add the replacement first. A later migration drops the old object after that build is replaced. Every top-level drop, truncate, delete, rename or column type change carries `-- @destructive: <reason>` directly above it; `lib/security/destructive-migrations.test.ts` checks every migration newer than its frozen baseline, because applied files cannot change. `lib/security/retired-functions.test.ts` fails on a public function that no code calls, unless it names the SQL caller or the release that may drop it.

Between releases, migrations wait on DEV. Read the two migration ledgers before you claim parity. `bun run migrations:check`, `bun run types:check` and `bun run realtime:check` each compare one thing against the committed files. None compares the complete DEV and PROD schemas, and a matching migration name does not prove an identical function body. When production parity matters, compare the live object definitions with the procedure in the `supabase-live-workflow` skill.

## Work in a worktree

T3 Code gives every thread its own git worktree and runs `scripts/setup-worktree.ts` in the background (`t3.json`). The script installs from the frozen lockfile, links the main checkout's env backups and `supabase/.temp`, and writes the worktree's own `.env.local` with `bun run env:local`. It writes `.t3/setup-running` while it works, then `.t3/setup-done` or `.t3/setup-failed` with the tail of the failing output.

- Wait for `.t3/setup-done` before you run any command in a worktree. On `.t3/setup-failed`, read the file, repair the cause, and run `bun scripts/setup-worktree.ts` again.
- A checkout keeps its own `.next`, workspace lock and `.agent-logs/` run archive, because they live inside it. The main checkout serves on port 3000. A linked worktree derives its test-server port and its `bun run dev` port from its path (`workspacePorts` in `lib/testing/runner/app-port.ts`). A collision of two paths fails at the port check of the build.
- Every worktree uses the one local stack. Each browser group seeds its own organization, so ordinary groups of several worktrees run side by side. A group that measures, or restarts a stack service, holds the stack alone: `lib/testing/runner/stack-lock.ts` keeps the holders in the git common directory, and a waiting run prints what it waits for.
- `supabase db reset` and `supabase stop` affect every worktree. The edit guard refuses them while any worktree holds the stack.

## Set up a new machine

1. Install Bun, Node 22 or later, git, the GitHub CLI, Docker (Docker Engine on Linux or in WSL Ubuntu, Docker Desktop on a Mac) and the Supabase CLI. On Windows, clone and work inside WSL Ubuntu.
2. Make the owner's Supabase personal access token available as `SUPABASE_ACCESS_TOKEN` to the CLI and the scripts. Keep a copy in every env backup, because a switch overwrites `.env.local`. Never commit or print the token.
3. Get `.env.local` with the DEV values from the owner's password manager and copy it to `.env.dev-backup`. Add `.env.live-backup` only when production sessions are expected.
4. Agent tools, the same for Claude Code and Codex: the two scoped Supabase MCP servers above (`claude mcp add --scope user --transport http <name> "<url>"`, and `[mcp_servers.<name>]` with that `url` in `~/.codex/config.toml`), then the owner signs in once per server in each tool (`/mcp` in Claude Code, `codex mcp login <name>`). The Vercel CLI, signed in as the owner, serves both; each tool also carries its Vercel plugin.
5. Local stack: from the repository root run `supabase start` and `supabase db reset`. Create `.env.local-stack-backup` from the values that `supabase status` prints, then run `bun run env:local`.
6. Run `bunx playwright install --with-deps chromium` once. The first visual run pulls the pinned Playwright image (`lib/testing/runner/visual-browser.ts`).
7. CodeRabbit: install the CLI into your own account with `curl -fsSL https://cli.coderabbit.ai/install.sh | sh` (it lands in `~/.local/bin`). The owner signs in once with `coderabbit auth login`; `bun run review:doctor` confirms both. This step is the only time an agent installs CodeRabbit.
8. Run `git config core.hooksPath .githooks` to enable the [publication gate](testing.md#publication-gate).
9. Verify: `bunx supabase projects list` shows both cloud projects, and `bun scripts/check-r2.ts` passes against the dev bucket. Start `bun run test:server local`, then run `bun run test:verify --group golden:gg-00` in another terminal.

## Work on production

- Reads: the connector, the MCP server or the Management API, read-only.
- Preview: when the owner asks for a push, run `git push origin main:partner-preview`. Vercel builds a preview on DEV data. `origin/main` does not move.
- Release: `origin/main` advances only on the owner's explicit release request, after the pending migrations and edge functions reached PROD in the order of the migration rule. [Decision 0008](../decisions/0008-development-workflow.md) owns the flow.
- A production-local session: `bun run env:prod`, do the task, `bun run env:dev`. No tests and no bulk scripts in between.
- Owner demo data: `bun scripts/seed-demo-data.ts --target dev|prod` (production adds `--confirm-prod`) deletes and recreates the owner's demo organizations. It refuses the beta partner's organization. The data is disposable. For a manual look at `bun run dev`, which runs against DEV through `.env.local`, sign in with a demo member's address and the fixture password from that script.
