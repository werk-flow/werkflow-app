-- A record names the people who created or last changed it. A reader shows a
-- person who has left the organization by name only (toProfileReference in
-- lib/profile-reference.ts), so it needs each person's profile together with
-- whether they are still a member of the record's organization.
-- organization_members has no foreign key to profiles, so PostgREST cannot
-- embed one in the other; two reads cost every hydration a second request.
-- list_profile_references returns both in one read: the profile columns and
-- is_member for the given organization. The rule itself stays in TypeScript.
--
-- Service-role only: the caller resolves the organization first and passes
-- the people its own rows name.

create function public.list_profile_references(
  p_organization_id uuid,
  p_user_ids uuid[]
) returns table (
  id uuid,
  first_name text,
  last_name text,
  email text,
  avatar_path text,
  is_member boolean
)
language sql stable security invoker set search_path = '' as $$
  select
    profile.id,
    profile.first_name,
    profile.last_name,
    profile.email,
    profile.avatar_path,
    exists (
      select 1
      from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = profile.id
    )
  from public.profiles profile
  where profile.id = any (p_user_ids)
  order by profile.id
$$;

revoke all on function public.list_profile_references(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.list_profile_references(uuid, uuid[]) to service_role;
