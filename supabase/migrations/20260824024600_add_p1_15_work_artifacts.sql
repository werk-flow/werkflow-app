create type public.work_artifact_kind as enum (
  'site_diary', 'work_report', 'measurement', 'defect', 'change_work'
);
create type public.work_artifact_visibility as enum (
  'internal_only', 'customer_facing'
);
create type public.work_artifact_status as enum (
  'draft', 'submitted', 'approved', 'rejected', 'correction_requested', 'voided'
);
create type public.work_artifact_measurement_unit as enum (
  'piece', 'meter', 'square_meter', 'cubic_meter', 'liter', 'kilogram', 'hour', 'flat_rate'
);
create type public.work_artifact_defect_severity as enum (
  'low', 'medium', 'high', 'critical'
);
create type public.work_artifact_defect_state as enum (
  'open', 'in_progress', 'resolved'
);
create type public.work_artifact_change_authorization_state as enum (
  'not_requested', 'requested', 'authorized', 'rejected'
);
create type public.work_artifact_document_relation as enum (
  'supporting_evidence', 'closure_proof', 'signature_mark', 'rendered_export'
);

create table public.work_artifacts (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  kind public.work_artifact_kind not null,
  status public.work_artifact_status not null default 'draft',
  current_revision_id uuid,
  version bigint not null default 1 check (version > 0),
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_artifacts_one_target_check check (
    (job_id is not null)::integer + (project_id is not null)::integer = 1
  ),
  constraint work_artifacts_void_check check (
    (status = 'voided' and voided_at is not null and voided_by is not null
      and length(btrim(void_reason)) between 3 and 1000)
    or (status <> 'voided' and voided_at is null and voided_by is null and void_reason is null)
  ),
  unique (id, organization_id)
);

create table public.work_artifact_revisions (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  artifact_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  kind public.work_artifact_kind not null,
  visibility public.work_artifact_visibility not null,
  captured_at timestamptz not null,
  site_id uuid references public.client_sites(id) on delete restrict,
  instruction_item_id uuid references public.job_instruction_items(id) on delete restrict,
  title text not null check (length(btrim(title)) between 3 and 160),
  summary text,
  customer_statement text,
  corrects_revision_id uuid,
  correction_reason text,
  requires_customer_response boolean not null default false,
  requires_signature boolean not null default false,
  work_date date,
  progress text,
  people_present text,
  weather_conditions text,
  site_conditions text,
  deliveries text,
  impediments text,
  decisions text,
  notable_events text,
  visit_started_at timestamptz,
  visit_ended_at timestamptz,
  performed_work text,
  outstanding_work text,
  materials_summary text,
  next_visit_at timestamptz,
  measurement_date date,
  measurement_location text,
  measurement_notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_artifact_revisions_artifact_fkey foreign key (artifact_id, organization_id)
    references public.work_artifacts(id, organization_id) on delete cascade,
  constraint work_artifact_revisions_corrects_fkey foreign key (corrects_revision_id)
    references public.work_artifact_revisions(id) on delete restrict,
  constraint work_artifact_revisions_summary_check check (
    summary is null or length(btrim(summary)) between 1 and 5000
  ),
  constraint work_artifact_revisions_customer_statement_check check (
    customer_statement is null or length(btrim(customer_statement)) between 1 and 5000
  ),
  constraint work_artifact_revisions_correction_check check (
    (corrects_revision_id is null and correction_reason is null)
    or (corrects_revision_id is not null and length(btrim(correction_reason)) between 3 and 1000)
  ),
  constraint work_artifact_revisions_customer_requirements_check check (
    visibility = 'customer_facing' or (not requires_customer_response and not requires_signature)
  ),
  constraint work_artifact_revisions_visit_check check (
    visit_started_at is null or visit_ended_at is null or visit_ended_at > visit_started_at
  ),
  unique (artifact_id, revision_number),
  unique (id, organization_id)
);

alter table public.work_artifacts
  add constraint work_artifacts_current_revision_fkey
  foreign key (current_revision_id, organization_id)
  references public.work_artifact_revisions(id, organization_id) on delete restrict;

