create type public.maintenance_coverage_status as enum ('active', 'suspended', 'terminated');
create type public.maintenance_plan_status as enum ('draft', 'active', 'suspended', 'terminated');
create type public.maintenance_next_due_basis as enum ('planned_due_date', 'actual_completion_date');
create type public.maintenance_due_status as enum (
  'open', 'visit_created', 'completed', 'skipped', 'cancelled', 'superseded'
);
create type public.maintenance_scope_outcome as enum ('complete', 'partial', 'unresolved');
create type public.maintenance_coverage_event_type as enum (
  'created', 'updated', 'status_changed', 'document_linked', 'document_unlinked'
);
create type public.maintenance_plan_event_type as enum (
  'created', 'revised', 'status_changed', 'horizon_extended', 'archived', 'restored'
);
create type public.maintenance_due_event_type as enum (
  'generated', 'visit_linked', 'visit_rescheduled', 'combined', 'completed',
  'skipped', 'cancelled', 'superseded', 'service_case_linked'
);

create table public.maintenance_coverages (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  coverage_number text not null,
  client_id uuid not null,
  site_id uuid not null,
  reference text,
  description text,
  status public.maintenance_coverage_status not null default 'active',
  valid_from date,
  valid_until date,
  notice_date date,
  renewal_date date,
  review_due_date date,
  operational_note text,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_coverages_number_length check (
    length(btrim(coverage_number)) between 3 and 60
  ),
  constraint maintenance_coverages_text_lengths check (
    (reference is null or length(btrim(reference)) between 1 and 160)
    and (description is null or length(btrim(description)) between 1 and 5000)
    and (operational_note is null or length(btrim(operational_note)) between 1 and 5000)
  ),
  constraint maintenance_coverages_validity_check check (
    valid_from is null or valid_until is null or valid_until >= valid_from
  ),
  constraint maintenance_coverages_id_organization_key unique (id, organization_id),
  foreign key (client_id, organization_id)
    references public.clients(id, organization_id) on delete no action,
  foreign key (site_id, organization_id)
    references public.client_sites(id, organization_id) on delete no action
);

create unique index maintenance_coverages_number_per_org
  on public.maintenance_coverages (organization_id, lower(coverage_number));
create index maintenance_coverages_list_idx
  on public.maintenance_coverages (organization_id, status, review_due_date, updated_at desc);
create index maintenance_coverages_client_site_idx
  on public.maintenance_coverages (organization_id, client_id, site_id);

create table public.maintenance_coverage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_coverage_id uuid not null,
  event_type public.maintenance_coverage_event_type not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  request_operation text not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  constraint maintenance_coverage_events_reason_length check (
    reason is null or length(btrim(reason)) between 3 and 1000
  ),
  constraint maintenance_coverage_events_operation_length check (
    length(btrim(request_operation)) between 3 and 80
  ),
  constraint maintenance_coverage_events_payload_size check (
    octet_length(request_payload::text) <= 65536
    and octet_length(after_snapshot::text) <= 65536
    and (before_snapshot is null or octet_length(before_snapshot::text) <= 65536)
  ),
  unique (id, organization_id),
  unique (organization_id, request_operation, idempotency_key),
  foreign key (maintenance_coverage_id, organization_id)
    references public.maintenance_coverages(id, organization_id) on delete cascade
);

create index maintenance_coverage_events_root_idx
  on public.maintenance_coverage_events (maintenance_coverage_id, recorded_at desc, id desc);

create table public.maintenance_plans (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_number text not null,
  client_id uuid not null,
  site_id uuid not null,
  maintenance_coverage_id uuid,
  status public.maintenance_plan_status not null default 'draft',
  current_revision_id uuid,
  generation_through_date date,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete restrict,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_plans_number_length check (
    length(btrim(plan_number)) between 3 and 60
  ),
  constraint maintenance_plans_archive_shape check (
    (archived_at is null and archived_by is null)
    or (archived_at is not null and archived_by is not null and status = 'terminated')
  ),
  constraint maintenance_plans_id_organization_key unique (id, organization_id),
  foreign key (client_id, organization_id)
    references public.clients(id, organization_id) on delete no action,
  foreign key (site_id, organization_id)
    references public.client_sites(id, organization_id) on delete no action,
  foreign key (maintenance_coverage_id, organization_id)
    references public.maintenance_coverages(id, organization_id) on delete no action
);

