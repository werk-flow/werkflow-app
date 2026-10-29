# Environments

WerkFlow runs on two cloud backends ([decision 0003](../decisions/0003-dev-prod-environment-split.md)) and a local Supabase stack for the application tests ([decision 0006](../decisions/0006-testing-architecture.md)).

## The two cloud backends

|  | Production | Dev |
| --- | --- | --- |
| Supabase project | `jbgaqpdjauzoocplgdsn` | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev") |
| Supabase organization | "WerkFlow" (`svxdwqapsmvfkchswonc`), Pro plan | The same |
| Region | AWS eu-central-1 | The same, on purpose |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod` | `werkflow-documents-dev` (CORS allows localhost and the staging URL) |
| Serves | The deployed app and real customers | Local development, the cloud canary, the partner preview, scoped provider checks |
| Auth site URL | `https://app.werk-flow.app` | `http://localhost:3000` |

Both projects deploy the edge functions from `supabase/functions/`. Each project's secret store holds its own Resend key; the production key never leaves production.

Both run Micro compute, whose latency rises steeply with concurrency. The owner accepts this while one beta business is the only traffic. Cloud canary timings are no capacity proof.

### Vercel

- Every variable exists twice: one row for Production (PROD project, production bucket, production domain), one for all pre-production environments (DEV project, dev bucket, staging URL as `NEXT_PUBLIC_SITE_URL`).
- The staging URL is the branch alias of `main`, `https://werkflow-app-git-main-werkflows-projects.vercel.app`, behind Vercel Authentication. DEV's auth redirect list must allow it, or invite and password links break on staging.
- `vercel.json` installs from the frozen `bun.lock`. The app runtime and `next build` stay on Node.
- The production branch is `production`. `vercel.json` turns off Git deployments of `main`, so `.github/workflows/staging.yml` deploys staging after DEV's migrations. PR previews stay automatic.
- `SUPABASE_ACCESS_TOKEN` is never on Vercel. Recheck the scopes when deployment configuration changes.

### Provider configuration

Auth settings, mail templates, SMTP and rate limits are no schema and no migration carries them. Both projects carry the same posture.

- After every auth change on the production dashboard, run `bun scripts/sync-dev-auth-from-prod.ts`. It prints the difference; `--apply` copies the mail fields from PROD to DEV.
- `bun run auth:check` compares DEV's Auth configuration with the reviewed posture in `lib/security/supabase-project-checks.ts`. Change a setting and its posture entry together.
- Not adopted, each an owner decision: point-in-time recovery, database network restrictions, Supabase branching, the GitHub deploy integration. Signup CAPTCHA turns on when public sign-up opens.
- Owner duties no API covers: MFA on the Supabase account and a second organization owner.

## Credentials

This table is the one home of every credential the deployments and workflows use. No check copies a secret elsewhere to test it.

- `.github/workflows/health.yml` checks every row each Monday morning, Berlin time, with a read-only call where the value lives. A failed run fails the step named after the credential (a 404 from a health endpoint names a token mismatch, a 401 from staging the bypass secret) and opens or updates the issue "Weekly health check failed", assigned to `tamaycbn`. The next green run closes it. GitHub mails a scheduled run's failure to the account that last changed its cron line, `tamaycbn`, which needs failed-workflow mail turned on.
- The app checks its runtime credentials at `GET /api/health`, each Supabase project at its `health` function. Both accept only a request with the header `x-health-check-token`; without it they answer like a missing route. The answer names each check `ok` or `failed`, never a value.

