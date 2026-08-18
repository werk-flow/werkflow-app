# Environments

WerkFlow runs on two fully separated backend environments since 2026-08-18 (decision [0003](../decisions/0003-dev-prod-environment-split.md)). This document is the operational reference: which project is which, who owns which env file, how tools reach each project, and how a new machine gets onboarded.

## The two backends

| | Production | Dev / Test |
| --- | --- | --- |
| Supabase project | `jbgaqpdjauzoocplgdsn` | `mbkkzuqjbdvzelqvuzcn` ("WerkFlow App Dev") |
| Supabase org | "WerkFlow" (`svxdwqapsmvfkchswonc`) | "WerkFlow Dev" (`sptlkyimyrrmthjezafx`) |
| Region / compute | AWS eu-central-1, Postgres 17 | AWS eu-central-1 (same, deliberate), Postgres 17, free tier NANO |
| R2 bucket (EU jurisdiction) | `werkflow-documents-prod` | `werkflow-documents-dev` (CORS: localhost only) |
| Serves | Deployed app on Vercel, real customers | Local dev server, Playwright harness (Golden + audit) |
| Edge functions | `send-invite-email`, `send-email-change-current-otp` | Same two, deployed from `supabase/functions/` |
| Auth | Site URL `https://app.werk-flow.app`, custom SMTP via Resend (prod key) | Site URL `http://localhost:3000`, custom SMTP via Resend ("werkflow-dev" key) |

Orgs are separate because Supabase plans are per-org: prod's org can move to Pro without dragging the dev project onto a paid plan.

The dev project is on the free tier and **auto-pauses after roughly a week of inactivity**. Symptoms: local app/harness cannot connect, `db push` fails. Fix: restore the project in the Supabase dashboard, wait a minute, retry. Not a code bug.

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
| claude.ai Supabase connector (OAuth, org-scoped) | read/write | **no access** | Scoped to the "WerkFlow" org only; it cannot see the dev project. Use for prod reads. |
| Account-wide Supabase MCP server (`.mcp.json`) | yes | yes | Official `@supabase/mcp-server-supabase` via `npx`, authenticated by `SUPABASE_ACCESS_TOKEN` (PAT) from the shell environment. Routine writes belong on dev only. |
| Supabase CLI (`bunx supabase`) | yes (forbidden to link/push) | yes | With `SUPABASE_ACCESS_TOKEN` exported. The repo links to the **dev** ref only; never `link`/`db push` against prod. |
| Management API (`api.supabase.com`) | yes | yes | Same PAT. Used for read-only prod inspection and dev configuration. |
| R2 API token (in `.env.local`) | object read/write | object read/write | Object-scoped: it cannot manage bucket settings (CORS is set in the Cloudflare dashboard). |

## The migration rule

Every schema change is **a file in `supabase/migrations/` first**, and is applied **dev-first, prod-second** — via the MCP `apply_migration` or the CLI, but always both projects and always from the same committed file. Details and the repair-migration story: [decision 0003](../decisions/0003-dev-prod-environment-split.md).

- Dev: `bunx supabase db push` (repo is linked to the dev ref), or MCP `apply_migration` against `mbkkzuqjbdvzelqvuzcn`.
- Prod: MCP `apply_migration` against `jbgaqpdjauzoocplgdsn` with the identical SQL, after the change is verified on dev. Never `supabase link`/`db push` against prod.
- After a schema change: regenerate `lib/supabase/database.types.ts` (`bunx supabase gen types typescript --project-id mbkkzuqjbdvzelqvuzcn --schema public`) — dev and prod schemas are identical, so dev is the generation source.

## Per-machine onboarding checklist

1. **PAT**: create/obtain a Supabase Personal Access Token and export it in the shell profile: `export SUPABASE_ACCESS_TOKEN=sbp_…` (never commit it; the committed `.mcp.json` expands it from the environment).
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