create unique index maintenance_plans_number_per_org
  on public.maintenance_plans (organization_id, lower(plan_number));
create index maintenance_plans_list_idx
  on public.maintenance_plans (organization_id, status, archived_at, updated_at desc);
create index maintenance_plans_client_site_idx
  on public.maintenance_plans (organization_id, client_id, site_id);

create table public.maintenance_plan_revisions (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_plan_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  template_version_id uuid not null,
  effective_from_date date not null,
  first_due_date date not null,
  interval_months integer not null check (interval_months between 1 and 120),
  due_window_before_days integer not null default 0 check (due_window_before_days between 0 and 365),
  due_window_after_days integer not null default 0 check (due_window_after_days between 0 and 365),
  planned_duration_minutes integer not null check (planned_duration_minutes between 15 and 1440),
  next_due_basis public.maintenance_next_due_basis not null,
  operational_instructions text,
  overlap_reason text,
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint maintenance_plan_revisions_text_lengths check (
    length(btrim(reason)) between 3 and 1000
    and (operational_instructions is null or length(btrim(operational_instructions)) between 1 and 10000)
    and (overlap_reason is null or length(btrim(overlap_reason)) between 3 and 1000)
  ),
  constraint maintenance_plan_revisions_dates check (first_due_date >= effective_from_date),
  constraint maintenance_plan_revisions_id_organization_key unique (id, organization_id),
  unique (maintenance_plan_id, revision_number),
  foreign key (maintenance_plan_id, organization_id)
    references public.maintenance_plans(id, organization_id) on delete no action,
  foreign key (template_version_id, organization_id)
    references public.work_template_versions(id, organization_id) on delete no action
);

alter table public.maintenance_plans
  add constraint maintenance_plans_current_revision_fkey
  foreign key (current_revision_id, organization_id)
  references public.maintenance_plan_revisions(id, organization_id)
  on delete no action deferrable initially deferred;

create index maintenance_plan_revisions_plan_idx
  on public.maintenance_plan_revisions (maintenance_plan_id, revision_number desc);

create table public.maintenance_plan_revision_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_plan_revision_id uuid not null,
  equipment_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (maintenance_plan_revision_id, equipment_id),
  foreign key (maintenance_plan_revision_id, organization_id)
    references public.maintenance_plan_revisions(id, organization_id) on delete no action,
  foreign key (equipment_id, organization_id)
    references public.installed_equipment(id, organization_id) on delete no action
);

create index maintenance_plan_revision_equipment_equipment_idx
  on public.maintenance_plan_revision_equipment (organization_id, equipment_id);

create table public.maintenance_plan_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_plan_id uuid not null,
  event_type public.maintenance_plan_event_type not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  request_operation text not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  constraint maintenance_plan_events_reason_length check (
    reason is null or length(btrim(reason)) between 3 and 1000
  ),
  constraint maintenance_plan_events_operation_length check (
    length(btrim(request_operation)) between 3 and 80
  ),
  constraint maintenance_plan_events_payload_size check (
    octet_length(request_payload::text) <= 65536
    and octet_length(after_snapshot::text) <= 65536
    and (before_snapshot is null or octet_length(before_snapshot::text) <= 65536)
  ),
  unique (id, organization_id),
  unique (organization_id, request_operation, idempotency_key),
  foreign key (maintenance_plan_id, organization_id)
    references public.maintenance_plans(id, organization_id) on delete cascade
);

create index maintenance_plan_events_root_idx
  on public.maintenance_plan_events (maintenance_plan_id, recorded_at desc, id desc);

