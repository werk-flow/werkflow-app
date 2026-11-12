-- Berufsschule days per apprentice (werk-flow/werkflow-planning#165, owner
-- decision on #14): the office records each apprentice's school days as a
-- recurring weekday or as a block period. A school day is no sickness: it is
-- credited with the day's normal target, so the Zeitkonto neither gains nor
-- loses on it (lib/personnel/targets.ts owns the rule).
--
-- History stays: a row is never deleted. A weekly rule is ended by setting
-- its end date, a wrong entry is cancelled. Neither may reach into a closed
-- period, so a closed month's school days are the rows as they stand today
-- and its numbers can always be recomputed.
--
-- The server writes every row through the service role
-- (lib/personnel/school-day-actions.ts). Client roles only read: Admin and
-- Büro the rows of their organization, a person their own rows. That read is
-- what Realtime delivers.
create table public.school_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_record_id uuid not null references public.employee_records (id) on delete cascade,
  kind text not null,
  -- 0 = Montag … 4 = Freitag, as lib/personnel/schedule.ts counts weekdays.
  weekday smallint,
  start_date date not null,
  -- A weekly rule may run open-ended; a block always has its last day.
  end_date date,
  -- No foreign keys on the actors: the record stays when an account goes.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  ended_by uuid,
  ended_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  constraint school_days_kind_check check (kind in ('weekday', 'block')),
  constraint school_days_shape_check check (
    (kind = 'weekday' and weekday between 0 and 4)
    or (kind = 'block' and weekday is null and end_date is not null)
  ),
  constraint school_days_range_check check (end_date is null or end_date >= start_date),
  constraint school_days_ended_check check (
    (ended_at is null) = (ended_by is null) and (ended_at is null or kind = 'weekday')
  ),
  constraint school_days_cancelled_check check ((cancelled_at is null) = (cancelled_by is null)),
  -- One active rule per weekday and one active block per day and person.
  constraint school_days_no_weekday_overlap exclude using gist (
    employee_record_id with =,
    weekday with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
  ) where (kind = 'weekday' and cancelled_at is null),
  constraint school_days_no_block_overlap exclude using gist (
    employee_record_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (kind = 'block' and cancelled_at is null)
);

create index school_days_organization_start_idx
  on public.school_days (organization_id, start_date);
create index school_days_employee_record_idx
  on public.school_days (employee_record_id);

-- The write rules. An insert names a record of its own organization and
-- starts active. An update either cancels the row or ends a weekly rule
-- earlier; every other column stays. A delete is refused, except the cascade
-- of a deleted organization or personnel record. Each write checks the days
-- it changes against the closed periods: a new or cancelled row its whole
-- span, an end date only the days it removes.
create function app_private.guard_school_day_write()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.organizations where id = old.organization_id)
      or not exists (select 1 from public.employee_records where id = old.employee_record_id)
    then
      return old;
    end if;
    raise exception 'school_day_history_kept';
  end if;

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.employee_records record
      where record.id = new.employee_record_id and record.organization_id = new.organization_id
    ) then
      raise exception 'school_day_record_organization_mismatch';
    end if;
    if new.ended_at is not null or new.cancelled_at is not null then
      raise exception 'school_day_starts_active';
    end if;
    perform app_private.assert_time_facts_period_open(
      new.organization_id, new.start_date, coalesce(new.end_date, 'infinity'::date)
    );
    return new;
  end if;

  if (new.id, new.organization_id, new.employee_record_id, new.kind, new.weekday,
      new.start_date, new.created_by, new.created_at)
    is distinct from
     (old.id, old.organization_id, old.employee_record_id, old.kind, old.weekday,
      old.start_date, old.created_by, old.created_at)
  then
    raise exception 'school_day_immutable';
  end if;
  if old.cancelled_at is not null then
    raise exception 'school_day_cancelled';
  end if;

  if new.cancelled_at is not null then
    if new.end_date is distinct from old.end_date
      or (new.ended_at, new.ended_by) is distinct from (old.ended_at, old.ended_by)
    then
      raise exception 'school_day_immutable';
    end if;
    perform app_private.assert_time_facts_period_open(
      old.organization_id, old.start_date, coalesce(old.end_date, 'infinity'::date)
    );
    return new;
  end if;

  if new.end_date is distinct from old.end_date then
    if new.end_date is null
      or (old.end_date is not null and new.end_date >= old.end_date)
      or new.ended_at is null
    then
      raise exception 'school_day_end_not_earlier';
    end if;
    perform app_private.assert_time_facts_period_open(
      old.organization_id, new.end_date + 1, coalesce(old.end_date, 'infinity'::date)
    );
    return new;
  end if;

  if (new.ended_at, new.ended_by) is distinct from (old.ended_at, old.ended_by) then
    raise exception 'school_day_immutable';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_school_day_write() from public, anon, authenticated, service_role;