| Credential | Lives in | Used by | Expires | Rotate |
| --- | --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | GitHub repository secret | Staging and release: deploy the edge functions | 2027-10-26 | Supabase account settings, Access Tokens; `gh secret set`; revoke the old one. |
| `VERCEL_TOKEN` | GitHub repository secret | Staging deploys, release promotes | 2027-10-26 | Vercel account settings, Tokens, team-scoped; `gh secret set`. |
| `SIBLING_REPOSITORIES_TOKEN` | GitHub repository secret | CI clones werkflow-business for `docs:check` | 2027-10-26 | Fine-grained GitHub token, read access to werkflow-business contents; `gh secret set`. |
| `DEV_DATABASE_URL` | GitHub repository secret | Staging: `supabase db push` | With its password | DEV Database settings: reset the password; `gh secret set` the new connection string. |
| `PROD_DATABASE_URL` | GitHub environment `production` | Release: `supabase db push` | With its password | As for DEV, with `gh secret set --env production`. |
| `PRODUCTION_DEPLOY_KEY` | GitHub environment `production`; its public half is a write deploy key of this repository | Release: advances `production` | Never | `ssh-keygen -t ed25519`, add the public key as a deploy key with write access, `gh secret set PRODUCTION_DEPLOY_KEY --env production`, delete the old deploy key. |
| `HEALTH_CHECK_TOKEN` | GitHub repository secret, Vercel (both rows), Supabase secrets of DEV and PROD | The health endpoints and the weekly run | Never | One new value (`openssl rand -hex 32`) in one sitting: `gh secret set`, `vercel env add` for Production and Preview, `supabase secrets set` on both projects, then redeploy staging and production. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub repository secret; Vercel project, Deployment Protection | The weekly run past staging's protection | Never | Vercel project settings, Deployment Protection, Protection Bypass for Automation: regenerate, then `gh secret set`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel | Supabase clients | Never | Supabase API keys: create one, set it in Vercel, redeploy, delete the old one. |
| `SUPABASE_SECRET_KEY` | Vercel | Admin client, edge-function calls | Never | As above. The functions accept every secret key of their project. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Vercel | Document storage | As set on the token | Cloudflare R2, Manage API tokens: one token scoped to the bucket; set both, redeploy, delete the old token. |
| `EMAIL_OTP_HASH_SECRET` | Vercel | Email-change code hashes and rate-limit subjects | Never | Only after a leak: a new value voids pending email-change codes and restarts every rate-limit window. |
| `RESEND_API_KEY` | Supabase secrets, one key per project | The mail functions | Never | Resend, API keys: a sending key for the project, `supabase secrets set --project-ref <ref> RESEND_API_KEY`, delete the old key. |
| `FROM_EMAIL` | Supabase secrets | The mail functions' sender | Never | `supabase secrets set`. |

The platform injects `SUPABASE_SECRET_KEYS` into every function; `supabase_secret_keys` checks that the mail functions can read it. Not checked: the owner's local Supabase token and R2 admin token in the env backups.

## The local test stack

The test groups run against the Supabase CLI's Docker composition: Docker Engine in WSL Ubuntu on Windows, Docker Desktop on a Mac. Every repository command runs inside Linux or macOS. `supabase/config.toml` owns ports, auth posture, storage bucket and mail capture.

