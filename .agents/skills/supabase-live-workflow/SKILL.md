---
name: supabase-live-workflow
description: Use for Supabase-related work in this WerkFlow repo: database schema/state inspection, SQL, auth, RLS, storage, edge functions, project metadata, generated types, or any task where live Supabase state matters. Covers the two cloud projects (prod + dev) plus the local test stack, which tool reaches which backend, and the dev-first migration rule.
---

# Supabase live workflow

[Environments](../../../docs/technical/environments.md) owns the facts: the two cloud projects, the local test stack, `.env.local` and the `env:*` switches, which tool reaches which backend, work on PROD, and the migration rule. Read it before any Supabase work.

## Steps

1. Inspect the real project before a schema claim or edit. A claim about PROD needs a PROD read. DEV and the migration files do not stand in for it.
2. Prefer MCP inspection over guesses from app code or old docs.
3. Before a migration, read the migration rule in [environments](../../../docs/technical/environments.md). For a new table, also follow [security](../../../docs/technical/security.md).
4. After a schema change, run `bun run types:generate`. `bun run types:check` fails while `lib/supabase/database.types.ts` is stale.
5. Deploy an edge function from `supabase/functions/` with `bunx supabase functions deploy <slug> --project-ref <ref> --no-verify-jwt --use-api`.
6. Verify on DEV first with MCP queries or the most direct check. Run the SQL group that owns the change (`bun run test:verify --group sql:<name>`). `lib/testing/selection/test-groups.ts` lists each group's files.

## Compare DEV and PROD

No guard compares the two cloud catalogs. Matching migration names and generated types miss a changed function body. To compare, run read-only queries through MCP `execute_sql` on both: `pg_class` (with the RLS flag), `pg_policies`, `pg_proc` with `pg_get_functiondef`, `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_trigger`, `pg_publication_tables`, `supabase_migrations.schema_migrations`. Match by schema-qualified name. Normalize whitespace and comments before you call a differing body formatting. `supabase/tests/security_boundaries.sql` holds the function and ACL queries.
