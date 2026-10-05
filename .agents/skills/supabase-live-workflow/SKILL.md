---
name: supabase-live-workflow
description: Use for Supabase-related work in this WerkFlow repo: database schema/state inspection, SQL, auth, RLS, storage, edge functions, project metadata, generated types, or any task where live Supabase state matters. Covers the two cloud projects (prod + dev) plus the local test stack, which tool reaches which backend, and the dev-first migration rule.
---

# Supabase Live Workflow

WerkFlow runs two cloud Supabase projects plus a local stack. Project IDs, plan and compute posture, per-backend configuration, and which tool reaches which backend live in `docs/technical/environments.md`; read it before any Supabase work and do not restate its facts elsewhere.

- **Prod** serves the deployed Vercel app and real customers. Treat as read-only outside the migration rule.
- **Dev** supports local development, the cloud canary, and explicitly scoped provider checks. Routine wave and release verification uses the local release plan plus the cloud canary under decision 0007. Read `docs/technical/testing.md` for selection and acceptance.
- **Local stack** (WSL Docker, `supabase db reset` over the committed migrations) is the default backend for application test groups. Reached through the Supabase CLI in WSL and direct psql, not through MCP.

`.env.local` has no permanent target: `bun run env:local` / `env:dev` / `env:prod` switch it between the three backends. The shared migration history in `supabase/migrations/` is intended to keep schemas aligned. Verify live parity rather than inferring it from shared filenames.

## Required workflow

1. Inspect the real project before making schema-aware claims or edits. Inspect production for production-state claims. Dev and the migration files describe their own state and intended rollout; they are not substitutes for a production parity check.
2. Prefer MCP or project inspection over guessing from app code or older architecture docs.
3. When a schema change affects app code, run `bun run types:generate`. It reads dev, covers the `graphql_public` and `public` schemas, and uses the pinned tools in `package.json`. `bun run types:check` fails when the committed `lib/supabase/database.types.ts` differs from a fresh generation.

## The migration rule

`docs/technical/environments.md` ("The migration rule") is the one home of the rule. Read it before you write or apply a migration. Do not restate it here or anywhere else.

A migration that creates a table also follows the table item of the checklist in `docs/technical/security.md`: RLS, policies and explicit grants in the same file. A new table that feeds the period calculation also gets the closed-period trigger, and `sql:closed-period-writes` covers it. `bun run test:verify --group sql:security` fails on a table that misses them.

Never run tests or bulk scripts while `.env.local` points at prod. A `bun run env:prod` session is a deliberate, temporary exception. Switch back with `bun run env:dev`.

## Edge functions

Sources are versioned in `supabase/functions/` and deployed with `bunx supabase functions deploy <slug> --project-ref <ref> --no-verify-jwt --use-api`. Each project's secret store holds its own Resend key; the prod key never leaves prod.

## Verification

- Ground database-related claims in actual Supabase inspection when needed.
- Confirm live auth, RLS, table, function, or storage state before relying on it.
- After Supabase-sensitive changes, verify the relevant behavior with MCP queries or the most direct available check, on dev first.
- Run the guards that cover the change: `bun run migrations:check` (dev history matches the committed files), `bun run types:check`, `bun run realtime:check` (publication and replica-identity parity), and the SQL groups that own the change (`bun run test:verify --group sql:p1-24`, `sql:security`, `sql:list-pagination`); the registry in `lib/testing/selection/test-groups.ts` is the only list of a group's SQL files.

## Parity check between DEV and PROD

None of the guards above compares the two cloud catalogs, and matching migration names or identical generated types do not detect a changed function body. To compare the projects, run read-only catalog queries on each through MCP `execute_sql`: `pg_class` (tables and their RLS flag), `pg_policies`, `pg_proc` with `pg_get_functiondef`, `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_publication_tables`, and `supabase_migrations.schema_migrations`. Compare by schema-qualified object identity, and normalize whitespace and comments before dismissing a differing function body as formatting. `supabase/tests/security_boundaries.sql` holds the function-definition and ACL part of these queries, and `canary:security` repeats the grant comparison on DEV. Record the result in the slice or cross-slice record; `docs/technical/environments.md` explains why no gate does this automatically.