create table public.maintenance_due_work (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_plan_id uuid not null,
  maintenance_plan_revision_id uuid not null,
  original_due_date date not null,
  due_date date not null,
  window_start_date date not null,
  window_end_date date not null,
  status public.maintenance_due_status not null default 'open',
  job_id uuid,
  planning_occurrence_id uuid,
  scope_outcome public.maintenance_scope_outcome,
  completed_on date,
  next_due_date date,
  exception_reason text,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maintenance_due_work_window_check check (
    window_start_date <= due_date and due_date <= window_end_date
  ),
  constraint maintenance_due_work_terminal_shape check (
    (status = 'completed' and scope_outcome is not null and completed_on is not null)
    or (status in ('skipped', 'cancelled', 'superseded') and exception_reason is not null
        and scope_outcome is null and completed_on is null)
    or (status in ('open', 'visit_created') and scope_outcome is null and completed_on is null)
  ),
  constraint maintenance_due_work_visit_shape check (
    (status = 'open' and job_id is null and planning_occurrence_id is null)
    or (status = 'visit_created' and job_id is not null)
    or status in ('completed', 'skipped', 'cancelled', 'superseded')
  ),
  constraint maintenance_due_work_exception_length check (
    exception_reason is null or length(btrim(exception_reason)) between 3 and 1000
  ),
  constraint maintenance_due_work_id_organization_key unique (id, organization_id),
  unique (maintenance_plan_id, maintenance_plan_revision_id, original_due_date),
  foreign key (maintenance_plan_id, organization_id)
    references public.maintenance_plans(id, organization_id) on delete no action,
  foreign key (maintenance_plan_revision_id, organization_id)
    references public.maintenance_plan_revisions(id, organization_id) on delete no action,
  foreign key (job_id, organization_id)
    references public.jobs(id, organization_id) on delete no action deferrable initially deferred,
  foreign key (planning_occurrence_id, organization_id)
    references public.planning_occurrences(id, organization_id) on delete no action deferrable initially deferred
);

create index maintenance_due_work_queue_idx
  on public.maintenance_due_work (organization_id, status, due_date, id);
create index maintenance_due_work_plan_idx
  on public.maintenance_due_work (maintenance_plan_id, due_date, id);
create index maintenance_due_work_job_idx
  on public.maintenance_due_work (organization_id, job_id) where job_id is not null;
create index maintenance_due_work_occurrence_idx
  on public.maintenance_due_work (organization_id, planning_occurrence_id)
  where planning_occurrence_id is not null;

create table public.maintenance_due_work_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_due_work_id uuid not null,
  event_type public.maintenance_due_event_type not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  reason text,
  request_operation text not null,
  idempotency_key uuid not null,
  request_payload jsonb not null,
  before_snapshot jsonb,
  after_snapshot jsonb not null,
  recorded_at timestamptz not null default now(),
  constraint maintenance_due_work_events_reason_length check (
    reason is null or length(btrim(reason)) between 3 and 1000
  ),
  constraint maintenance_due_work_events_operation_length check (
    length(btrim(request_operation)) between 3 and 80
  ),
  constraint maintenance_due_work_events_payload_size check (
    octet_length(request_payload::text) <= 65536
    and octet_length(after_snapshot::text) <= 65536
    and (before_snapshot is null or octet_length(before_snapshot::text) <= 65536)
  ),
  unique (id, organization_id),
  unique (organization_id, request_operation, idempotency_key),
  foreign key (maintenance_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete cascade
);

create index maintenance_due_work_events_root_idx
  on public.maintenance_due_work_events (maintenance_due_work_id, recorded_at desc, id desc);

create table public.maintenance_due_evidence_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_due_work_id uuid not null,
  work_artifact_revision_id uuid not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (maintenance_due_work_id, work_artifact_revision_id),
  foreign key (maintenance_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete no action,
  foreign key (work_artifact_revision_id, organization_id)
    references public.work_artifact_revisions(id, organization_id) on delete no action
);

create index maintenance_due_evidence_links_revision_idx
  on public.maintenance_due_evidence_links (organization_id, work_artifact_revision_id);

create table public.maintenance_service_case_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_plan_id uuid not null,
  maintenance_due_work_id uuid,
  service_case_id uuid not null,
  reason text not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint maintenance_service_case_links_reason_length check (
    length(btrim(reason)) between 3 and 1000
  ),
  unique (id, organization_id),
  foreign key (maintenance_plan_id, organization_id)
    references public.maintenance_plans(id, organization_id) on delete no action,
  foreign key (maintenance_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete no action,
  foreign key (service_case_id, organization_id)
    references public.service_cases(id, organization_id) on delete no action
);

