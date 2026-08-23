create table public.work_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_type text not null check (target_type in ('job', 'project')),
  draft_version_id uuid,
  current_published_version_id uuid,
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_templates_archive_actor_check check (
    (archived_at is null and archived_by is null)
    or (archived_at is not null and archived_by is not null)
  )
);

create table public.work_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.work_templates(id) on delete restrict,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  name text not null,
  description text,
  created_by uuid references auth.users(id) on delete set null,
  published_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint work_template_versions_name_length
    check (length(btrim(name)) between 1 and 160),
  constraint work_template_versions_description_length
    check (description is null or length(description) <= 2000),
  constraint work_template_versions_publish_state_check check (
    (status = 'draft' and published_at is null and published_by is null)
    or (status = 'published' and published_at is not null and published_by is not null)
  ),
  unique (template_id, version_number)
);

alter table public.work_templates
  add constraint work_templates_draft_version_id_fkey
  foreign key (draft_version_id) references public.work_template_versions(id) on delete restrict;

alter table public.work_templates
  add constraint work_templates_current_published_version_id_fkey
  foreign key (current_published_version_id) references public.work_template_versions(id) on delete restrict;

create unique index work_template_versions_one_draft_per_template
  on public.work_template_versions (template_id)
  where status = 'draft';
create index work_templates_organization_target_idx
  on public.work_templates (organization_id, target_type, archived_at);
create index work_template_versions_organization_idx
  on public.work_template_versions (organization_id, template_id, version_number desc);

create table public.work_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null references public.work_template_versions(id) on delete restrict,
  copied_from_item_id uuid references public.work_template_items(id) on delete set null,
  item_kind text not null check (item_kind in ('task', 'checklist')),
  content text not null,
  requirement_state text not null check (requirement_state in ('required', 'optional')),
  group_label text,
  notes text,
  sort_order integer not null check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_template_items_content_length
    check (length(btrim(content)) between 1 and 1000),
  constraint work_template_items_group_length
    check (group_label is null or length(btrim(group_label)) between 1 and 120),
  constraint work_template_items_notes_length
    check (notes is null or length(notes) <= 2000),
  unique (version_id, sort_order)
);

create table public.work_template_item_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null references public.work_template_versions(id) on delete restrict,
  template_item_id uuid not null references public.work_template_items(id) on delete cascade,
  description text not null,
  document_category text not null check (
    document_category in ('photo', 'contract', 'invoice', 'offer', 'report', 'other')
  ),
  sort_order integer not null check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_template_evidence_description_length
    check (length(btrim(description)) between 1 and 500),
  unique (template_item_id, sort_order)
);

create table public.work_template_item_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null references public.work_template_versions(id) on delete restrict,
  predecessor_item_id uuid not null references public.work_template_items(id) on delete cascade,
  dependent_item_id uuid not null references public.work_template_items(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint work_template_dependencies_not_self
    check (predecessor_item_id <> dependent_item_id),
  unique (version_id, predecessor_item_id, dependent_item_id)
);

create table public.work_template_material_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null references public.work_template_versions(id) on delete restrict,
  item_id uuid not null references public.inventory_items(id) on delete restrict,
  preferred_location_id uuid references public.inventory_locations(id) on delete restrict,
  planned_quantity numeric(12,3) not null check (planned_quantity > 0),
  is_billable boolean not null default true,
  notes text,
  sort_order integer not null check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_template_material_notes_length
    check (notes is null or length(notes) <= 1000),
  unique (version_id, sort_order)
);

create table public.work_template_capability_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version_id uuid not null references public.work_template_versions(id) on delete restrict,
  capability_id uuid not null references public.organization_capabilities(id) on delete restrict,
  require_confirmation boolean not null default false,
  sort_order integer not null check (sort_order >= 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (version_id, capability_id),
  unique (version_id, sort_order)
);

create index work_template_items_version_idx
  on public.work_template_items (version_id, sort_order);
create index work_template_items_copied_from_idx
  on public.work_template_items (copied_from_item_id)
  where copied_from_item_id is not null;
create index work_template_evidence_version_idx
  on public.work_template_item_evidence_requirements (version_id, template_item_id, sort_order);
