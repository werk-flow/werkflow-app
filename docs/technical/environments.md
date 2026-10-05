# Environments

Status: living — last reviewed 2026-10-01

WerkFlow runs on two separate cloud backends ([decision 0003](../decisions/0003-dev-prod-environment-split.md)) and a local Supabase stack for the application tests ([decision 0006](../decisions/0006-testing-architecture.md)). This page owns which backend is which, who owns which env file, how tools reach each project, the migration rule, and how to set up a new machine.

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

Every variable exists twice: one row for Production and one for all pre-production environments. Production rows carry the PROD project, the production bucket and the production domain. Pre-production rows carry the DEV project, the dev bucket and the partner-preview branch URL as `NEXT_PUBLIC_SITE_URL`. The names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SITE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` and `EMAIL_OTP_HASH_SECRET` (one value per backend). `SUPABASE_ACCESS_TOKEN` is never on Vercel. DEV's auth redirect list must allow the partner-preview URL so that invite and password links work on the preview. Recheck the scopes when deployment configuration changes.

### Provider configuration

Project configuration (auth settings, mail templates, SMTP, rate limits) is not schema, and no migration carries it. Both projects carry the same posture so that DEV mirrors PROD. Read the current values through the Management API or the dashboard. `bun scripts/sync-dev-auth-from-prod.ts` prints the difference between the two auth configurations and, with `--apply`, copies the mail fields from PROD to DEV. Run it after every auth change on the production dashboard.

Decided and in force: leaked-password protection, custom SMTP through Resend, SSL enforcement for direct database connections, the organization spend cap, daily backups from the plan, anonymous sign-in off, Vercel Authentication on every deployment except the custom domain.

Not adopted, each a future owner decision: point-in-time recovery, signup CAPTCHA, database network restrictions, Supabase branching, the GitHub deploy integration. Owner duties that no API covers: MFA on the Supabase account and a second organization owner.

## The local test stack

The application test groups run against the Supabase CLI's Docker composition inside WSL Ubuntu (Docker Engine, not Docker Desktop). `supabase/config.toml` owns its ports, auth posture, storage bucket and mail capture.

- `supabase db reset` replays the committed migration history. A failing reset is a finding about that history.
- The keys are the CLI's shared local defaults. They are not secrets.
- Auth mail lands in Mailpit, never in a real inbox. Cloud functions reject the local capture configuration.
- Leaked-password protection needs the internet and has no local equivalent. The canary owns that check.
- PostgREST truncates a response at its row limit without an error, locally and on the hosted projects. A read that can exceed the limit reads in pages and reports an overflow ([Realtime and caching](realtime-and-caching.md) owns the rule). Do not raise the limit to hide the bound.

Facts for this workstation:

- Windows reaches the stack through the WSL address, not `localhost`. `bun run env:local` resolves the current address and rewrites `.env.local`. Run it again after every WSL restart, and rebuild before the next browser run, because `NEXT_PUBLIC_*` values are baked into the build. The preflight fails with the remedy when the address is stale.
- WSL shuts down when it idles. `bun run test:server local` holds WSL alive from environment generation through the build and the server's lifetime, and waits for the stack to become healthy. Keep that process alive while you verify.
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
| claude.ai Supabase connector (OAuth) | read and write | read and write | Scoped to the "WerkFlow" organization. Address projects by ref. Production writes are forbidden outside the migration rule. |
| Supabase MCP server (`.mcp.json`) | yes | yes | Authenticated by `SUPABASE_ACCESS_TOKEN` from the shell environment. Routine writes go to DEV only. |
| Supabase CLI (`bunx supabase`) | never link or push | yes | The repository links to the DEV ref only. |
| Management API | yes | yes | Read-only production inspection and DEV configuration. |
| R2 tokens | prod bucket only | dev bucket only | Each backup carries its own bucket-scoped credentials. Runtime tokens cannot manage bucket settings. `scripts/setup-r2-cors.ts` needs a bucket-admin token. |
| Local stack | n/a | n/a | The Supabase CLI inside WSL and direct psql. MCP does not reach it. |

## The migration rule

This section is the one home of the rule. Skills and decision records link here.

1. Every schema change is a committed file in `supabase/migrations/` first. No DDL exists only in a database.
2. A migration that creates a table follows [security rule 9](security.md#checklist): RLS, policies and explicit grants in the same file.
3. Apply to DEV with `bunx supabase db push`. The push records the committed file's exact version in the remote history. If a migration reached DEV through MCP `apply_migration` instead, align its history key to the committed file name afterwards, because MCP stamps its own version. `bun run migrations:check` and the canary fail on a divergence.
4. Run `bun run types:generate` after the push and commit the result. `bun run types:check` fails when the committed types differ from a fresh DEV generation.
5. Apply to PROD only as part of a production release that the owner requested ([decision 0008](../decisions/0008-development-workflow.md)): MCP `apply_migration` against the production ref with the identical SQL, inside the maintenance window, before `origin/main` advances. Compare name and statement, then align the history key to the committed file name. Never `supabase link` or `db push` against production.
6. The `*baseline*` repair migrations reconcile drift from before the split. Never edit them.
7. Coordinate a schema change that the running app cannot tolerate with the app release that consumes it. For a change of a Realtime transport: pause writes, drain requests from the old app, change the database, deploy the compatible app, make open tabs reload, verify an authorized receiver, then reopen writes. A rollback keeps app and database compatible.
8. A migration never drops or changes the signature of a function, column or table that the deployed build still uses. Add the replacement first. A later migration drops the old object after that build is replaced.

Between releases, migrations wait on DEV. Read the two migration ledgers before you claim parity. `bun run migrations:check`, `bun run types:check` and `bun run realtime:check` each compare one thing against the committed files. None compares the complete DEV and PROD schemas, and a matching migration name does not prove an identical function body. When production parity matters, compare the live object definitions with the procedure in the `supabase-live-workflow` skill.

## Set up a new machine

1. Make the owner's Supabase personal access token available as `SUPABASE_ACCESS_TOKEN` to the CLI and the scripts. Keep a copy in every env backup, because a switch overwrites `.env.local`. Never commit or print the token.
2. Get `.env.local` with the DEV values from the owner's password manager and copy it to `.env.dev-backup`. Add `.env.live-backup` only when production sessions are expected.
3. Claude Code: approve the project's `.mcp.json` server on first start. Codex: add the same server to `~/.codex/config.toml`.
4. Local stack: install Docker Engine and the Supabase CLI inside WSL Ubuntu. From the repository root in WSL run `supabase start` and `supabase db reset`. Create `.env.local-stack-backup` from the values that `supabase status` prints.
5. Run `bunx playwright install chromium` once.
6. Run `git config core.hooksPath .githooks` to enable the [publication gate](testing.md#publication-gate).
7. Verify: `bunx supabase projects list` shows both cloud projects, and `bun scripts/check-r2.ts` passes against the dev bucket. Start `bun run test:server local`, then run `bun run test:verify --group golden:gg-00` in another terminal.

## Work on production

- Reads: the connector, the MCP server or the Management API, read-only.
- Preview: when the owner asks for a push, run `git push origin main:partner-preview`. Vercel builds a preview on DEV data. `origin/main` does not move.
- Release: `origin/main` advances only on the owner's explicit release request, after the pending migrations and edge functions reached PROD in the order of the migration rule. [Decision 0008](../decisions/0008-development-workflow.md) owns the flow.
- A production-local session: `bun run env:prod`, do the task, `bun run env:dev`. No tests and no bulk scripts in between.
- Owner demo data: `bun scripts/seed-demo-data.ts --target dev|prod` (production adds `--confirm-prod`) deletes and recreates the owner's demo organizations. It refuses the beta partner's organization. The data is disposable.
