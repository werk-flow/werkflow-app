# Environments

Status: living — last reviewed 2026-08-29

WerkFlow runs on two fully separated cloud backend environments since 2026-08-18 (decision [0003](../decisions/0003-dev-prod-environment-split.md)), plus a local Supabase stack for the browser-test harness since 2026-08-28 (decision [0006](../decisions/0006-testing-architecture.md)). This document is the operational reference: which backend is which, who owns which env file, how tools reach each project, and how a new machine gets onboarded.

## The two backends

| | Production | Dev / Test |
| --- | --- | --- |
| Supabase project | `jbgaqpdjauzoocplgdsn` | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev") |
| Supabase org | "WerkFlow" (`svxdwqapsmvfkchswonc`) | same org since 2026-08-20 (transfer verified: refs/keys unchanged) |
| Region / compute | AWS eu-central-1, Postgres 17 | AWS eu-central-1 (same, deliberate), Postgres 17, Micro compute since 2026-08-21 |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod` | `werkflow-documents-dev` (CORS: localhost only) |
| Serves | Deployed app on Vercel, real customers | Local dev server, the cloud canary suite, wave-end cloud certifications (the Golden/audit batteries run against the local stack since 2026-08-28) |
| Edge functions | `send-invite-email`, `send-email-change-current-otp` | Same two, deployed from `supabase/functions/` |
| Auth | Site URL `https://app.werk-flow.app`, custom SMTP via Resend (prod key) | Site URL `http://localhost:3000`, custom SMTP via Resend ("werkflow-dev" key) |

Both projects live in the one "WerkFlow" org since 2026-08-20 (the separate "WerkFlow Dev" org was deleted after the transfer). **The org is on the Pro plan since 2026-08-21**, so both projects run under Pro quotas. The same day the dev project's compute was raised from Nano to Micro (covered by the plan's compute credits, no additional cost per the owner). Practical effects: the free-tier auto-pause no longer applies to dev, the shared free egress cap is gone, and harness runs are faster than the Nano-era baselines recorded in [testing.md](testing.md) — re-baseline durations on the next full run before reading a slow run as a regression.

