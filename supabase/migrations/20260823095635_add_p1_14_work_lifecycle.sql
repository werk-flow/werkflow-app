-- P1-14: one canonical execution lifecycle plus separate blocker,
-- dependency, readiness and parking facts. Existing work remains legacy
-- until a person performs an explicit P1-14 action.

create type public.work_execution_state as enum (
  'not_started',
  'in_progress',
  'interrupted',
  'execution_complete',
  'handed_over',
  'cancelled'
);

create type public.work_blocker_kind as enum ('blocker', 'parking');
create type public.work_blocker_reason as enum (
  'customer',
  'material',
  'approval',
  'capacity',
  'site_access',
  'dependency',
  'external_trade',
  'safety',
  'internal_clarification',
  'other'
);
create type public.work_blocker_state as enum ('open', 'resolved');
create type public.work_dependency_effect as enum (
  'blocks_start',
  'blocks_completion',
  'warning'
);
create type public.work_declared_dependency_kind as enum (
  'approval',
  'delivery',
  'site_condition',
  'external_trade'
);
create type public.work_dependency_manual_state as enum (
  'open',
  'satisfied',
  'waived'
);

alter table public.jobs
  add column execution_state public.work_execution_state,
  add column execution_version bigint not null default 0;

alter table public.projects
  add column execution_state_override public.work_execution_state,
  add column execution_version bigint not null default 0,
  add column execution_override_reason text,
  add constraint projects_execution_override_reason_check check (
    execution_override_reason is null
    or length(btrim(execution_override_reason)) between 3 and 1000
  );

alter table public.job_instruction_items
  add column completion_version bigint not null default 0;

-- Defaults apply to work created after P1-14. Existing rows remain NULL.
alter table public.jobs
  alter column execution_state set default 'not_started'::public.work_execution_state;

create table public.work_execution_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  event_type text not null check (event_type in (
    'transitioned', 'reopened', 'cancelled', 'restored',
    'handed_over', 'handover_withdrawn', 'override_set', 'override_cleared'
  )),
  from_state public.work_execution_state,
  to_state public.work_execution_state,
  previous_version bigint not null check (previous_version >= 0),
  resulting_version bigint not null check (resulting_version > previous_version),
  reason text,
  gate_snapshot jsonb not null default '{}'::jsonb,
  gate_fingerprint text not null check (length(gate_fingerprint) = 64),
  event_payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint work_execution_events_one_target_check check (
    (job_id is not null)::integer + (project_id is not null)::integer = 1
  ),
  constraint work_execution_events_reason_check check (
    reason is null or length(btrim(reason)) between 3 and 1000
  )
);

create table public.work_blockers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  instruction_item_id uuid references public.job_instruction_items(id) on delete cascade,
  kind public.work_blocker_kind not null default 'blocker',
  reason public.work_blocker_reason,
  details text,
  responsible_employee_record_id uuid references public.employee_records(id) on delete set null,
  next_review_date date,
  state public.work_blocker_state not null default 'open',
  version bigint not null default 1 check (version > 0),
  is_legacy boolean not null default false,
  legacy_source text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  constraint work_blockers_one_target_check check (
    (job_id is not null)::integer
      + (project_id is not null)::integer
      + (instruction_item_id is not null)::integer = 1
  ),
  constraint work_blockers_details_check check (
    details is null or length(btrim(details)) between 3 and 2000
  ),
  constraint work_blockers_new_context_check check (
    is_legacy
    or (
      reason is not null
      and responsible_employee_record_id is not null
      and next_review_date is not null
      and (reason <> 'other' or details is not null)
    )
  ),
  constraint work_blockers_resolution_check check (
    (state = 'open' and resolved_by is null and resolved_at is null and resolution_note is null)
    or (
      state = 'resolved'
      and (
        is_legacy
        or (
          resolved_by is not null
          and resolved_at is not null
          and length(btrim(resolution_note)) between 3 and 1000
        )
      )
    )
  )
);

create table public.work_blocker_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  blocker_id uuid not null references public.work_blockers(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'updated', 'resolved', 'reopened', 'parked', 'unparked',
    'legacy_context_set', 'legacy_context_updated', 'legacy_unparked'
  )),
  before_state jsonb,
  after_state jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.work_dependencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dependent_job_id uuid references public.jobs(id) on delete cascade,
  dependent_project_id uuid references public.projects(id) on delete cascade,
  predecessor_job_id uuid references public.jobs(id) on delete restrict,
  predecessor_project_id uuid references public.projects(id) on delete restrict,
  predecessor_instruction_item_id uuid references public.job_instruction_items(id) on delete restrict,
  declared_kind public.work_declared_dependency_kind,
  description text,
  effect public.work_dependency_effect not null,
  manual_state public.work_dependency_manual_state,
  version bigint not null default 1 check (version > 0),
  removed_at timestamptz,
  removed_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint work_dependencies_one_target_check check (
    (dependent_job_id is not null)::integer
      + (dependent_project_id is not null)::integer = 1
  ),
  constraint work_dependencies_one_predecessor_check check (
    (predecessor_job_id is not null)::integer
      + (predecessor_project_id is not null)::integer
      + (predecessor_instruction_item_id is not null)::integer
      + (declared_kind is not null)::integer = 1
  ),
  constraint work_dependencies_declared_state_check check (
    (declared_kind is null and manual_state is null)
    or (declared_kind is not null and manual_state is not null)
  ),
  constraint work_dependencies_description_check check (
    description is null or length(btrim(description)) between 3 and 1000
  ),
  constraint work_dependencies_declared_description_check check (
    declared_kind is null or description is not null
  ),
  constraint work_dependencies_removal_check check (
    (removed_at is null and removed_by is null)
    or (removed_at is not null and removed_by is not null)
  )
);

create table public.work_dependency_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dependency_id uuid not null references public.work_dependencies(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'updated', 'satisfied', 'reopened', 'waived', 'removed'
  )),
  reason text,
  before_state jsonb,
  after_state jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint work_dependency_events_reason_check check (
    reason is null or length(btrim(reason)) between 3 and 1000
  )
);

create table public.job_instruction_item_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  instruction_item_id uuid not null references public.job_instruction_items(id) on delete cascade,
  event_type text not null check (event_type in ('completed', 'reopened')),
  previous_version bigint not null check (previous_version >= 0),
  resulting_version bigint not null check (resulting_version > previous_version),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index work_execution_events_job_created_idx
  on public.work_execution_events (job_id, created_at desc) where job_id is not null;
create index work_execution_events_project_created_idx
  on public.work_execution_events (project_id, created_at desc) where project_id is not null;
create index work_execution_events_org_created_idx
  on public.work_execution_events (organization_id, created_at desc);

create index work_blockers_job_state_idx
  on public.work_blockers (job_id, state) where job_id is not null;
create index work_blockers_project_state_idx
  on public.work_blockers (project_id, state) where project_id is not null;
create index work_blockers_instruction_state_idx
  on public.work_blockers (instruction_item_id, state) where instruction_item_id is not null;
create index work_blockers_review_idx
  on public.work_blockers (organization_id, next_review_date)
  where state = 'open' and next_review_date is not null;
create index work_blockers_responsible_idx
  on public.work_blockers (responsible_employee_record_id)
  where state = 'open' and responsible_employee_record_id is not null;
create unique index work_blockers_one_open_job_parking_idx
  on public.work_blockers (job_id)
  where kind = 'parking' and state = 'open' and job_id is not null;
create unique index work_blockers_one_open_project_parking_idx
  on public.work_blockers (project_id)
  where kind = 'parking' and state = 'open' and project_id is not null;

create index work_blocker_events_blocker_created_idx
  on public.work_blocker_events (blocker_id, created_at desc);
create index work_blocker_events_org_created_idx
  on public.work_blocker_events (organization_id, created_at desc);

create index work_dependencies_job_idx
  on public.work_dependencies (dependent_job_id) where dependent_job_id is not null;
create index work_dependencies_project_idx
  on public.work_dependencies (dependent_project_id) where dependent_project_id is not null;
create index work_dependencies_predecessor_job_idx
  on public.work_dependencies (predecessor_job_id) where predecessor_job_id is not null;
create index work_dependencies_predecessor_project_idx
  on public.work_dependencies (predecessor_project_id) where predecessor_project_id is not null;
create index work_dependencies_instruction_idx
  on public.work_dependencies (predecessor_instruction_item_id)
  where predecessor_instruction_item_id is not null;
create unique index work_dependencies_active_unique_idx
  on public.work_dependencies (
    organization_id,
    dependent_job_id,
    dependent_project_id,
    predecessor_job_id,
    predecessor_project_id,
    predecessor_instruction_item_id,
    declared_kind,
    effect
  ) nulls not distinct where removed_at is null;

create index work_dependency_events_dependency_created_idx
  on public.work_dependency_events (dependency_id, created_at desc);
create index work_dependency_events_org_created_idx
  on public.work_dependency_events (organization_id, created_at desc);
create index job_instruction_item_events_item_created_idx
  on public.job_instruction_item_events (instruction_item_id, created_at desc);

-- Organization, target and graph integrity ---------------------------------

