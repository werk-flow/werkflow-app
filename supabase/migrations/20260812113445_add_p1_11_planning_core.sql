
create type public.planning_entry_kind as enum ('job_visit', 'internal');
create type public.planning_internal_type as enum ('internal_work', 'meeting', 'training', 'other');
create type public.planning_time_kind as enum ('timed', 'all_day');
create type public.planning_occurrence_status as enum ('scheduled', 'skipped', 'cancelled');

create table public.planning_series (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lineage_id uuid not null default gen_random_uuid(),
  previous_series_id uuid references public.planning_series(id) on delete restrict,
  job_id uuid references public.jobs(id) on delete cascade,
  entry_kind public.planning_entry_kind not null,
  internal_type public.planning_internal_type,
  title text,
  description text,
  location text,
  time_kind public.planning_time_kind not null,
  timezone text not null default 'Europe/Berlin',
  starts_at_local timestamp without time zone not null,
  duration_minutes integer,
  duration_days integer,
  recurrence_frequency text not null,
  recurrence_interval integer not null default 1,
  weekdays smallint[],
  month_day smallint,
  until_local_date date,
  occurrence_count integer,
  segment_start_local timestamp without time zone not null,
  segment_end_before_local timestamp without time zone,
  generated_through_local timestamp without time zone,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint planning_series_subject_check check (
    (
      entry_kind = 'job_visit'
      and job_id is not null
      and internal_type is null
      and title is null
      and description is null
      and location is null
    )
    or (
      entry_kind = 'internal'
      and job_id is null
      and internal_type is not null
      and length(btrim(title)) between 1 and 200
      and (description is null or length(description) <= 4000)
      and (location is null or length(location) <= 500)
    )
  ),
  constraint planning_series_timezone_check check (timezone = 'Europe/Berlin'),
  constraint planning_series_duration_check check (
    (
      time_kind = 'timed'
      and duration_minutes between 1 and 525600
      and duration_days is null
    )
    or (
      time_kind = 'all_day'
      and duration_days between 1 and 366
      and duration_minutes is null
    )
  ),
  constraint planning_series_frequency_check check (
    recurrence_frequency in ('daily', 'weekly', 'monthly')
  ),
  constraint planning_series_interval_check check (recurrence_interval between 1 and 12),
  constraint planning_series_weekly_check check (
    (
      recurrence_frequency = 'weekly'
      and weekdays is not null
      and cardinality(weekdays) between 1 and 7
      and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
      and month_day is null
    )
    or (
      recurrence_frequency = 'monthly'
      and weekdays is null
      and month_day between 1 and 31
    )
    or (
      recurrence_frequency = 'daily'
      and weekdays is null
      and month_day is null
    )
  ),
  constraint planning_series_end_check check (
    (until_local_date is not null and occurrence_count is null)
    or (until_local_date is null and occurrence_count between 2 and 730)
  ),
  constraint planning_series_until_limit_check check (
    until_local_date is null
    or (
      until_local_date >= starts_at_local::date
      and until_local_date <= starts_at_local::date + 731
    )
  ),
  constraint planning_series_segment_check check (
    segment_start_local >= starts_at_local
    and (
      segment_end_before_local is null
      or segment_end_before_local > segment_start_local
    )
  ),
  constraint planning_series_not_self_previous check (
    previous_series_id is null or previous_series_id <> id
  ),
  unique (organization_id, lineage_id, segment_start_local)
);