create unique index maintenance_service_case_links_unique
  on public.maintenance_service_case_links (
    maintenance_plan_id,
    coalesce(maintenance_due_work_id, '00000000-0000-0000-0000-000000000000'::uuid),
    service_case_id
  );
create index maintenance_service_case_links_case_idx
  on public.maintenance_service_case_links (organization_id, service_case_id);

create or replace function app_private.maintenance_actor_is_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and member.role in ('admin', 'buero')
  );
$$;

create or replace function app_private.validate_maintenance_coverage()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.client_sites site
    where site.id = new.site_id
      and site.organization_id = new.organization_id
      and site.client_id = new.client_id
  ) then raise exception 'maintenance_coverage_site_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_maintenance_plan()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.client_sites site
    where site.id = new.site_id
      and site.organization_id = new.organization_id
      and site.client_id = new.client_id
  ) then raise exception 'maintenance_plan_site_mismatch'; end if;

  if new.maintenance_coverage_id is not null and not exists (
    select 1 from public.maintenance_coverages coverage
    where coverage.id = new.maintenance_coverage_id
      and coverage.organization_id = new.organization_id
      and coverage.client_id = new.client_id
      and coverage.site_id = new.site_id
  ) then raise exception 'maintenance_plan_coverage_mismatch'; end if;

  if new.current_revision_id is not null and not exists (
    select 1 from public.maintenance_plan_revisions revision
    where revision.id = new.current_revision_id
      and revision.organization_id = new.organization_id
      and revision.maintenance_plan_id = new.id
  ) then raise exception 'maintenance_plan_revision_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_maintenance_plan_revision()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.work_template_versions version
    join public.work_templates template on template.id = version.template_id
    where version.id = new.template_version_id
      and version.organization_id = new.organization_id
      and version.status = 'published'
      and template.organization_id = new.organization_id
      and template.target_type = 'job'
      and template.archived_at is null
  ) then raise exception 'maintenance_template_version_unavailable'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_maintenance_revision_equipment()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.maintenance_plan_revisions revision
    join public.maintenance_plans plan on plan.id = revision.maintenance_plan_id
      and plan.organization_id = new.organization_id
    join public.installed_equipment equipment on equipment.id = new.equipment_id
      and equipment.organization_id = new.organization_id
    where revision.id = new.maintenance_plan_revision_id
      and revision.organization_id = new.organization_id
      and equipment.client_id = plan.client_id
      and equipment.site_id = plan.site_id
      and equipment.archived_at is null
      and equipment.voided_at is null
  ) then raise exception 'maintenance_plan_equipment_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_maintenance_due_work()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.maintenance_plans plan
    join public.maintenance_plan_revisions revision
      on revision.id = new.maintenance_plan_revision_id
     and revision.organization_id = new.organization_id
    where plan.id = new.maintenance_plan_id
      and plan.organization_id = new.organization_id
      and revision.maintenance_plan_id = plan.id
  ) then raise exception 'maintenance_due_plan_revision_mismatch'; end if;

  if new.job_id is not null and not exists (
    select 1
    from public.jobs job
    join public.maintenance_plans plan on plan.id = new.maintenance_plan_id
      and plan.organization_id = new.organization_id
    where job.id = new.job_id
      and job.organization_id = new.organization_id
      and job.client_id = plan.client_id
      and job.site_id = plan.site_id
  ) then raise exception 'maintenance_due_job_mismatch'; end if;

  if new.planning_occurrence_id is not null and not exists (
    select 1 from public.planning_occurrences occurrence
    where occurrence.id = new.planning_occurrence_id
      and occurrence.organization_id = new.organization_id
      and occurrence.job_id = new.job_id
  ) then raise exception 'maintenance_due_occurrence_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_maintenance_due_evidence()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.maintenance_due_work due_work
    join public.work_artifact_revisions revision
      on revision.id = new.work_artifact_revision_id
     and revision.organization_id = new.organization_id
    where due_work.id = new.maintenance_due_work_id
      and due_work.organization_id = new.organization_id
      and due_work.job_id is not null
      and revision.job_id = due_work.job_id
  ) then raise exception 'maintenance_due_evidence_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_maintenance_service_case_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.maintenance_plans plan
    join public.service_cases service_case
      on service_case.id = new.service_case_id
     and service_case.organization_id = new.organization_id
    where plan.id = new.maintenance_plan_id
      and plan.organization_id = new.organization_id
      and service_case.client_id = plan.client_id
      and service_case.site_id = plan.site_id
  ) then raise exception 'maintenance_service_case_mismatch'; end if;

  if new.maintenance_due_work_id is not null and not exists (
    select 1 from public.maintenance_due_work due_work
    where due_work.id = new.maintenance_due_work_id
      and due_work.organization_id = new.organization_id
      and due_work.maintenance_plan_id = new.maintenance_plan_id
  ) then raise exception 'maintenance_service_case_due_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.guard_maintenance_write()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if coalesce(current_setting('app.maintenance_write', true), '') <> 'true' then
    raise exception 'maintenance_direct_write_forbidden';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function app_private.prevent_maintenance_history_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'maintenance_history_is_immutable';
