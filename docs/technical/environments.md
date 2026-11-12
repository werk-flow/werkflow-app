# Environments

WerkFlow runs on two cloud backends ([decision 0003](../decisions/0003-dev-prod-environment-split.md)) and a local Supabase stack for application tests ([decision 0006](../decisions/0006-testing-architecture.md)).

## The two cloud backends

|  | Production | Dev |
| --- | --- | --- |
| Supabase project | `jbgaqpdjauzoocplgdsn` | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev") |
| Supabase organization | "WerkFlow" (`svxdwqapsmvfkchswonc`), Pro plan | The same |
| Region | AWS eu-central-1 | The same, on purpose |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod` | `werkflow-documents-dev` (CORS allows localhost and the staging URL) |
| Serves | The deployed app and real customers | Local development, the cloud canary, the partner preview, scoped provider checks |
| Auth site URL | `https://app.werk-flow.app` | `http://localhost:3000` |

Both projects deploy the edge functions from `supabase/functions/`. Each secret store holds its own Resend key; the production key never leaves production.

Both run Micro compute, whose latency rises steeply with concurrency, accepted while one beta business is the traffic. Cloud canary timings are no capacity proof.

### Vercel

- Every variable exists twice: one row for Production (PROD project, production bucket, production domain), one for all pre-production environments (DEV project, dev bucket, staging URL as `NEXT_PUBLIC_SITE_URL`).
- The staging URL is the branch alias of `main`, `https://werkflow-app-git-main-werkflows-projects.vercel.app`, behind Vercel Authentication. DEV's auth redirect list must allow it, or invite and password links break on staging.
- The project builds production and staging only: the Git integration builds the `production` push of [release](#release-and-rollback); `.github/workflows/staging.yml` deploys `main` through the REST API after DEV's migrations.
- The project's Ignored Build Step skips every other build, even on a branch without `vercel.json`, the second layer (`git.deploymentEnabled`). A skipped push ends Canceled, without failure mail. Change the setting and `.github/vercel/ignored-build-step.sh` together; the weekly `health` run fails while they differ.
- `SUPABASE_ACCESS_TOKEN` is never on Vercel. Recheck scopes when deployment settings change.

### Provider configuration

No migration carries auth settings, mail templates, SMTP or rate limits. Both projects carry the same posture.

- After every auth change on the production dashboard, run `bun scripts/sync-dev-auth-from-prod.ts`. It prints the difference; `--apply` copies the mail fields from PROD to DEV.
- `bun run auth:check` compares DEV's Auth configuration with the reviewed posture in `lib/security/supabase-project-checks.ts`. Change a setting and its posture entry together.
- Not adopted, each an owner decision: point-in-time recovery, database network restrictions, Supabase branching, GitHub's deploy integration. Signup CAPTCHA turns on when public sign-up opens.
- Owner duties no API covers: Supabase account MFA and a second organization owner.

## Credentials

This table is the one home of every deployment and workflow credential. No check copies a secret to test it.

- `.github/workflows/health.yml` checks every row in GitHub's reach each Monday with a read-only call where the value lives. A failed run fails the step named after the credential and opens or updates the issue "Weekly health check failed". Only a failed check marked `prod` assigns the owner ([monitoring](recovery-and-incidents.md#monitoring)); a run off `main` or with `break_check` reports on "… (proof)".
- The app checks its runtime credentials at `GET /api/health`, each Supabase project at its `health` function. Both answer only a request with the header `x-health-check-token`. The answer names each check `ok` or `failed`, never a value.

| Credential | Lives in | Used by | Expires | Rotate |
| --- | --- | --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | GitHub repository secret | Staging and release: deploy the edge functions | 2027-10-26 | Supabase account settings, Access Tokens; `gh secret set`; revoke the old one. |
| `VERCEL_TOKEN` | GitHub repository secret | Staging deploys, release promotes | 2027-10-26 | Vercel account settings, Tokens, team-scoped; `gh secret set`. |
| `werkflow app prod-watch` | The owner's PC: `~/.config/werkflow/prod-watch.env`, mode 600 | The [production watcher](recovery-and-incidents.md#monitoring), which checks it | 2027-11-07 | Vercel Tokens: same name, team-scoped (`werkflows-projects`, also werkflow-website), 1 year; set the file's `VERCEL_TOKEN=`. |
| Boat API key | `~/.config/werkflow/boat-api-key`, [mode 600](boat-verification.md#the-key-contract) | [Boat](boat-verification.md) | `boat-api-key.expires` | [Renew](boat-verification.md#renew-the-key) |
| `SIBLING_REPOSITORIES_TOKEN` | GitHub repository secret | CI clones werkflow-business for `docs:check` | 2027-10-26 | Fine-grained GitHub token, read access to werkflow-business contents; `gh secret set`. |
| `DEV_DATABASE_URL` | GitHub repository secret | Staging: `supabase db push` | With its password | DEV Database settings: reset the password; `gh secret set` the new connection string. |
| `PROD_DATABASE_URL` | GitHub environment `production` | Release: `supabase db push` | With its password | As for DEV, with `gh secret set --env production`. |
| `PRODUCTION_DEPLOY_KEY` | GitHub environment `production`; its public half is a write deploy key of this repository | Release: advances `production` | Never | `ssh-keygen -t ed25519`, add the public key as a deploy key with write access, `gh secret set PRODUCTION_DEPLOY_KEY --env production`, delete the old deploy key. |
| `HEALTH_CHECK_TOKEN` | GitHub repository secret, Vercel (both rows), Supabase secrets of DEV and PROD | The health endpoints and the weekly run | Never | One new value (`openssl rand -hex 32`) in one sitting: `gh secret set`, `vercel env add` for Production and Preview, `supabase secrets set` on both projects, then redeploy staging and production. |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | GitHub repository secret; Vercel project, Deployment Protection | The weekly run past staging's protection | Never | Vercel project settings, Deployment Protection, Protection Bypass for Automation: regenerate, then `gh secret set`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Vercel | Supabase clients | Never | Supabase API keys: create one, set it in Vercel, redeploy, delete the old one. |
| `SUPABASE_SECRET_KEY` | Vercel | Admin client, edge-function calls | Never | As above. The functions accept every secret key of their project. |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Vercel | Document storage | As set on the token | Cloudflare R2, Manage API tokens: one token scoped to the bucket; set both, redeploy, delete the old token. |
| `CRON_SECRET` | Vercel, Production | Vercel Cron: [storage purge](document-storage-and-access.md#storage-cleanup) and [report deletion](../features/problem-reports.md#current-product-baseline) | Never | `openssl rand -hex 32`, then redeploy. |
| `PROBLEM_REPORT_HANDOUT_SECRET` | Vercel; the dispatcher | Report-thread [hand-out](problem-report-scrubbing.md#hand-out) | Never | `openssl rand -hex 32`, redeploy. |
| `SUPPORT_USER_IDS` | Vercel, Production and Preview (PROD ids, DEV ids) | [Support allowlist](../features/problem-reports.md#current-product-baseline) | Never | Set, redeploy. |
| `EMAIL_OTP_HASH_SECRET` | Vercel | Email-change code hashes and rate-limit subjects | Never | Only after a leak: a new value voids pending email-change codes and restarts every rate-limit window. |
| `RESEND_API_KEY` | Supabase secrets, one key per project | The mail functions | Never | Resend, API keys: a sending key for the project, `supabase secrets set --project-ref <ref> RESEND_API_KEY`, delete the old key. |
| `FROM_EMAIL` | Supabase secrets | The mail functions' sender | Never | `supabase secrets set`. |

The platform injects `SUPABASE_SECRET_KEYS` into every function; `supabase_secret_keys` checks that the mail functions read it. Not checked: the owner's local Supabase and R2 admin tokens in the env backups.

## The local test stack

The test groups run against the Supabase CLI's Docker composition: Docker Engine in WSL Ubuntu, Colima on macOS. `supabase/config.toml` owns ports, auth posture, storage bucket and mail capture.

- `supabase db reset` replays the committed migration history; a failing reset is a finding.
- The keys are the CLI's shared defaults, not secrets.
- Auth mail lands in Mailpit. Cloud functions reject the local capture setup.
- Analytics is off: Logflare filled the disk. The lab recorder reads Kong's access log through `docker logs`.
- PostgREST truncates at its row limit without an error, locally and hosted. Read in pages ([add a list](realtime-and-caching.md#add-a-list)). Never raise the limit to hide the bound.
- The stack answers on `http://127.0.0.1:54321`. `bun run env:local` writes that origin and this checkout's test-server origin into `.env.local`. Rebuild after a switch: `NEXT_PUBLIC_*` values are baked into the build.
- A reset or crash stops the edge runtime; the test server and CI wait start it.
- An edge function imports only relative modules. The runtime fetches a remote one (`jsr:`, `npm:`, `https:`) on its first request, so a stalled registry hangs a fresh stack.
- A restarted edge-runtime container keeps its old configuration. After you change `[edge_runtime.secrets]`, reload the runtime and verify the capture endpoint before an email browser group.

## Env-file ownership

`.env.local` (gitignored) selects the backend. Three gitignored backups sit beside it: `.env.local-stack-backup`, `.env.dev-backup`, `.env.live-backup`. Next.js loads none of them.

```bash
bun run env:local  # .env.local -> the local Supabase stack (application tests)
bun run env:dev    # .env.local -> the cloud dev backend (canary, live inspection)
bun run env:prod   # .env.local -> PRODUCTION (loud warning; no tests)
```

## Which tool reaches what

Agents never read PROD data through any tool: every tool result goes to the model provider. Metadata is allowed: `bun run prod:inspect`, Vercel's deployment state and `vercel.request.count` counts. Two hooks enforce this in Claude Code and Codex; the [backlog](enforcement-ladder-backlog.md) records the other shell and `env:prod` paths. `.claude/hooks/refuse-production-mcp.ts` refuses an MCP tool that reaches the production Supabase project, or returns Vercel's logs, build events or traces. `.claude/hooks/refuse-production-logs.ts` refuses `vercel logs` and `vercel inspect --logs`. Preview runtime logs pass. Keep the `Supabase project` row's shape: the MCP hook reads the production ref there. After a change to `.codex/hooks.json`, the owner trusts it with `/hooks` in Codex on each machine; Codex skips an untrusted hook.

| Access path | Prod | Dev | Notes |
| --- | --- | --- | --- |
| claude.ai Supabase connector | no | no | Organization-wide, so Claude Code denies it (`deniedMcpServers` in `~/.claude/settings.json`). |
| MCP server `supabase` | never | read and write | `https://mcp.supabase.com/mcp?project_ref=mbkkzuqjbdvzelqvuzcn` |
| Supabase CLI (`bunx supabase`) | never link or push | yes | The repository links to the DEV ref only. |
| `bun run prod:inspect` | structure only | compared | Read-only query endpoint with the owner's token. Run it from an up-to-date `main`. |
| Management API | through `prod:inspect` only | yes | DEV configuration and the `*:check` scripts. |
| R2 tokens | prod bucket only | dev bucket only | Runtime tokens cannot manage bucket settings. `scripts/setup-r2-cors.ts` needs a bucket-admin token. |
| Local stack | n/a | n/a | The Supabase CLI and psql through `docker exec`. MCP cannot reach it. |

## The migration rule

1. Every schema change is a committed file in `supabase/migrations/` first. A PR carries at most one migration, with its regenerated types: apply it locally (`supabase migration up`) and run `bun run types:generate -- --local`. CI fails while the committed types differ. Its version sorts after the newest migration on `main`, or `supabase db push` refuses it after the merge; `bun run migrations:order` (in `check:changed` and CI) fails otherwise and names the version to rename it to.
2. A migration that creates a table follows [add a table](security.md#add-a-table).
3. DEV receives a migration only when its PR merges to `main`: `.github/workflows/staging.yml` runs `supabase db push`, deploys the edge functions, then deploys that commit to staging. Never apply a migration to DEV by hand. `bun run migrations:check` and the canary fail when DEV's history diverges. `bun run advisors:check` fails on an advisor finding without a reviewed exception, and on an exception the advisor no longer reports.
4. PROD receives migrations only through the `release` workflow ([Release and rollback](#release-and-rollback)). Never link, push or apply a migration to PROD by hand.
5. Migrations are expand-only within a release, so the previous release's code works against the new schema and an Instant Rollback never meets a schema it cannot use. Add the replacement first. A drop or rename is a later release's step, after the build that used the object is replaced. `lib/security/destructive-migrations.test.ts` fails a statement the previous code may not survive unless the comment directly above it reads `-- @destructive: after release <production commit>: <reason>`. A changed signature or return shape of a called function is a review point.
6. Product code tolerates values it does not know yet, such as an enum value a newer release writes. The [backlog](enforcement-ladder-backlog.md) lists the reads that do not yet. A release that writes a new value to one of them is not rollback-safe, and its PR says so.
7. Never edit the `*baseline*` repair migrations.
8. A Realtime transport change has no expand step: pause writes, drain requests from the old app, change the database, deploy the compatible app, make open tabs reload, verify an authorized receiver, then reopen writes.

Between releases, merged migrations wait on DEV. `migrations:check`, `types:check` and `realtime:check` each compare one thing against the committed files; none compares the complete schemas, and a matching migration name does not prove an identical function body. When parity matters, run `bun run prod:inspect`: it compares every app object's definition by hash and fails on drift once both ledgers match.

## Work in a worktree

T3 Code gives every thread its own worktree and runs `scripts/setup-worktree.ts` in the background.

- Wait for `.t3/setup-done` before any command. While it waits for its turn or for room, `.t3/setup-running` says why (`lib/testing/runner/setup-turn.ts`). On `.t3/setup-failed`, repair the cause and rerun `bun scripts/setup-worktree.ts`.
- A checkout keeps its own `.next`, workspace lock, `.agent-logs/` and ports (`lib/testing/runner/app-port.ts`).
- Every worktree shares one local stack. Browser groups of several worktrees run side by side, except one that measures or restarts a stack service: it holds the stack alone (`lib/testing/runner/stack-lock.ts`).
- `bun run check:changed`, `test:verify`, `typecheck`, `build` (a test server's too) and a `lint` over 150 files take a machine-wide slot (`lib/testing/runner/heavy-slot.ts`): the first unless the machine is blocked, further ones with measured room (`bun run room`). Serving and CI take none. A hook refuses a direct whole-repository `tsc`, wider `eslint` or `next build` and names the slot command (`lib/testing/runner/heavy-command.ts`). Other heavy work: `bun scripts/heavy.ts -- <command>`.
- `supabase db reset` and `supabase stop` affect every worktree: the edit guard refuses them while any worktree holds the stack. A hook refuses a second stack (`lib/testing/runner/second-stack.ts`).
- Another worktree's unmerged migration may sit in the shared stack ([recurring traps](testing.md#recurring-traps)).

## Set up a new machine

1. Install Bun, Node 22 or later, git, the GitHub CLI, Docker and the Supabase CLI. On Windows, clone and work inside WSL Ubuntu.
   On an Apple Silicon Mac, run `softwareupdate --install-rosetta` and `brew install colima docker flock`, then `colima start --cpu 4 --memory 6 --disk 40 --vm-type vz --vz-rosetta --mount-type virtiofs` ([why Rosetta](standards-audit.md#keep-accepted-screens-as-visual-references)). Run the repository's pinned CLI with `bunx supabase`. Grow the VM only for a measured need. On AC power, `caffeinate -s` keeps the Mac awake for agents.
2. Export the owner's Supabase personal access token as `SUPABASE_ACCESS_TOKEN`, with a copy in every env backup (a switch overwrites `.env.local`). Never commit or print it.
3. Get the DEV `.env.local` from the owner's password manager and copy it to `.env.dev-backup`. Add `.env.live-backup` only for production sessions.
4. Add the DEV MCP server `supabase` above to Claude Code (`claude mcp add --scope user --transport http supabase "<url>"`) and Codex (`[mcp_servers.supabase]` in `~/.codex/config.toml`). The owner signs in once per tool. Never add a server for PROD. The Vercel CLI, signed in as the owner, serves both.
5. Run `supabase start` and `supabase db reset`. Create `.env.local-stack-backup` from `supabase status`, then run `bun run env:local`.
6. Run `bunx playwright install --with-deps chromium` once.
7. CodeRabbit: `curl -fsSL https://cli.coderabbit.ai/install.sh | sh`. The owner signs in once with `coderabbit auth login`. `bun run review:doctor` confirms both. Agents install CodeRabbit only here.
8. Install the [background jobs](#background-jobs); `bun run room` prints numbers.
9. Verify: `bunx supabase projects list` shows both projects, `bun scripts/check-r2.ts` passes, and `WERKFLOW_VERIFY_LOCAL=1 bun run test:verify --group golden:gg-00` passes beside `bun run test:server local`.

## Background jobs

The `ops/` scripts of `werk-flow/werkflow-planning` run from `~/code/werkflow-planning`, as systemd user timers on Linux and launchd agents on the Mac (`ops/install-mac.py`).

| Job | Runs on |
| --- | --- |
| `worktree-cleanup`, load watch | Each machine, for itself |
| [CodeRabbit queue](coderabbit.md#the-coderabbit-queue), `ci-alert` | Both; only the lease holder acts |
| [Production watcher](recovery-and-incidents.md#monitoring) | Where its [token](#credentials) is |
| [Recovery rehearsal](recovery-and-incidents.md#recovery-rehearsal) | The PC, beside the stack |

A lease is the ref `refs/leases/<job>` (`ops/lease.py`): its holder renews it every pass; another machine takes over once it lapses.

## Work on production

- Reads: metadata only, through `bun run prod:inspect`. [Which tool reaches what](#which-tool-reaches-what) owns the rule.
- A production-local session is the owner's: `bun run env:prod`, do the task, `bun run env:dev`. No tests or bulk scripts in between.
- Owner demo data: `bun scripts/seed-demo-data.ts --target local|dev|prod` (PROD adds `--confirm-prod`) recreates the demo organizations, never the beta partner's; `local` also creates the owner. Each run generates the members' password. To sign in to `bun run dev` as one, seed DEV with your own `DEMO_MEMBER_PASSWORD` and run `bun run env:dev` first; PROD refuses one.

## Release and rollback

[Decision 0009](../decisions/0009-pull-requests-and-ci.md) owns why. `main` is staging. The `production` branch is what Vercel serves on `app.werk-flow.app`.

1. `.github/workflows/release.yml` ships a `main` commit to PROD only after a green full run ([release gate](testing.md#ci)). PROD is live weekdays by 05:00 Berlin: a run fires at 17:00 and holds until 03:30. A scheduled run ships its starting commit only when `main` moved since `production` and its newest full run, or its own, passed. A manual run queues behind a held one: `gh run cancel` it first. By hand, when a green `main` should not wait ("release main"): `gh workflow run release`, then `gh run watch`; `-f dry_run=true` prints a scheduled run's decision and, with a candidate, checks the serving build (step 3). `production` has no approval step (owner's decision). When it fails, repair `main` by PR and release again; a rerun is safe.
2. Rollback: Vercel Instant Rollback switches the domain to the previous build within seconds. It changes code only; rule 6 of the migration rule names the limit for data.
3. The last job checks production without reading data (`.github/scripts/release-smoke.sh`). If it fails, the coordinator thread, else the owner, rolls back (step 2) and reports.
4. Never roll back the database. Fix forward with a new migration. Point-in-time restore is a last resort that loses every write since the restore point ([recovery](recovery-and-incidents.md)).
