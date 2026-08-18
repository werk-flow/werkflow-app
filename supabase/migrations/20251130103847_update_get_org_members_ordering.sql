-- Update get_org_members RPC to order by role hierarchy, then by last_name
-- Role hierarchy: admin > manager > accountant > secretary > employee

CREATE OR REPLACE FUNCTION get_org_members(p_org_id uuid)
RETURNS TABLE (
  user_id uuid,
  first_name text,
  last_name text,
  email text,
  role org_role,
  joined_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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
    order by 
      -- Role hierarchy ordering: admin=1, manager=2, accountant=3, secretary=4, employee=5
      case m.role
        when 'admin' then 1
        when 'manager' then 2
        when 'accountant' then 3
        when 'secretary' then 4
        when 'employee' then 5
        else 6
      end,
      -- Then alphabetically by last_name
      coalesce(p.last_name, '') asc,
      coalesce(p.first_name, '') asc;
end;
$$;