create table public.planning_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  series_id uuid references public.planning_series(id) on delete restrict,
  series_lineage_id uuid,
  original_start_local timestamp without time zone,
  job_id uuid references public.jobs(id) on delete cascade,
  entry_kind public.planning_entry_kind not null,
  internal_type public.planning_internal_type,
  title text,
  description text,
  location text,
  time_kind public.planning_time_kind not null,
  start_at timestamp with time zone,
  end_at timestamp with time zone,
  start_date date,
  end_date_exclusive date,
  timezone text not null default 'Europe/Berlin',
  status public.planning_occurrence_status not null default 'scheduled',
  is_exception boolean not null default false,
  dst_resolution text not null default 'exact',
  legacy_source_job_id uuid references public.jobs(id) on delete cascade,
  version integer not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint planning_occurrences_series_identity_check check (
    (
      series_id is null
      and series_lineage_id is null
      and original_start_local is null
    )
    or (
      series_id is not null
      and series_lineage_id is not null
      and original_start_local is not null
    )
  ),
  constraint planning_occurrences_subject_check check (
    (
      entry_kind = 'job_visit'
      and job_id is not null
      and internal_type is null
      and title is null
      and description is null
      and location is null
    )
    or (
      entry_kind = 'internal'
      and job_id is null
      and internal_type is not null
      and length(btrim(title)) between 1 and 200
      and (description is null or length(description) <= 4000)
      and (location is null or length(location) <= 500)
    )
  ),
  constraint planning_occurrences_interval_check check (
    (
      time_kind = 'timed'
      and start_at is not null
      and end_at is not null
      and end_at > start_at
      and start_date is null
      and end_date_exclusive is null
    )
    or (
      time_kind = 'all_day'
      and start_at is null
      and end_at is null
      and start_date is not null
      and end_date_exclusive is not null
      and end_date_exclusive > start_date
    )
  ),
  constraint planning_occurrences_timezone_check check (timezone = 'Europe/Berlin'),
  constraint planning_occurrences_dst_check check (
    dst_resolution in ('exact', 'shifted_forward', 'first_ambiguous')
  ),
  constraint planning_occurrences_version_check check (version >= 1),
  constraint planning_occurrences_legacy_subject_check check (
    legacy_source_job_id is null
    or (entry_kind = 'job_visit' and legacy_source_job_id = job_id)
  )
);

create unique index planning_occurrences_series_identity_unique
  on public.planning_occurrences (
    organization_id,
    series_lineage_id,
    original_start_local
  )
  where series_lineage_id is not null;

create unique index planning_occurrences_legacy_source_unique
  on public.planning_occurrences (legacy_source_job_id)
  where legacy_source_job_id is not null;

create table public.planning_occurrence_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null references public.planning_occurrences(id) on delete cascade,
  employee_record_id uuid not null references public.employee_records(id) on delete cascade,
  team_source_id uuid references public.teams(id) on delete set null,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamp with time zone not null default now(),
  unique (occurrence_id, employee_record_id)
);

create table public.planning_occurrence_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null references public.planning_occurrences(id) on delete cascade,
  selected_employee_record_ids uuid[] not null default '{}',
  team_source_ids uuid[] not null default '{}',
  capacity_snapshot jsonb not null default '[]',
  qualification_snapshot jsonb not null default '[]',
  capacity_fingerprint text not null,
  qualification_fingerprint text not null,
  override_reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint planning_assessments_capacity_fingerprint_check check (
    length(btrim(capacity_fingerprint)) between 1 and 256
  ),
  constraint planning_assessments_qualification_fingerprint_check check (
    length(btrim(qualification_fingerprint)) between 1 and 256
  ),
  constraint planning_assessments_override_reason_check check (
    override_reason is null or length(btrim(override_reason)) between 3 and 500
  )
);

create table public.planning_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  series_id uuid references public.planning_series(id) on delete cascade,
  occurrence_id uuid references public.planning_occurrences(id) on delete cascade,
  event_type text not null,
  mutation_scope text not null,
  before_state jsonb,
  after_state jsonb,
  reason text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint planning_events_target_check check (
    series_id is not null or occurrence_id is not null
  ),
  constraint planning_events_type_check check (
    event_type in (
      'created',
      'moved',
      'resized',
      'reassigned',
      'edited',
      'series_split',
      'series_changed',
      'series_stopped',
      'skipped',
      'cancelled',
      'override_recorded',
      'legacy_synced'
    )
  ),
  constraint planning_events_scope_check check (
    mutation_scope in ('one', 'this_and_future', 'whole_series', 'system')
  ),
  constraint planning_events_reason_check check (
    reason is null or length(btrim(reason)) between 3 and 500
  )
);

