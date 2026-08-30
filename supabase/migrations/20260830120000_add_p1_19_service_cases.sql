create type public.service_case_intake_type as enum ('request', 'direct');
create type public.service_case_status as enum (
  'new',
  'clarification_needed',
  'visit_required',
  'follow_up_required',
  'resolved',
  'closed_without_visit',
  'duplicate'
);
create type public.service_case_charge_context as enum (
  'unknown',
  'suspected_warranty',
  'suspected_contract',
  'suspected_goodwill',
  'suspected_rework',
  'expected_chargeable'
);
create type public.service_case_relation_type as enum (
  'duplicate_of', 'related', 'continuation_of'
);
create type public.service_case_event_type as enum (
  'created',
  'triage_updated',
  'status_changed',
  'job_linked',
  'job_unlinked',
  'equipment_links_updated',
  'relation_linked',
  'evidence_linked',
  'document_linked',
  'document_unlinked'
);

create table public.service_cases (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_number text not null,
  intake_type public.service_case_intake_type not null,
  source_request_id uuid references public.client_requests(id) on delete no action,
  client_id uuid not null references public.clients(id) on delete no action,
  contact_id uuid references public.client_contacts(id) on delete set null,
  site_id uuid not null references public.client_sites(id) on delete no action,
  job_id uuid references public.jobs(id) on delete no action,
  original_statement text not null,
  original_details text,
  summary text not null,
  urgency public.request_urgency not null default 'normal',
  status public.service_case_status not null default 'new',
  charge_context public.service_case_charge_context not null default 'unknown',
  access_instructions text,
  triage_note text,
  resolution_note text,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_cases_number_length check (
    length(btrim(case_number)) between 3 and 60
  ),
  constraint service_cases_statement_length check (
    length(btrim(original_statement)) between 2 and 5000
    and (original_details is null or length(btrim(original_details)) between 1 and 10000)
  ),
  constraint service_cases_summary_length check (
    length(btrim(summary)) between 2 and 300
  ),
  constraint service_cases_optional_text_lengths check (
    (access_instructions is null or length(btrim(access_instructions)) between 1 and 3000)
    and (triage_note is null or length(btrim(triage_note)) between 1 and 5000)
    and (resolution_note is null or length(btrim(resolution_note)) between 3 and 5000)
  ),
  constraint service_cases_intake_shape check (
    (intake_type = 'request' and source_request_id is not null)
    or (intake_type = 'direct' and source_request_id is null)
  ),
  constraint service_cases_terminal_note check (
    status not in ('resolved', 'closed_without_visit', 'duplicate')
    or resolution_note is not null
  ),
  constraint service_cases_id_organization_key unique (id, organization_id),
  foreign key (job_id, organization_id)
    references public.jobs(id, organization_id)
    on delete no action deferrable initially deferred
);

create unique index service_cases_number_per_org
  on public.service_cases (organization_id, lower(case_number));
create index service_cases_number_lookup_idx
  on public.service_cases (organization_id, case_number);
create unique index service_cases_source_request_unique
  on public.service_cases (organization_id, source_request_id)
  where source_request_id is not null;
create index service_cases_list_idx
  on public.service_cases (organization_id, status, urgency, updated_at desc);
create index service_cases_client_site_idx
  on public.service_cases (organization_id, client_id, site_id, updated_at desc);
create index service_cases_job_idx
  on public.service_cases (organization_id, job_id) where job_id is not null;

create table public.service_case_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_case_id uuid not null,
  event_type public.service_case_event_type not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  request_operation text not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  constraint service_case_events_reason_length check (
    reason is null or length(btrim(reason)) between 3 and 1000
  ),
  constraint service_case_events_operation_length check (
    length(btrim(request_operation)) between 3 and 80
  ),
  constraint service_case_events_payload_size check (
    octet_length(request_payload::text) <= 65536
    and octet_length(after_snapshot::text) <= 65536
    and (before_snapshot is null or octet_length(before_snapshot::text) <= 65536)
  ),
  unique (id, organization_id),
  unique (organization_id, request_operation, idempotency_key),
  foreign key (service_case_id, organization_id)
    references public.service_cases(id, organization_id) on delete cascade
);

