-- P1-02: customer requests (Anfragen) and deliberate conversion into work.

-- Vocabularies (owner-approved 2026-08-05)
create type public.request_status as enum ('offen', 'in_klaerung', 'umgewandelt', 'geschlossen');
create type public.request_category as enum (
  'notfall', 'stoerung_reparatur', 'wartung', 'angebotsanfrage',
  'installation_umbau', 'garantie_mangel', 'allgemeine_frage', 'sonstiges'
);
create type public.request_urgency as enum ('niedrig', 'normal', 'hoch', 'notfall');
create type public.request_source as enum ('telefon', 'email', 'vor_ort', 'sonstiges');
create type public.request_close_reason as enum (
  'kein_bedarf', 'abgelehnt', 'duplikat', 'anderweitig_geloest', 'sonstiges'
);

create table public.client_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_number text,
  -- References to customer identity (never copies). Deleting the customer keeps the request.
  client_id uuid references public.clients(id) on delete set null,
  contact_id uuid references public.client_contacts(id) on delete set null,
  site_id uuid references public.client_sites(id) on delete set null,
  -- Provisional identity for unknown callers; retained as captured history after matching.
  caller_name text,
  caller_phone text,
  caller_email text,
  caller_address text,
  summary text not null,
  details text,
  category public.request_category not null default 'sonstiges',
  urgency public.request_urgency not null default 'normal',
  source public.request_source not null default 'telefon',
  status public.request_status not null default 'offen',
  assigned_to uuid references public.profiles(id) on delete set null,
  received_at timestamptz not null default now(),
  closed_reason public.request_close_reason,
  closed_note text,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  -- Once-only conversion facts. SET NULL keeps the converted state if the work is deleted.
  converted_job_id uuid references public.jobs(id) on delete set null,
  converted_project_id uuid references public.projects(id) on delete set null,
  converted_by uuid references public.profiles(id),
  converted_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_requests_one_conversion_target
    check (num_nonnulls(converted_job_id, converted_project_id) <= 1),
  constraint client_requests_converted_consistency
    check ((status = 'umgewandelt') = (converted_at is not null)),
  constraint client_requests_closed_consistency
    check ((status = 'geschlossen') = (closed_at is not null)),
  constraint client_requests_closed_reason_required
    check (status <> 'geschlossen' or closed_reason is not null),
  constraint client_requests_conversion_requires_actor
    check (converted_at is null or converted_by is not null)
);

create unique index client_requests_org_number_unique
  on public.client_requests (organization_id, request_number)
  where request_number is not null;
-- A job/project can originate from at most one request (DB-level once-only backstop).
create unique index client_requests_converted_job_unique
  on public.client_requests (converted_job_id)
  where converted_job_id is not null;
create unique index client_requests_converted_project_unique
  on public.client_requests (converted_project_id)
  where converted_project_id is not null;
create index client_requests_org_status_idx
  on public.client_requests (organization_id, status);
create index client_requests_client_idx
  on public.client_requests (client_id)
  where client_id is not null;

create table public.client_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.client_requests(id) on delete cascade,
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index client_request_events_request_idx
  on public.client_request_events (request_id, created_at);

-- Org/client integrity validation, mirroring validate_client_site (P1-01).
create or replace function app_private.validate_client_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.client_id is not null and (
       tg_op = 'INSERT'
       or old.client_id is distinct from new.client_id
       or old.organization_id is distinct from new.organization_id
     ) then
    if not exists (
      select 1 from public.clients c
      where c.id = new.client_id and c.organization_id = new.organization_id
    ) then
      raise exception 'client_request client organization mismatch';
    end if;
  end if;

  if new.contact_id is not null and (
       tg_op = 'INSERT'
       or old.contact_id is distinct from new.contact_id
       or old.client_id is distinct from new.client_id
     ) then
    if new.client_id is null or not exists (
      select 1 from public.client_contacts cc
      where cc.id = new.contact_id and cc.client_id = new.client_id
    ) then
      raise exception 'client_request contact belongs to another client';
    end if;
  end if;

  if new.site_id is not null and (
       tg_op = 'INSERT'
       or old.site_id is distinct from new.site_id
       or old.client_id is distinct from new.client_id
     ) then
    if new.client_id is null or not exists (
      select 1 from public.client_sites cs
      where cs.id = new.site_id and cs.client_id = new.client_id
    ) then
      raise exception 'client_request site belongs to another client';
    end if;
  end if;

  if new.converted_job_id is not null and (
       tg_op = 'INSERT' or old.converted_job_id is distinct from new.converted_job_id
     ) then
    if not exists (
      select 1 from public.jobs j
      where j.id = new.converted_job_id and j.organization_id = new.organization_id
    ) then
      raise exception 'client_request converted job organization mismatch';
    end if;
  end if;

  if new.converted_project_id is not null and (
       tg_op = 'INSERT' or old.converted_project_id is distinct from new.converted_project_id
     ) then
    if not exists (
      select 1 from public.projects p
      where p.id = new.converted_project_id and p.organization_id = new.organization_id
    ) then
      raise exception 'client_request converted project organization mismatch';
    end if;
  end if;

  return new;
