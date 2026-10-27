# Environments

Status: living — last reviewed 2026-10-27

WerkFlow runs on two separate cloud backends ([decision 0003](../decisions/0003-dev-prod-environment-split.md)) and a local Supabase stack for the application tests ([decision 0006](../decisions/0006-testing-architecture.md)). This page owns which backend is which, who owns which env file, every credential and its rotation, how tools reach each project, the migration rule, how worktrees share the local stack, and how to set up a new machine.

## The two cloud backends

|  | Production | Dev |
| --- | --- | --- |
| Supabase project | `jbgaqpdjauzoocplgdsn` | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev") |
| Supabase organization | "WerkFlow" (`svxdwqapsmvfkchswonc`), Pro plan | The same organization |
| Region | AWS eu-central-1 | The same region, on purpose |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod` | `werkflow-documents-dev` (CORS allows localhost and the staging URL) |
| Serves | The deployed app on Vercel and real customers | Local development, the cloud canary, the partner preview, and explicitly scoped provider checks |
| Auth site URL | `https://app.werk-flow.app` | `http://localhost:3000` |

Both projects deploy the edge functions from `supabase/functions/`. Each project's secret store holds its own Resend key. The production key never leaves production.

Both projects run Micro compute. Query latency on that tier rises steeply with concurrent requests. The owner accepts this while one beta business is the only production traffic and raises the production tier when traffic grows. Do not read cloud canary timings as capacity proof.

### Vercel

Every variable exists twice: one row for Production and one for all pre-production environments. Production rows carry the PROD project, the production bucket and the production domain. Pre-production rows carry the DEV project, the dev bucket and the staging URL as `NEXT_PUBLIC_SITE_URL`. The staging URL is the branch alias of `main`, `https://werkflow-app-git-main-werkflows-projects.vercel.app`, behind Vercel Authentication. The production branch is `production`; `vercel.json` turns off Git deployments of `main`, so `.github/workflows/staging.yml` deploys staging after DEV's migrations, and pull-request previews stay automatic. The names are the ones `lib/env/public.ts`, `lib/env/server.ts` and `lib/storage/r2.ts` read, each with one value per backend. `SUPABASE_ACCESS_TOKEN` is never on Vercel. DEV's auth redirect list must allow the staging URL so that invite and password links work on staging. Recheck the scopes when deployment configuration changes.

### Provider configuration

Project configuration (auth settings, mail templates, SMTP, rate limits) is not schema, and no migration carries it. Both projects carry the same posture so that DEV mirrors PROD. Read the current values through the Management API or the dashboard. `bun scripts/sync-dev-auth-from-prod.ts` prints the difference between the two auth configurations and, with `--apply`, copies the mail fields from PROD to DEV. Run it after every auth change on the production dashboard. `bun run auth:check` compares DEV's Auth configuration with the reviewed security posture in `lib/security/supabase-project-checks.ts` and fails on a difference. Change a setting and its posture entry together.

Decided and in force: leaked-password protection, custom SMTP through Resend, SSL enforcement for direct database connections, the organization spend cap, daily backups from the plan, anonymous sign-in off, Vercel Authentication on every deployment except the custom domain.

Not adopted, each a future owner decision: point-in-time recovery, database network restrictions, Supabase branching, the GitHub deploy integration. Signup CAPTCHA stays off while the rate limits cover sign-up; it turns on when public sign-up opens. Owner duties that no API covers: MFA on the Supabase account and a second organization owner.

## Credentials

This table is the one home of every credential the deployments and workflows use. Each value lives where the table says, and no check copies a secret elsewhere to test it. `.github/workflows/health.yml` checks every row each Monday morning, Berlin time, with a read-only call where the value lives. A failed run fails the step named after the credential, then opens or updates the issue "Weekly health check failed", assigned to `tamaycbn`, which lists only the failed check ids; the next green run closes it. GitHub mails a scheduled run's failure to the account that last pushed a change to its cron line, which is the account that merges on `main`: `tamaycbn`. That account needs failed-workflow mail turned on in its GitHub notification settings.

