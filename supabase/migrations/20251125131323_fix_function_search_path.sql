-- Fix search_path for set_updated_at function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Fix search_path for add_admin_membership function
create or replace function public.add_admin_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.organization_members (user_id, organization_id, role)
  values (new.admin_id, new.id, 'admin')
  on conflict (user_id, organization_id) do nothing;
  return new;
end;
$$;