create or replace function app_private.can_view_p1_14_work_target(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_instruction_item_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when p_instruction_item_id is not null then
      app_private.can_view_work_instruction_item(p_instruction_item_id, p_user_id)
    else app_private.can_view_work_instruction_target(
      p_organization_id, p_job_id, p_project_id, p_user_id
    )
  end;
$$;

revoke all on function app_private.can_view_p1_14_work_target(uuid, uuid, uuid, uuid, uuid)
from public, anon;
grant execute on function app_private.can_view_p1_14_work_target(uuid, uuid, uuid, uuid, uuid)
to authenticated, service_role;

create or replace function app_private.validate_work_execution_event_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs j
    where j.id = new.job_id and j.organization_id = new.organization_id
  ) then
    raise exception 'work_execution_target_organization_mismatch';
  end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.organization_id = new.organization_id
  ) then
    raise exception 'work_execution_target_organization_mismatch';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_blocker_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.job_id is not null and not exists (
    select 1 from public.jobs j
    where j.id = new.job_id and j.organization_id = new.organization_id
  ) then raise exception 'work_blocker_target_organization_mismatch'; end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = new.project_id and p.organization_id = new.organization_id
  ) then raise exception 'work_blocker_target_organization_mismatch'; end if;
  if new.instruction_item_id is not null and not exists (
    select 1 from public.job_instruction_items i
    where i.id = new.instruction_item_id and i.organization_id = new.organization_id
  ) then raise exception 'work_blocker_target_organization_mismatch'; end if;
  if new.responsible_employee_record_id is not null and not exists (
    select 1 from public.employee_records e
    where e.id = new.responsible_employee_record_id
      and e.organization_id = new.organization_id
      and (new.is_legacy or e.user_id is not null)
  ) then raise exception 'work_blocker_responsible_organization_mismatch'; end if;
  if new.kind = 'parking' and new.instruction_item_id is not null then
    raise exception 'work_blocker_parking_target_invalid';
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_blocker_event_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.work_blockers b
    where b.id = new.blocker_id and b.organization_id = new.organization_id
  ) then raise exception 'work_blocker_event_organization_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_dependency_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_instruction public.job_instruction_items%rowtype;
begin
  if new.dependent_job_id is not null and not exists (
    select 1 from public.jobs j
    where j.id = new.dependent_job_id and j.organization_id = new.organization_id
  ) then raise exception 'work_dependency_target_organization_mismatch'; end if;
  if new.dependent_project_id is not null and not exists (
    select 1 from public.projects p
    where p.id = new.dependent_project_id and p.organization_id = new.organization_id
  ) then raise exception 'work_dependency_target_organization_mismatch'; end if;
  if new.predecessor_job_id is not null then
    if not exists (
      select 1 from public.jobs j
      where j.id = new.predecessor_job_id and j.organization_id = new.organization_id
    ) then raise exception 'work_dependency_predecessor_organization_mismatch'; end if;
    if new.dependent_job_id = new.predecessor_job_id then
      raise exception 'work_dependency_self';
    end if;
    if new.dependent_project_id is not null and exists (
      select 1 from public.jobs j
      where j.id = new.predecessor_job_id and j.project_id = new.dependent_project_id
    ) then raise exception 'work_dependency_parent_child'; end if;
  end if;
  if new.predecessor_project_id is not null then
    if not exists (
      select 1 from public.projects p
      where p.id = new.predecessor_project_id and p.organization_id = new.organization_id
    ) then raise exception 'work_dependency_predecessor_organization_mismatch'; end if;
    if new.dependent_project_id = new.predecessor_project_id then
      raise exception 'work_dependency_self';
    end if;
    if new.dependent_job_id is not null and exists (
      select 1 from public.jobs j
      where j.id = new.dependent_job_id and j.project_id = new.predecessor_project_id
    ) then raise exception 'work_dependency_parent_child'; end if;
  end if;
  if new.predecessor_instruction_item_id is not null then
    select * into v_instruction
    from public.job_instruction_items i
    where i.id = new.predecessor_instruction_item_id
      and i.organization_id = new.organization_id;
    if not found then raise exception 'work_dependency_predecessor_organization_mismatch'; end if;
    if not (
      (new.dependent_job_id is not null and v_instruction.job_id = new.dependent_job_id)
      or (
        new.dependent_project_id is not null
        and v_instruction.project_id = new.dependent_project_id
      )
    ) then raise exception 'work_dependency_instruction_target_invalid'; end if;
  end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_dependency_cycle()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_dependent text;
  v_predecessor text;
begin
  if new.removed_at is not null
    or new.effect = 'warning'
    or (new.predecessor_job_id is null and new.predecessor_project_id is null)
  then return new; end if;

  v_dependent := case
    when new.dependent_job_id is not null then 'job:' || new.dependent_job_id::text
    else 'project:' || new.dependent_project_id::text
  end;
  v_predecessor := case
    when new.predecessor_job_id is not null then 'job:' || new.predecessor_job_id::text
    else 'project:' || new.predecessor_project_id::text
  end;

  if v_dependent = v_predecessor then raise exception 'work_dependency_self'; end if;

  if exists (
    with recursive edges as (
      select
        case when d.dependent_job_id is not null
          then 'job:' || d.dependent_job_id::text
          else 'project:' || d.dependent_project_id::text end as dependent_node,
        case when d.predecessor_job_id is not null
          then 'job:' || d.predecessor_job_id::text
          else 'project:' || d.predecessor_project_id::text end as predecessor_node
      from public.work_dependencies d
      where d.organization_id = new.organization_id
        and d.removed_at is null
        and d.effect <> 'warning'
        and (d.predecessor_job_id is not null or d.predecessor_project_id is not null)
        and d.id <> new.id
      union all select v_dependent, v_predecessor
    ), reachable(node) as (
      select v_predecessor
      union
      select e.predecessor_node
      from edges e join reachable r on e.dependent_node = r.node
    )
    select 1 from reachable where node = v_dependent
  ) then raise exception 'work_dependency_cycle'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_work_dependency_event_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.work_dependencies d
    where d.id = new.dependency_id and d.organization_id = new.organization_id
  ) then raise exception 'work_dependency_event_organization_mismatch'; end if;
  return new;
end;
$$;

create or replace function app_private.validate_instruction_event_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.job_instruction_items i
    where i.id = new.instruction_item_id and i.organization_id = new.organization_id
  ) then raise exception 'instruction_event_organization_mismatch'; end if;
  return new;
end;
$$;

create trigger validate_work_execution_event_org
  before insert on public.work_execution_events
  for each row execute function app_private.validate_work_execution_event_org();
create trigger validate_work_blocker_org
  before insert or update on public.work_blockers
  for each row execute function app_private.validate_work_blocker_org();
create trigger validate_work_blocker_event_org
  before insert on public.work_blocker_events
  for each row execute function app_private.validate_work_blocker_event_org();
create trigger validate_work_dependency_org
  before insert or update on public.work_dependencies
  for each row execute function app_private.validate_work_dependency_org();
create trigger validate_work_dependency_cycle
  before insert or update on public.work_dependencies
  for each row execute function app_private.validate_work_dependency_cycle();
create trigger validate_work_dependency_event_org
  before insert on public.work_dependency_events
  for each row execute function app_private.validate_work_dependency_event_org();
create trigger validate_instruction_event_org
  before insert on public.job_instruction_item_events
  for each row execute function app_private.validate_instruction_event_org();

create trigger prevent_work_execution_event_change
  before update or delete on public.work_execution_events
  for each row execute function app_private.prevent_planning_history_change();
create trigger prevent_work_blocker_event_change
  before update or delete on public.work_blocker_events
  for each row execute function app_private.prevent_planning_history_change();
create trigger prevent_work_dependency_event_change
  before update or delete on public.work_dependency_events
  for each row execute function app_private.prevent_planning_history_change();
create trigger prevent_instruction_item_event_change
  before update or delete on public.job_instruction_item_events
  for each row execute function app_private.prevent_planning_history_change();

create or replace function app_private.guard_job_execution_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (new.execution_state, new.execution_version)
      is distinct from (old.execution_state, old.execution_version)
    and coalesce(current_setting('app.work_execution_write', true), '') <> 'true'
  then raise exception 'work_execution_direct_write_forbidden'; end if;
  return new;
end;
$$;

create or replace function app_private.guard_project_execution_write()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (
      new.execution_state_override,
      new.execution_version,
      new.execution_override_reason
    ) is distinct from (
      old.execution_state_override,
      old.execution_version,
      old.execution_override_reason
    )
    and coalesce(current_setting('app.work_execution_write', true), '') <> 'true'
  then raise exception 'work_execution_direct_write_forbidden'; end if;
  return new;
end;
$$;

create trigger guard_job_execution_write
  before update of execution_state, execution_version on public.jobs
  for each row execute function app_private.guard_job_execution_write();
create trigger guard_project_execution_write
  before update of execution_state_override, execution_version, execution_override_reason
  on public.projects
  for each row execute function app_private.guard_project_execution_write();

