---
name: supabase-live-workflow
description: Use for Supabase-related work in this WerkFlow repo: database schema/state inspection, SQL, auth, RLS, storage, edge functions, project metadata, generated types, or any task where live Supabase state matters. Covers the two cloud projects (prod + dev) plus the local test stack, which tool reaches which backend, and the dev-first migration rule.
---

# Supabase Live Workflow

WerkFlow runs two cloud Supabase projects plus a local stack. Project IDs, plan and compute posture, per-backend configuration, and which tool reaches which backend live in `docs/technical/environments.md`; read it before any Supabase work and do not restate its facts elsewhere.

- **Prod** serves the deployed Vercel app and real customers. Treat as read-only outside the migration rule below.
- **Dev** is routine-write territory: local development, the cloud canary suite, and wave-end cloud batteries.
- **Local stack** (WSL Docker, `supabase db reset` over the committed migrations) is the default backend for the Golden and audit batteries. Reached through the Supabase CLI in WSL and direct psql, not through MCP.

`.env.local` has no permanent target: `bun run env:local` / `env:dev` / `env:prod` switch it between the three backends. Schemas stay identical through the shared migration history in `supabase/migrations/`.

## Required workflow

1. Inspect the real project before making schema-aware claims or edits. Prod is the source of truth for production state; dev mirrors it through `supabase/migrations/`, so for schema questions dev inspection or the migration files are equivalent to prod.
2. Prefer MCP or project inspection over guessing from app code or older architecture docs.
3. When a schema change affects app code, run `bun run types:generate`. It reads dev, covers the `graphql_public` and `public` schemas, and formats with pinned Supabase 2.116.0 and Prettier 3.6.2. `bun run types:check` fails when the committed `lib/supabase/database.types.ts` differs from a fresh generation.

## The migration rule

Every schema change:

1. **Is a committed file** in `supabase/migrations/<version>_<name>.sql`. No ad-hoc DDL that lives only in a database.
2. **Applies dev-first, prod-second**, always both projects, always the same SQL. Verify on dev (types, tests) before touching prod.
3. **Goes to dev through `bunx supabase db push`** (the repo is linked to the dev ref), because it records the committed file's exact version in the remote history. MCP `apply_migration` stamps its own apply-time version, and canary C9 fails on that divergence, so an MCP-applied dev migration must be followed by the history alignment described in `docs/technical/environments.md` ("The migration rule").
4. **Goes to prod through MCP `apply_migration`** with the identical SQL. Never `supabase link` or `db push` against prod.

Also forbidden: schema changes on prod that have no migration file, and running tests or bulk scripts while `.env.local` points at prod (`bun run env:prod` sessions are a deliberate, temporary exception; switch back with `bun run env:dev`).

The four `*baseline*` repair migrations reconcile pre-split unrecorded drift; they are idempotent no-ops on prod and must never be edited to change history semantics.

## Edge functions

Sources are versioned in `supabase/functions/` and deployed with `bunx supabase functions deploy <slug> --project-ref <ref> --no-verify-jwt --use-api`. Each project's secret store holds its own Resend key; the prod key never leaves prod.

## Verification

- Ground database-related claims in actual Supabase inspection when needed.
- Confirm live auth, RLS, table, function, or storage state before relying on it.
- After Supabase-sensitive changes, verify the relevant behavior with MCP queries or the most direct available check, on dev first.
- Run the guards that cover the change: `bun run migrations:check` (dev history matches the committed files), `bun run types:check`, `bun run realtime:check` (publication and replica-identity parity), and the slice's SQL assertions (`bun run test:sql:p12N`, for example `test:sql:p124`).
