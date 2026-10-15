-- profiles.email mirrors the Auth account's address. Only the Auth trigger
-- (app_private.sync_profile_email_from_auth_user, which runs as definer) and
-- the audited email-change flow on the server write it. A signed-in user
-- edits their own name and avatar through the RLS client (lib/settings/actions.ts),
-- so the client role keeps UPDATE on exactly those columns and nothing else:
-- no INSERT (the trigger creates the row), no DELETE (the account deletion
-- removes it), no UPDATE of id, email or created_at. Migration
-- 20261015100100 removed the table-level write grants.
grant update (first_name, last_name, avatar_path, updated_at) on table public.profiles to authenticated;