create index planning_series_organization_job_idx
  on public.planning_series (organization_id, job_id)
  where job_id is not null;
create index planning_series_lineage_idx
  on public.planning_series (organization_id, lineage_id, segment_start_local);
create index planning_series_previous_idx
  on public.planning_series (previous_series_id)
  where previous_series_id is not null;
create index planning_series_created_by_idx
  on public.planning_series (created_by)
  where created_by is not null;
create index planning_series_updated_by_idx
  on public.planning_series (updated_by)
  where updated_by is not null;

create index planning_occurrences_organization_start_idx
  on public.planning_occurrences (organization_id, start_at)
  where start_at is not null;
create index planning_occurrences_organization_date_idx
  on public.planning_occurrences (organization_id, start_date)
  where start_date is not null;
create index planning_occurrences_job_start_idx
  on public.planning_occurrences (job_id, start_at)
  where job_id is not null and start_at is not null;
create index planning_occurrences_job_date_idx
  on public.planning_occurrences (job_id, start_date)
  where job_id is not null and start_date is not null;
create index planning_occurrences_series_idx
  on public.planning_occurrences (series_id, original_start_local);
create index planning_occurrences_status_idx
  on public.planning_occurrences (organization_id, status);
create index planning_occurrences_created_by_idx
  on public.planning_occurrences (created_by)
  where created_by is not null;
create index planning_occurrences_updated_by_idx
  on public.planning_occurrences (updated_by)
  where updated_by is not null;

create index planning_occurrence_assignments_employee_idx
  on public.planning_occurrence_assignments (employee_record_id, occurrence_id);
create index planning_occurrence_assignments_organization_idx
  on public.planning_occurrence_assignments (organization_id);
create index planning_occurrence_assignments_team_idx
  on public.planning_occurrence_assignments (team_source_id)
  where team_source_id is not null;
create index planning_occurrence_assignments_assigned_by_idx
  on public.planning_occurrence_assignments (assigned_by)
  where assigned_by is not null;

create index planning_occurrence_assessments_occurrence_created_idx
  on public.planning_occurrence_assessments (occurrence_id, created_at desc);
create index planning_occurrence_assessments_organization_idx
  on public.planning_occurrence_assessments (organization_id);
create index planning_occurrence_assessments_created_by_idx
  on public.planning_occurrence_assessments (created_by)
  where created_by is not null;

create index planning_events_occurrence_created_idx
  on public.planning_events (occurrence_id, created_at desc)
  where occurrence_id is not null;
create index planning_events_series_created_idx
  on public.planning_events (series_id, created_at desc)
  where series_id is not null;
create index planning_events_organization_created_idx
  on public.planning_events (organization_id, created_at desc);
create index planning_events_created_by_idx
  on public.planning_events (created_by)
  where created_by is not null;

create or replace function app_private.validate_planning_series_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked_job record;
  previous_segment record;
begin
  if new.job_id is not null then
    select organization_id into linked_job
    from public.jobs
    where id = new.job_id;

    if not found or linked_job.organization_id <> new.organization_id then
      raise exception 'planning series job organization mismatch';
    end if;
  end if;

  if new.previous_series_id is not null then
    select organization_id, lineage_id into previous_segment
    from public.planning_series
    where id = new.previous_series_id;

    if not found
      or previous_segment.organization_id <> new.organization_id
      or previous_segment.lineage_id <> new.lineage_id then
      raise exception 'planning series predecessor mismatch';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_planning_occurrence_org()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  linked_job record;
  linked_series record;