create or replace function app_private.resolve_legacy_job_execution_state(
  p_status public.job_status
)
returns public.work_execution_state
language sql
immutable
set search_path to ''
as $$
  select case p_status
    when 'in_bearbeitung' then 'in_progress'::public.work_execution_state
    when 'fertig' then 'execution_complete'::public.work_execution_state
    else 'not_started'::public.work_execution_state
  end;
$$;

create or replace function app_private.resolve_legacy_project_execution_state(
  p_status public.project_status
)
returns public.work_execution_state
language sql
immutable
set search_path to ''
as $$
  select case p_status
    when 'in_bearbeitung' then 'in_progress'::public.work_execution_state
    when 'abgeschlossen' then 'execution_complete'::public.work_execution_state
    else 'not_started'::public.work_execution_state
  end;
$$;

create or replace function app_private.work_dependency_is_satisfied(
  p_dependency_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_dependency public.work_dependencies%rowtype;
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_completed boolean;
begin
  select * into v_dependency
  from public.work_dependencies d
  where d.id = p_dependency_id and d.removed_at is null;
  if not found then return true; end if;
  if v_dependency.declared_kind is not null then
    return v_dependency.manual_state in ('satisfied', 'waived');
  end if;
  if v_dependency.predecessor_instruction_item_id is not null then
    select i.is_completed into v_completed
    from public.job_instruction_items i
    where i.id = v_dependency.predecessor_instruction_item_id;
    return coalesce(v_completed, false);
  end if;
  if v_dependency.predecessor_job_id is not null then
    select * into v_job from public.jobs j
    where j.id = v_dependency.predecessor_job_id;
    if not found then return false; end if;
    return coalesce(
      v_job.execution_state,
      app_private.resolve_legacy_job_execution_state(v_job.status)
    ) in ('execution_complete', 'handed_over');
  end if;
  select * into v_project from public.projects p
  where p.id = v_dependency.predecessor_project_id;
  if not found then return false; end if;
  return coalesce(
    v_project.execution_state_override,
    app_private.resolve_legacy_project_execution_state(v_project.status_override)
  ) in ('execution_complete', 'handed_over');
end;
$$;

revoke all on function app_private.work_dependency_is_satisfied(uuid)
from public, anon, authenticated;
grant execute on function app_private.work_dependency_is_satisfied(uuid)
to service_role;

create or replace function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_incomplete_required integer;
  v_reopened_predecessors integer;
  v_open_blockers integer;
  v_open_start_dependencies integer;
  v_open_completion_dependencies integer;
  v_active_clock integer := 0;
  v_incomplete_project_children integer := 0;
begin
  select count(*) into v_incomplete_required
  from public.job_instruction_items i
  where i.organization_id = p_organization_id
    and (
      (p_job_id is not null and i.job_id = p_job_id)
      or (p_project_id is not null and i.project_id = p_project_id)
    )
    and i.requirement_state = 'required'
    and not i.is_completed;

  select count(*) into v_reopened_predecessors
  from public.job_instruction_item_dependencies d
  join public.job_instruction_items dependent on dependent.id = d.dependent_item_id
  join public.job_instruction_items predecessor on predecessor.id = d.predecessor_item_id
  where d.organization_id = p_organization_id
    and dependent.is_completed
    and not predecessor.is_completed
    and (
      (p_job_id is not null and dependent.job_id = p_job_id)
      or (p_project_id is not null and dependent.project_id = p_project_id)
    );

  select count(*) into v_open_blockers
  from public.work_blockers b
  where b.organization_id = p_organization_id
    and b.state = 'open'
    and b.kind = 'blocker'
    and (
      (p_job_id is not null and (
        b.job_id = p_job_id
        or b.instruction_item_id in (
          select i.id from public.job_instruction_items i where i.job_id = p_job_id
        )
      ))
      or (p_project_id is not null and (
        b.project_id = p_project_id
        or b.instruction_item_id in (
          select i.id from public.job_instruction_items i where i.project_id = p_project_id
        )
      ))
    );

  select count(*) filter (
      where d.effect = 'blocks_start'
        and not app_private.work_dependency_is_satisfied(d.id)
    ),
    count(*) filter (
      where d.effect = 'blocks_completion'
        and not app_private.work_dependency_is_satisfied(d.id)
    )
  into v_open_start_dependencies, v_open_completion_dependencies
  from public.work_dependencies d
  where d.organization_id = p_organization_id
    and d.removed_at is null
    and (
      (p_job_id is not null and d.dependent_job_id = p_job_id)
      or (p_project_id is not null and d.dependent_project_id = p_project_id)
    );

  if p_job_id is not null then
    select count(*) into v_active_clock
    from (
      select distinct on (t.user_id) t.entry_type, t.job_id
      from public.time_entries t
      where t.organization_id = p_organization_id
        and t.timestamp >= (
          date_trunc('day', now() at time zone 'Europe/Berlin')
          at time zone 'Europe/Berlin'
        )
        and t.status not in ('rejected', 'pending_delete')
      order by t.user_id, t.timestamp desc
    ) latest
    where latest.entry_type in ('clock_in', 'break_end')
      and latest.job_id = p_job_id;
  end if;

  if p_project_id is not null then
    select count(*) into v_incomplete_project_children
    from public.jobs j
    where j.organization_id = p_organization_id
      and j.project_id = p_project_id
      and coalesce(
        j.execution_state,
        app_private.resolve_legacy_job_execution_state(j.status)
      ) not in ('execution_complete', 'handed_over', 'cancelled');
  end if;

  return jsonb_build_object(
    'incompleteRequiredInstructions', v_incomplete_required,
    'reopenedInstructionPredecessors', v_reopened_predecessors,
    'openBlockers', v_open_blockers,
    'openStartDependencies', v_open_start_dependencies,
    'openCompletionDependencies', v_open_completion_dependencies,
    'activeJobClocks', v_active_clock,
    'incompleteProjectChildren', v_incomplete_project_children,
    'notAssessable', jsonb_build_array(
      'time_segment_completeness', 'material_consumption', 'measurements',
      'defects', 'formal_approvals', 'instruction_evidence',
      'customer_decision', 'signature', 'handover_package', 'tool_custody'
    )
  );
end;
$$;

revoke all on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
to service_role;

create or replace function public.transition_work_execution(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text default null,
  p_override_gates boolean default false
)
returns table (
  execution_state public.work_execution_state,
  execution_version bigint,
  event_id uuid,
  gate_snapshot jsonb,
  gate_fingerprint text
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role public.org_role;
  v_is_manager boolean;
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_from_state public.work_execution_state;
  v_snapshot jsonb;
  v_fingerprint text;
  v_event_id uuid;
  v_event_type text := 'transitioned';
  v_next_version bigint;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_legacy_status text;
  v_gates_pass boolean;
begin
  if p_target_type not in ('job', 'project') or p_expected_version < 0 then
    raise exception 'work_transition_invalid_input';
  end if;
  select m.role into v_role
  from public.organization_members m
  where m.organization_id = p_organization_id and m.user_id = p_actor_id;
  if v_role is null then raise exception 'work_transition_not_authorized'; end if;
  v_is_manager := v_role in ('admin', 'buero');

  if p_target_type = 'job' then
    select * into v_job from public.jobs j
    where j.id = p_target_id and j.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if not v_is_manager and not exists (
      select 1 from public.job_assignments a
      where a.job_id = v_job.id and a.user_id = p_actor_id
    ) then raise exception 'work_transition_not_authorized'; end if;
    if v_job.execution_version <> p_expected_version then
      raise exception 'work_transition_stale_version';
    end if;
    v_from_state := coalesce(
      v_job.execution_state,
      app_private.resolve_legacy_job_execution_state(v_job.status)
    );
    v_legacy_status := v_job.status::text;
  else
    if not v_is_manager then raise exception 'work_transition_not_authorized'; end if;
    select * into v_project from public.projects p
    where p.id = p_target_id and p.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if v_project.execution_version <> p_expected_version then
      raise exception 'work_transition_stale_version';
    end if;
    v_from_state := coalesce(
      v_project.execution_state_override,
      app_private.resolve_legacy_project_execution_state(v_project.status_override)
    );
    v_legacy_status := coalesce(v_project.status_override::text, 'derived');
  end if;

  if v_from_state = p_to_state then raise exception 'work_transition_same_state'; end if;
  if not (
    (v_from_state = 'not_started' and p_to_state in ('in_progress', 'cancelled'))
    or (v_from_state = 'in_progress' and p_to_state in ('interrupted', 'execution_complete', 'cancelled'))
    or (v_from_state = 'interrupted' and p_to_state in ('in_progress', 'cancelled'))
    or (v_from_state = 'execution_complete' and p_to_state in ('handed_over', 'in_progress'))
    or (v_from_state = 'handed_over' and p_to_state = 'execution_complete')
    or (v_from_state = 'cancelled' and p_to_state = 'not_started')
  ) then raise exception 'work_transition_not_allowed'; end if;

  if not v_is_manager and (
    p_to_state in ('cancelled', 'handed_over')
    or v_from_state in ('execution_complete', 'handed_over', 'cancelled')
    or p_override_gates
  ) then raise exception 'work_transition_not_authorized'; end if;

  if (
    p_to_state in ('interrupted', 'cancelled', 'handed_over')
    or v_from_state in ('execution_complete', 'handed_over', 'cancelled')
    or p_target_type = 'project'
    or p_override_gates
  ) and (v_reason is null or length(v_reason) not between 3 and 1000) then
    raise exception 'work_transition_reason_required';
  end if;

  v_snapshot := app_private.build_work_gate_snapshot(
    p_organization_id,
    case when p_target_type = 'job' then p_target_id else null end,
    case when p_target_type = 'project' then p_target_id else null end
  );
  v_fingerprint := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');

  if p_to_state = 'in_progress' then
    v_gates_pass := (v_snapshot->>'openBlockers')::integer = 0
      and (v_snapshot->>'openStartDependencies')::integer = 0;
    if not v_gates_pass then raise exception 'work_transition_start_blocked'; end if;
  elsif p_to_state in ('execution_complete', 'handed_over') then
    v_gates_pass := (v_snapshot->>'incompleteRequiredInstructions')::integer = 0
      and (v_snapshot->>'reopenedInstructionPredecessors')::integer = 0
      and (v_snapshot->>'openBlockers')::integer = 0
      and (v_snapshot->>'openCompletionDependencies')::integer = 0
      and (v_snapshot->>'activeJobClocks')::integer = 0
      and (v_snapshot->>'incompleteProjectChildren')::integer = 0;
    if not v_gates_pass and not (v_is_manager and p_override_gates) then
      raise exception 'work_transition_completion_blocked';
    end if;
    if p_to_state = 'handed_over' and not p_override_gates then
      -- P1-15/P1-17 facts are intentionally not assessable yet. A manager
      -- must acknowledge that limitation for this one transition.
      raise exception 'work_transition_handover_requires_override';
    end if;
  end if;

  v_next_version := p_expected_version + 1;
  perform set_config('app.work_execution_write', 'true', true);

  if p_target_type = 'job' then
    update public.jobs
    set execution_state = p_to_state,
        execution_version = v_next_version,
        status = case
          when p_to_state = 'not_started' and exists (
            select 1 from public.work_blockers b
            where b.job_id = v_job.id and b.kind = 'parking' and b.state = 'open'
          ) then 'geparkt'::public.job_status
          when p_to_state = 'not_started' then 'nicht_bearbeitet'::public.job_status
          when p_to_state in ('in_progress', 'interrupted') then 'in_bearbeitung'::public.job_status
          else 'fertig'::public.job_status
        end,
        actual_completion_date = case
          when p_to_state in ('execution_complete', 'handed_over')
            then coalesce(actual_completion_date, (now() at time zone 'Europe/Berlin')::date)
          else null
        end,
        updated_at = now()
    where id = v_job.id;
  else
    update public.projects
    set execution_state_override = p_to_state,
        execution_version = v_next_version,
        execution_override_reason = v_reason,
        status_override = case
          when p_to_state = 'not_started' then 'nicht_begonnen'::public.project_status
          when p_to_state in ('in_progress', 'interrupted') then 'in_bearbeitung'::public.project_status
          when p_to_state in ('execution_complete', 'handed_over', 'cancelled')
            then 'abgeschlossen'::public.project_status
        end,
        updated_at = now()
    where id = v_project.id;
  end if;

  v_event_type := case
    when p_to_state = 'cancelled' then 'cancelled'
    when v_from_state = 'cancelled' then 'restored'
    when p_to_state = 'handed_over' then 'handed_over'
    when v_from_state = 'handed_over' then 'handover_withdrawn'
    when v_from_state = 'execution_complete' and p_to_state = 'in_progress' then 'reopened'
    when p_target_type = 'project' then 'override_set'
    else 'transitioned'
  end;

  insert into public.work_execution_events (
    organization_id, job_id, project_id, event_type, from_state, to_state,
    previous_version, resulting_version, reason, gate_snapshot,
    gate_fingerprint, event_payload, created_by
  ) values (
    p_organization_id,
    case when p_target_type = 'job' then p_target_id else null end,
    case when p_target_type = 'project' then p_target_id else null end,
    v_event_type, v_from_state, p_to_state, p_expected_version, v_next_version,
    v_reason, v_snapshot, v_fingerprint,
    jsonb_build_object(
      'legacyStatus', v_legacy_status,
      'legacyInitialization', case when p_target_type = 'job'
        then v_job.execution_state is null
        else v_project.execution_state_override is null end,
      'gateOverride', p_override_gates,
      'gatePassed', v_gates_pass
    ),
    p_actor_id
  ) returning id into v_event_id;

  return query select p_to_state, v_next_version, v_event_id, v_snapshot, v_fingerprint;
end;
$$;

revoke all on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) from public, anon, authenticated;
grant execute on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) to service_role;

