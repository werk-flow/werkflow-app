-- Employment dates follow the employment step (werk-flow/werkflow-planning#350).
--
-- 1. „Planung zurücknehmen“ restores the record's dates. A planned exit writes
--    employee_records.exit_date at once, and a planned start writes entry_date
--    and clears exit_date; withdrawing the plan cleared only the schedule, so
--    on the planned date the dates read as exited or employed although the
--    step never took effect. The lifecycle now keeps the dates the record held
--    before the first planned step (replaced_entry_date, replaced_exit_date; a
--    second plan of the same step keeps them), and cancel_scheduled writes
--    them back. It restores a date only while the record still holds the
--    plan's date: a date the office changed on the record since stays, and an
--    earlier exit that an edited entry date overtook does not return. The
--    dates are read under the record's row lock, after the organization lock.
--    Withdrawing a planned return that restores an exit date takes the
--    last-holder check of a step that ends the employment.
-- 3. A duplicate request that waited for the per-person lock answers with
--    the operation the first one recorded instead of stale_version
--    (werk-flow/werkflow-planning#352).
-- 2. A step that acts at once (start, mark_inactive, exit, reactivate) refuses
--    a date after today (immediate_effective_date_required). It set the state
--    at once and stored the later date, so „Austritt festhalten“ for next
--    month made the person exited today. plan_start and plan_exit remain the
--    way to a later date.
--
-- A schedule planned before this migration has no recorded dates. Withdrawing
-- such a planned start keeps its entry date (the backfill below records it),
-- and withdrawing such a planned exit clears the exit date: before the plan,
-- an employed person normally had none.
--
-- Expand-only: two nullable columns that only the function below writes, and
-- set_personnel_employment_transition keeps its signature, result and grants
-- (20261108060000_count_active_holders_in_employment_transitions.sql).
--
-- Prevention: Tier 1 (the function owns both rules), Tier 2
-- supabase/tests/p1_24_people_lifecycle.sql.

alter table public.personnel_employment_lifecycles
  add column replaced_entry_date date,
  add column replaced_exit_date date;

comment on column public.personnel_employment_lifecycles.replaced_entry_date is
  'The personnel record''s entry date before the scheduled step wrote its own; withdrawing the step restores it.';
comment on column public.personnel_employment_lifecycles.replaced_exit_date is
  'The personnel record''s exit date before the scheduled step wrote its own; withdrawing the step restores it.';

-- A planned start from before this migration keeps its entry date when withdrawn.
update public.personnel_employment_lifecycles lifecycle
set replaced_entry_date = record.entry_date
from public.employee_records record
where record.id = lifecycle.employee_record_id
  and lifecycle.scheduled_state = 'active';

create or replace function public.set_personnel_employment_transition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_expected_version bigint,
  p_transition_kind public.personnel_employment_transition_kind,
  p_effective_on date,
  p_reason text,
  p_unresolved_work jsonb,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  lifecycle public.personnel_employment_lifecycles;
  employee public.employee_records;
  baseline_state public.personnel_employment_state;
  target_state public.personnel_employment_state;
  result_id uuid;
  new_version bigint;
  has_stranded_responsibility boolean;
  withdrawn public.personnel_employment_lifecycles;
  restored_entry date;
  restored_exit date;
  today constant date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
begin
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  if not app_private.p1_24_is_admin(p_organization_id, p_actor_id) then raise exception 'forbidden'; end if;
  if p_effective_on is null or nullif(btrim(p_reason), '') is null
     or jsonb_typeof(coalesce(p_unresolved_work, '[]'::jsonb)) <> 'array'
  then raise exception 'invalid_transition'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-24-employment:' || p_employee_record_id::text, 0
  ));
  -- A duplicate that waited for the lock answers with what the first one recorded.
  result_id := app_private.p1_24_assert_replay(p_organization_id, p_operation_id, p_request_hash);
  if result_id is not null then return result_id; end if;
  select * into employee from public.employee_records
  where id = p_employee_record_id and organization_id = p_organization_id;
  if employee.id is null then raise exception 'employee_record_not_found'; end if;
  select * into lifecycle from public.personnel_employment_lifecycles
  where employee_record_id = p_employee_record_id for update;

  if lifecycle.id is not null and lifecycle.scheduled_for is not null
     and lifecycle.scheduled_for <= today then
    update public.personnel_employment_lifecycles set
      state = scheduled_state,
      state_effective_on = scheduled_for,
      scheduled_state = null,
      scheduled_for = null,
      replaced_entry_date = null,
      replaced_exit_date = null
    where id = lifecycle.id returning * into lifecycle;
  end if;
  if lifecycle.id is null then
    if coalesce(p_expected_version, 0) <> 0 then raise exception 'stale_version'; end if;
    baseline_state := case
      when employee.entry_date is not null and employee.entry_date > today then 'planned'
      when employee.exit_date is not null and employee.exit_date <= today then 'exited'
      else 'active'
    end;
  else
    if p_expected_version is distinct from lifecycle.version then raise exception 'stale_version'; end if;
    baseline_state := lifecycle.state;
  end if;

  target_state := case p_transition_kind
    when 'plan_start' then 'active'::public.personnel_employment_state
    when 'start' then 'active'::public.personnel_employment_state
    when 'record_notice' then 'notice'::public.personnel_employment_state
    when 'plan_exit' then 'exited'::public.personnel_employment_state
    when 'mark_inactive' then 'inactive'::public.personnel_employment_state
    when 'exit' then 'exited'::public.personnel_employment_state
    when 'reverse' then 'active'::public.personnel_employment_state
    when 'reactivate' then 'active'::public.personnel_employment_state
    when 'cancel_scheduled' then baseline_state
  end;
  if p_transition_kind = 'cancel_scheduled'
     and (lifecycle.id is null or lifecycle.scheduled_state is null)
  then raise exception 'no_scheduled_transition'; end if;
  if p_transition_kind in ('plan_start', 'plan_exit')
     and p_effective_on <= today
  then raise exception 'future_effective_date_required'; end if;
  if p_transition_kind in ('start', 'mark_inactive', 'exit', 'reactivate')
     and p_effective_on > today
  then raise exception 'immediate_effective_date_required'; end if;

  -- Withdrawing a planned return restores an exit date, which ends the person's holding too.
  if target_state in ('inactive', 'exited')
     or (p_transition_kind = 'cancel_scheduled' and lifecycle.scheduled_state = 'active'
         and lifecycle.replaced_exit_date is not null)
  then
    if employee.user_id is not null and exists (
      select 1 from public.organizations organization
      where organization.id = p_organization_id and organization.admin_id = employee.user_id
    ) then raise exception 'organization_owner_protected'; end if;
    perform pg_advisory_xact_lock(
      hashtextextended(p_organization_id::text || ':responsibility-holders', 0)
    );
    select exists (
      with latest as (
        select distinct on (configuration.responsibility)
          configuration.id, configuration.mode
        from public.organization_responsibility_configurations configuration
        where configuration.organization_id = p_organization_id
          and configuration.effective_from <= clock_timestamp()
        order by configuration.responsibility, configuration.effective_from desc,
          configuration.created_at desc, configuration.id desc
      )
      select 1
      from latest
      join public.organization_responsibility_assignments assignment
        on assignment.configuration_id = latest.id
      where latest.mode = 'selected'
        and assignment.employee_record_id = p_employee_record_id
        and not exists (
          select 1
          from public.organization_responsibility_assignments other_assignment
          join public.employee_records other_record
            on other_record.id = other_assignment.employee_record_id
          join public.organization_members other_member
            on other_member.organization_id = other_record.organization_id
           and other_member.user_id = other_record.user_id
          where other_assignment.configuration_id = latest.id
            and other_assignment.employee_record_id <> p_employee_record_id
            and other_record.exit_date is null
        )
    ) into has_stranded_responsibility;
    if has_stranded_responsibility then raise exception 'last_responsibility_holder'; end if;
  end if;

  -- The dates are snapshotted and written under the record's row lock, taken
  -- after the organization lock, so an edit of the record cannot fall between.
  select * into employee from public.employee_records
  where id = p_employee_record_id for update;

  if lifecycle.id is null then
    insert into public.personnel_employment_lifecycles(
      organization_id, employee_record_id, state, state_effective_on,
      scheduled_state, scheduled_for, replaced_entry_date, replaced_exit_date,
      version, created_by, updated_by
    ) values (
      p_organization_id, p_employee_record_id,
      case
        when p_transition_kind = 'plan_start' then 'planned'
        when p_transition_kind = 'plan_exit' then 'notice'
        else target_state
      end,
      case when p_transition_kind in ('plan_start', 'plan_exit') then
        today else p_effective_on end,
      case when p_transition_kind in ('plan_start', 'plan_exit') then target_state end,
      case when p_transition_kind in ('plan_start', 'plan_exit') then p_effective_on end,
      case when p_transition_kind = 'plan_start' then employee.entry_date end,
      case when p_transition_kind in ('plan_start', 'plan_exit') then employee.exit_date end,
      1, p_actor_id, p_actor_id
    ) returning * into lifecycle;
    new_version := 1;
  else
    withdrawn := lifecycle;
    new_version := lifecycle.version + 1;
    update public.personnel_employment_lifecycles set
      state = case
        when p_transition_kind = 'cancel_scheduled' then state
        when p_transition_kind = 'plan_start' then 'planned'
        when p_transition_kind = 'plan_exit' then 'notice'
        else target_state
      end,
      state_effective_on = case
        when p_transition_kind in ('plan_start', 'plan_exit', 'cancel_scheduled') then state_effective_on
        else p_effective_on
      end,
      scheduled_state = case when p_transition_kind in ('plan_start', 'plan_exit') then target_state end,
      scheduled_for = case when p_transition_kind in ('plan_start', 'plan_exit') then p_effective_on end,
      -- A second plan of the same step keeps the dates from before the first,
      -- unless the office changed the date on the record in between.
      replaced_entry_date = case when p_transition_kind = 'plan_start' then
        case when scheduled_state = 'active' and employee.entry_date is not distinct from scheduled_for
          then replaced_entry_date else employee.entry_date end end,
      replaced_exit_date = case
        when p_transition_kind = 'plan_exit' then
          case when scheduled_state = 'exited' and employee.exit_date is not distinct from scheduled_for
            then replaced_exit_date else employee.exit_date end
        when p_transition_kind = 'plan_start' then
          case when scheduled_state = 'active' and employee.exit_date is null
            then replaced_exit_date else employee.exit_date end
      end,
      version = new_version,
      updated_by = p_actor_id
    where id = lifecycle.id returning * into lifecycle;
  end if;

  if p_transition_kind in ('plan_start', 'start') then
    update public.employee_records set entry_date = p_effective_on, exit_date = null
    where id = p_employee_record_id;
  elsif p_transition_kind in ('plan_exit', 'exit') then
    update public.employee_records set exit_date = p_effective_on
    where id = p_employee_record_id;
  elsif p_transition_kind in ('reverse', 'reactivate') then
    update public.employee_records set exit_date = null where id = p_employee_record_id;
  elsif p_transition_kind = 'cancel_scheduled' then
    -- Each date returns only while it still holds what the plan wrote; one the
    -- office changed since stays.
    restored_entry := employee.entry_date;
    restored_exit := employee.exit_date;
    if withdrawn.scheduled_state = 'active'
       and employee.entry_date is not distinct from withdrawn.scheduled_for then
      restored_entry := withdrawn.replaced_entry_date;
    end if;
    if (withdrawn.scheduled_state = 'exited'
        and employee.exit_date is not distinct from withdrawn.scheduled_for)
       or (withdrawn.scheduled_state = 'active' and employee.exit_date is null) then
      restored_exit := withdrawn.replaced_exit_date;
    end if;
    -- An earlier exit that an edited entry date has overtaken does not return:
    -- a withdrawn exit leaves none, a withdrawn start keeps the record as it is.
    if restored_exit < restored_entry then
      if withdrawn.scheduled_state = 'exited' then
        restored_exit := null;
      else
        restored_entry := employee.entry_date;
        restored_exit := employee.exit_date;
      end if;
    end if;
    update public.employee_records set entry_date = restored_entry, exit_date = restored_exit
    where id = p_employee_record_id;
  end if;

  insert into public.personnel_employment_transitions(
    organization_id, employment_lifecycle_id, employee_record_id, transition_kind,
    from_state, to_state, effective_on, reason, lifecycle_version,
    operation_id, request_hash, unresolved_work, actor_id
  ) values (
    p_organization_id, lifecycle.id, p_employee_record_id, p_transition_kind,
    baseline_state, target_state, p_effective_on, btrim(p_reason), new_version,
    p_operation_id, p_request_hash, coalesce(p_unresolved_work, '[]'::jsonb), p_actor_id
  );
  insert into public.employee_record_events(
    organization_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_employee_record_id, 'employment_transition',
    jsonb_build_object(
      'transitionKind', p_transition_kind, 'fromState', baseline_state,
      'toState', target_state, 'effectiveOn', p_effective_on,
      'lifecycleVersion', new_version, 'reason', btrim(p_reason),
      'unresolvedWork', coalesce(p_unresolved_work, '[]'::jsonb)
    ), p_actor_id
  );
  perform app_private.p1_24_record_operation(
    p_organization_id, p_operation_id, p_request_hash,
    'employment_transition', lifecycle.id, p_actor_id
  );
  return lifecycle.id;
end;
$$;