begin
  if new.job_id is not null then
    select organization_id into linked_job
    from public.jobs
    where id = new.job_id;

    if not found or linked_job.organization_id <> new.organization_id then
      raise exception 'planning occurrence job organization mismatch';
    end if;
  end if;

  if new.series_id is not null then
    select organization_id, lineage_id, job_id, entry_kind
      into linked_series
    from public.planning_series
    where id = new.series_id;

    if not found
      or linked_series.organization_id <> new.organization_id
      or linked_series.lineage_id <> new.series_lineage_id
      or linked_series.entry_kind <> new.entry_kind
      or linked_series.job_id is distinct from new.job_id then
      raise exception 'planning occurrence series mismatch';
    end if;
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_planning_assignment_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.planning_occurrences o
    where o.id = new.occurrence_id
      and o.organization_id = new.organization_id
  ) then
    raise exception 'planning assignment occurrence organization mismatch';
  end if;

  if not exists (
    select 1
    from public.employee_records e
    where e.id = new.employee_record_id
      and e.organization_id = new.organization_id
  ) then
    raise exception 'planning assignment employee organization mismatch';
  end if;

  if new.team_source_id is not null and not exists (
    select 1
    from public.teams t
    where t.id = new.team_source_id
      and t.organization_id = new.organization_id
  ) then
    raise exception 'planning assignment team organization mismatch';
  end if;

  return new;
end;
$$;

create or replace function app_private.validate_planning_history_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.occurrence_id is not null and not exists (
    select 1
    from public.planning_occurrences o
    where o.id = new.occurrence_id
      and o.organization_id = new.organization_id
  ) then
    raise exception 'planning history occurrence organization mismatch';
  end if;

  if new.series_id is not null and not exists (
    select 1
    from public.planning_series s
    where s.id = new.series_id
      and s.organization_id = new.organization_id
  ) then
    raise exception 'planning history series organization mismatch';
  end if;

  return new;
end;
$$;

create or replace function app_private.prevent_planning_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'planning history is append-only';
end;
$$;

create or replace function app_private.get_user_planning_occurrence_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.occurrence_id
  from public.planning_occurrence_assignments a
  join public.employee_records e
    on e.id = a.employee_record_id
   and e.organization_id = a.organization_id
  where e.user_id = (select auth.uid());
$$;

revoke all on function app_private.validate_planning_series_org() from public, anon, authenticated;
revoke all on function app_private.validate_planning_occurrence_org() from public, anon, authenticated;
revoke all on function app_private.validate_planning_assignment_org() from public, anon, authenticated;
revoke all on function app_private.validate_planning_history_org() from public, anon, authenticated;
revoke all on function app_private.prevent_planning_history_change() from public, anon, authenticated;
revoke all on function app_private.get_user_planning_occurrence_ids() from public, anon;
grant execute on function app_private.get_user_planning_occurrence_ids() to authenticated;

create trigger planning_series_validate
before insert or update on public.planning_series
for each row execute function app_private.validate_planning_series_org();

create trigger planning_series_updated_at
before update on public.planning_series
for each row execute function public.update_updated_at_column();

create trigger planning_occurrences_validate
before insert or update on public.planning_occurrences
for each row execute function app_private.validate_planning_occurrence_org();

create trigger planning_occurrences_updated_at
before update on public.planning_occurrences
for each row execute function public.update_updated_at_column();

create trigger planning_occurrence_assignments_validate
before insert or update on public.planning_occurrence_assignments
for each row execute function app_private.validate_planning_assignment_org();

create trigger planning_occurrence_assessments_validate
before insert on public.planning_occurrence_assessments
for each row execute function app_private.validate_planning_history_org();

create trigger planning_occurrence_assessments_append_only
before update or delete on public.planning_occurrence_assessments
for each row execute function app_private.prevent_planning_history_change();

create trigger planning_events_validate
before insert on public.planning_events
for each row execute function app_private.validate_planning_history_org();

create trigger planning_events_append_only
before update or delete on public.planning_events
for each row execute function app_private.prevent_planning_history_change();

alter table public.planning_series enable row level security;
alter table public.planning_occurrences enable row level security;
alter table public.planning_occurrence_assignments enable row level security;
alter table public.planning_occurrence_assessments enable row level security;
alter table public.planning_events enable row level security;

create policy "Managers can view planning series"
on public.planning_series
for select
to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