create or replace function public.clear_project_execution_override(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_project public.projects%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_next_version bigint;
  v_snapshot jsonb;
  v_fingerprint text;
begin
  if v_reason is null or length(v_reason) not between 3 and 1000 then
    raise exception 'work_transition_reason_required';
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) then raise exception 'work_transition_not_authorized'; end if;
  select * into v_project from public.projects p
  where p.id = p_project_id and p.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_transition_target_not_found'; end if;
  if v_project.execution_version <> p_expected_version then
    raise exception 'work_transition_stale_version';
  end if;
  if v_project.execution_state_override is null then
    raise exception 'work_transition_no_override';
  end if;
  v_next_version := p_expected_version + 1;
  v_snapshot := app_private.build_work_gate_snapshot(p_organization_id, null, p_project_id);
  v_fingerprint := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');
  perform set_config('app.work_execution_write', 'true', true);
  update public.projects set
    execution_state_override = null,
    execution_version = v_next_version,
    execution_override_reason = null,
    status_override = null,
    updated_at = now()
  where id = p_project_id;
  insert into public.work_execution_events (
    organization_id, project_id, event_type, from_state, to_state,
    previous_version, resulting_version, reason, gate_snapshot,
    gate_fingerprint, event_payload, created_by
  ) values (
    p_organization_id, p_project_id, 'override_cleared',
    v_project.execution_state_override, null, p_expected_version,
    v_next_version, v_reason, v_snapshot, v_fingerprint,
    jsonb_build_object('legacyStatusOverride', v_project.status_override), p_actor_id
  );
  return v_next_version;
end;
$$;

revoke all on function public.clear_project_execution_override(uuid, uuid, uuid, bigint, text)
from public, anon, authenticated;
grant execute on function public.clear_project_execution_override(uuid, uuid, uuid, bigint, text)
to service_role;

create or replace function public.upsert_work_blocker(
  p_organization_id uuid,
  p_actor_id uuid,
  p_blocker_id uuid,
  p_expected_version bigint,
  p_job_id uuid,
  p_project_id uuid,
  p_instruction_item_id uuid,
  p_kind public.work_blocker_kind,
  p_reason public.work_blocker_reason,
  p_details text,
  p_responsible_employee_record_id uuid,
  p_next_review_date date
)
returns table (blocker_id uuid, blocker_version bigint)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role public.org_role;
  v_is_manager boolean;
  v_owner_user_id uuid;
  v_current public.work_blockers%rowtype;
  v_next_version bigint;
  v_before jsonb;
  v_after jsonb;
  v_event_type text;
begin
  if (p_job_id is not null)::integer
      + (p_project_id is not null)::integer
      + (p_instruction_item_id is not null)::integer <> 1
    or p_reason is null
    or p_responsible_employee_record_id is null
    or p_next_review_date is null
    or (p_reason = 'other' and nullif(btrim(coalesce(p_details, '')), '') is null)
  then raise exception 'work_blocker_invalid_input'; end if;

  select m.role into v_role from public.organization_members m
  where m.organization_id = p_organization_id and m.user_id = p_actor_id;
  if v_role is null then raise exception 'work_blocker_not_authorized'; end if;
  v_is_manager := v_role in ('admin', 'buero');
  select e.user_id into v_owner_user_id from public.employee_records e
  where e.id = p_responsible_employee_record_id
    and e.organization_id = p_organization_id;
  if v_owner_user_id is null then raise exception 'work_blocker_owner_invalid'; end if;

  if not v_is_manager then
    if p_job_id is null or p_kind <> 'blocker' or v_owner_user_id <> p_actor_id
      or p_next_review_date <> (now() at time zone 'Europe/Berlin')::date
      or not exists (
        select 1 from public.job_assignments a
        where a.job_id = p_job_id and a.user_id = p_actor_id
      )
    then raise exception 'work_blocker_not_authorized'; end if;
  end if;

  if p_blocker_id is null then
    insert into public.work_blockers (
      organization_id, job_id, project_id, instruction_item_id, kind, reason,
      details, responsible_employee_record_id, next_review_date, created_by,
      updated_by
    ) values (
      p_organization_id, p_job_id, p_project_id, p_instruction_item_id,
      p_kind, p_reason, nullif(btrim(coalesce(p_details, '')), ''),
      p_responsible_employee_record_id, p_next_review_date, p_actor_id, p_actor_id
    ) returning * into v_current;
    v_before := null;
    v_event_type := case when p_kind = 'parking' then 'parked' else 'created' end;
  else
    select * into v_current from public.work_blockers b
    where b.id = p_blocker_id and b.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_blocker_not_found'; end if;
    if v_current.version <> p_expected_version then
      raise exception 'work_blocker_stale_version';
    end if;
    if v_current.state <> 'open' then raise exception 'work_blocker_not_open'; end if;
    if not v_is_manager and v_current.responsible_employee_record_id
      <> p_responsible_employee_record_id then
      raise exception 'work_blocker_not_authorized';
    end if;
    v_before := to_jsonb(v_current);
    v_next_version := v_current.version + 1;
    update public.work_blockers set
      reason = p_reason,
      details = nullif(btrim(coalesce(p_details, '')), ''),
      responsible_employee_record_id = p_responsible_employee_record_id,
      next_review_date = p_next_review_date,
      version = v_next_version,
      updated_by = p_actor_id,
      updated_at = now()
    where id = p_blocker_id
    returning * into v_current;
    v_event_type := 'updated';
  end if;

  v_after := to_jsonb(v_current);
  insert into public.work_blocker_events (
    organization_id, blocker_id, event_type, before_state, after_state, created_by
  ) values (
    p_organization_id, v_current.id, v_event_type, v_before, v_after, p_actor_id
  );
  return query select v_current.id, v_current.version;