**Production configuration posture (since 2026-08-23, applied to BOTH projects so dev mirrors prod):** leaked-password protection (HaveIBeenPwned) ON — the app's `translateSupabasePasswordError` already maps the rejection to German copy; server `password_min_length` 8 (matches the app's `MIN_PASSWORD_LENGTH`); OTP length 6, expiry 5 minutes; custom SMTP via Resend; auth email rate limit 25/hour; SSL enforcement ON for direct database connections (app traffic is PostgREST/HTTP and unaffected; the CLI's `db push` already uses SSL). Spend cap ON (org default). Daily backups with 7-day retention come with Pro automatically. Deliberately NOT adopted, each a future decision: PITR (paid add-on — revisit at first real customer onboarding), signup CAPTCHA (would add friction and break harness signup; revisit at public exposure), database network restrictions (would pin `db push` to fixed IPs), Supabase branching and the GitHub deploy integration (our two-project migration-file workflow from decision 0003 fills that role). Owner-side duties the API cannot cover: MFA on the Supabase account itself and a second organization owner.

**Auth/config parity:** project configuration (auth email templates, SMTP, rate limits) is not schema and is not covered by migrations or the decision-0003 object comparison. `bun scripts/sync-dev-auth-from-prod.ts` diffs the complete auth config of both projects and with `--apply` syncs the `mailer_*` fields prod → dev (this fixed the 2026-08-20 gap where dev sent confirmation links instead of the app's 6-digit OTP). Run the diff after any dashboard-side auth change on prod.

## The local test stack

Since Stage A of the [platform-hardening phase](../plans/platform-hardening.md), the full Golden and audit batteries run against a local Supabase stack; cloud DEV keeps the canary suite and live-state inspection (decision [0006](../decisions/0006-testing-architecture.md)). The stack is the Supabase CLI's Docker composition, running on Docker Engine (docker-ce) inside WSL Ubuntu — not Docker Desktop.

| | Local stack |
| --- | --- |
| Runs | `supabase start` from the repo root inside WSL (config: `supabase/config.toml`) |
| API / DB / Studio / Mailpit | ports 54321 / 54322 / 54323 / 54324 |
| Schema | `supabase db reset` replays the committed `supabase/migrations/` history — a failing reset is a finding about that history |
| Keys | the CLI's shared local defaults (`sb_publishable_…`/`sb_secret_…`), printed by `supabase status`; not secrets |
| Storage | bundled S3-compatible endpoint (`/storage/v1/s3`), bucket `werkflow-documents-local` declared in `config.toml`; the app reaches it through the `R2_ENDPOINT` override |
| Auth posture | mirrors the cloud posture in `config.toml` (password min length 8, OTP 6 digits / 5 minutes, confirmations on); auth mail lands in Mailpit, never real inboxes. Leaked-password protection (HIBP) needs internet and has no local equivalent — the canary owns that copy |
| Edge functions | served from `supabase/functions/`; without a local `RESEND_API_KEY` the mail functions log instead of sending, which is the intended local behavior |

Operational facts for this workstation:

- Windows reaches the stack via the WSL VM's NAT address, not `localhost`: the Windows→WSL localhost relay drops connections under sustained traffic (observed 2026-08-28; mirrored networking is blocked by the corporate IPv6 policy). `bun run env:local` resolves the current WSL address and rewrites `.env.local` — rerun it after every WSL restart, and rebuild before certification because `NEXT_PUBLIC_*` values are baked into the build. The preflight fails with a clear remedy when the address is stale.
- `supabase db reset` leaves the edge-runtime container stopped (CLI 2.116.0). The preflight detects it; the remedy is `wsl docker start supabase_edge_runtime_werkflow-app`.
- Docker and the stack survive WSL restarts (systemd starts Docker; containers restart themselves), but the WSL address changes — hence the `env:local` rerun.

## Env-file ownership

`.env.local` (gitignored) is the only env file Next.js loads locally. The environment-switch scripts replace it with the selected local-stack, cloud DEV, or production backup; it does not have one permanent target. Vercel holds production's environment variables independently, so a local file change cannot affect the deployed app. `NEXT_PUBLIC_*` values are baked into each build.

Gitignored backups next to it:

- `.env.local-stack-backup` — the local test stack (normal state for harness work; `env:local` refreshes its WSL address on every switch)
- `.env.dev-backup` — the cloud dev configuration (normal state for dev-server work and canary runs)
- `.env.live-backup` — the production configuration (Supabase prod + `werkflow-documents-prod`)

All three are outside Next.js's env loading chain (only `.env`, `.env.local`, `.env.development*`, `.env.production*`, `.env.test*` are loaded), so their presence changes nothing.

Swapping:

```bash
bun run env:local  # .env.local -> local Supabase stack (golden/audit batteries)
```

```bash
bun run env:dev    # .env.local -> cloud dev backend (canary, live inspection)
```

```bash
bun run env:prod   # .env.local -> LIVE PRODUCTION backend (loud warning; no tests!)
```

Never run the Playwright harness or destructive scripts while `.env.local` points at prod. Switch back immediately after the prod-local task is done. The test preflight additionally refuses any run whose `.env.local` routing does not match the requested target, so a forgotten switch fails loudly instead of sweeping the wrong backend.

## Which tool reaches what

| Access path | Prod | Dev | Notes |
| --- | --- | --- | --- |
| claude.ai Supabase connector (OAuth, org-scoped) | read/write | read/write (since the 2026-08-20 org consolidation) | Scoped to the "WerkFlow" org, which now contains both projects. Address projects by ref; prod writes remain forbidden outside the migration rule. |
| Account-wide Supabase MCP server (`.mcp.json`) | yes | yes | Official `@supabase/mcp-server-supabase` via `npx`, authenticated by `SUPABASE_ACCESS_TOKEN` (PAT) from the shell environment. Routine writes belong on dev only. |
| Supabase CLI (`bunx supabase`) | yes (forbidden to link/push) | yes | With `SUPABASE_ACCESS_TOKEN` exported. The repo links to the **dev** ref only; never `link`/`db push` against prod. |
| Management API (`api.supabase.com`) | yes | yes | Same PAT. Used for read-only prod inspection and dev configuration. |
| R2 API tokens (S3 credentials) | prod token: prod bucket only | dev token: dev bucket only | Per-bucket account tokens since 2026-08-19: `.env.local`/`.env.dev-backup` carry the dev-scoped token, Vercel and `.env.live-backup` carry the prod-scoped one. Both are object-scoped and cannot manage bucket settings (CORS is set in the Cloudflare dashboard). |

## The migration rule

Every schema change is **a file in `supabase/migrations/` first**, and is applied **dev-first, prod-second** — via the MCP `apply_migration` or the CLI, but always both projects and always from the same committed file. Details and the repair-migration story: [decision 0003](../decisions/0003-dev-prod-environment-split.md).

- Dev: prefer `bunx supabase db push` (repo is linked to the dev ref) — it records the committed file's exact version in the remote history. MCP `apply_migration` works but stamps its own apply-time version: 23 pre-Stage-A migrations diverged that way from the committed filenames until the history was repaired by a name-keyed version update on 2026-08-28. Canary C9 now fails on any new divergence, so an MCP-applied dev migration must be followed by the same history alignment.
- Prod: MCP `apply_migration` against `jbgaqpdjauzoocplgdsn` with the identical SQL, after the change is verified on dev. Never `supabase link`/`db push` against prod. Prod's recorded history carries the same apply-time-version divergence for MCP-applied migrations; it is harmless there (nothing pushes against prod's history). **Owner decision 2026-08-28: left as-is deliberately.** The schema itself is correct; only the bookkeeping version labels differ from the committed filenames. Repair it (the same name-keyed version update that fixed dev) only when something genuinely needs prod's history by version — e.g. future CLI/CI tooling against prod — ideally folded into the next real prod migration rollout. Do not treat the divergence as a defect or "fix" it in passing.
- After a schema change: regenerate `lib/supabase/database.types.ts` (`bunx supabase gen types typescript --project-id mbkkzuqjbdvzelqvuzcn --schema public`) — dev and prod schemas are identical, so dev is the generation source.

**Latest parity checkpoint (P1-17, 2026-08-28):** migrations `20260827150000` through `20260827151400` were applied DEV-first and then identically to production. Fresh DEV-generated types exactly match `lib/supabase/database.types.ts`. Both Security Advisors returned zero findings; migration 1514 removed every new unindexed-foreign-key notice. Production retained 40 jobs and 14 projects and received zero rows in all five handover tables. Performance Advisor `unused_index` notices on the new empty tables are expected until real workload exists; they are not a reason to remove foreign-key or query-path indexes before usage data exists.

**Latest Realtime parity checkpoint (Stage C, 2026-08-29):** `bun run realtime:check` and read-only cloud inspection agree across local, DEV, and PROD. Each backend publishes 73 tables: 70 use replica identity `USING INDEX` on exactly `(id, organization_id)`, 3 use the recorded DEFAULT identity, and 0 use FULL. The `supabase_realtime` publication has INSERT, UPDATE, and DELETE enabled on all three backends.

## Per-machine onboarding checklist

1. **PAT**: create/obtain a Supabase Personal Access Token and make it available as `SUPABASE_ACCESS_TOKEN` — the exact name matters; every consumer (the committed `.mcp.json`, the CLI, `scripts/sync-dev-auth-from-prod.ts`) reads that variable and nothing reads other names. On Windows set it user-wide (`[Environment]::SetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','sbp_…','User')`, then restart the agent session so it inherits it); on Unix export it in the shell profile. It additionally lives in the gitignored `.env.local` **and both backups** (a `bun run env:dev/env:prod` swap overwrites `.env.local`, so a copy only there gets wiped), which lets `bun` scripts find it even without the user-wide variable. Never commit it.
2. **Env file**: obtain `.env.local` (dev values) from the owner's password manager / another machine; place it in the repo root. Optionally also `.env.live-backup` if prod-local sessions are expected. Copy `.env.local` to `.env.dev-backup`.
3. **Claude Code**: approve the project-scoped `.mcp.json` server on first start. Project permissions travel via git (`.claude/settings.json`); the autoMode environment note about the dev project lives in the user-level `~/.claude/settings.json`.
4. **Codex**: add the same account-wide server to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.supabase]
   command = "npx"
   args = ["-y", "@supabase/mcp-server-supabase@latest"]
   env = { "SUPABASE_ACCESS_TOKEN" = "…" }
   ```

5. **Local stack**: install Docker Engine inside WSL Ubuntu (`docker-ce` via Docker's apt repo; corporate proxies permitting), install the Supabase CLI in WSL (pinned to the version in use — 2.116.0 as of Stage A), then from the repo root in WSL: `supabase start` and `supabase db reset`. Create `.env.local-stack-backup` from another machine or from the values `supabase status` prints (the keys are shared CLI defaults; copy `SUPABASE_ACCESS_TOKEN` in from `.env.local` — a swap overwrites `.env.local`, so the PAT must live in every backup).
6. **Verify**: `bunx supabase projects list` shows both cloud projects; `bun scripts/check-r2.ts` passes the EU round-trip against the dev bucket; `bun run env:local` then `bun run test:golden:gg00` passes against the local stack.

## Escape hatches for prod work

- **Reads**: the org-scoped claude.ai connector or the account-wide MCP/Management API (read-only queries).
- **Deploys**: publishing is only `git push origin main:partner-preview` (origin/main is the production deploy branch).
- **Prod-local session**: `bun run env:prod`, do the task, `bun run env:dev`. No tests, no bulk scripts, in between.
