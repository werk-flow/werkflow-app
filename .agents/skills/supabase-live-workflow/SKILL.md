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
4. With a migration, run `bun run types:generate -- --local`: it writes the types of this tree's migrations and never changes the shared stack. CI fails while `lib/supabase/database.types.ts` is stale.
5. Deploy an edge function from `supabase/functions/` with `bunx supabase functions deploy <slug> --project-ref <ref> --no-verify-jwt --use-api`.
6. Verify on DEV first with MCP queries or the most direct check. Run the SQL group that owns the change (`bun run test:verify --group sql:<name>`). `lib/testing/selection/test-groups.ts` lists each group's files.

## The shared local stack

Every worktree of a workstation tests against one local stack. It holds `main`'s merged migrations and nothing else, so no branch applies its own migration there.

- With a migration in your tree, `bun run test:verify` runs the SQL and browser groups on a fresh Boat stack, and `bun run types:generate -- --local` writes the types without changing the shared database.
- `bun run stack:sync` applies `origin/main`'s pending migrations under the exclusive stack lock, from any worktree on any branch. Every SQL and browser run holds that lock shared, so a sync never migrates under one; it takes no workspace lock, which guards only one checkout. The worktree setup and `check:changed` run it and never wait for a run that holds the stack.
- A trigger on the stack's migration ledger refuses every other writer, so `supabase migration up`, `db push --local` and `migration repair --local` fail and roll back, in any shell and on any branch. A hook refuses them, a raw `supabase db reset` and `psql` with a migration file before they start.
- `check:changed` fails while the stack holds a migration `main` lacks. Only a reset repairs that: tell your lead.

### Reset the shared stack

A reset deletes what every worktree on the machine keeps in the stack: retained test worlds, the lab world, storage objects, auth users and captured mail.

1. Announce it on the coordination issue, with the machine and the time.
2. Wait until no run holds the stack. The command refuses while one does and names it.
3. Run `bun run stack:reset -- --destroy-test-data`. It rebuilds the database from `origin/main`'s migrations and installs the ledger trigger.
4. Check that `bun run stack:sync` prints `The shared stack is at main`.
5. Each worktree's next run seeds its own world. A run retained for diagnosis has lost its world: diagnose from its trace. Seed the owner's demo data again if you use it (`bun scripts/seed-demo-data.ts --target local`).

## Compare DEV and PROD

Matching migration names and generated types miss a changed function body. Run `bun run prod:inspect` from an up-to-date `main`. It lists the versions waiting for a release, every relation, column, constraint, index, trigger, policy, function, enum and published table whose definition differs between the projects, by name only, and PROD's advisor findings. Drift is expected only for objects the pending migrations touch. To see how a named object differs, read its definition on DEV through MCP and in the migration files; never read PROD's.