create table public.work_artifact_measurement_lines (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_id uuid not null,
  line_number integer not null check (line_number > 0),
  description text not null check (length(btrim(description)) between 1 and 500),
  location text,
  quantity numeric(14,3) not null check (quantity > 0),
  unit public.work_artifact_measurement_unit not null,
  note text,
  constraint work_artifact_measurement_lines_revision_fkey foreign key (revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete cascade,
  unique (revision_id, line_number)
);

create table public.work_artifact_defect_details (
  revision_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  description text not null check (length(btrim(description)) between 3 and 5000),
  severity public.work_artifact_defect_severity not null,
  location text not null check (length(btrim(location)) between 1 and 500),
  responsible_employee_record_id uuid references public.employee_records(id) on delete restrict,
  responsibility_context text,
  due_date date,
  state public.work_artifact_defect_state not null default 'open',
  proposed_resolution text,
  resolution_summary text,
  constraint work_artifact_defect_details_revision_fkey foreign key (revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete cascade,
  constraint work_artifact_defect_details_resolution_check check (
    state <> 'resolved' or length(btrim(resolution_summary)) between 3 and 5000
  )
);

create table public.work_artifact_change_details (
  revision_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  change_description text not null check (length(btrim(change_description)) between 3 and 5000),
  change_reason text not null check (length(btrim(change_reason)) between 3 and 2000),
  requested_by_context text not null check (length(btrim(requested_by_context)) between 1 and 500),
  expected_labor_minutes integer check (expected_labor_minutes >= 0),
  actual_labor_minutes integer check (actual_labor_minutes >= 0),
  expected_material_summary text,
  actual_material_summary text,
  authorization_state public.work_artifact_change_authorization_state not null default 'not_requested',
  schedule_impact text,
  constraint work_artifact_change_details_revision_fkey foreign key (revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete cascade
);

create table public.work_artifact_revision_documents (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_id uuid not null,
  document_id uuid not null references public.documents(id) on delete restrict,
  relation public.work_artifact_document_relation not null,
  description text,
  renderer_version text,
  content_hash text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_artifact_revision_documents_revision_fkey foreign key (revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete cascade,
  constraint work_artifact_revision_documents_export_check check (
    (relation = 'rendered_export' and length(btrim(renderer_version)) between 1 and 100
      and content_hash ~ '^[0-9a-f]{64}$')
    or (relation <> 'rendered_export' and renderer_version is null and content_hash is null)
  ),
  unique (revision_id, document_id, relation)
);

create unique index work_artifact_revision_documents_export_identity_idx
  on public.work_artifact_revision_documents(revision_id, renderer_version, content_hash)
  where relation = 'rendered_export';

create table public.work_artifact_revision_sources (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision_id uuid not null,
  time_entry_id uuid references public.time_entries(id) on delete restrict,
  inventory_movement_id uuid references public.inventory_movements(id) on delete restrict,
  description text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint work_artifact_revision_sources_revision_fkey foreign key (revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete cascade,
  constraint work_artifact_revision_sources_one_source_check check (
    (time_entry_id is not null)::integer + (inventory_movement_id is not null)::integer = 1
  )
);

create unique index work_artifact_revision_sources_time_idx
  on public.work_artifact_revision_sources(revision_id, time_entry_id)
  where time_entry_id is not null;
create unique index work_artifact_revision_sources_inventory_idx
  on public.work_artifact_revision_sources(revision_id, inventory_movement_id)
  where inventory_movement_id is not null;

create index work_artifacts_job_idx on public.work_artifacts(job_id) where job_id is not null;
create index work_artifacts_project_idx on public.work_artifacts(project_id) where project_id is not null;
create index work_artifacts_org_status_idx on public.work_artifacts(organization_id, status, updated_at desc);
create index work_artifacts_created_by_idx on public.work_artifacts(created_by);
create index work_artifacts_voided_by_idx on public.work_artifacts(voided_by) where voided_by is not null;
create index work_artifact_revisions_artifact_idx on public.work_artifact_revisions(artifact_id, revision_number desc);
create index work_artifact_revisions_site_idx on public.work_artifact_revisions(site_id) where site_id is not null;
create index work_artifact_revisions_instruction_idx on public.work_artifact_revisions(instruction_item_id) where instruction_item_id is not null;
create index work_artifact_revisions_created_by_idx on public.work_artifact_revisions(created_by);
create index work_artifact_revisions_corrects_idx on public.work_artifact_revisions(corrects_revision_id) where corrects_revision_id is not null;
create index work_artifact_measurement_lines_org_idx on public.work_artifact_measurement_lines(organization_id);
create index work_artifact_defect_details_org_due_idx on public.work_artifact_defect_details(organization_id, due_date, state);
create index work_artifact_defect_details_responsible_idx on public.work_artifact_defect_details(responsible_employee_record_id) where responsible_employee_record_id is not null;
create index work_artifact_change_details_org_idx on public.work_artifact_change_details(organization_id);
create index work_artifact_revision_documents_org_idx on public.work_artifact_revision_documents(organization_id);
create index work_artifact_revision_documents_document_idx on public.work_artifact_revision_documents(document_id);
create index work_artifact_revision_documents_created_by_idx on public.work_artifact_revision_documents(created_by);
create index work_artifact_revision_sources_org_idx on public.work_artifact_revision_sources(organization_id);
create index work_artifact_revision_sources_created_by_idx on public.work_artifact_revision_sources(created_by);

create or replace function app_private.is_work_artifact_manager(
  p_organization_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_user_id
      and member.role in ('admin', 'buero')
  );
$$;

create or replace function app_private.can_access_work_artifact_target(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select app_private.is_work_artifact_manager(p_organization_id, p_user_id)
    or exists (
      select 1
      from public.job_assignments assignment
      join public.jobs job on job.id = assignment.job_id
      where p_job_id is not null
        and assignment.job_id = p_job_id
        and assignment.user_id = p_user_id
        and job.organization_id = p_organization_id
    )
    or exists (
      select 1
      from public.jobs job
      join public.job_assignments assignment on assignment.job_id = job.id
      where p_project_id is not null
        and job.project_id = p_project_id
        and job.organization_id = p_organization_id
        and assignment.user_id = p_user_id
    );
$$;

create or replace function app_private.can_access_work_artifact(
  p_artifact_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.work_artifacts artifact
    where artifact.id = p_artifact_id
      and app_private.can_access_work_artifact_target(
        artifact.organization_id, artifact.job_id, artifact.project_id, p_user_id
      )
  );
$$;

create or replace function app_private.validate_work_artifact()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then raise exception 'work_artifact_job_org_mismatch'; end if;

  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then raise exception 'work_artifact_project_org_mismatch'; end if;

  return new;
end;
$$;

create trigger work_artifacts_validate
before insert or update on public.work_artifacts
for each row execute function app_private.validate_work_artifact();

create or replace function app_private.validate_work_artifact_revision()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_artifact public.work_artifacts%rowtype;
  v_corrected public.work_artifact_revisions%rowtype;
begin
  select * into v_artifact from public.work_artifacts artifact
  where artifact.id = new.artifact_id and artifact.organization_id = new.organization_id;
  if not found or v_artifact.kind <> new.kind then
    raise exception 'work_artifact_revision_identity_mismatch';
  end if;

  if new.site_id is not null and not exists (
    select 1 from public.client_sites site
    where site.id = new.site_id and site.organization_id = new.organization_id
  ) then raise exception 'work_artifact_revision_site_org_mismatch'; end if;

  if new.instruction_item_id is not null and not exists (
    select 1 from public.job_instruction_items item
    where item.id = new.instruction_item_id
      and item.organization_id = new.organization_id
      and ((v_artifact.job_id is not null and item.job_id = v_artifact.job_id)
        or (v_artifact.project_id is not null and item.project_id = v_artifact.project_id))
  ) then raise exception 'work_artifact_revision_instruction_target_mismatch'; end if;

  if new.corrects_revision_id is not null then
    select * into v_corrected from public.work_artifact_revisions revision
    where revision.id = new.corrects_revision_id;
    if not found or v_corrected.artifact_id <> new.artifact_id
      or v_corrected.revision_number >= new.revision_number then
      raise exception 'work_artifact_revision_correction_mismatch';
    end if;
  end if;

  return new;
end;
$$;

create trigger work_artifact_revisions_validate
before insert on public.work_artifact_revisions
for each row execute function app_private.validate_work_artifact_revision();

create or replace function app_private.validate_work_artifact_detail()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
  v_required_kind public.work_artifact_kind;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_detail_revision_mismatch'; end if;

  v_required_kind := case tg_table_name
    when 'work_artifact_measurement_lines' then 'measurement'::public.work_artifact_kind
    when 'work_artifact_defect_details' then 'defect'::public.work_artifact_kind
    when 'work_artifact_change_details' then 'change_work'::public.work_artifact_kind
  end;
  if v_revision.kind <> v_required_kind then
    raise exception 'work_artifact_detail_kind_mismatch';
  end if;

  if tg_table_name = 'work_artifact_defect_details' then
    if new.responsible_employee_record_id is not null and not exists (
      select 1 from public.employee_records employee
      where employee.id = new.responsible_employee_record_id
        and employee.organization_id = new.organization_id
    ) then raise exception 'work_artifact_defect_responsible_org_mismatch'; end if;
  end if;

  return new;
end;
$$;

create trigger work_artifact_measurement_lines_validate
before insert on public.work_artifact_measurement_lines
for each row execute function app_private.validate_work_artifact_detail();
create trigger work_artifact_defect_details_validate
before insert on public.work_artifact_defect_details
for each row execute function app_private.validate_work_artifact_detail();
create trigger work_artifact_change_details_validate
before insert on public.work_artifact_change_details
for each row execute function app_private.validate_work_artifact_detail();

create or replace function app_private.validate_work_artifact_relation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_revision public.work_artifact_revisions%rowtype;
begin
  select * into v_revision from public.work_artifact_revisions revision
  where revision.id = new.revision_id and revision.organization_id = new.organization_id;
  if not found then raise exception 'work_artifact_relation_revision_mismatch'; end if;

  if tg_table_name = 'work_artifact_revision_documents' and not exists (
    select 1 from public.documents document
    where document.id = new.document_id
      and document.organization_id = new.organization_id
      and document.deleted_at is null
  ) then raise exception 'work_artifact_document_org_mismatch'; end if;

  if tg_table_name = 'work_artifact_revision_sources' then
    if new.time_entry_id is not null and not exists (
      select 1 from public.time_entries entry
      where entry.id = new.time_entry_id and entry.organization_id = new.organization_id
    ) then raise exception 'work_artifact_time_source_org_mismatch'; end if;
    if new.inventory_movement_id is not null and not exists (
      select 1 from public.inventory_movements movement
      where movement.id = new.inventory_movement_id
        and movement.organization_id = new.organization_id
    ) then raise exception 'work_artifact_inventory_source_org_mismatch'; end if;
  end if;

  return new;
end;
$$;

create trigger work_artifact_revision_documents_validate
before insert on public.work_artifact_revision_documents
for each row execute function app_private.validate_work_artifact_relation();
create trigger work_artifact_revision_sources_validate
before insert on public.work_artifact_revision_sources
for each row execute function app_private.validate_work_artifact_relation();

create or replace function app_private.prevent_work_artifact_ledger_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'work_artifact_history_is_immutable';
end;
$$;

create trigger work_artifact_revisions_immutable
before update or delete on public.work_artifact_revisions
for each row execute function app_private.prevent_work_artifact_ledger_mutation();
create trigger work_artifact_measurement_lines_immutable
before update or delete on public.work_artifact_measurement_lines
for each row execute function app_private.prevent_work_artifact_ledger_mutation();
create trigger work_artifact_defect_details_immutable
before update or delete on public.work_artifact_defect_details
for each row execute function app_private.prevent_work_artifact_ledger_mutation();
create trigger work_artifact_change_details_immutable
before update or delete on public.work_artifact_change_details
for each row execute function app_private.prevent_work_artifact_ledger_mutation();
create trigger work_artifact_revision_documents_immutable
before update or delete on public.work_artifact_revision_documents
for each row execute function app_private.prevent_work_artifact_ledger_mutation();
create trigger work_artifact_revision_sources_immutable
before update or delete on public.work_artifact_revision_sources
for each row execute function app_private.prevent_work_artifact_ledger_mutation();

alter table public.work_artifacts enable row level security;
alter table public.work_artifact_revisions enable row level security;
alter table public.work_artifact_measurement_lines enable row level security;
alter table public.work_artifact_defect_details enable row level security;
alter table public.work_artifact_change_details enable row level security;
alter table public.work_artifact_revision_documents enable row level security;
alter table public.work_artifact_revision_sources enable row level security;

create policy "Authorized users can view work artifacts"
on public.work_artifacts for select to authenticated
using (app_private.can_access_work_artifact(id, (select auth.uid())));

create policy "Authorized users can view work artifact revisions"
on public.work_artifact_revisions for select to authenticated
using (app_private.can_access_work_artifact(artifact_id, (select auth.uid())));

create policy "Authorized users can view work artifact measurement lines"
on public.work_artifact_measurement_lines for select to authenticated
using (exists (
  select 1 from public.work_artifact_revisions revision
  where revision.id = work_artifact_measurement_lines.revision_id
    and app_private.can_access_work_artifact(revision.artifact_id, (select auth.uid()))
));

create policy "Authorized users can view work artifact defect details"
on public.work_artifact_defect_details for select to authenticated
using (exists (
  select 1 from public.work_artifact_revisions revision
  where revision.id = work_artifact_defect_details.revision_id
    and app_private.can_access_work_artifact(revision.artifact_id, (select auth.uid()))
));

create policy "Authorized users can view work artifact change details"
on public.work_artifact_change_details for select to authenticated
using (exists (
  select 1 from public.work_artifact_revisions revision
  where revision.id = work_artifact_change_details.revision_id
    and app_private.can_access_work_artifact(revision.artifact_id, (select auth.uid()))
));

create policy "Authorized users can view work artifact document relations"
on public.work_artifact_revision_documents for select to authenticated
using (exists (
  select 1 from public.work_artifact_revisions revision
  where revision.id = work_artifact_revision_documents.revision_id
    and app_private.can_access_work_artifact(revision.artifact_id, (select auth.uid()))
));

create policy "Authorized users can view work artifact source relations"
on public.work_artifact_revision_sources for select to authenticated
using (exists (
  select 1 from public.work_artifact_revisions revision
  where revision.id = work_artifact_revision_sources.revision_id
    and app_private.can_access_work_artifact(revision.artifact_id, (select auth.uid()))
));

revoke all on table
  public.work_artifacts,
  public.work_artifact_revisions,
  public.work_artifact_measurement_lines,
  public.work_artifact_defect_details,
  public.work_artifact_change_details,
  public.work_artifact_revision_documents,
  public.work_artifact_revision_sources
from anon, authenticated;
grant select on table
  public.work_artifacts,
  public.work_artifact_revisions,
  public.work_artifact_measurement_lines,
  public.work_artifact_defect_details,
  public.work_artifact_change_details,
  public.work_artifact_revision_documents,
  public.work_artifact_revision_sources
to authenticated;
grant all on table
  public.work_artifacts,
  public.work_artifact_revisions,
  public.work_artifact_measurement_lines,
  public.work_artifact_defect_details,
  public.work_artifact_change_details,
  public.work_artifact_revision_documents,
  public.work_artifact_revision_sources
to service_role;

alter table public.work_artifacts replica identity full;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'work_artifacts'
  ) then alter publication supabase_realtime add table public.work_artifacts; end if;
end $$;

revoke all on function app_private.is_work_artifact_manager(uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.can_access_work_artifact_target(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function app_private.can_access_work_artifact(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.is_work_artifact_manager(uuid, uuid) to authenticated, service_role;
grant execute on function app_private.can_access_work_artifact_target(uuid, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function app_private.can_access_work_artifact(uuid, uuid) to authenticated, service_role;
revoke all on function app_private.validate_work_artifact() from public, anon, authenticated;
revoke all on function app_private.validate_work_artifact_revision() from public, anon, authenticated;
revoke all on function app_private.validate_work_artifact_detail() from public, anon, authenticated;
revoke all on function app_private.validate_work_artifact_relation() from public, anon, authenticated;
revoke all on function app_private.prevent_work_artifact_ledger_mutation() from public, anon, authenticated;
grant execute on function app_private.validate_work_artifact() to service_role;
grant execute on function app_private.validate_work_artifact_revision() to service_role;
grant execute on function app_private.validate_work_artifact_detail() to service_role;
grant execute on function app_private.validate_work_artifact_relation() to service_role;
grant execute on function app_private.prevent_work_artifact_ledger_mutation() to service_role;

-- The value is consumed by the following migration after this transaction commits.
alter type public.organization_responsibility add value 'work_artifact_approval';