create index work_template_dependencies_predecessor_idx
  on public.work_template_item_dependencies (predecessor_item_id);
create index work_template_dependencies_dependent_idx
  on public.work_template_item_dependencies (dependent_item_id);
create index work_template_material_version_idx
  on public.work_template_material_lines (version_id, sort_order);
create index work_template_material_item_idx
  on public.work_template_material_lines (item_id);
create index work_template_material_location_idx
  on public.work_template_material_lines (preferred_location_id)
  where preferred_location_id is not null;
create index work_template_capability_version_idx
  on public.work_template_capability_requirements (version_id, sort_order);
create index work_template_capability_definition_idx
  on public.work_template_capability_requirements (capability_id);

create table public.work_template_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.work_templates(id) on delete restrict,
  template_version_id uuid not null references public.work_template_versions(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  idempotency_key text not null,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz not null default now(),
  constraint work_template_applications_one_target
    check (num_nonnulls(job_id, project_id) = 1),
  constraint work_template_applications_idempotency_length
    check (length(btrim(idempotency_key)) between 8 and 200),
  unique (organization_id, idempotency_key)
);

create unique index work_template_applications_job_version_unique
  on public.work_template_applications (job_id, template_version_id)
  where job_id is not null;
create unique index work_template_applications_project_version_unique
  on public.work_template_applications (project_id, template_version_id)
  where project_id is not null;
create index work_template_applications_template_idx
  on public.work_template_applications (template_id, applied_at desc);
create index work_template_applications_version_idx
  on public.work_template_applications (template_version_id);
create index work_template_applications_job_idx
  on public.work_template_applications (job_id, applied_at desc)
  where job_id is not null;
create index work_template_applications_project_idx
  on public.work_template_applications (project_id, applied_at desc)
  where project_id is not null;

create table public.work_template_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  template_id uuid not null references public.work_templates(id) on delete restrict,
  template_version_id uuid references public.work_template_versions(id) on delete restrict,
  application_id uuid references public.work_template_applications(id) on delete restrict,
  event_type text not null check (
    event_type in (
      'created', 'draft_saved', 'published', 'draft_created',
      'archived', 'reactivated', 'applied'
    )
  ),
  event_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(event_payload) = 'object'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index work_template_events_template_created_idx
  on public.work_template_events (template_id, created_at desc);
create index work_template_events_application_idx
  on public.work_template_events (application_id)
  where application_id is not null;

alter table public.job_instruction_items
  alter column job_id drop not null,
  add column project_id uuid references public.projects(id) on delete cascade,
  add column item_kind text not null default 'checklist'
    check (item_kind in ('task', 'checklist')),
  add column requirement_state text
    check (requirement_state in ('required', 'optional')),
  add column group_label text,
  add column notes text,
  add column work_template_application_id uuid
    references public.work_template_applications(id) on delete set null,
  add column source_work_template_item_id uuid
    references public.work_template_items(id) on delete set null,
  add constraint job_instruction_items_one_target
    check (num_nonnulls(job_id, project_id) = 1),
  add constraint job_instruction_items_group_length
    check (group_label is null or length(btrim(group_label)) between 1 and 120),
  add constraint job_instruction_items_notes_length
    check (notes is null or length(notes) <= 2000),
  add constraint job_instruction_items_template_origin_check check (
    num_nonnulls(work_template_application_id, source_work_template_item_id) in (0, 2)
  );

create index job_instruction_items_project_sort_idx
  on public.job_instruction_items (project_id, sort_order)
  where project_id is not null;
create index job_instruction_items_template_application_idx
  on public.job_instruction_items (work_template_application_id)
  where work_template_application_id is not null;
create index job_instruction_items_source_template_item_idx
  on public.job_instruction_items (source_work_template_item_id)
  where source_work_template_item_id is not null;

