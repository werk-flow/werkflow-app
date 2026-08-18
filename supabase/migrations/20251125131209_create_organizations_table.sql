-- Generic updated_at trigger function
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Organizations table
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admin_id uuid not null references auth.users(id) on delete restrict,
  unique_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index on admin_id for faster lookups
create index if not exists idx_organizations_admin_id on public.organizations(admin_id);

-- Trigger to auto-update updated_at on row changes
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();