- `supabase db reset` replays the committed migration history. A failing reset is a finding about that history.
- The keys are the CLI's shared local defaults, not secrets.
- Auth mail lands in Mailpit. Cloud functions reject the local capture configuration.
- Analytics is off: Logflare filled the disk. The lab recorder reads Kong's access log through `docker logs`.
- PostgREST truncates at its row limit without an error, locally and hosted. Read in pages ([add a list](realtime-and-caching.md#add-a-list)). Never raise the limit to hide the bound.
- The stack answers on `http://127.0.0.1:54321`. `bun run env:local` writes that origin and this checkout's test-server origin into `.env.local`. Rebuild after a switch: `NEXT_PUBLIC_*` values are baked into the build.
- `bun run test:server local` waits for a healthy stack before it builds. Keep it running while you verify.
- `supabase db reset` can leave the edge-runtime container stopped. The preflight prints the remedy.
- A restarted edge-runtime container keeps its old configuration. After you change `[edge_runtime.secrets]`, reload the runtime and verify the capture endpoint before an email browser group.

## Env-file ownership

`.env.local` (gitignored) selects the backend. Three gitignored backups sit beside it: `.env.local-stack-backup`, `.env.dev-backup`, `.env.live-backup`. Next.js loads none of the backups.

```bash
bun run env:local  # .env.local -> the local Supabase stack (application tests)
bun run env:dev    # .env.local -> the cloud dev backend (canary, live inspection)
bun run env:prod   # .env.local -> PRODUCTION (loud warning; no tests)
```

A local file never affects the deployed app. Never run the test harness or a destructive script while `.env.local` points at production; switch back as soon as the task is done. The preflight refuses a run whose `.env.local` does not match the requested target.

## Which tool reaches what

| Access path | Prod | Dev | Notes |
| --- | --- | --- | --- |
| claude.ai Supabase connector | no | no | Organization-wide, so Claude Code denies it (`deniedMcpServers` in `~/.claude/settings.json`). |
| MCP server `supabase` | never | read and write | `https://mcp.supabase.com/mcp?project_ref=mbkkzuqjbdvzelqvuzcn` |
| MCP server `supabase-prod-readonly` | read only | never | `https://mcp.supabase.com/mcp?project_ref=jbgaqpdjauzoocplgdsn&read_only=true`, a read-only database user |
| Supabase CLI (`bunx supabase`) | never link or push | yes | The repository links to the DEV ref only. |
| Management API | yes | yes | Read-only production inspection and DEV configuration. |
| R2 tokens | prod bucket only | dev bucket only | Runtime tokens cannot manage bucket settings. `scripts/setup-r2-cors.ts` needs a bucket-admin token. |
| Local stack | n/a | n/a | The Supabase CLI and psql through `docker exec`. MCP does not reach it. |

## The migration rule

This section is the one home of the rule.

1. Every schema change is a committed file in `supabase/migrations/` first. A PR carries at most one migration, with its regenerated types: apply it locally (`supabase migration up`) and run `bun run types:generate -- --local`. CI fails while the committed types differ. Its version sorts after the newest migration on `main`, or `supabase db push` refuses it after the merge; `bun run migrations:order` (in `check:changed` and CI) fails otherwise and names the version to rename it to.
2. A migration that creates a table follows [add a table](security.md#add-a-table).
3. DEV receives a migration only when its PR merges to `main`: `.github/workflows/staging.yml` runs `supabase db push`, deploys the edge functions, then deploys that commit to staging. Never apply a migration to DEV by hand. `bun run migrations:check` and the canary fail when DEV's history diverges. `bun run advisors:check` fails on an advisor finding without a reviewed exception, and on an exception the advisor no longer reports.
4. PROD receives migrations only through the `release` workflow ([Release and rollback](#release-and-rollback)). Never link, push or apply a migration to PROD by hand.
5. Migrations are expand-only within a release, so the previous release's code works against the new schema and an Instant Rollback never meets a schema it cannot use. Add the replacement first. A drop or rename is a later release's step, after the build that used the object is replaced. `lib/security/destructive-migrations.test.ts` fails a statement the previous code may not survive unless the comment directly above it reads `-- @destructive: after release <production commit>: <reason>`. A changed signature or return shape of a called function is a review point.
6. Product code tolerates values it does not know yet, such as an enum value a newer release writes. The [backlog](enforcement-ladder-backlog.md) lists the reads that do not yet. A release that writes a new value to one of them is not rollback-safe, and its PR says so.
7. Never edit the `*baseline*` repair migrations.
8. A Realtime transport change has no expand step: pause writes, drain requests from the old app, change the database, deploy the compatible app, make open tabs reload, verify an authorized receiver, then reopen writes.

Between releases, merged migrations wait on DEV. `migrations:check`, `types:check` and `realtime:check` each compare one thing against the committed files. None compares the complete DEV and PROD schemas, and a matching migration name does not prove an identical function body. When parity matters, compare the live definitions with the procedure in the `supabase-live-workflow` skill.

## Work in a worktree

T3 Code gives every thread its own worktree and runs `scripts/setup-worktree.ts` in the background. It installs from the frozen lockfile, links the main checkout's env backups and Supabase link state, and runs `bun run env:local`. It writes `.t3/setup-running`, then `.t3/setup-done` or `.t3/setup-failed` with the failing output.

- Wait for `.t3/setup-done` before you run any command. On `.t3/setup-failed`, read the file, repair the cause, and run `bun scripts/setup-worktree.ts` again.
- A checkout keeps its own `.next`, workspace lock and `.agent-logs/`. The main checkout serves on port 3000. A linked worktree derives its test-server and dev ports from its path (`lib/testing/runner/app-port.ts`).
- Every worktree uses the one local stack. Ordinary browser groups of several worktrees run side by side. A group that measures or restarts a stack service holds the stack alone (`lib/testing/runner/stack-lock.ts`).
- `supabase db reset` and `supabase stop` affect every worktree. The edit guard refuses them while any worktree holds the stack.
- Another worktree's unmerged migration may sit in the shared stack ([recurring traps](testing.md#recurring-traps)).

## Set up a new machine

1. Install Bun, Node 22 or later, git, the GitHub CLI, Docker and the Supabase CLI. On Windows, clone and work inside WSL Ubuntu.
2. Export the owner's Supabase personal access token as `SUPABASE_ACCESS_TOKEN`, with a copy in every env backup (a switch overwrites `.env.local`). Never commit or print it.
3. Get the DEV `.env.local` from the owner's password manager and copy it to `.env.dev-backup`. Add `.env.live-backup` only for production sessions.
4. Add the two scoped Supabase MCP servers above to Claude Code (`claude mcp add --scope user --transport http <name> "<url>"`) and Codex (`[mcp_servers.<name>]` in `~/.codex/config.toml`). The owner signs in once per server and tool. The Vercel CLI, signed in as the owner, serves both.
5. Run `supabase start` and `supabase db reset`. Create `.env.local-stack-backup` from `supabase status`, then run `bun run env:local`.
6. Run `bunx playwright install --with-deps chromium` once.
7. CodeRabbit: `curl -fsSL https://cli.coderabbit.ai/install.sh | sh` (into `~/.local/bin`). The owner signs in once with `coderabbit auth login`. `bun run review:doctor` confirms both. This is the only time an agent installs CodeRabbit.
8. Verify: `bunx supabase projects list` shows both projects, `bun scripts/check-r2.ts` passes, and `bun run test:verify --group golden:gg-00` passes beside `bun run test:server local`.

## Work on production

- Reads: the connector, the MCP server or the Management API, read-only.
- Staging: a PR merged to `main` reaches DEV's schema, then staging.
- Release: only through the `release` workflow, which the owner starts or asks an agent to start.
- A production-local session: `bun run env:prod`, do the task, `bun run env:dev`. No tests and no bulk scripts in between.
- Owner demo data: `bun scripts/seed-demo-data.ts --target dev|prod` (production adds `--confirm-prod`) recreates the demo organizations and refuses the beta partner's. Each run gives the demo members a generated password. To sign in to `bun run dev` as one, seed DEV with `DEMO_MEMBER_PASSWORD` set to a password you choose and run `bun run env:dev` first. PROD refuses a chosen password.

## Release and rollback

[Decision 0009](../decisions/0009-pull-requests-and-ci.md) owns why. `main` is staging. The `production` branch is what Vercel serves on `app.werk-flow.app`.

1. Release when the owner or the coordinator thread asks ("release main"): `gh workflow run release`, then `gh run watch` until it ends. Starting it is the release; the `production` environment has no approval step by the owner's decision. `.github/workflows/release.yml` requires a green full run on the `main` commit it ships, reusing a nightly or manual one or running the full suite itself first, then migrates PROD, deploys the edge functions, advances `production` and promotes Vercel's build. When it fails, find the cause in the build log, repair it on `main` through a PR, and release again. A rerun is safe.
2. Rollback: Vercel Instant Rollback switches the domain to the previous build within seconds. It changes code only; rule 6 of the migration rule names the limit for data. After a rollback Vercel stops assigning new production builds to the domain, so the next release must promote explicitly, which the workflow does.
3. After every release, the releasing thread checks production: the app loads and signs in, and Vercel shows no new runtime errors. If production breaks, it rolls the app back through Vercel (step 2), then reports.
4. Never roll back the database. Fix forward with a new migration. Point-in-time restore is a last resort that loses every write since the restore point ([recovery](recovery-and-incidents.md)).
