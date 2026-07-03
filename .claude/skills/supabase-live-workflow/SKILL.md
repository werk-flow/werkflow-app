---
name: supabase-live-workflow
description: Use for Supabase-related work in this WerkFlow repo: database schema/state inspection, SQL, auth, RLS, storage, edge functions, project metadata, generated types, or any task where live Supabase state matters. Prefer MCP/plugin inspection and direct SQL workflows; do not add migration files unless the user explicitly asks for a migration-based workflow.
---

# Supabase Live Workflow

Use this workflow for Supabase-sensitive work in WerkFlow. The live Supabase project is the operational source of truth for schema, auth, RLS, storage, edge functions, and project state.

## Required Workflow

1. Use the Supabase MCP server/plugin when live project state matters. Inspect the real project before making schema-aware claims or edits.
2. Prefer MCP/project inspection over guessing from app code or older architecture docs.
3. For SQL or schema changes, prefer direct Supabase MCP operations such as SQL execution and project inspection.
4. Use Supabase plugin/skill guidance for Supabase-specific best practices, auth/security considerations, and current product behavior.
5. When schema changes affect app code, update the relevant TypeScript/generated-type usage so the repo stays aligned with the live Supabase state.

## Migration-File Policy

- Do not create a local `supabase/` directory, migration files, or seed files as part of normal Supabase work in this repo.
- Do not propose a migration-first workflow by default.
- Do not tell the user to manage schema changes through migration files unless they explicitly ask to change the team workflow.

Allowed exceptions:

- The user explicitly asks to introduce or adopt migration files.
- The user explicitly asks for a local `supabase/` project structure or migration-based workflow.
- The task is purely frontend/application logic and does not depend on current Supabase state.

## Verification

- Ground database-related claims in actual Supabase inspection when needed.
- Confirm live auth, RLS, table, branch, function, or storage state before relying on it.
- After Supabase-sensitive changes, verify the relevant behavior with MCP/plugin queries or the most direct available check.