end;
$$;

revoke all on function public.upsert_work_blocker(
  uuid, uuid, uuid, bigint, uuid, uuid, uuid, public.work_blocker_kind,
  public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated;
grant execute on function public.upsert_work_blocker(
  uuid, uuid, uuid, bigint, uuid, uuid, uuid, public.work_blocker_kind,
  public.work_blocker_reason, text, uuid, date
) to service_role;

create or replace function public.set_work_blocker_state(
  p_organization_id uuid,
  p_actor_id uuid,
  p_blocker_id uuid,
  p_expected_version bigint,
  p_state public.work_blocker_state,
  p_note text,
  p_reason public.work_blocker_reason default null,
  p_details text default null,
  p_responsible_employee_record_id uuid default null,
  p_next_review_date date default null
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role public.org_role;
  v_is_manager boolean;
  v_current public.work_blockers%rowtype;
  v_before jsonb;
  v_next_version bigint;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is null or length(v_note) not between 3 and 1000 then
    raise exception 'work_blocker_note_required';
  end if;
  select m.role into v_role from public.organization_members m
  where m.organization_id = p_organization_id and m.user_id = p_actor_id;
  if v_role is null then raise exception 'work_blocker_not_authorized'; end if;
  v_is_manager := v_role in ('admin', 'buero');
  select * into v_current from public.work_blockers b
  where b.id = p_blocker_id and b.organization_id = p_organization_id
  for update;
  if not found then raise exception 'work_blocker_not_found'; end if;
  if v_current.version <> p_expected_version then raise exception 'work_blocker_stale_version'; end if;
  if not v_is_manager and not exists (
    select 1 from public.employee_records e
    where e.id = v_current.responsible_employee_record_id and e.user_id = p_actor_id
  ) then raise exception 'work_blocker_not_authorized'; end if;
  if v_current.kind = 'parking' and not v_is_manager then
    raise exception 'work_blocker_not_authorized';
  end if;
  if v_current.state = p_state then raise exception 'work_blocker_same_state'; end if;
  v_before := to_jsonb(v_current);
  v_next_version := v_current.version + 1;

  if p_state = 'resolved' then
    update public.work_blockers set
      state = 'resolved', version = v_next_version, updated_by = p_actor_id,
      updated_at = now(), resolved_by = p_actor_id, resolved_at = now(),
      resolution_note = v_note
    where id = p_blocker_id;
    insert into public.work_blocker_events (
      organization_id, blocker_id, event_type, before_state, after_state, created_by
    ) select p_organization_id, p_blocker_id,
      case when v_current.kind = 'parking' then 'unparked' else 'resolved' end,
      v_before, to_jsonb(b), p_actor_id
    from public.work_blockers b where b.id = p_blocker_id;
  else
    if p_reason is null or p_responsible_employee_record_id is null
      or p_next_review_date is null
      or (p_reason = 'other' and nullif(btrim(coalesce(p_details, '')), '') is null)
    then raise exception 'work_blocker_invalid_input'; end if;
    update public.work_blockers set
      state = 'open', reason = p_reason,
      details = nullif(btrim(coalesce(p_details, '')), ''),
      responsible_employee_record_id = p_responsible_employee_record_id,
      next_review_date = p_next_review_date, version = v_next_version,
      updated_by = p_actor_id, updated_at = now(), resolved_by = null,
      resolved_at = null, resolution_note = null, is_legacy = false,
      legacy_source = null
    where id = p_blocker_id;
    insert into public.work_blocker_events (
      organization_id, blocker_id, event_type, before_state, after_state, created_by
    ) select p_organization_id, p_blocker_id, 'reopened', v_before,
      to_jsonb(b) || jsonb_build_object('reopenNote', v_note), p_actor_id
    from public.work_blockers b where b.id = p_blocker_id;
  end if;
  return v_next_version;
end;
$$;

revoke all on function public.set_work_blocker_state(
  uuid, uuid, uuid, bigint, public.work_blocker_state, text,
  public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated;
grant execute on function public.set_work_blocker_state(
  uuid, uuid, uuid, bigint, public.work_blocker_state, text,
  public.work_blocker_reason, text, uuid, date
) to service_role;

create or replace function public.park_work_target(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_execution_version bigint,
  p_reason public.work_blocker_reason,
  p_details text,
  p_responsible_employee_record_id uuid,
  p_next_review_date date
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_child public.jobs%rowtype;
  v_occurrence public.planning_occurrences%rowtype;
  v_blocker_id uuid;
  v_target_blocker_id uuid;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
begin
  if p_target_type not in ('job', 'project')
    or p_reason is null
    or p_responsible_employee_record_id is null
    or p_next_review_date is null
    or (p_reason = 'other' and v_details is null)
  then raise exception 'work_parking_invalid_input'; end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) then raise exception 'work_parking_not_authorized'; end if;
  if not exists (
    select 1 from public.employee_records e
    where e.id = p_responsible_employee_record_id
      and e.organization_id = p_organization_id and e.user_id is not null
  ) then raise exception 'work_blocker_owner_invalid'; end if;

  if p_target_type = 'job' then
    select * into v_job from public.jobs j
    where j.id = p_target_id and j.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_parking_target_not_found'; end if;
    if v_job.execution_version <> p_expected_execution_version then
      raise exception 'work_transition_stale_version';
    end if;
    if coalesce(
      v_job.execution_state,
      app_private.resolve_legacy_job_execution_state(v_job.status)
    ) in ('execution_complete', 'handed_over', 'cancelled') then
      raise exception 'work_parking_terminal_work';
    end if;
    if exists (
      select 1 from public.work_blockers b
      where b.job_id = v_job.id and b.kind = 'parking' and b.state = 'open'
    ) then raise exception 'work_already_parked'; end if;

    for v_occurrence in
      select * from public.planning_occurrences o
      where o.organization_id = p_organization_id and o.job_id = v_job.id
        and o.status = 'scheduled'
      for update
    loop
      insert into public.planning_events (
        organization_id, series_id, occurrence_id, event_type, mutation_scope,
        before_state, after_state, reason, created_by
      ) values (
        p_organization_id, v_occurrence.series_id, v_occurrence.id,
        'status_changed', 'occurrence', to_jsonb(v_occurrence),
        to_jsonb(v_occurrence) || jsonb_build_object(
          'status', 'cancelled', 'version', v_occurrence.version + 1
        ), 'work_parked', p_actor_id
      );
      update public.planning_occurrences set
        status = 'cancelled', version = version + 1, updated_at = now()
      where id = v_occurrence.id;
    end loop;

    insert into public.work_blockers (
      organization_id, job_id, kind, reason, details,
      responsible_employee_record_id, next_review_date, created_by, updated_by
    ) values (
      p_organization_id, v_job.id, 'parking', p_reason, v_details,
      p_responsible_employee_record_id, p_next_review_date, p_actor_id, p_actor_id
    ) returning id into v_target_blocker_id;
    insert into public.work_blocker_events (
      organization_id, blocker_id, event_type, after_state, created_by
    ) select p_organization_id, b.id, 'parked', to_jsonb(b), p_actor_id
      from public.work_blockers b where b.id = v_target_blocker_id;
    update public.jobs set
      status = 'geparkt', planned_date = null, planned_time = null, updated_at = now()
    where id = v_job.id;
  else
    select * into v_project from public.projects p
    where p.id = p_target_id and p.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_parking_target_not_found'; end if;
    if v_project.execution_version <> p_expected_execution_version then
      raise exception 'work_transition_stale_version';
    end if;
    if coalesce(
      v_project.execution_state_override,
      app_private.resolve_legacy_project_execution_state(v_project.status_override)
    ) in ('execution_complete', 'handed_over', 'cancelled') then
      raise exception 'work_parking_terminal_work';
    end if;
    if exists (
      select 1 from public.work_blockers b
      where b.project_id = v_project.id and b.kind = 'parking' and b.state = 'open'
    ) then raise exception 'work_already_parked'; end if;

    insert into public.work_blockers (
      organization_id, project_id, kind, reason, details,
      responsible_employee_record_id, next_review_date, created_by, updated_by
    ) values (
      p_organization_id, v_project.id, 'parking', p_reason, v_details,
      p_responsible_employee_record_id, p_next_review_date, p_actor_id, p_actor_id
    ) returning id into v_target_blocker_id;
    insert into public.work_blocker_events (
      organization_id, blocker_id, event_type, after_state, created_by
    ) select p_organization_id, b.id, 'parked', to_jsonb(b), p_actor_id
      from public.work_blockers b where b.id = v_target_blocker_id;

    update public.projects set status_override = 'geparkt', updated_at = now()
    where id = v_project.id;

    for v_child in
      select * from public.jobs j
      where j.organization_id = p_organization_id and j.project_id = v_project.id
        and coalesce(
          j.execution_state,
          app_private.resolve_legacy_job_execution_state(j.status)
        ) not in ('execution_complete', 'handed_over', 'cancelled')
      for update
    loop
      if not exists (
        select 1 from public.work_blockers b
        where b.job_id = v_child.id and b.kind = 'parking' and b.state = 'open'
      ) then
        insert into public.work_blockers (
          organization_id, job_id, kind, reason, details,
          responsible_employee_record_id, next_review_date, created_by, updated_by
        ) values (
          p_organization_id, v_child.id, 'parking', p_reason, v_details,
          p_responsible_employee_record_id, p_next_review_date, p_actor_id, p_actor_id
        ) returning id into v_blocker_id;
        insert into public.work_blocker_events (
          organization_id, blocker_id, event_type, after_state, created_by
        ) select p_organization_id, b.id, 'parked', to_jsonb(b), p_actor_id
          from public.work_blockers b where b.id = v_blocker_id;
      end if;
      for v_occurrence in
        select * from public.planning_occurrences o
        where o.organization_id = p_organization_id and o.job_id = v_child.id
          and o.status = 'scheduled'
        for update
      loop
        insert into public.planning_events (
          organization_id, series_id, occurrence_id, event_type, mutation_scope,
          before_state, after_state, reason, created_by
        ) values (
          p_organization_id, v_occurrence.series_id, v_occurrence.id,
          'status_changed', 'occurrence', to_jsonb(v_occurrence),
          to_jsonb(v_occurrence) || jsonb_build_object(
            'status', 'cancelled', 'version', v_occurrence.version + 1
          ), 'project_parked', p_actor_id
        );
        update public.planning_occurrences set
          status = 'cancelled', version = version + 1, updated_at = now()
        where id = v_occurrence.id;
      end loop;
      update public.jobs set
        status = 'geparkt', planned_date = null, planned_time = null, updated_at = now()
      where id = v_child.id;
    end loop;
  end if;
  return v_target_blocker_id;
end;
$$;

revoke all on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated;
grant execute on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) to service_role;

create or replace function public.unpark_work_target(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_blocker_version bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_blocker public.work_blockers%rowtype;
  v_job public.jobs%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_next_version bigint;
begin
  if p_target_type not in ('job', 'project')
    or v_reason is null or length(v_reason) not between 3 and 1000
  then raise exception 'work_parking_invalid_input'; end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) then raise exception 'work_parking_not_authorized'; end if;
  select * into v_blocker from public.work_blockers b
  where b.organization_id = p_organization_id and b.kind = 'parking'
    and b.state = 'open'
    and (
      (p_target_type = 'job' and b.job_id = p_target_id)
      or (p_target_type = 'project' and b.project_id = p_target_id)
    )
  for update;
  if not found then raise exception 'work_parking_context_not_found'; end if;
  if v_blocker.version <> p_expected_blocker_version then
    raise exception 'work_blocker_stale_version';
  end if;
  v_next_version := v_blocker.version + 1;
  update public.work_blockers set
    state = 'resolved', version = v_next_version, updated_by = p_actor_id,
    updated_at = now(), resolved_by = p_actor_id, resolved_at = now(),
    resolution_note = v_reason
  where id = v_blocker.id;
  insert into public.work_blocker_events (
    organization_id, blocker_id, event_type, before_state, after_state, created_by
  ) select p_organization_id, v_blocker.id, 'unparked', to_jsonb(v_blocker),
    to_jsonb(b), p_actor_id from public.work_blockers b where b.id = v_blocker.id;

  if p_target_type = 'job' then
    select * into v_job from public.jobs j
    where j.id = p_target_id and j.organization_id = p_organization_id
    for update;
    update public.jobs set
      status = case coalesce(
        v_job.execution_state,
        app_private.resolve_legacy_job_execution_state(v_job.status)
      )
        when 'not_started' then 'nicht_bearbeitet'::public.job_status
        when 'in_progress' then 'in_bearbeitung'::public.job_status
        when 'interrupted' then 'in_bearbeitung'::public.job_status
        else 'fertig'::public.job_status
      end,
      updated_at = now()
    where id = p_target_id;
  else
    update public.projects set status_override = null, updated_at = now()
    where id = p_target_id and organization_id = p_organization_id;
  end if;
  return v_next_version;
end;
$$;

revoke all on function public.unpark_work_target(uuid, uuid, text, uuid, bigint, text)
from public, anon, authenticated;
grant execute on function public.unpark_work_target(uuid, uuid, text, uuid, bigint, text)
to service_role;

create or replace function public.upsert_work_dependency(
  p_organization_id uuid,
  p_actor_id uuid,
  p_dependency_id uuid,
  p_expected_version bigint,
  p_dependent_job_id uuid,
  p_dependent_project_id uuid,
  p_predecessor_job_id uuid,
  p_predecessor_project_id uuid,
  p_predecessor_instruction_item_id uuid,
  p_declared_kind public.work_declared_dependency_kind,
  p_description text,
  p_effect public.work_dependency_effect
)
returns public.work_dependencies
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_current public.work_dependencies%rowtype;
  v_result public.work_dependencies%rowtype;
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if num_nonnulls(p_dependent_job_id, p_dependent_project_id) <> 1
    or num_nonnulls(
      p_predecessor_job_id, p_predecessor_project_id,
      p_predecessor_instruction_item_id, p_declared_kind
    ) <> 1
    or (p_declared_kind is not null and v_description is null)
  then raise exception 'work_dependency_invalid_input'; end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) then raise exception 'work_dependency_not_authorized'; end if;

  if p_dependency_id is null then
    insert into public.work_dependencies (
      organization_id, dependent_job_id, dependent_project_id,
      predecessor_job_id, predecessor_project_id,
      predecessor_instruction_item_id, declared_kind, description, effect,
      manual_state, created_by, updated_by
    ) values (
      p_organization_id, p_dependent_job_id, p_dependent_project_id,
      p_predecessor_job_id, p_predecessor_project_id,
      p_predecessor_instruction_item_id, p_declared_kind, v_description, p_effect,
      case when p_declared_kind is not null
        then 'open'::public.work_dependency_manual_state end,
      p_actor_id, p_actor_id
    ) returning * into v_result;
    insert into public.work_dependency_events (
      organization_id, dependency_id, event_type, after_state, created_by
    ) values (
      p_organization_id, v_result.id, 'created', to_jsonb(v_result), p_actor_id
    );
    return v_result;
  end if;

  select * into v_current from public.work_dependencies d
  where d.id = p_dependency_id and d.organization_id = p_organization_id
    and d.removed_at is null
  for update;
  if not found then raise exception 'work_dependency_not_found'; end if;
  if v_current.version <> p_expected_version then
    raise exception 'work_dependency_stale_version';
  end if;
  update public.work_dependencies set
    dependent_job_id = p_dependent_job_id,
    dependent_project_id = p_dependent_project_id,
    predecessor_job_id = p_predecessor_job_id,
    predecessor_project_id = p_predecessor_project_id,
    predecessor_instruction_item_id = p_predecessor_instruction_item_id,
    declared_kind = p_declared_kind,
    description = v_description,
    effect = p_effect,
    manual_state = case
      when p_declared_kind is null then null
      when v_current.declared_kind is null then 'open'::public.work_dependency_manual_state
      else v_current.manual_state
    end,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where id = p_dependency_id
  returning * into v_result;
  insert into public.work_dependency_events (
    organization_id, dependency_id, event_type, before_state, after_state, created_by
  ) values (
    p_organization_id, v_result.id, 'updated', to_jsonb(v_current),
    to_jsonb(v_result), p_actor_id
  );
  return v_result;
end;
$$;

revoke all on function public.upsert_work_dependency(
  uuid, uuid, uuid, bigint, uuid, uuid, uuid, uuid, uuid,
  public.work_declared_dependency_kind, text, public.work_dependency_effect
) from public, anon, authenticated;
grant execute on function public.upsert_work_dependency(
  uuid, uuid, uuid, bigint, uuid, uuid, uuid, uuid, uuid,
  public.work_declared_dependency_kind, text, public.work_dependency_effect
) to service_role;

create or replace function public.set_declared_work_dependency_state(
  p_organization_id uuid,
  p_actor_id uuid,
  p_dependency_id uuid,
  p_expected_version bigint,
  p_state public.work_dependency_manual_state,
  p_reason text
)
returns public.work_dependencies
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_current public.work_dependencies%rowtype;
  v_result public.work_dependencies%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or length(v_reason) not between 3 and 1000 then
    raise exception 'work_dependency_reason_required';
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) then raise exception 'work_dependency_not_authorized'; end if;
  select * into v_current from public.work_dependencies d
  where d.id = p_dependency_id and d.organization_id = p_organization_id
    and d.removed_at is null
  for update;
  if not found then raise exception 'work_dependency_not_found'; end if;
  if v_current.version <> p_expected_version then
    raise exception 'work_dependency_stale_version';
  end if;
  if v_current.declared_kind is null then
    raise exception 'work_dependency_not_declared';
  end if;
  if v_current.manual_state = p_state then
    raise exception 'work_dependency_same_state';
  end if;
  update public.work_dependencies set
    manual_state = p_state,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where id = p_dependency_id
  returning * into v_result;
  insert into public.work_dependency_events (
    organization_id, dependency_id, event_type, reason,
    before_state, after_state, created_by
  ) values (
    p_organization_id, v_result.id,
    case p_state
      when 'satisfied' then 'satisfied'
      when 'waived' then 'waived'
      else 'reopened'
    end,
    v_reason, to_jsonb(v_current), to_jsonb(v_result), p_actor_id
  );
  return v_result;