create index service_case_events_case_idx
  on public.service_case_events (service_case_id, recorded_at desc, id desc);

create table public.service_case_equipment_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_case_id uuid not null,
  equipment_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (service_case_id, equipment_id),
  foreign key (service_case_id, organization_id)
    references public.service_cases(id, organization_id) on delete cascade,
  foreign key (equipment_id, organization_id)
    references public.installed_equipment(id, organization_id) on delete no action
);

create index service_case_equipment_links_equipment_idx
  on public.service_case_equipment_links (organization_id, equipment_id);

create table public.service_case_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_case_id uuid not null,
  related_service_case_id uuid not null,
  relation_type public.service_case_relation_type not null,
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint service_case_relations_distinct check (
    service_case_id <> related_service_case_id
  ),
  constraint service_case_relations_reason_length check (
    length(btrim(reason)) between 3 and 1000
  ),
  unique (id, organization_id),
  unique (service_case_id, related_service_case_id, relation_type),
  foreign key (service_case_id, organization_id)
    references public.service_cases(id, organization_id) on delete no action,
  foreign key (related_service_case_id, organization_id)
    references public.service_cases(id, organization_id) on delete no action
);

create index service_case_relations_related_idx
  on public.service_case_relations (organization_id, related_service_case_id);
create unique index service_case_relations_related_pair_unique
  on public.service_case_relations (
    organization_id,
    least(service_case_id, related_service_case_id),
    greatest(service_case_id, related_service_case_id)
  )
  where relation_type = 'related';

create or replace function app_private.validate_service_case_relation_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.relation_type in ('duplicate_of', 'continuation_of') and exists (
    select 1
    from public.service_case_relations relation
    where relation.organization_id = new.organization_id
      and relation.service_case_id = new.related_service_case_id
      and relation.related_service_case_id = new.service_case_id
      and relation.relation_type = new.relation_type
  ) then
    raise exception 'service_case_relation_cycle';
  end if;
  return new;
end;
$$;

create trigger service_case_relations_validate_insert
before insert on public.service_case_relations
for each row execute function app_private.validate_service_case_relation_insert();

create table public.service_case_evidence_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_case_id uuid not null,
  work_artifact_revision_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (service_case_id, work_artifact_revision_id),
  foreign key (service_case_id, organization_id)
    references public.service_cases(id, organization_id) on delete no action,
  foreign key (work_artifact_revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete no action
);

create index service_case_evidence_links_revision_idx
  on public.service_case_evidence_links (organization_id, work_artifact_revision_id);

create or replace function app_private.service_case_actor_is_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and member.role in ('admin', 'buero')
  );
$$;

create or replace function app_private.validate_service_case()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.clients client
    where client.id = new.client_id and client.organization_id = new.organization_id
  ) then raise exception 'service_case_client_mismatch'; end if;

  if not exists (
    select 1 from public.client_sites site
    where site.id = new.site_id and site.client_id = new.client_id
      and site.organization_id = new.organization_id
  ) then raise exception 'service_case_site_mismatch'; end if;

  if new.contact_id is not null and not exists (
    select 1 from public.client_contacts contact
    where contact.id = new.contact_id and contact.client_id = new.client_id
      and contact.organization_id = new.organization_id
  ) then raise exception 'service_case_contact_mismatch'; end if;

  if new.source_request_id is not null and not exists (
    select 1 from public.client_requests request
    where request.id = new.source_request_id
      and request.organization_id = new.organization_id
      and request.client_id = new.client_id
      and request.site_id = new.site_id
      and request.contact_id is not distinct from new.contact_id
  ) then raise exception 'service_case_request_mismatch'; end if;

  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
      and job.client_id = new.client_id and job.site_id = new.site_id
  ) then raise exception 'service_case_job_mismatch'; end if;

  return new;