create trigger school_days_guard_write
  before insert or update or delete on public.school_days
  for each row execute function app_private.guard_school_day_write();

alter table public.school_days enable row level security;

create policy school_days_select_managers on public.school_days
  for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

create policy school_days_select_own on public.school_days
  for select to authenticated
  using (employee_record_id in (select app_private.get_user_employee_record_ids((select auth.uid()))));

revoke all on table public.school_days from public, anon, authenticated, service_role;
grant select on table public.school_days to authenticated;
grant select, insert, update on table public.school_days to service_role;

-- Realtime (docs/technical/realtime-and-caching.md, "Add Realtime data"): the
-- apprentice's Zeiterfassung and calendar and the office's views update when
-- a school day is recorded, ended or cancelled.
create unique index school_days_replident_idx
  on public.school_days (id, organization_id);
alter table public.school_days
  replica identity using index school_days_replident_idx;
create trigger emit_realtime_deletion
  after delete on public.school_days
  for each row execute function app_private.emit_realtime_deletion();
alter publication supabase_realtime add table public.school_days;

-- The period review shows each person's school minutes, read live from the
-- school days and the person's absence policy. Assigning a person another
-- policy writes only time_account_policy_assignments, so it is published too
-- (Admin and Büro already read it); an open review then re-reads.
create unique index time_account_policy_assignments_replident_idx
  on public.time_account_policy_assignments (id, organization_id);
alter table public.time_account_policy_assignments
  replica identity using index time_account_policy_assignments_replident_idx;
create trigger emit_realtime_deletion
  after delete on public.time_account_policy_assignments
  for each row execute function app_private.emit_realtime_deletion();
alter publication supabase_realtime add table public.time_account_policy_assignments;

-- A period's calculation depends on its school days, so its fingerprint
-- includes them: a school day recorded after the preparation makes the close
-- refuse with stale_calculation. The fingerprint hashes the effective school
-- dates inside the period, not the rows, and only when there are any: a
-- period without school days keeps the fingerprint it had, so no prepared
-- period turns stale by this migration. Otherwise the body is the one of
-- 20260901130000_include_organization_calendar_in_p1_23_fingerprint.sql.
create or replace function app_private.compute_p1_23_source_fingerprint(
  p_organization_id uuid,
  p_period_start_date date,
  p_period_end_date date
)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest((jsonb_build_object(
    'period_sources', app_private.compute_p1_23_source_fingerprint_base(
      p_organization_id,
      p_period_start_date,
      p_period_end_date
    ),
    'holiday_settings', coalesce((
      select jsonb_build_object(
        'holiday_region', settings.holiday_region,
        'holiday_region_history', settings.holiday_region_history
      )
      from public.organization_settings settings
      where settings.organization_id = p_organization_id
    ), '{}'::jsonb),
    'closure_days', coalesce((
      select jsonb_agg(to_jsonb(closure_day) order by closure_day.closure_date, closure_day.id)
      from public.organization_closure_days closure_day
      where closure_day.organization_id = p_organization_id
        and closure_day.closure_date between p_period_start_date and p_period_end_date
    ), '[]'::jsonb)
  ) || coalesce((
    select jsonb_build_object(
      'school_days',
      jsonb_agg(jsonb_build_array(school.employee_record_id, school.school_date)
        order by school.employee_record_id, school.school_date)
    )
    from (
      select distinct school_day.employee_record_id, day::date as school_date
      from public.school_days school_day
      cross join lateral generate_series(
        greatest(school_day.start_date, p_period_start_date)::timestamp,
        least(coalesce(school_day.end_date, p_period_end_date), p_period_end_date)::timestamp,
        interval '1 day'
      ) day
      where school_day.organization_id = p_organization_id
        and school_day.cancelled_at is null
        and school_day.start_date <= p_period_end_date
        and coalesce(school_day.end_date, p_period_end_date) >= p_period_start_date
        and (school_day.kind = 'block' or extract(isodow from day)::integer - 1 = school_day.weekday)
    ) school
    having count(*) > 0
  ), '{}'::jsonb))::text, 'sha256'), 'hex');
$$;