end;
$$;

create trigger maintenance_coverages_validate before insert or update on public.maintenance_coverages
for each row execute function app_private.validate_maintenance_coverage();
create trigger maintenance_coverages_write_guard before insert or update or delete on public.maintenance_coverages
for each row execute function app_private.guard_maintenance_write();
create trigger maintenance_plans_validate before insert or update on public.maintenance_plans
for each row execute function app_private.validate_maintenance_plan();
create trigger maintenance_plans_write_guard before insert or update or delete on public.maintenance_plans
for each row execute function app_private.guard_maintenance_write();
create trigger maintenance_plan_revisions_validate before insert or update on public.maintenance_plan_revisions
for each row execute function app_private.validate_maintenance_plan_revision();
create trigger maintenance_plan_revisions_write_guard before insert or update or delete on public.maintenance_plan_revisions
for each row execute function app_private.guard_maintenance_write();
create trigger maintenance_plan_revision_equipment_validate before insert or update on public.maintenance_plan_revision_equipment
for each row execute function app_private.validate_maintenance_revision_equipment();
create trigger maintenance_plan_revision_equipment_write_guard before insert or update or delete on public.maintenance_plan_revision_equipment
for each row execute function app_private.guard_maintenance_write();
create trigger maintenance_due_work_validate before insert or update on public.maintenance_due_work
for each row execute function app_private.validate_maintenance_due_work();
create trigger maintenance_due_work_write_guard before insert or update or delete on public.maintenance_due_work
for each row execute function app_private.guard_maintenance_write();
create trigger maintenance_due_evidence_links_validate before insert or update on public.maintenance_due_evidence_links
for each row execute function app_private.validate_maintenance_due_evidence();
create trigger maintenance_due_evidence_links_write_guard before insert or update or delete on public.maintenance_due_evidence_links
for each row execute function app_private.guard_maintenance_write();
create trigger maintenance_service_case_links_validate before insert or update on public.maintenance_service_case_links
for each row execute function app_private.validate_maintenance_service_case_link();
create trigger maintenance_service_case_links_write_guard before insert or update or delete on public.maintenance_service_case_links
for each row execute function app_private.guard_maintenance_write();

create trigger maintenance_coverage_events_immutable before update or delete on public.maintenance_coverage_events
for each row execute function app_private.prevent_maintenance_history_mutation();
create trigger maintenance_plan_events_immutable before update or delete on public.maintenance_plan_events
for each row execute function app_private.prevent_maintenance_history_mutation();
create trigger maintenance_due_work_events_immutable before update or delete on public.maintenance_due_work_events
for each row execute function app_private.prevent_maintenance_history_mutation();
create trigger maintenance_due_evidence_links_immutable before update or delete on public.maintenance_due_evidence_links
for each row execute function app_private.prevent_maintenance_history_mutation();
create trigger maintenance_service_case_links_immutable before update or delete on public.maintenance_service_case_links
for each row execute function app_private.prevent_maintenance_history_mutation();