end;
$$;

create trigger client_requests_validate
  before insert or update on public.client_requests
  for each row execute function app_private.validate_client_request();

create trigger client_requests_updated_at
  before update on public.client_requests
  for each row execute function public.update_updated_at_column();

create or replace function app_private.validate_client_request_event_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.client_requests r
    where r.id = new.request_id and r.organization_id = new.organization_id
  ) then
    raise exception 'client_request_event request organization mismatch';
  end if;
  return new;
end;
$$;

create trigger client_request_events_validate
  before insert or update on public.client_request_events
  for each row execute function app_private.validate_client_request_event_org();

-- RLS: requests are a manager surface. SELECT only for admin/buero of the org;
-- all writes go through service-role server actions (established pattern).
alter table public.client_requests enable row level security;
alter table public.client_request_events enable row level security;

create policy "Managers can view client requests in their orgs"
  on public.client_requests for select to authenticated
  using (organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  ));

create policy "Managers can view client request events in their orgs"
  on public.client_request_events for select to authenticated
  using (organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  ));

-- Attachments: requests become a fifth exactly-one document link target.
alter table public.document_links
  add column request_id uuid references public.client_requests(id) on delete cascade;

alter table public.document_links
  drop constraint document_links_exactly_one_target_check;

alter table public.document_links
  add constraint document_links_exactly_one_target_check
  check (num_nonnulls(job_id, project_id, client_id, employee_id, request_id) = 1);

create index document_links_request_idx
  on public.document_links (request_id)
  where request_id is not null;

create or replace function app_private.validate_document_link_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  linked_document_org_id uuid;
  linked_job_org_id uuid;
  linked_project_org_id uuid;
  linked_client_org_id uuid;
  linked_request_org_id uuid;
begin
  select organization_id into linked_document_org_id
  from public.documents
  where id = new.document_id
    and deleted_at is null;

  if linked_document_org_id is null or linked_document_org_id <> new.organization_id then
    raise exception 'document link document must belong to the same organization';
  end if;

  if new.job_id is not null then
    select organization_id into linked_job_org_id
    from public.jobs
    where id = new.job_id;

    if linked_job_org_id is null or linked_job_org_id <> new.organization_id then
      raise exception 'document link job must belong to the same organization';
    end if;
  end if;

  if new.project_id is not null then
    select organization_id into linked_project_org_id
    from public.projects
    where id = new.project_id;

    if linked_project_org_id is null or linked_project_org_id <> new.organization_id then
      raise exception 'document link project must belong to the same organization';
    end if;
  end if;

  if new.client_id is not null then
    select organization_id into linked_client_org_id
    from public.clients
    where id = new.client_id;

    if linked_client_org_id is null or linked_client_org_id <> new.organization_id then
      raise exception 'document link client must belong to the same organization';
    end if;
  end if;

  if new.request_id is not null then
    select organization_id into linked_request_org_id
    from public.client_requests
    where id = new.request_id;

    if linked_request_org_id is null or linked_request_org_id <> new.organization_id then
      raise exception 'document link request must belong to the same organization';
    end if;
  end if;

  return new;
end;
$$;

-- Realtime: request list/detail surfaces refresh live like the other CRM tables.
alter publication supabase_realtime add table public.client_requests;