create table public.job_instruction_item_evidence_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  instruction_item_id uuid not null references public.job_instruction_items(id) on delete cascade,
  description text not null,
  document_category text not null check (
    document_category in ('photo', 'contract', 'invoice', 'offer', 'report', 'other')
  ),
  sort_order integer not null check (sort_order >= 0),
  work_template_application_id uuid
    references public.work_template_applications(id) on delete set null,
  source_work_template_evidence_id uuid
    references public.work_template_item_evidence_requirements(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_instruction_evidence_description_length
    check (length(btrim(description)) between 1 and 500),
  constraint job_instruction_evidence_origin_check check (
    num_nonnulls(work_template_application_id, source_work_template_evidence_id) in (0, 2)
  ),
  unique (instruction_item_id, sort_order)
);

create table public.job_instruction_item_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  predecessor_item_id uuid not null references public.job_instruction_items(id) on delete cascade,
  dependent_item_id uuid not null references public.job_instruction_items(id) on delete cascade,
  work_template_application_id uuid
    references public.work_template_applications(id) on delete set null,
  source_work_template_dependency_id uuid
    references public.work_template_item_dependencies(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint job_instruction_dependencies_not_self
    check (predecessor_item_id <> dependent_item_id),
  constraint job_instruction_dependencies_origin_check check (
    num_nonnulls(work_template_application_id, source_work_template_dependency_id) in (0, 2)
  ),
  unique (predecessor_item_id, dependent_item_id)
);

create index job_instruction_evidence_item_idx
  on public.job_instruction_item_evidence_requirements (instruction_item_id, sort_order);
create index job_instruction_evidence_application_idx
  on public.job_instruction_item_evidence_requirements (work_template_application_id)
  where work_template_application_id is not null;
create index job_instruction_dependencies_predecessor_idx
  on public.job_instruction_item_dependencies (predecessor_item_id);
create index job_instruction_dependencies_dependent_idx
  on public.job_instruction_item_dependencies (dependent_item_id);
create index job_instruction_dependencies_application_idx
  on public.job_instruction_item_dependencies (work_template_application_id)
  where work_template_application_id is not null;

alter table public.job_material_lines
  add column work_template_application_id uuid
    references public.work_template_applications(id) on delete set null,
  add column source_work_template_material_line_id uuid
    references public.work_template_material_lines(id) on delete set null,
  add constraint job_material_lines_template_origin_check check (
    num_nonnulls(work_template_application_id, source_work_template_material_line_id) in (0, 2)
  );

create index job_material_lines_template_application_idx
  on public.job_material_lines (work_template_application_id)
  where work_template_application_id is not null;
create index job_material_lines_source_template_line_idx
  on public.job_material_lines (source_work_template_material_line_id)
  where source_work_template_material_line_id is not null;

alter table public.job_capability_requirements
  drop constraint job_capability_requirements_job_id_capability_id_key,
  alter column job_id drop not null,
  add column project_id uuid references public.projects(id) on delete cascade,
  add constraint job_capability_requirements_one_target
    check (num_nonnulls(job_id, project_id) = 1);

create unique index job_capability_requirements_job_capability_unique
  on public.job_capability_requirements (job_id, capability_id)
  where job_id is not null;
create unique index job_capability_requirements_project_capability_unique
  on public.job_capability_requirements (project_id, capability_id)
  where project_id is not null;
create index job_capability_requirements_project_idx
  on public.job_capability_requirements (project_id)
  where project_id is not null;

create table public.job_capability_requirement_origins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requirement_id uuid not null references public.job_capability_requirements(id) on delete cascade,
  work_template_application_id uuid not null
    references public.work_template_applications(id) on delete cascade,
  source_work_template_requirement_id uuid not null
    references public.work_template_capability_requirements(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (requirement_id, work_template_application_id, source_work_template_requirement_id)
);

create index job_capability_requirement_origins_requirement_idx
  on public.job_capability_requirement_origins (requirement_id);
create index job_capability_requirement_origins_application_idx
  on public.job_capability_requirement_origins (work_template_application_id);
create index job_capability_requirement_origins_source_idx
  on public.job_capability_requirement_origins (source_work_template_requirement_id);

create or replace function app_private.assert_work_template_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_actor_id is null or not exists (
    select 1
    from public.organization_members member
    where member.organization_id = p_organization_id
      and member.user_id = p_actor_id
      and member.role in ('admin', 'buero')
  ) then
    raise exception 'work_template_not_authorized';
  end if;