The app checks its own runtime credentials at `GET /api/health`, and each Supabase project at its `health` function; the weekly run reads the staging deployment, production and both projects. Both accept only a request that carries the header `x-health-check-token`; without it they answer like a route or function that does not exist. The answer names each check as `ok` or `failed`, never a value or a provider message. Each Vercel variable exists twice ([Vercel](#vercel)), and each Supabase secret once per project.

| Credential | Lives in | Used by | Expires | Check | Rotate |
| --- | --- | --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | GitHub repository secret | Staging and release: deploy the edge functions | 2027-10-26 | `supabase-access-token-dev`, `-prod` | Supabase account settings, Access Tokens: create one, `gh secret set SUPABASE_ACCESS_TOKEN`, revoke the old one. |
| `VERCEL_TOKEN` | GitHub repository secret | Staging deploys, release promotes | 2027-10-26 | `vercel-token` | Vercel account settings, Tokens, scoped to the team; then `gh secret set`. |
| `SIBLING_REPOSITORIES_TOKEN` | GitHub repository secret | CI clones werkflow-business for `docs:check` | 2027-10-26 | `sibling-repositories-token` | A fine-grained GitHub token with read access to werkflow-business contents; then `gh secret set`. |
| `DEV_DATABASE_URL` | GitHub repository secret | Staging: `supabase db push` | With its password | `dev-database-url` | DEV dashboard, Database settings: reset the password, then `gh secret set` with the new connection string. |
| `PROD_DATABASE_URL` | GitHub environment `production` | Release: `supabase db push` | With its password | `prod-database-url` | As for DEV, on PROD, with `gh secret set --env production`. |
| `PRODUCTION_DEPLOY_KEY` | GitHub environment `production`; its public half is a write deploy key of this repository | Release: advances `production` | Never | `production-deploy-key` (`git ls-remote`, never a push) | `ssh-keygen -t ed25519`, add the public key as a deploy key with write access, `gh secret set PRODUCTION_DEPLOY_KEY --env production`, delete the old deploy key. |
| `HEALTH_CHECK_TOKEN` | GitHub repository secret, Vercel (both rows), Supabase secrets of DEV and PROD | The health endpoints and the weekly run | Never | Every endpoint check; a 404 names a mismatch | One new value (`openssl rand -hex 32`) in one sitting: `gh secret set`, `vercel env add` for Production and Preview, `supabase secrets set` on both projects, then redeploy staging and production. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub repository secret; Vercel project, Deployment Protection | The weekly run past staging's protection | Never | `app-staging`; a 401 names it | Vercel project settings, Deployment Protection, Protection Bypass for Automation: regenerate, then `gh secret set`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel | Browser and server Supabase clients | Never | `supabase_publishable_key` | Supabase API keys: create a publishable key, set it in Vercel, redeploy, delete the old key. |
| `SUPABASE_SECRET_KEY` | Vercel | The admin client and the edge-function calls | Never | `supabase_secret_key` | Supabase API keys: create a secret key, set it in Vercel, redeploy, delete the old key. The functions accept every secret key of their project. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Vercel | Document storage | As set on the Cloudflare token | `r2_storage` (head of the bucket) | Cloudflare R2, Manage API tokens: a token scoped to the one bucket; set both in Vercel, redeploy, delete the old token. |
| `EMAIL_OTP_HASH_SECRET` | Vercel | Email-change code hashes and rate-limit subjects | Never | `email_otp_hash_secret` (presence only; no provider can confirm it) | Only after a leak: a new value voids pending email-change codes and restarts every rate-limit window. |
| `RESEND_API_KEY` | Supabase secrets, one key per project | The mail functions | Never | `resend_api_key` | Resend, API keys: a sending key for the project, `supabase secrets set --project-ref <ref> RESEND_API_KEY`, delete the old key. |
| `FROM_EMAIL` | Supabase secrets | The mail functions' sender | Never | `from_email` (presence) | `supabase secrets set`. |

The platform injects `SUPABASE_SECRET_KEYS` into every function; `supabase_secret_keys` checks that the mail functions can read it. Not checked: the owner's local Supabase token and R2 admin token in the env backups, which no workflow holds.

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

1. Every schema change is a committed file in `supabase/migrations/` first. No DDL exists only in a database. A pull request carries at most one migration, with its regenerated types: apply it to the local stack (`supabase migration up`) and run `bun run types:generate -- --local`. CI applies every migration to its own stack and fails while the committed types differ (`bun run types:check -- --local` in the SQL job).
2. A migration that creates a table follows [add a table](security.md#add-a-table): RLS, policies and explicit grants in the same file.
3. DEV receives a migration only when its pull request merges to `main`: `.github/workflows/staging.yml` runs `supabase db push`, deploys the edge functions, and only then deploys that exact commit to staging. Never apply a migration to DEV by hand. `bun run migrations:check` and the canary fail on a divergence of DEV's history from the committed files. `bun run advisors:check` runs the DEV security and performance advisors and fails on a warning, an error or a security finding without a reviewed exception in `lib/security/supabase-project-checks.ts`, and on an exception the advisor no longer reports.
4. PROD receives migrations only through the `release` workflow, before production deploys ([Release and rollback](#release-and-rollback)). Never link, push or apply a migration to PROD by hand.
5. Migrations are expand-only within a release, so the previous release's code keeps working against the new schema and a Vercel Instant Rollback never meets a schema it cannot use. Add the replacement first. Dropping or renaming a table, column, function or enum value is a later release's contract step, after the build that used the object is replaced. `lib/security/destructive-migrations.test.ts` fails a statement the previous code may not survive unless the comment directly above it reads `-- @destructive: after release <production commit>: <reason>`: a drop, truncate, delete or rename; a column type change; a new NOT NULL column without a default; a new NOT NULL, CHECK, UNIQUE or foreign-key rule on an existing table; a changed policy or a revoked table grant. A changed signature or return shape of a function that existing code calls is a review point. `lib/security/retired-functions.test.ts` fails on a public function that no code calls, unless it names the SQL caller or the release that may drop it.
6. Product code tolerates values it does not know yet, such as an enum value a newer release writes, so a rolled-back build reads newer data safely. The [backlog](enforcement-ladder-backlog.md) lists the reads that do not yet; until they do, a release that writes a new value to one of them is not rollback-safe, and its pull request says so.
7. The `*baseline*` repair migrations reconcile drift from before the split. Never edit them.
8. For a change of a Realtime transport, which no expand step makes compatible: pause writes, drain requests from the old app, change the database, deploy the compatible app, make open tabs reload, verify an authorized receiver, then reopen writes.

Between releases, merged migrations wait on DEV. Read the two migration ledgers before you claim parity. `bun run migrations:check`, `bun run types:check` and `bun run realtime:check` each compare one thing against the committed files. None compares the complete DEV and PROD schemas, and a matching migration name does not prove an identical function body. When production parity matters, compare the live object definitions with the procedure in the `supabase-live-workflow` skill.

## Work in a worktree

T3 Code gives every thread its own git worktree and runs `scripts/setup-worktree.ts` in the background (`t3.json`). The script installs from the frozen lockfile, links the main checkout's env backups and the Supabase CLI's link state, and writes the worktree's own `.env.local` with `bun run env:local`. It writes `.t3/setup-running` while it works, then `.t3/setup-done` or `.t3/setup-failed` with the tail of the failing output.

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
8. Verify: `bunx supabase projects list` shows both cloud projects, and `bun scripts/check-r2.ts` passes against the dev bucket. Start `bun run test:server local`, then run `bun run test:verify --group golden:gg-00` in another terminal.

## Work on production

- Reads: the connector, the MCP server or the Management API, read-only.
- Staging: a pull request merged to `main` reaches DEV's schema, then the staging deployment ([the migration rule](#the-migration-rule)).
- Release: only through the `release` workflow, which the owner starts or asks an agent to start ([Release and rollback](#release-and-rollback)).
- A production-local session: `bun run env:prod`, do the task, `bun run env:dev`. No tests and no bulk scripts in between.
- Owner demo data: `bun scripts/seed-demo-data.ts --target dev|prod` (production adds `--confirm-prod`) deletes and recreates the owner's demo organizations. It refuses the beta partner's organization. The data is disposable. For a manual look at `bun run dev`, which runs against DEV through `.env.local`, sign in with a demo member's address and the fixture password from that script.

## Release and rollback

[Decision 0009](../decisions/0009-pull-requests-and-ci.md) owns why. `main` is staging; the `production` branch is what Vercel serves on `app.werk-flow.app`.

1. Release: `gh workflow run release`, then `gh run watch` until it ends. The job runs in the `production` environment, which only `main` may use and which alone holds the PROD secrets; by the owner's decision it has no approval step, so starting the workflow is the release. `.github/workflows/release.yml` requires a successful `Check` on the head of `main` and a fast-forward from `production`, applies the pending migrations to PROD and deploys the edge functions, advances `production` to that commit with its deploy key, waits for Vercel's production build of it and promotes that build explicitly. A failed build gets one redeploy. When the run still fails, find the cause in the Vercel build log or the step's output, repair it on `main` through a pull request, and release again; rerunning a failed release is safe, because migrations already applied are skipped and `production` only moves forward.
2. Rollback: Vercel Instant Rollback in the dashboard switches the domain back to the previous production build within seconds. It changes code only; the database stays as it is, which expand-only migrations make safe for the schema; rule 6 of the migration rule names the limit for data. After a rollback Vercel stops assigning new production builds to the domain, so the next release must promote explicitly, which the workflow does.
3. The database is never rolled back. Fix forward with a new migration. Point-in-time restore is a last resort that loses every customer write since the restore point ([recovery](recovery-and-incidents.md)).