end;
$$;

revoke all on function public.set_declared_work_dependency_state(
  uuid, uuid, uuid, bigint, public.work_dependency_manual_state, text
) from public, anon, authenticated;
grant execute on function public.set_declared_work_dependency_state(
  uuid, uuid, uuid, bigint, public.work_dependency_manual_state, text
) to service_role;

create or replace function public.remove_work_dependency(
  p_organization_id uuid,
  p_actor_id uuid,
  p_dependency_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_current public.work_dependencies%rowtype;
  v_result public.work_dependencies%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null or length(v_reason) not between 3 and 1000 then
    raise exception 'work_dependency_reason_required';
  end if;
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) then raise exception 'work_dependency_not_authorized'; end if;
  select * into v_current from public.work_dependencies d
  where d.id = p_dependency_id and d.organization_id = p_organization_id
    and d.removed_at is null
  for update;
  if not found then raise exception 'work_dependency_not_found'; end if;
  if v_current.version <> p_expected_version then
    raise exception 'work_dependency_stale_version';
  end if;
  update public.work_dependencies set
    removed_at = now(), removed_by = p_actor_id, version = version + 1,
    updated_by = p_actor_id, updated_at = now()
  where id = p_dependency_id returning * into v_result;
  insert into public.work_dependency_events (
    organization_id, dependency_id, event_type, reason,
    before_state, after_state, created_by
  ) values (
    p_organization_id, v_result.id, 'removed', v_reason,
    to_jsonb(v_current), to_jsonb(v_result), p_actor_id
  );
  return v_result.version;
