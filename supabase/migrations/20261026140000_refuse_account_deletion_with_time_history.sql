-- Deleting an Auth user cascades to its memberships and its legacy time
-- entries. Member removal already refuses a member with recorded time
-- (migration 20260906221500); this guard holds the same rule for the account
-- deletion path, whichever caller deletes the Auth user. It fires before every
-- cascade, so it still sees the rows the cascade would remove. A deleted
-- organization takes its memberships and time with it, so a former member of
-- one passes.

create function app_private.refuse_deleting_member_with_time_history()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if exists (
    select 1 from public.organization_members membership
    where membership.user_id = old.id
      and (
        exists (
          select 1 from public.time_entries entry
          where entry.organization_id = membership.organization_id
            and entry.user_id = old.id
        )
        or exists (
          select 1 from public.time_sessions session
          where session.organization_id = membership.organization_id
            and session.user_id = old.id
        )
      )
  ) then raise exception 'account_deletion_member_has_time_history'; end if;
  return old;
end;
$$;

revoke all on function app_private.refuse_deleting_member_with_time_history()
  from public, anon, authenticated, service_role;

create trigger refuse_deleting_member_with_time_history
  before delete on auth.users
  for each row execute function app_private.refuse_deleting_member_with_time_history();