end;
$$;

create or replace function app_private.can_view_work_instruction_target(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    exists (
      select 1
      from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = p_user_id
        and member.role in ('admin', 'buero')
    )
    or (
      p_job_id is not null
      and p_project_id is null
      and exists (
        select 1
        from public.jobs job
        join public.job_assignments assignment on assignment.job_id = job.id
        where job.id = p_job_id
          and job.organization_id = p_organization_id
          and assignment.user_id = p_user_id
      )
    )
  );
$$;

create or replace function app_private.can_view_work_instruction_item(
  p_instruction_item_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.job_instruction_items item
    where item.id = p_instruction_item_id
      and app_private.can_view_work_instruction_target(
        item.organization_id,
        item.job_id,
        item.project_id,
        p_user_id
      )
  );
$$;

create or replace function app_private.validate_work_template_version_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.work_templates template
    where template.id = new.template_id
      and template.organization_id = new.organization_id
  ) then
    raise exception 'work_template_version_organization_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_template_pointers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.draft_version_id is not null and not exists (
    select 1 from public.work_template_versions version
    where version.id = new.draft_version_id
      and version.template_id = new.id
      and version.organization_id = new.organization_id
      and version.status = 'draft'
  ) then
    raise exception 'work_template_draft_pointer_mismatch';
  end if;
  if new.current_published_version_id is not null and not exists (
    select 1 from public.work_template_versions version
    where version.id = new.current_published_version_id
      and version.template_id = new.id
      and version.organization_id = new.organization_id
      and version.status = 'published'
  ) then
    raise exception 'work_template_published_pointer_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.guard_published_work_template_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'published' then
    raise exception 'published_work_template_version_immutable';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_template_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  child_organization_id uuid;
  child_version_id uuid;
  version_status text;
