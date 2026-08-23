---
name: supabase-live-workflow
description: Use for Supabase-related work in this WerkFlow repo: database schema/state inspection, SQL, auth, RLS, storage, edge functions, project metadata, generated types, or any task where live Supabase state matters. Covers the two-project model (prod + dev), which tool reaches which project, and the dev-first migration rule.
---

# Supabase Live Workflow

WerkFlow runs on **two** Supabase projects since 2026-08-18 (decision `docs/decisions/0003-dev-prod-environment-split.md`; operational reference `docs/technical/environments.md`):

- **Prod** `jbgaqpdjauzoocplgdsn` — real customers, serves the deployed Vercel app. Treat as read-only outside the migration rule below.
- **Dev** `mbkkzuqjbdvzelqvuzcn` — local dev and the entire Playwright harness. Routine-write territory. Both projects run under the org's Pro plan since 2026-08-21, so dev does not auto-pause; the current plan/compute posture lives in `docs/technical/environments.md`.

`.env.local` points at dev. Schemas are kept identical through the shared migration history in `supabase/migrations/`.

## Which tool reaches what

| Access path | Prod | Dev |
| --- | --- | --- |
| claude.ai Supabase connector (org-scoped OAuth) | read/write | read/write (both projects share one org since 2026-08-20) |
| Account-wide Supabase MCP server (`.mcp.json`, PAT via `SUPABASE_ACCESS_TOKEN`) | yes | yes |
| Supabase CLI `bunx supabase` (PAT exported) | yes — but never `link`/`db push` | yes (repo links to dev ref) |
| Management API `api.supabase.com` (PAT) | yes | yes |

## Required Workflow

1. Inspect the real project before making schema-aware claims or edits. **Prod is the source of truth for production state; dev mirrors it via `supabase/migrations/`.** For schema questions, dev inspection or the migration files are equivalent to prod (fidelity is maintained by the migration rule).
2. Prefer MCP/project inspection over guessing from app code or older architecture docs.
3. When schema changes affect app code, regenerate `lib/supabase/database.types.ts` **from dev** (`bunx supabase gen types typescript --project-id mbkkzuqjbdvzelqvuzcn --schema public`) so the repo stays aligned.

## The Migration Rule

Every schema change:

1. **Is a committed file** in `supabase/migrations/<version>_<name>.sql` — no ad-hoc DDL that lives only in a database.
2. **Applies dev-first, prod-second** — via MCP `apply_migration` or the CLI, but always both projects, always the same SQL. Verify on dev (types, tests) before touching prod.

Forbidden: `supabase link` or `db push` against prod; schema changes on prod that have no migration file; running tests or bulk scripts while `.env.local` points at prod (`bun run env:prod` sessions are a deliberate, temporary exception — switch back with `bun run env:dev`).

The four `*baseline*` repair migrations reconcile pre-split unrecorded drift; they are idempotent no-ops on prod and must never be edited to change history semantics.

## Edge Functions

Sources are versioned in `supabase/functions/` and deployed with `bunx supabase functions deploy <slug> --project-ref <ref> --no-verify-jwt --use-api`. Dev's secret store holds the dev Resend key (`RESEND_API_KEY`, `FROM_EMAIL`); prod's Resend key is prod-only.

## Verification

- Ground database-related claims in actual Supabase inspection when needed.
- Confirm live auth, RLS, table, function, or storage state before relying on it.
- After Supabase-sensitive changes, verify the relevant behavior with MCP queries or the most direct available check — on dev first.
