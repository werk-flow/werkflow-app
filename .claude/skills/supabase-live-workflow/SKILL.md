---
name: supabase-live-workflow
description: Use for Supabase-related work in this WerkFlow repo: database schema/state inspection, SQL, auth, RLS, storage, edge functions, project metadata, generated types, or any task where live Supabase state matters. Covers the two cloud projects (prod + dev) plus the local test stack, which tool reaches which backend, and the dev-first migration rule.
---

# Supabase live workflow

[Environments](../../../docs/technical/environments.md) owns the facts: the two cloud projects, the local test stack, `.env.local` and the `env:*` switches, which tool reaches which backend, work on PROD, and the migration rule. Read it before any Supabase work.

## Steps

1. Inspect the real project before a schema claim or edit. A claim about PROD needs `bun run prod:inspect`; DEV and the migration files do not stand in for it.
2. Inspect DEV through the MCP server `supabase` rather than guess from app code or old docs. Agents read no PROD data through any tool, because every tool result goes to the model provider. The one exception is `bun run prod:inspect`, which returns metadata only. The hook enforces this for MCP calls only.
3. Before a migration, read the migration rule in [environments](../../../docs/technical/environments.md). For a new table, also follow [security](../../../docs/technical/security.md).
4. After a schema change, run `bun run types:generate`. `bun run types:check` fails while `lib/supabase/database.types.ts` is stale.
5. Deploy an edge function from `supabase/functions/` with `bunx supabase functions deploy <slug> --project-ref <ref> --no-verify-jwt --use-api`.
6. Verify on DEV first with MCP queries or the most direct check. Run the SQL group that owns the change (`bun run test:verify --group sql:<name>`). `lib/testing/selection/test-groups.ts` lists each group's files.

## Compare DEV and PROD

Matching migration names and generated types miss a changed function body. Run `bun run prod:inspect` from an up-to-date `main`. It lists the versions waiting for a release, every relation, column, constraint, index, trigger, policy, function, enum and published table whose definition differs between the projects, by name only, and PROD's advisor findings. Drift is expected only for objects the pending migrations touch. To see how a named object differs, read its definition on DEV through MCP and in the migration files; never read PROD's.