begin
  if tg_op = 'DELETE' then
    child_organization_id := old.organization_id;
    child_version_id := old.version_id;
  else
    child_organization_id := new.organization_id;
    child_version_id := new.version_id;
  end if;

  select version.status into version_status
  from public.work_template_versions version
  where version.id = child_version_id
    and version.organization_id = child_organization_id;

  if version_status is null then
    raise exception 'work_template_child_organization_mismatch';
  end if;
  if version_status <> 'draft' then
    raise exception 'published_work_template_version_immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_template_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.work_template_items item
    where item.id = new.template_item_id
      and item.version_id = new.version_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'work_template_evidence_item_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_template_dependency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.work_template_items predecessor
    where predecessor.id = new.predecessor_item_id
      and predecessor.version_id = new.version_id
      and predecessor.organization_id = new.organization_id
  ) or not exists (
    select 1 from public.work_template_items dependent
    where dependent.id = new.dependent_item_id
      and dependent.version_id = new.version_id
      and dependent.organization_id = new.organization_id
  ) then
    raise exception 'work_template_dependency_item_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_template_material()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id
      and item.organization_id = new.organization_id
      and item.item_type in ('material', 'consumable')
  ) then
    raise exception 'work_template_material_unavailable';
  end if;
  if new.preferred_location_id is not null and not exists (
    select 1 from public.inventory_locations location
    where location.id = new.preferred_location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'work_template_location_unavailable';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_template_capability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  capability_kind text;
begin
  select capability.kind into capability_kind
  from public.organization_capabilities capability
  where capability.id = new.capability_id
    and capability.organization_id = new.organization_id;
  if capability_kind is null then
    raise exception 'work_template_capability_unavailable';
  end if;
  if new.require_confirmation and capability_kind <> 'certification' then
    raise exception 'work_template_skill_confirmation_invalid';
  end if;
  return new;
end;
$$;

create or replace function app_private.prevent_work_template_history_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'work_template_history_immutable';
end;
$$;

create or replace function app_private.validate_work_template_event_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.work_templates template
    where template.id = new.template_id
      and template.organization_id = new.organization_id
  ) then
    raise exception 'work_template_event_template_mismatch';
  end if;
  if new.template_version_id is not null and not exists (
    select 1 from public.work_template_versions version
    where version.id = new.template_version_id
      and version.template_id = new.template_id
      and version.organization_id = new.organization_id
  ) then
    raise exception 'work_template_event_version_mismatch';
  end if;
  if new.application_id is not null and not exists (
    select 1 from public.work_template_applications application
    where application.id = new.application_id
      and application.template_id = new.template_id
      and application.organization_id = new.organization_id
      and application.template_version_id is not distinct from new.template_version_id
  ) then
    raise exception 'work_template_event_application_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_template_application_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.work_templates template
    join public.work_template_versions version
      on version.id = new.template_version_id
     and version.template_id = template.id
    where template.id = new.template_id
      and template.organization_id = new.organization_id
      and version.organization_id = new.organization_id
      and version.status = 'published'
  ) then
    raise exception 'work_template_application_version_mismatch';
  end if;
  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then
    raise exception 'work_template_application_job_mismatch';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then
    raise exception 'work_template_application_project_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_job_instruction_item_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then
    raise exception 'job_instruction_item_job_mismatch';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then
    raise exception 'job_instruction_item_project_mismatch';
  end if;
  if tg_op = 'UPDATE' and (
    old.work_template_application_id is distinct from new.work_template_application_id
    or old.source_work_template_item_id is distinct from new.source_work_template_item_id
  ) then
    raise exception 'job_instruction_item_origin_immutable';
  end if;
  if new.work_template_application_id is not null and not exists (
    select 1
    from public.work_template_applications application
    join public.work_template_items template_item
      on template_item.id = new.source_work_template_item_id
     and template_item.version_id = application.template_version_id
    where application.id = new.work_template_application_id
      and application.organization_id = new.organization_id
      and application.job_id is not distinct from new.job_id
      and application.project_id is not distinct from new.project_id
  ) then
    raise exception 'job_instruction_item_origin_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_job_instruction_evidence_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.job_instruction_items item
    where item.id = new.instruction_item_id
      and item.organization_id = new.organization_id
  ) then
    raise exception 'job_instruction_evidence_item_mismatch';
  end if;
  if tg_op = 'UPDATE' and (
    old.work_template_application_id is distinct from new.work_template_application_id
    or old.source_work_template_evidence_id is distinct from new.source_work_template_evidence_id
  ) then
    raise exception 'job_instruction_evidence_origin_immutable';
  end if;
  if new.work_template_application_id is not null and not exists (
    select 1
    from public.work_template_applications application
    join public.work_template_item_evidence_requirements source
      on source.id = new.source_work_template_evidence_id
     and source.version_id = application.template_version_id
    join public.job_instruction_items item
      on item.id = new.instruction_item_id
     and item.work_template_application_id = application.id
     and item.source_work_template_item_id = source.template_item_id
    where application.id = new.work_template_application_id
      and application.organization_id = new.organization_id
  ) then
    raise exception 'job_instruction_evidence_origin_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_job_instruction_dependency_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  predecessor_job_id uuid;
  predecessor_project_id uuid;
  dependent_job_id uuid;
  dependent_project_id uuid;
