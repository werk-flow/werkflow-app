-- P1-01: customer contacts and work sites (additive).
-- clients gains an optional org-unique customer number; two new org-scoped
-- tables hold contact people and durable work sites; jobs/projects gain
-- nullable references. jobs.location stays as the historical text snapshot.

alter table public.clients add column customer_number text;

create unique index clients_customer_number_per_org
  on public.clients (organization_id, lower(customer_number))
  where customer_number is not null;

create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  role text,
  email text,
  phone text,
  notes text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_contacts_client_id_idx on public.client_contacts (client_id);
create index client_contacts_organization_id_idx on public.client_contacts (organization_id);

create table public.client_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  street text,
  postal_code text,
  city text,
  access_notes text,
  notes text,
  primary_contact_id uuid references public.client_contacts(id) on delete set null,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index client_sites_client_id_idx on public.client_sites (client_id);
create index client_sites_organization_id_idx on public.client_sites (organization_id);

alter table public.jobs
  add column site_id uuid references public.client_sites(id) on delete set null,
  add column contact_id uuid references public.client_contacts(id) on delete set null;

create index jobs_site_id_idx on public.jobs (site_id);

alter table public.projects
  add column site_id uuid references public.client_sites(id) on delete set null,
  add column contact_id uuid references public.client_contacts(id) on delete set null;

-- updated_at maintenance follows the existing convention.
create trigger client_contacts_updated_at
  before update on public.client_contacts
  for each row execute function update_updated_at_column();

create trigger client_sites_updated_at
  before update on public.client_sites
  for each row execute function update_updated_at_column();

-- Organization/client consistency. Validation only runs when the linked
-- columns actually change (lesson from the document-folder triggers:
-- unconditional revalidation makes unrelated updates order-dependent).
create or replace function app_private.validate_client_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or old.client_id is distinct from new.client_id
     or old.organization_id is distinct from new.organization_id then
    if not exists (
      select 1 from public.clients c
      where c.id = new.client_id and c.organization_id = new.organization_id
    ) then
      raise exception 'client_contact organization mismatch';
    end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_client_site()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or old.client_id is distinct from new.client_id
     or old.organization_id is distinct from new.organization_id then
    if not exists (
      select 1 from public.clients c
      where c.id = new.client_id and c.organization_id = new.organization_id
    ) then
      raise exception 'client_site organization mismatch';
    end if;
  end if;

  if new.primary_contact_id is not null and (
       tg_op = 'INSERT'
       or old.primary_contact_id is distinct from new.primary_contact_id
       or old.client_id is distinct from new.client_id
     ) then
    if not exists (
      select 1 from public.client_contacts cc
      where cc.id = new.primary_contact_id and cc.client_id = new.client_id
    ) then
      raise exception 'client_site primary contact belongs to another client';
    end if;
  end if;
  return new;
end;
$$;

create trigger client_contacts_validate
  before insert or update on public.client_contacts
  for each row execute function app_private.validate_client_contact();

create trigger client_sites_validate
  before insert or update on public.client_sites
  for each row execute function app_private.validate_client_site();

-- RLS follows the clients pattern: org members read, writes go through
-- service-role server actions with in-code role checks.
alter table public.client_contacts enable row level security;
alter table public.client_sites enable row level security;

create policy "Users can view client contacts in their orgs"
  on public.client_contacts for select to authenticated
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

create policy "Users can view client sites in their orgs"
  on public.client_sites for select to authenticated
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

-- Realtime freshness for the customer surfaces.
alter publication supabase_realtime add table public.client_contacts;
alter publication supabase_realtime add table public.client_sites;