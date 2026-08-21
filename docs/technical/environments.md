# Environments

WerkFlow runs on two fully separated backend environments since 2026-08-18 (decision [0003](../decisions/0003-dev-prod-environment-split.md)). This document is the operational reference: which project is which, who owns which env file, how tools reach each project, and how a new machine gets onboarded.

## The two backends

| | Production | Dev / Test |
| --- | --- | --- |
| Supabase project | `jbgaqpdjauzoocplgdsn` | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev") |
| Supabase org | "WerkFlow" (`svxdwqapsmvfkchswonc`) | same org since 2026-08-20 (transfer verified: refs/keys unchanged) |
| Region / compute | AWS eu-central-1, Postgres 17 | AWS eu-central-1 (same, deliberate), Postgres 17, Micro compute since 2026-08-21 |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod` | `werkflow-documents-dev` (CORS: localhost only) |
| Serves | Deployed app on Vercel, real customers | Local dev server, Playwright harness (Golden + audit) |
| Edge functions | `send-invite-email`, `send-email-change-current-otp` | Same two, deployed from `supabase/functions/` |
| Auth | Site URL `https://app.werk-flow.app`, custom SMTP via Resend (prod key) | Site URL `http://localhost:3000`, custom SMTP via Resend ("werkflow-dev" key) |

Both projects live in the one "WerkFlow" org since 2026-08-20 (the separate "WerkFlow Dev" org was deleted after the transfer). **The org is on the Pro plan since 2026-08-21**, so both projects run under Pro quotas. The same day the dev project's compute was raised from Nano to Micro (covered by the plan's compute credits, no additional cost per the owner). Practical effects: the free-tier auto-pause no longer applies to dev, the shared free egress cap is gone, and harness runs are faster than the Nano-era baselines recorded in [testing.md](testing.md) — re-baseline durations on the next full run before reading a slow run as a regression.

**Auth/config parity:** project configuration (auth email templates, SMTP, rate limits) is not schema and is not covered by migrations or the decision-0003 object comparison. `bun scripts/sync-dev-auth-from-prod.ts` diffs the complete auth config of both projects and with `--apply` syncs the `mailer_*` fields prod → dev (this fixed the 2026-08-20 gap where dev sent confirmation links instead of the app's 6-digit OTP). Run the diff after any dashboard-side auth change on prod.

## Env-file ownership

`.env.local` (gitignored) is the only env file Next.js loads locally, and it points at **dev**. Vercel holds production's environment variables independently — no local file change can ever affect deployed behavior (NEXT_PUBLIC_* values are baked at build time per deployment).

Gitignored backups next to it:

- `.env.dev-backup` — the dev configuration (normal state of `.env.local`)
- `.env.live-backup` — the production configuration (Supabase prod + `werkflow-documents-prod`)

Both are outside Next.js's env loading chain (only `.env`, `.env.local`, `.env.development*`, `.env.production*`, `.env.test*` are loaded), so their presence changes nothing.

Swapping (the deliberate escape hatch for rare prod-local sessions):

```bash
bun run env:dev    # .env.local -> dev backend (normal state)
bun run env:prod   # .env.local -> LIVE PRODUCTION backend (loud warning; no tests!)
```

Never run the Playwright harness or destructive scripts while `.env.local` points at prod. Switch back immediately after the prod-local task is done.

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

- Dev: `bunx supabase db push` (repo is linked to the dev ref), or MCP `apply_migration` against `mbkkzuqjbdvzelqvuzcn`.
- Prod: MCP `apply_migration` against `jbgaqpdjauzoocplgdsn` with the identical SQL, after the change is verified on dev. Never `supabase link`/`db push` against prod.
- After a schema change: regenerate `lib/supabase/database.types.ts` (`bunx supabase gen types typescript --project-id mbkkzuqjbdvzelqvuzcn --schema public`) — dev and prod schemas are identical, so dev is the generation source.

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

5. **Verify**: `bunx supabase projects list` shows both projects; `bun scripts/check-r2.ts` passes the EU round-trip against the dev bucket; `bun run test:golden:gg00` passes 13/13.

## Escape hatches for prod work

- **Reads**: the org-scoped claude.ai connector or the account-wide MCP/Management API (read-only queries).
- **Deploys**: publishing is only `git push origin main:partner-preview` (origin/main is the production deploy branch).
- **Prod-local session**: `bun run env:prod`, do the task, `bun run env:dev`. No tests, no bulk scripts, in between.