begin
  select item.job_id, item.project_id
  into predecessor_job_id, predecessor_project_id
  from public.job_instruction_items item
  where item.id = new.predecessor_item_id
    and item.organization_id = new.organization_id;

  select item.job_id, item.project_id
  into dependent_job_id, dependent_project_id
  from public.job_instruction_items item
  where item.id = new.dependent_item_id
    and item.organization_id = new.organization_id;

  if num_nonnulls(predecessor_job_id, predecessor_project_id) <> 1
    or num_nonnulls(dependent_job_id, dependent_project_id) <> 1
    or predecessor_job_id is distinct from dependent_job_id
    or predecessor_project_id is distinct from dependent_project_id then
    raise exception 'job_instruction_dependency_target_mismatch';
  end if;

  if new.work_template_application_id is not null and not exists (
    select 1
    from public.work_template_applications application
    join public.work_template_item_dependencies source
      on source.id = new.source_work_template_dependency_id
     and source.version_id = application.template_version_id
    join public.job_instruction_items predecessor
      on predecessor.id = new.predecessor_item_id
     and predecessor.work_template_application_id = application.id
     and predecessor.source_work_template_item_id = source.predecessor_item_id
    join public.job_instruction_items dependent
      on dependent.id = new.dependent_item_id
     and dependent.work_template_application_id = application.id
     and dependent.source_work_template_item_id = source.dependent_item_id
    where application.id = new.work_template_application_id
      and application.organization_id = new.organization_id
  ) then
    raise exception 'job_instruction_dependency_origin_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_job_material_line_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then
    raise exception 'job material line job must belong to same organization';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then
    raise exception 'job material line project must belong to same organization';
  end if;
  if not exists (
    select 1 from public.inventory_items item
    where item.id = new.item_id and item.organization_id = new.organization_id
  ) then
    raise exception 'job material line item must belong to same organization';
  end if;
  if new.preferred_location_id is not null and not exists (
    select 1 from public.inventory_locations location
    where location.id = new.preferred_location_id
      and location.organization_id = new.organization_id
  ) then
    raise exception 'job material line location must belong to same organization';
  end if;
  if tg_op = 'UPDATE' and (
    old.work_template_application_id is distinct from new.work_template_application_id
    or old.source_work_template_material_line_id is distinct from new.source_work_template_material_line_id
  ) then
    raise exception 'job_material_line_origin_immutable';
  end if;
  if new.work_template_application_id is not null and not exists (
    select 1
    from public.work_template_applications application
    join public.work_template_material_lines source
      on source.id = new.source_work_template_material_line_id
     and source.version_id = application.template_version_id
    where application.id = new.work_template_application_id
      and application.organization_id = new.organization_id
      and application.job_id is not distinct from new.job_id
      and (
        application.project_id is not distinct from new.project_id
        or (application.job_id is not null and new.project_id is not null)
      )
  ) then
    raise exception 'job_material_line_origin_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_job_capability_requirement_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  capability_kind text;
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then
    raise exception 'job capability requirement job organization mismatch';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then
    raise exception 'job capability requirement project organization mismatch';
  end if;
  select capability.kind into capability_kind
  from public.organization_capabilities capability
  where capability.id = new.capability_id
    and capability.organization_id = new.organization_id
    and capability.retired_at is null;
  if capability_kind is null then
    raise exception 'job capability requirement definition organization mismatch';
  end if;
  if new.require_confirmation and capability_kind <> 'certification' then
    raise exception 'skill requirements cannot require confirmation';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_job_capability_origin_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.job_capability_requirements requirement
    join public.work_template_applications application
      on application.id = new.work_template_application_id
     and application.organization_id = requirement.organization_id
     and application.job_id is not distinct from requirement.job_id
     and application.project_id is not distinct from requirement.project_id
    join public.work_template_capability_requirements source
      on source.id = new.source_work_template_requirement_id
     and source.version_id = application.template_version_id
     and source.capability_id = requirement.capability_id
    where requirement.id = new.requirement_id
      and requirement.organization_id = new.organization_id
  ) then
    raise exception 'job_capability_requirement_origin_mismatch';
  end if;
  return new;
end;
$$;

create trigger validate_work_template_version_org
before insert or update on public.work_template_versions
for each row execute function app_private.validate_work_template_version_org();
create trigger validate_work_template_pointers
before insert or update on public.work_templates
for each row execute function app_private.validate_work_template_pointers();
create trigger guard_published_work_template_version
before update or delete on public.work_template_versions
for each row execute function app_private.guard_published_work_template_version();