create policy "Managers and assigned employees can view planning occurrences"
on public.planning_occurrences
for select
to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or id in (
    select app_private.get_user_planning_occurrence_ids()
  )
);

create policy "Managers and assigned employees can view planning assignments"
on public.planning_occurrence_assignments
for select
to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
  or employee_record_id in (
    select app_private.get_user_employee_record_ids((select auth.uid()))
  )
);

create policy "Managers can view planning assessments"
on public.planning_occurrence_assessments
for select
to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

create policy "Managers can view planning events"
on public.planning_events
for select
to authenticated
using (
  organization_id in (
    select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))
  )
);

revoke all on table public.planning_series from public, anon, authenticated;
revoke all on table public.planning_occurrences from public, anon, authenticated;
revoke all on table public.planning_occurrence_assignments from public, anon, authenticated;
revoke all on table public.planning_occurrence_assessments from public, anon, authenticated;
revoke all on table public.planning_events from public, anon, authenticated;

grant select on table public.planning_series to authenticated;
grant select on table public.planning_occurrences to authenticated;
grant select on table public.planning_occurrence_assignments to authenticated;
grant select on table public.planning_occurrence_assessments to authenticated;
grant select on table public.planning_events to authenticated;

grant all on table public.planning_series to service_role;
grant all on table public.planning_occurrences to service_role;
grant all on table public.planning_occurrence_assignments to service_role;
grant all on table public.planning_occurrence_assessments to service_role;
grant all on table public.planning_events to service_role;

alter table public.planning_series replica identity full;
alter table public.planning_occurrences replica identity full;
alter table public.planning_occurrence_assignments replica identity full;

alter publication supabase_realtime add table public.planning_series;
alter publication supabase_realtime add table public.planning_occurrences;
alter publication supabase_realtime add table public.planning_occurrence_assignments;

do $$
begin
  if exists (
    select 1
    from public.jobs
    where planned_date is not null
      and planned_time is not null
      and estimated_duration_minutes is null
  ) then
    raise exception 'timed legacy job without duration';
  end if;
end;
$$;

insert into public.planning_occurrences (
  organization_id,
  job_id,
  entry_kind,
  time_kind,
  start_at,
  end_at,
  start_date,
  end_date_exclusive,
  timezone,
  status,
  is_exception,
  legacy_source_job_id,
  created_by,
  updated_by,
  created_at,
  updated_at
)
select
  j.organization_id,
  j.id,
  'job_visit'::public.planning_entry_kind,
  case
    when j.planned_time is null then 'all_day'::public.planning_time_kind
    else 'timed'::public.planning_time_kind
  end,
  case
    when j.planned_time is not null
      then (j.planned_date + j.planned_time) at time zone 'Europe/Berlin'
    else null
  end,
  case
    when j.planned_time is not null
      then ((j.planned_date + j.planned_time) at time zone 'Europe/Berlin')
        + make_interval(mins => j.estimated_duration_minutes)
    else null
  end,
  case when j.planned_time is null then j.planned_date else null end,
  case when j.planned_time is null then j.planned_date + 1 else null end,
  'Europe/Berlin',
  'scheduled'::public.planning_occurrence_status,
  false,
  j.id,
  j.created_by,
  j.created_by,
  j.created_at,
  j.updated_at
from public.jobs j
where j.planned_date is not null
on conflict (legacy_source_job_id) where legacy_source_job_id is not null do nothing;

insert into public.planning_occurrence_assignments (
  organization_id,
  occurrence_id,
  employee_record_id,
  assigned_by,
  assigned_at
)
select
  j.organization_id,
  o.id,
  e.id,
  ja.assigned_by,
  ja.assigned_at
from public.job_assignments ja
join public.jobs j on j.id = ja.job_id
join public.planning_occurrences o on o.legacy_source_job_id = j.id
join public.employee_records e
  on e.organization_id = j.organization_id
 and e.user_id = ja.user_id
on conflict (occurrence_id, employee_record_id) do nothing;
