-- Drop and recreate the get_org_members function with proper column qualification
drop function if exists public.get_org_members(uuid);

create or replace function public.get_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  role public.org_role,
  joined_at timestamptz
) language plpgsql security definer set search_path = public as $$
begin
  -- ensure caller is a member of the org
  if not exists (
    select 1 from public.organization_members om
    where om.user_id = auth.uid() and om.organization_id = p_org_id
  ) then
    raise exception 'not_authorized';
  end if;

  return query
    select m.user_id,
           coalesce(p.first_name, '')::text,
           coalesce(p.last_name, '')::text,
           u.email::text,
           m.role,
           m.joined_at
    from public.organization_members m
    left join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_org_id
    order by m.joined_at desc;
end;$$;