create trigger validate_work_template_items
before insert or update or delete on public.work_template_items
for each row execute function app_private.validate_work_template_child();
create trigger validate_work_template_evidence_children
before insert or update or delete on public.work_template_item_evidence_requirements
for each row execute function app_private.validate_work_template_child();
create trigger validate_work_template_evidence
before insert or update on public.work_template_item_evidence_requirements
for each row execute function app_private.validate_work_template_evidence();
create trigger validate_work_template_dependency_children
before insert or update or delete on public.work_template_item_dependencies
for each row execute function app_private.validate_work_template_child();
create trigger validate_work_template_dependency
before insert or update on public.work_template_item_dependencies
for each row execute function app_private.validate_work_template_dependency();
create trigger validate_work_template_material_children
before insert or update or delete on public.work_template_material_lines
for each row execute function app_private.validate_work_template_child();
create trigger validate_work_template_material
before insert or update on public.work_template_material_lines
for each row execute function app_private.validate_work_template_material();
create trigger validate_work_template_capability_children
before insert or update or delete on public.work_template_capability_requirements
for each row execute function app_private.validate_work_template_child();
create trigger validate_work_template_capability
before insert or update on public.work_template_capability_requirements
for each row execute function app_private.validate_work_template_capability();

create trigger validate_work_template_application_org
before insert on public.work_template_applications
for each row execute function app_private.validate_work_template_application_org();
create trigger prevent_work_template_application_change
before update or delete on public.work_template_applications
for each row execute function app_private.prevent_work_template_history_change();
create trigger prevent_work_template_event_change
before update or delete on public.work_template_events
for each row execute function app_private.prevent_work_template_history_change();
create trigger validate_work_template_event_org
before insert on public.work_template_events
for each row execute function app_private.validate_work_template_event_org();

create trigger validate_job_instruction_item_org
before insert or update on public.job_instruction_items
for each row execute function app_private.validate_job_instruction_item_org();
create trigger validate_job_instruction_evidence_org
before insert or update on public.job_instruction_item_evidence_requirements
for each row execute function app_private.validate_job_instruction_evidence_org();
create trigger validate_job_instruction_dependency_org
before insert or update on public.job_instruction_item_dependencies
for each row execute function app_private.validate_job_instruction_dependency_org();
create trigger validate_job_capability_origin_org
before insert or update on public.job_capability_requirement_origins
for each row execute function app_private.validate_job_capability_origin_org();

drop policy if exists "Users can view permitted instruction items"
  on public.job_instruction_items;
create policy "Users can view permitted instruction items"
on public.job_instruction_items for select to authenticated
using (
  (select app_private.can_view_work_instruction_target(
    organization_id,
    job_id,
    project_id,
    (select auth.uid())
  ))
);

alter table public.work_templates enable row level security;
alter table public.work_template_versions enable row level security;
alter table public.work_template_items enable row level security;
alter table public.work_template_item_evidence_requirements enable row level security;
alter table public.work_template_item_dependencies enable row level security;
alter table public.work_template_material_lines enable row level security;
alter table public.work_template_capability_requirements enable row level security;
alter table public.work_template_applications enable row level security;
alter table public.work_template_events enable row level security;
alter table public.job_instruction_item_evidence_requirements enable row level security;
alter table public.job_instruction_item_dependencies enable row level security;
alter table public.job_capability_requirement_origins enable row level security;

create policy "Managers can view work templates"
on public.work_templates for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template versions"
on public.work_template_versions for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template items"
on public.work_template_items for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template evidence"
on public.work_template_item_evidence_requirements for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template dependencies"
on public.work_template_item_dependencies for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template material"
on public.work_template_material_lines for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template capabilities"
on public.work_template_capability_requirements for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template applications"
on public.work_template_applications for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));
create policy "Managers can view work template events"
on public.work_template_events for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));

create policy "Users can view permitted instruction evidence"
on public.job_instruction_item_evidence_requirements for select to authenticated
using ((select app_private.can_view_work_instruction_item(
  instruction_item_id,
  (select auth.uid())
)));
create policy "Users can view permitted instruction dependencies"
on public.job_instruction_item_dependencies for select to authenticated
using ((select app_private.can_view_work_instruction_item(
  dependent_item_id,
  (select auth.uid())
)));
create policy "Managers can view capability requirement origins"
on public.job_capability_requirement_origins for select to authenticated
using (organization_id in (
  select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
));