end;
$$;

revoke all on function public.remove_work_dependency(uuid, uuid, uuid, bigint, text)
from public, anon, authenticated;
grant execute on function public.remove_work_dependency(uuid, uuid, uuid, bigint, text)
to service_role;

create or replace function public.set_instruction_item_completion(
  p_organization_id uuid,
  p_actor_id uuid,
  p_instruction_item_id uuid,
  p_expected_version bigint,
  p_is_completed boolean
)
returns bigint
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_item public.job_instruction_items%rowtype;
  v_is_manager boolean;
  v_next_version bigint;
begin
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_organization_id and m.user_id = p_actor_id
      and m.role in ('admin', 'buero')
  ) into v_is_manager;
  select * into v_item from public.job_instruction_items i
  where i.id = p_instruction_item_id and i.organization_id = p_organization_id
  for update;
  if not found then raise exception 'instruction_item_not_found'; end if;
  if not v_is_manager and not (
    v_item.job_id is not null and exists (
      select 1 from public.job_assignments a
      where a.job_id = v_item.job_id and a.user_id = p_actor_id
    )
  ) then raise exception 'instruction_item_not_authorized'; end if;
  if v_item.completion_version <> p_expected_version then
    raise exception 'instruction_item_stale_version';
  end if;
  if v_item.is_completed = p_is_completed then return v_item.completion_version; end if;
  if p_is_completed and exists (
    select 1
    from public.job_instruction_item_dependencies d
    join public.job_instruction_items predecessor
      on predecessor.id = d.predecessor_item_id
    where d.dependent_item_id = v_item.id and not predecessor.is_completed
  ) then raise exception 'instruction_predecessor_incomplete'; end if;
  v_next_version := v_item.completion_version + 1;
  perform set_config('app.work_instruction_completion_write', 'true', true);
  update public.job_instruction_items set
    is_completed = p_is_completed,
    completion_version = v_next_version,
    last_status_changed_by = p_actor_id,
    last_status_changed_at = now(),
    updated_at = now()
  where id = v_item.id;
  insert into public.job_instruction_item_events (
    organization_id, instruction_item_id, event_type,
    previous_version, resulting_version, created_by
  ) values (
    p_organization_id, v_item.id,
    case when p_is_completed then 'completed' else 'reopened' end,
    v_item.completion_version, v_next_version, p_actor_id
  );
  return v_next_version;
end;
$$;

revoke all on function public.set_instruction_item_completion(
  uuid, uuid, uuid, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.set_instruction_item_completion(
  uuid, uuid, uuid, bigint, boolean
) to service_role;

create or replace function app_private.guard_instruction_item_completion_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if (new.is_completed, new.completion_version) is distinct from
    (old.is_completed, old.completion_version)
    and coalesce(current_setting('app.work_instruction_completion_write', true), '') <> 'true'
  then raise exception 'instruction_completion_requires_transition'; end if;
  return new;
end;
$$;

create trigger guard_instruction_item_completion_write
before update of is_completed, completion_version on public.job_instruction_items
for each row execute function app_private.guard_instruction_item_completion_write();

revoke all on function app_private.guard_instruction_item_completion_write()
from public, anon, authenticated;
grant execute on function app_private.guard_instruction_item_completion_write()
to postgres, service_role;

-- Preserve P1-12 parking facts without inventing missing context. Existing
-- parked jobs that never had a context row continue to surface as legacy gaps.
insert into public.work_blockers (
  organization_id, job_id, kind, reason, details,
  responsible_employee_record_id, next_review_date, state, version,
  is_legacy, legacy_source, created_by, created_at, updated_by, updated_at
)
select
  c.organization_id,
  c.job_id,
  'parking'::public.work_blocker_kind,
  case c.reason
    when 'warten_auf_kunde' then 'customer'::public.work_blocker_reason
    when 'warten_auf_material' then 'material'::public.work_blocker_reason
    when 'warten_auf_freigabe' then 'approval'::public.work_blocker_reason
    when 'kapazitaet' then 'capacity'::public.work_blocker_reason
    else 'other'::public.work_blocker_reason
  end,
  c.note,
  c.responsible_employee_record_id,
  c.next_review_date,
  'open'::public.work_blocker_state,
  1,
  true,
  'job_parking_contexts',
  c.created_by,
  c.created_at,
  c.updated_by,
  c.updated_at
from public.job_parking_contexts c;

insert into public.work_blockers (
  organization_id, job_id, kind, state, version, is_legacy, legacy_source,
  created_at, updated_at, resolved_at
)
select
  e.organization_id,
  e.job_id,
  'parking'::public.work_blocker_kind,
  'resolved'::public.work_blocker_state,
  1,
  true,
  'job_parking_events',
  min(e.created_at),
  max(e.created_at),
  max(e.created_at)
from public.job_parking_events e
where not exists (
  select 1 from public.work_blockers b where b.job_id = e.job_id
)
group by e.organization_id, e.job_id;

insert into public.work_blocker_events (
  organization_id, blocker_id, event_type,
  before_state, after_state, created_by, created_at
)
select
  e.organization_id,
  b.id,
  case e.event_type
    when 'context_set' then 'legacy_context_set'
    when 'context_updated' then 'legacy_context_updated'
    else 'legacy_unparked'
  end,
  e.before_state,
  e.after_state,
  e.created_by,
  e.created_at
from public.job_parking_events e
join public.work_blockers b
  on b.job_id = e.job_id
  and b.legacy_source in ('job_parking_contexts', 'job_parking_events');

drop trigger if exists clear_parking_context_on_unpark on public.jobs;
drop function if exists public.set_job_parking_context(
  uuid, uuid, uuid, public.job_parking_reason, text, uuid, date
);
drop table public.job_parking_events;
drop table public.job_parking_contexts;
drop function if exists app_private.clear_parking_context_on_unpark();
drop function if exists app_private.validate_job_parking_row_org();
drop type public.job_parking_reason;

-- Schedule presence is a planning fact. Removing a schedule clears only the
-- legacy date/time projection and never changes execution or parking state.
create or replace function app_private.sync_job_status_from_planning_occurrences()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job_id uuid := coalesce(new.job_id, old.job_id);
  v_organization_id uuid := coalesce(new.organization_id, old.organization_id);
begin
  if v_job_id is null then return coalesce(new, old); end if;
  if not exists (
    select 1 from public.planning_occurrences occurrence
    where occurrence.organization_id = v_organization_id
      and occurrence.job_id = v_job_id
      and occurrence.status = 'scheduled'
  ) then
    perform set_config('app.planning_projection_write', 'true', true);
    update public.jobs set
      planned_date = null,
      planned_time = null,
      updated_at = now()
    where id = v_job_id and organization_id = v_organization_id;
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function app_private.sync_job_status_from_planning_occurrences()
from public, anon, authenticated;
grant execute on function app_private.sync_job_status_from_planning_occurrences()
to postgres, service_role;

alter table public.attention_read_states
  drop constraint if exists attention_read_states_source_type_check;
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'vacation_request_approval', 'client_request_open', 'vacation_decision',
      'sickness_report', 'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review'
    ]::text[])
  );
