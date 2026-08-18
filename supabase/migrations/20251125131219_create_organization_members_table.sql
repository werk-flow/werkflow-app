-- Organization members table (many-to-many users <-> organizations with role)
create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role public.org_role not null default 'employee',
  joined_at timestamptz not null default now(),
  constraint organization_members_unique unique (user_id, organization_id)
);

-- Indexes for efficient lookups
create index if not exists idx_org_members_user on public.organization_members(user_id);
create index if not exists idx_org_members_org on public.organization_members(organization_id);

-- Auto-insert admin membership after creating an organization
create or replace function public.add_admin_membership()
returns trigger
language plpgsql
as $$
begin
  insert into public.organization_members (user_id, organization_id, role)
  values (new.admin_id, new.id, 'admin')
  on conflict (user_id, organization_id) do nothing;
  return new;
end;
$$;

-- Trigger to auto-add admin as member when organization is created
create trigger organizations_after_insert
after insert on public.organizations
for each row execute function public.add_admin_membership();
