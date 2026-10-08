---
name: supabase-live-workflow
description: Use for Supabase-related work in this WerkFlow repo: database schema/state inspection, SQL, auth, RLS, storage, edge functions, project metadata, generated types, or any task where live Supabase state matters. Covers the two cloud projects (prod + dev) plus the local test stack, which tool reaches which backend, and the dev-first migration rule.
---

# Supabase Live Workflow

WerkFlow runs two cloud Supabase projects and a local stack. [Environments](../../../docs/technical/environments.md) owns their facts. Read it before any Supabase work, and do not restate its facts here or elsewhere:

- [The two cloud backends](../../../docs/technical/environments.md#the-two-cloud-backends): project refs, what each one serves, provider configuration.
- [The local test stack](../../../docs/technical/environments.md#the-local-test-stack): the default backend of the application test groups.
- [Env-file ownership](../../../docs/technical/environments.md#env-file-ownership): which backend `.env.local` points at, and the `env:*` switches.
- [Which tool reaches what](../../../docs/technical/environments.md#which-tool-reaches-what): MCP, the CLI and psql per backend.
- [Work on production](../../../docs/technical/environments.md#work-on-production): reads, releases and a production-local session.

## Required workflow

1. Inspect the real project before you make a schema-aware claim or edit. Inspect production for a production-state claim. Dev and the migration files describe their own state and the intended rollout. They do not replace a production parity check.
2. Prefer MCP or project inspection over guesses from app code or older architecture docs.
3. When a schema change affects app code, run `bun run types:generate`. It reads dev, covers the `graphql_public` and `public` schemas, and uses the pinned tools in `package.json`. `bun run types:check` fails when the committed `lib/supabase/database.types.ts` differs from a fresh generation.

## The migration rule

[The migration rule](../../../docs/technical/environments.md#the-migration-rule) has one home. Read it before you write or apply a migration. For a new table, also follow "Add a table" in the [security control map](../../../docs/technical/security.md#add-a-table).

## Edge functions

Sources are versioned in `supabase/functions/`. Deploy one with `bunx supabase functions deploy <slug> --project-ref <ref> --no-verify-jwt --use-api`.

## Verification

- Ground a database claim in live Supabase inspection when it matters.
- Confirm live auth, RLS, table, function or storage state before you rely on it.
- After a Supabase-sensitive change, verify the behavior with MCP queries or the most direct available check, on dev first.
- Run the guards in [Verify your work](../../../docs/technical/security.md#verify-your-work) of the security control map, and the SQL group that owns the change (for example `bun run test:verify --group sql:p1-24`). `lib/testing/selection/test-groups.ts` is the only list of a group's SQL files.

## Parity check between DEV and PROD

None of the guards above compares the two cloud catalogs, and matching migration names or identical generated types do not detect a changed function body. To compare the projects, run read-only catalog queries on each through MCP `execute_sql`: `pg_class` (tables and their RLS flag), `pg_policies`, `pg_proc` with `pg_get_functiondef`, `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_publication_tables`, and `supabase_migrations.schema_migrations`. Compare by schema-qualified object identity, and normalize whitespace and comments before you dismiss a differing function body as formatting. `supabase/tests/security_boundaries.sql` holds the function-definition and ACL part of these queries, and `canary:security` repeats the grant comparison on DEV. Record the result in the slice or cross-slice record. [The migration rule](../../../docs/technical/environments.md#the-migration-rule) explains why no gate does this automatically.