alter table public.attention_events
  drop constraint if exists attention_events_source_type_check;
alter table public.attention_events
  add constraint attention_events_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'vacation_request_approval', 'client_request_open', 'vacation_decision',
      'sickness_report', 'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review'
    ]::text[])
  );

create or replace function app_private.validate_attention_source_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.user_id
  ) then raise exception 'attention state user is not a member of the organization'; end if;
  if new.source_type in ('vacation_decision', 'vacation_request_approval') then
    if not exists (select 1 from public.vacation_requests r where r.id = new.source_id and r.organization_id = new.organization_id)
      then raise exception 'attention source vacation request organization mismatch'; end if;
  elsif new.source_type = 'sickness_report' then
    if not exists (select 1 from public.sickness_reports r where r.id = new.source_id and r.organization_id = new.organization_id)
      then raise exception 'attention source sickness report organization mismatch'; end if;
  elsif new.source_type = 'employee_certification_expiry' then
    if not exists (select 1 from public.employee_capabilities c where c.id = new.source_id and c.organization_id = new.organization_id and c.capability_kind = 'certification')
      then raise exception 'attention source employee certification organization mismatch'; end if;
  elsif new.source_type = 'client_request_open' then
    if not exists (select 1 from public.client_requests r where r.id = new.source_id and r.organization_id = new.organization_id)
      then raise exception 'attention source client request organization mismatch'; end if;
  elsif new.source_type = 'client_follow_up' then
    if not exists (select 1 from public.client_follow_ups f where f.id = new.source_id and f.organization_id = new.organization_id)
      then raise exception 'attention source client follow-up organization mismatch'; end if;
  elsif new.source_type = 'time_session_approval' then
    if not exists (select 1 from public.time_entries e where e.id = new.source_id and e.organization_id = new.organization_id)
      then raise exception 'attention source time entry organization mismatch'; end if;
  elsif new.source_type = 'time_change_request_approval' then
    if not exists (select 1 from public.entry_change_requests r where r.id = new.source_id and r.organization_id = new.organization_id)
      then raise exception 'attention source change request organization mismatch'; end if;
  elsif new.source_type = 'dispatch_acknowledgement' then
    if not exists (select 1 from public.planning_dispatches d where d.id = new.source_id and d.organization_id = new.organization_id)
      then raise exception 'attention source dispatch organization mismatch'; end if;
  elsif new.source_type = 'dispatch_challenge_open' then
    if not exists (select 1 from public.planning_dispatch_acknowledgements a where a.id = new.source_id and a.organization_id = new.organization_id and a.state = 'challenged')
      then raise exception 'attention source dispatch challenge organization mismatch'; end if;
  elsif new.source_type = 'job_parking_review' then
    if not exists (select 1 from public.jobs j where j.id = new.source_id and j.organization_id = new.organization_id)
      then raise exception 'attention source job organization mismatch'; end if;
  elsif new.source_type = 'work_blocker_review' then
    if not exists (select 1 from public.work_blockers b where b.id = new.source_id and b.organization_id = new.organization_id)
      then raise exception 'attention source work blocker organization mismatch'; end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_attention_source_org()
from public, anon, authenticated;
grant execute on function app_private.validate_attention_source_org()
to postgres, service_role;

create or replace function app_private.can_view_p1_14_blocker(
  p_blocker_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.work_blockers b
    where b.id = p_blocker_id
      and app_private.can_view_p1_14_work_target(
        b.organization_id, b.job_id, b.project_id, b.instruction_item_id, p_user_id
      )
  );
$$;

create or replace function app_private.can_view_p1_14_dependency(
  p_dependency_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.work_dependencies d
    where d.id = p_dependency_id
      and app_private.can_view_p1_14_work_target(
        d.organization_id, d.dependent_job_id, d.dependent_project_id, null, p_user_id
      )
  );
$$;

revoke all on function app_private.can_view_p1_14_blocker(uuid, uuid)
from public, anon;
revoke all on function app_private.can_view_p1_14_dependency(uuid, uuid)
from public, anon;
grant execute on function app_private.can_view_p1_14_blocker(uuid, uuid)
to authenticated, service_role;
grant execute on function app_private.can_view_p1_14_dependency(uuid, uuid)
to authenticated, service_role;

alter table public.work_execution_events enable row level security;
alter table public.work_blockers enable row level security;
alter table public.work_blocker_events enable row level security;
alter table public.work_dependencies enable row level security;
alter table public.work_dependency_events enable row level security;
alter table public.job_instruction_item_events enable row level security;

create policy "Users can view permitted work execution events"
on public.work_execution_events for select to authenticated using (
  app_private.can_view_p1_14_work_target(
    organization_id, job_id, project_id, null, (select auth.uid())
  )
);
create policy "Users can view permitted work blockers"
on public.work_blockers for select to authenticated using (
  app_private.can_view_p1_14_work_target(
    organization_id, job_id, project_id, instruction_item_id, (select auth.uid())
  )
);
create policy "Users can view permitted work blocker events"
on public.work_blocker_events for select to authenticated using (
  app_private.can_view_p1_14_blocker(blocker_id, (select auth.uid()))
);
create policy "Users can view permitted work dependencies"
on public.work_dependencies for select to authenticated using (
  app_private.can_view_p1_14_work_target(
    organization_id, dependent_job_id, dependent_project_id, null, (select auth.uid())
  )
);
create policy "Users can view permitted work dependency events"
on public.work_dependency_events for select to authenticated using (
  app_private.can_view_p1_14_dependency(dependency_id, (select auth.uid()))
);
create policy "Users can view permitted instruction item events"
on public.job_instruction_item_events for select to authenticated using (
  app_private.can_view_p1_14_work_target(
    organization_id, null, null, instruction_item_id, (select auth.uid())
  )
);

revoke all on table
  public.work_execution_events,
  public.work_blockers,
  public.work_blocker_events,
  public.work_dependencies,
  public.work_dependency_events,
  public.job_instruction_item_events
from anon, authenticated;
grant select on table
  public.work_execution_events,
  public.work_blockers,
  public.work_blocker_events,
  public.work_dependencies,
  public.work_dependency_events,
  public.job_instruction_item_events
to authenticated;
grant all on table
  public.work_execution_events,
  public.work_blockers,
  public.work_blocker_events,
  public.work_dependencies,
  public.work_dependency_events,
  public.job_instruction_item_events
to service_role;

alter table public.jobs replica identity full;
alter table public.projects replica identity full;
alter table public.job_instruction_items replica identity full;
alter table public.work_blockers replica identity full;
alter table public.work_dependencies replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'work_blockers'
  ) then alter publication supabase_realtime add table public.work_blockers; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'work_dependencies'
  ) then alter publication supabase_realtime add table public.work_dependencies; end if;
end $$;

create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_table_name = 'jobs' and (
    exists (select 1 from public.work_execution_events e where e.job_id = old.id)
    or exists (select 1 from public.work_blockers b where b.job_id = old.id)
    or exists (
      select 1 from public.work_dependencies d
      where d.dependent_job_id = old.id or d.predecessor_job_id = old.id
    )
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;
  if tg_table_name = 'projects' and (
    exists (select 1 from public.work_execution_events e where e.project_id = old.id)
    or exists (select 1 from public.work_blockers b where b.project_id = old.id)
    or exists (
      select 1 from public.work_dependencies d
      where d.dependent_project_id = old.id or d.predecessor_project_id = old.id
    )
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;
  return old;
end;
$$;

create trigger prevent_job_with_history_delete
before delete on public.jobs
for each row execute function app_private.prevent_historic_work_delete();
create trigger prevent_project_with_history_delete
before delete on public.projects
for each row execute function app_private.prevent_historic_work_delete();

revoke all on function app_private.prevent_historic_work_delete()
from public, anon, authenticated;
grant execute on function app_private.prevent_historic_work_delete()
to postgres, service_role;

comment on column public.jobs.execution_state is
  'P1-14 canonical execution state. NULL marks untouched legacy work.';
comment on column public.projects.execution_state_override is
  'Explicit project execution override; NULL means derive the visible state from child jobs or legacy projection.';
comment on table public.work_blockers is
  'Canonical current blocker and parking facts. Parking is separate from execution state.';
comment on table public.work_dependencies is
  'Bounded execution dependencies for jobs and projects, including declared external prerequisites.';