end;
$$;

create or replace function app_private.validate_service_case_equipment_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.service_cases service_case
    join public.installed_equipment equipment
      on equipment.id = new.equipment_id
     and equipment.organization_id = new.organization_id
    where service_case.id = new.service_case_id
      and service_case.organization_id = new.organization_id
      and equipment.client_id = service_case.client_id
      and equipment.site_id = service_case.site_id
      and equipment.voided_at is null
      and equipment.archived_at is null
  ) then raise exception 'service_case_equipment_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.guard_service_case_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if coalesce(current_setting('app.service_case_write', true), '') <> 'true' then
    raise exception 'service_case_direct_write_forbidden';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_private.prevent_service_case_history_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'service_case_history_is_immutable';
end;
$$;

create trigger service_cases_validate
before insert or update on public.service_cases
for each row execute function app_private.validate_service_case();
create trigger service_cases_write_guard
before insert or update or delete on public.service_cases
for each row execute function app_private.guard_service_case_write();
create trigger service_case_equipment_links_validate
before insert or update on public.service_case_equipment_links
for each row execute function app_private.validate_service_case_equipment_link();
create trigger service_case_equipment_links_write_guard
before insert or update or delete on public.service_case_equipment_links
for each row execute function app_private.guard_service_case_write();
create trigger service_case_events_immutable
before update or delete on public.service_case_events
for each row execute function app_private.prevent_service_case_history_mutation();
create trigger service_case_relations_immutable
before update or delete on public.service_case_relations
for each row execute function app_private.prevent_service_case_history_mutation();
create trigger service_case_evidence_links_immutable
before update or delete on public.service_case_evidence_links
for each row execute function app_private.prevent_service_case_history_mutation();

alter table public.service_cases enable row level security;
alter table public.service_case_events enable row level security;
alter table public.service_case_equipment_links enable row level security;
alter table public.service_case_relations enable row level security;
alter table public.service_case_evidence_links enable row level security;

create policy "Managers can view service cases"
on public.service_cases for select to authenticated
using (app_private.service_case_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view service case events"
on public.service_case_events for select to authenticated
using (app_private.service_case_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view service case equipment links"
on public.service_case_equipment_links for select to authenticated
using (app_private.service_case_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view service case relations"
on public.service_case_relations for select to authenticated
using (app_private.service_case_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view service case evidence links"
on public.service_case_evidence_links for select to authenticated
using (app_private.service_case_actor_is_manager(organization_id, (select auth.uid())));

grant select on public.service_cases, public.service_case_events,
  public.service_case_equipment_links, public.service_case_relations,
  public.service_case_evidence_links to authenticated;
grant all on public.service_cases, public.service_case_events,
  public.service_case_equipment_links, public.service_case_relations,
  public.service_case_evidence_links to service_role;

alter table public.service_cases
  replica identity using index service_cases_id_organization_key;
alter publication supabase_realtime add table public.service_cases;

revoke all on function app_private.service_case_actor_is_manager(uuid, uuid)
from public, anon;
revoke all on function app_private.validate_service_case()
from public, anon, authenticated;
revoke all on function app_private.validate_service_case_equipment_link()
from public, anon, authenticated;
revoke all on function app_private.validate_service_case_relation_insert()
from public, anon, authenticated;
revoke all on function app_private.guard_service_case_write()
from public, anon, authenticated;
revoke all on function app_private.prevent_service_case_history_mutation()
from public, anon, authenticated;
grant execute on function app_private.service_case_actor_is_manager(uuid, uuid)
to authenticated, service_role;
grant execute on function app_private.validate_service_case(),
  app_private.validate_service_case_equipment_link(),
  app_private.validate_service_case_relation_insert(),
  app_private.guard_service_case_write(),
  app_private.prevent_service_case_history_mutation() to service_role;