alter table public.maintenance_coverages enable row level security;
alter table public.maintenance_coverage_events enable row level security;
alter table public.maintenance_plans enable row level security;
alter table public.maintenance_plan_revisions enable row level security;
alter table public.maintenance_plan_revision_equipment enable row level security;
alter table public.maintenance_plan_events enable row level security;
alter table public.maintenance_due_work enable row level security;
alter table public.maintenance_due_work_events enable row level security;
alter table public.maintenance_due_evidence_links enable row level security;
alter table public.maintenance_service_case_links enable row level security;

create policy "Managers can view maintenance coverages" on public.maintenance_coverages
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view maintenance coverage events" on public.maintenance_coverage_events
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view maintenance plans" on public.maintenance_plans
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view maintenance plan revisions" on public.maintenance_plan_revisions
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view maintenance plan equipment" on public.maintenance_plan_revision_equipment
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view maintenance plan events" on public.maintenance_plan_events
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers or assigned employees can view maintenance due work" on public.maintenance_due_work
for select to authenticated using (
  app_private.maintenance_actor_is_manager(organization_id, (select auth.uid()))
  or exists (
    select 1 from public.job_assignments assignment
    where assignment.job_id = maintenance_due_work.job_id
      and assignment.user_id = (select auth.uid())
  )
);
create policy "Managers can view maintenance due events" on public.maintenance_due_work_events
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view maintenance due evidence" on public.maintenance_due_evidence_links
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));
create policy "Managers can view maintenance service links" on public.maintenance_service_case_links
for select to authenticated using (app_private.maintenance_actor_is_manager(organization_id, (select auth.uid())));

revoke all on public.maintenance_coverages, public.maintenance_coverage_events,
  public.maintenance_plans, public.maintenance_plan_revisions,
  public.maintenance_plan_revision_equipment, public.maintenance_plan_events,
  public.maintenance_due_work, public.maintenance_due_work_events,
  public.maintenance_due_evidence_links, public.maintenance_service_case_links
from public, anon, authenticated;
grant select on public.maintenance_coverages, public.maintenance_coverage_events,
  public.maintenance_plans, public.maintenance_plan_revisions,
  public.maintenance_plan_revision_equipment, public.maintenance_plan_events,
  public.maintenance_due_work, public.maintenance_due_work_events,
  public.maintenance_due_evidence_links, public.maintenance_service_case_links
to authenticated;
grant all on public.maintenance_coverages, public.maintenance_coverage_events,
  public.maintenance_plans, public.maintenance_plan_revisions,
  public.maintenance_plan_revision_equipment, public.maintenance_plan_events,
  public.maintenance_due_work, public.maintenance_due_work_events,
  public.maintenance_due_evidence_links, public.maintenance_service_case_links
to service_role;

alter table public.maintenance_coverages
  replica identity using index maintenance_coverages_id_organization_key;
alter table public.maintenance_plans
  replica identity using index maintenance_plans_id_organization_key;
alter table public.maintenance_due_work
  replica identity using index maintenance_due_work_id_organization_key;
alter publication supabase_realtime add table public.maintenance_coverages;
alter publication supabase_realtime add table public.maintenance_plans;
alter publication supabase_realtime add table public.maintenance_due_work;

revoke all on function app_private.maintenance_actor_is_manager(uuid, uuid)
from public, anon;
revoke all on function app_private.validate_maintenance_coverage(),
  app_private.validate_maintenance_plan(),
  app_private.validate_maintenance_plan_revision(),
  app_private.validate_maintenance_revision_equipment(),
  app_private.validate_maintenance_due_work(),
  app_private.validate_maintenance_due_evidence(),
  app_private.validate_maintenance_service_case_link(),
  app_private.guard_maintenance_write(),
  app_private.prevent_maintenance_history_mutation()
from public, anon, authenticated;
grant execute on function app_private.maintenance_actor_is_manager(uuid, uuid)
to authenticated, service_role;
grant execute on function app_private.validate_maintenance_coverage(),
  app_private.validate_maintenance_plan(),
  app_private.validate_maintenance_plan_revision(),
  app_private.validate_maintenance_revision_equipment(),
  app_private.validate_maintenance_due_work(),
  app_private.validate_maintenance_due_evidence(),
  app_private.validate_maintenance_service_case_link(),
  app_private.guard_maintenance_write(),
  app_private.prevent_maintenance_history_mutation()
to service_role;