revoke all on public.work_templates from anon, authenticated;
revoke all on public.work_template_versions from anon, authenticated;
revoke all on public.work_template_items from anon, authenticated;
revoke all on public.work_template_item_evidence_requirements from anon, authenticated;
revoke all on public.work_template_item_dependencies from anon, authenticated;
revoke all on public.work_template_material_lines from anon, authenticated;
revoke all on public.work_template_capability_requirements from anon, authenticated;
revoke all on public.work_template_applications from anon, authenticated;
revoke all on public.work_template_events from anon, authenticated;
revoke all on public.job_instruction_item_evidence_requirements from anon, authenticated;
revoke all on public.job_instruction_item_dependencies from anon, authenticated;
revoke all on public.job_capability_requirement_origins from anon, authenticated;

grant select on public.work_templates to authenticated;
grant select on public.work_template_versions to authenticated;
grant select on public.work_template_items to authenticated;
grant select on public.work_template_item_evidence_requirements to authenticated;
grant select on public.work_template_item_dependencies to authenticated;
grant select on public.work_template_material_lines to authenticated;
grant select on public.work_template_capability_requirements to authenticated;
grant select on public.work_template_applications to authenticated;
grant select on public.work_template_events to authenticated;
grant select on public.job_instruction_item_evidence_requirements to authenticated;
grant select on public.job_instruction_item_dependencies to authenticated;
grant select on public.job_capability_requirement_origins to authenticated;

grant all on public.work_templates to service_role;
grant all on public.work_template_versions to service_role;
grant all on public.work_template_items to service_role;
grant all on public.work_template_item_evidence_requirements to service_role;
grant all on public.work_template_item_dependencies to service_role;
grant all on public.work_template_material_lines to service_role;
grant all on public.work_template_capability_requirements to service_role;
grant all on public.work_template_applications to service_role;
grant all on public.work_template_events to service_role;
grant all on public.job_instruction_item_evidence_requirements to service_role;
grant all on public.job_instruction_item_dependencies to service_role;
grant all on public.job_capability_requirement_origins to service_role;

revoke all on function app_private.assert_work_template_manager(uuid, uuid)
  from public, anon, authenticated;
revoke all on function app_private.can_view_work_instruction_target(uuid, uuid, uuid, uuid)
  from public, anon;
revoke all on function app_private.can_view_work_instruction_item(uuid, uuid)
  from public, anon;
grant execute on function app_private.can_view_work_instruction_target(uuid, uuid, uuid, uuid)
  to authenticated, service_role;
grant execute on function app_private.can_view_work_instruction_item(uuid, uuid)
  to authenticated, service_role;

revoke all on function app_private.validate_work_template_version_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_pointers()
  from public, anon, authenticated;
revoke all on function app_private.guard_published_work_template_version()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_child()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_evidence()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_dependency()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_material()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_capability()
  from public, anon, authenticated;
revoke all on function app_private.prevent_work_template_history_change()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_event_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_work_template_application_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_job_instruction_item_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_job_instruction_evidence_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_job_instruction_dependency_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_job_material_line_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_job_capability_requirement_org()
  from public, anon, authenticated;
revoke all on function app_private.validate_job_capability_origin_org()
  from public, anon, authenticated;

alter table public.work_templates replica identity full;
alter table public.work_template_versions replica identity full;
alter table public.work_template_items replica identity full;
alter table public.work_template_item_evidence_requirements replica identity full;
alter table public.work_template_item_dependencies replica identity full;
alter table public.work_template_material_lines replica identity full;
alter table public.work_template_capability_requirements replica identity full;
alter table public.work_template_applications replica identity full;
alter table public.job_instruction_item_evidence_requirements replica identity full;
alter table public.job_instruction_item_dependencies replica identity full;
alter table public.job_capability_requirement_origins replica identity full;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'work_templates',
    'work_template_versions',
    'work_template_items',
    'work_template_item_evidence_requirements',
    'work_template_item_dependencies',
    'work_template_material_lines',
    'work_template_capability_requirements',
    'work_template_applications',
    'job_instruction_item_evidence_requirements',
    'job_instruction_item_dependencies',
    'job_capability_requirement_origins'
  ] loop
    if not exists (
      select 1 from pg_publication_tables publication_table
      where publication_table.pubname = 'supabase_realtime'
        and publication_table.schemaname = 'public'
        and publication_table.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;
