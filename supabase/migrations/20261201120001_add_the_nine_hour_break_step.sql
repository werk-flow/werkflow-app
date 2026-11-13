-- The automatic break gets a second step: beyond a second threshold, a longer
-- total break (by default beyond nine hours, 45 minutes in total, ArbZG § 4).
-- Both columns are set together or both are empty; empty means the step is
-- off. Existing organizations keep it off, so none of their numbers change
-- until an admin switches it on; the switch is a new version in
-- break_policy_history, and every earlier day keeps the version it ran under.
-- A new organization starts with the step on.
--
-- Both save versions end an open break only after locking the person's
-- employee record, the row a clock transition locks, and only while the
-- break's start is still the person's latest entry: a transition that ended
-- it between the action's read and the call leaves nothing to end. The job a
-- break resumes is read from the entry before it under a share lock, not
-- taken from the caller, so a concurrent entry edit cannot leave it stale.
--
-- The ten-argument save checks the step: after the first threshold, at least
-- the first step's break, and its extra minutes between the two thresholds.
-- It is no table constraint, so it never refuses a save of the previous
-- release.
--
-- Expand-only: the eight-argument update_time_tracking_settings stays for the
-- previous release, which neither reads nor writes the new columns. The
-- ten-argument version below writes them and includes them in the snapshot
-- it re-checks under lock.
alter table public.organization_settings
  add column auto_break_second_threshold_minutes integer,
  add column auto_break_second_duration_minutes integer;

-- Saving the break rule, second step included: the same refusals, locks and
-- break ends as the eight-argument version (20261004154000).
create function public.update_time_tracking_settings(
  p_actor_id uuid,
  p_organization_id uuid,
  p_expected_settings jsonb,
  p_break_mode text,
  p_auto_break_threshold_minutes integer,
  p_auto_break_duration_minutes integer,
  p_auto_break_second_threshold_minutes integer,
  p_auto_break_second_duration_minutes integer,
  p_break_policy_history jsonb,
  p_break_ends jsonb
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_admin_id uuid;
  v_stored jsonb;
  v_inserted integer;
  v_break_end_count integer;
begin
  if p_break_mode is null or p_break_mode not in ('manual', 'automatic')
    or p_auto_break_threshold_minutes is null or p_auto_break_duration_minutes is null
    or p_break_policy_history is null or jsonb_typeof(p_break_policy_history) <> 'array'
    or p_break_ends is null or jsonb_typeof(p_break_ends) <> 'array'
    or (p_auto_break_second_threshold_minutes is null) <> (p_auto_break_second_duration_minutes is null)
    or p_auto_break_second_threshold_minutes <= p_auto_break_threshold_minutes
    or p_auto_break_second_threshold_minutes > 1440
    or p_auto_break_second_duration_minutes < p_auto_break_duration_minutes
    or p_auto_break_second_duration_minutes - p_auto_break_duration_minutes
      > p_auto_break_second_threshold_minutes - p_auto_break_threshold_minutes
  then
    raise exception 'invalid_input';
  end if;
  v_break_end_count := jsonb_array_length(p_break_ends);
  if exists (
    select 1 from jsonb_array_elements(p_break_ends) break_end
    where jsonb_typeof(break_end) <> 'object' or break_end ->> 'user_id' is null
  ) or v_break_end_count <> (
    select count(distinct (break_end ->> 'user_id')::uuid) from jsonb_array_elements(p_break_ends) break_end
  ) then
    raise exception 'invalid_input';
  end if;

  -- A share lock holds the admin until commit: an ownership transfer waits.
  select organization.admin_id into v_admin_id
  from public.organizations organization
  where organization.id = p_organization_id
  for share;
  if not found then
    raise exception 'org_not_found';
  end if;
  if v_admin_id is distinct from p_actor_id then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
    'break_mode', settings.break_mode,
    'auto_break_threshold_minutes', settings.auto_break_threshold_minutes,
    'auto_break_duration_minutes', settings.auto_break_duration_minutes,
    'auto_break_second_threshold_minutes', settings.auto_break_second_threshold_minutes,
    'auto_break_second_duration_minutes', settings.auto_break_second_duration_minutes,
    'break_policy_history', settings.break_policy_history
  ) into v_stored
  from public.organization_settings settings
  where settings.organization_id = p_organization_id
  for update;

  if found then
    if p_expected_settings is null or v_stored is distinct from p_expected_settings then
      raise exception 'settings_changed';
    end if;
    update public.organization_settings settings
    set break_mode = p_break_mode::public.time_tracking_break_mode,
      auto_break_threshold_minutes = p_auto_break_threshold_minutes,
      auto_break_duration_minutes = p_auto_break_duration_minutes,
      auto_break_second_threshold_minutes = p_auto_break_second_threshold_minutes,
      auto_break_second_duration_minutes = p_auto_break_second_duration_minutes,
      break_policy_history = p_break_policy_history,
      updated_at = now()
    where settings.organization_id = p_organization_id;
  else
    if p_expected_settings is not null then
      raise exception 'settings_changed';
    end if;
    -- A concurrent first save inserts the row too: the later one waits for it
    -- and refuses instead of overwriting the history the first one wrote.
    insert into public.organization_settings (
      organization_id, break_mode, auto_break_threshold_minutes, auto_break_duration_minutes,
      auto_break_second_threshold_minutes, auto_break_second_duration_minutes, break_policy_history
    ) values (
      p_organization_id, p_break_mode::public.time_tracking_break_mode, p_auto_break_threshold_minutes,
      p_auto_break_duration_minutes, p_auto_break_second_threshold_minutes,
      p_auto_break_second_duration_minutes, p_break_policy_history
    )
    on conflict (organization_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      raise exception 'settings_changed';
    end if;
  end if;

  if v_break_end_count = 0 then
    return;
  end if;

  -- A share lock holds every named membership until commit: a removal waits
  -- for this call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id in (
      select (break_end ->> 'user_id')::uuid from jsonb_array_elements(p_break_ends) break_end
    )
  order by member.user_id
  for share;
  if exists (
    select 1 from jsonb_array_elements(p_break_ends) break_end
    where not exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = (break_end ->> 'user_id')::uuid
    )
  ) then
    raise exception 'target_not_found';
  end if;

  -- Each person's clock timeline is locked as a clock transition locks it
  -- (their employee record, for update), and a break is ended only while its
  -- start is still the person's latest entry: a transition that ended the
  -- break between the action's read and this call leaves nothing to end. A
  -- caller that names the break's start entry (the ten-argument save) has it
  -- matched; the previous release names none.
  perform 1 from public.employee_records employee
  where employee.organization_id = p_organization_id
    and employee.user_id in (
      select (break_end ->> 'user_id')::uuid from jsonb_array_elements(p_break_ends) break_end
    )
  order by employee.id
  for update;

  -- Entries are ordered as the app orders them (compareTimeEntries in
  -- lib/time-tracking/entry-order.ts): at one timestamp a break end, then a
  -- clock-out, a clock-in, a break start.
  -- The break resumes the job of the entry right before its start (a clock-in
  -- or an earlier break end; none after any other entry), read here under a
  -- share lock: an entry edit holds that row for update, so a job changed
  -- after the action's read is the job that resumes.
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
  select (break_end ->> 'user_id')::uuid, p_organization_id, 'break_end', now(), false, 'approved',
    case when resume.entry_type in ('clock_in', 'break_end') then resume.job_id end
  from jsonb_array_elements(p_break_ends) break_end
  cross join lateral (
    select entry.id, entry.entry_type, entry.timestamp, entry.created_at,
      (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end) as boundary
    from public.time_entries entry
    where entry.user_id = (break_end ->> 'user_id')::uuid
      and entry.organization_id = p_organization_id
      and entry.status not in ('rejected', 'pending_delete')
    order by entry.timestamp desc, (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end) desc, entry.created_at desc, entry.id desc
    limit 1
  ) latest
  left join lateral (
    select entry.entry_type, entry.job_id
    from public.time_entries entry
    where entry.user_id = (break_end ->> 'user_id')::uuid
      and entry.organization_id = p_organization_id
      and entry.status not in ('rejected', 'pending_delete')
      and (entry.timestamp, (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end), entry.created_at, entry.id)
        < (latest.timestamp, latest.boundary, latest.created_at, latest.id)
    order by entry.timestamp desc, (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end) desc, entry.created_at desc, entry.id desc
    limit 1
    for share
  ) resume on true
  where latest.entry_type = 'break_start'
    and (break_end ->> 'break_start_id' is null or latest.id = (break_end ->> 'break_start_id')::uuid);
end;
$$;

revoke all on function public.update_time_tracking_settings(uuid, uuid, jsonb, text, integer, integer, integer, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_time_tracking_settings(uuid, uuid, jsonb, text, integer, integer, integer, integer, jsonb, jsonb)
  to service_role;

-- A new organization starts with the nine-hour step on.
create or replace function public.create_organization_with_defaults(
  p_admin_id uuid,
  p_name text,
  p_unique_code text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_organization_id uuid;
  v_created_at timestamptz;
  v_constraint text;
begin
  begin
    insert into public.organizations (name, admin_id, unique_code)
    values (p_name, p_admin_id, p_unique_code)
    returning id, created_at into v_organization_id, v_created_at;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'organizations_admin_id_normalized_name_key' then
      raise exception 'name_taken';
    end if;
    raise;
  end;

  -- The default break policy and its first history entry, with the nine-hour
  -- step on. effectiveFrom uses the ISO form with Z that the history parser in
  -- lib/time-tracking/settings.ts accepts.
  insert into public.organization_settings (
    organization_id, break_mode, auto_break_threshold_minutes, auto_break_duration_minutes,
    auto_break_second_threshold_minutes, auto_break_second_duration_minutes, break_policy_history
  ) values (
    v_organization_id, 'manual', 360, 30, 540, 45,
    jsonb_build_array(jsonb_build_object(
      'breakMode', 'manual',
      'autoBreakThresholdMinutes', 360,
      'autoBreakDurationMinutes', 30,
      'secondStep', jsonb_build_object('thresholdMinutes', 540, 'durationMinutes', 45),
      'effectiveFrom', to_char(v_created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ))
  );

  if not exists (
    select 1 from public.organization_members membership
    where membership.organization_id = v_organization_id
      and membership.user_id = p_admin_id
      and membership.role = 'admin'
  ) then
    raise exception 'member_creation_failed';
  end if;

  return v_organization_id;
end;
$$;

revoke all on function public.create_organization_with_defaults(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_organization_with_defaults(uuid, text, text) to service_role;

-- The previous release saves through the eight-argument version and knows
-- no second step: its history parser drops `secondStep` from every version it
-- sends back. After a rollback, such a save would take the step from the days
-- that ran under it. This version restores each sent version's step from its
-- stored version, keeps the step on (in the columns and in the version it
-- adds) while it still fits the first step, and turns it off otherwise.
create or replace function public.update_time_tracking_settings(
  p_actor_id uuid,
  p_organization_id uuid,
  p_expected_settings jsonb,
  p_break_mode text,
  p_auto_break_threshold_minutes integer,
  p_auto_break_duration_minutes integer,
  p_break_policy_history jsonb,
  p_break_ends jsonb
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_admin_id uuid;
  v_stored jsonb;
  v_stored_history jsonb;
  v_second_threshold integer;
  v_second_duration integer;
  v_keep_step boolean;
  v_history jsonb;
  v_inserted integer;
  v_break_end_count integer;
begin
  if p_break_mode is null or p_break_mode not in ('manual', 'automatic')
    or p_auto_break_threshold_minutes is null or p_auto_break_duration_minutes is null
    or p_break_policy_history is null or jsonb_typeof(p_break_policy_history) <> 'array'
    or p_break_ends is null or jsonb_typeof(p_break_ends) <> 'array'
  then
    raise exception 'invalid_input';
  end if;
  v_break_end_count := jsonb_array_length(p_break_ends);
  if exists (
    select 1 from jsonb_array_elements(p_break_ends) break_end
    where jsonb_typeof(break_end) <> 'object' or break_end ->> 'user_id' is null
  ) or v_break_end_count <> (
    select count(distinct (break_end ->> 'user_id')::uuid) from jsonb_array_elements(p_break_ends) break_end
  ) then
    raise exception 'invalid_input';
  end if;

  -- A share lock holds the admin until commit: an ownership transfer waits.
  select organization.admin_id into v_admin_id
  from public.organizations organization
  where organization.id = p_organization_id
  for share;
  if not found then
    raise exception 'org_not_found';
  end if;
  if v_admin_id is distinct from p_actor_id then
    raise exception 'not_authorized';
  end if;

  select jsonb_build_object(
    'break_mode', settings.break_mode,
    'auto_break_threshold_minutes', settings.auto_break_threshold_minutes,
    'auto_break_duration_minutes', settings.auto_break_duration_minutes,
    'break_policy_history', settings.break_policy_history
  ), settings.break_policy_history, settings.auto_break_second_threshold_minutes,
    settings.auto_break_second_duration_minutes
  into v_stored, v_stored_history, v_second_threshold, v_second_duration
  from public.organization_settings settings
  where settings.organization_id = p_organization_id
  for update;

  if found then
    if p_expected_settings is null or v_stored is distinct from p_expected_settings then
      raise exception 'settings_changed';
    end if;
    -- The step stays on when it still fits after the first step this save sets.
    v_keep_step := v_second_threshold is not null
      and v_second_threshold > p_auto_break_threshold_minutes
      and v_second_duration >= p_auto_break_duration_minutes
      and v_second_duration - p_auto_break_duration_minutes
        <= v_second_threshold - p_auto_break_threshold_minutes;
    -- The caller's parser drops secondStep: a version it sends back gets the
    -- step of its stored version, a version it adds gets the step that stays on.
    select coalesce(jsonb_agg(
      case
        when version.entry ? 'secondStep' then version.entry
        when stored.entry is not null then
          case when stored.entry ? 'secondStep'
            then version.entry || jsonb_build_object('secondStep', stored.entry -> 'secondStep')
            else version.entry
          end
        when v_keep_step then version.entry || jsonb_build_object('secondStep', jsonb_build_object(
          'thresholdMinutes', v_second_threshold, 'durationMinutes', v_second_duration))
        else version.entry
      end order by version.position), '[]'::jsonb)
    into v_history
    from jsonb_array_elements(p_break_policy_history) with ordinality as version(entry, position)
    left join lateral (
      select stored_version as entry
      from jsonb_array_elements(v_stored_history) stored_version
      where (stored_version ->> 'effectiveFrom')::timestamptz = (version.entry ->> 'effectiveFrom')::timestamptz
      limit 1
    ) stored on true;
    update public.organization_settings settings
    set break_mode = p_break_mode::public.time_tracking_break_mode,
      auto_break_threshold_minutes = p_auto_break_threshold_minutes,
      auto_break_duration_minutes = p_auto_break_duration_minutes,
      break_policy_history = v_history,
      auto_break_second_threshold_minutes = case when v_keep_step then v_second_threshold end,
      auto_break_second_duration_minutes = case when v_keep_step then v_second_duration end,
      updated_at = now()
    where settings.organization_id = p_organization_id;
  else
    if p_expected_settings is not null then
      raise exception 'settings_changed';
    end if;
    -- A concurrent first save inserts the row too: the later one waits for it
    -- and refuses instead of overwriting the history the first one wrote.
    insert into public.organization_settings (
      organization_id, break_mode, auto_break_threshold_minutes, auto_break_duration_minutes,
      break_policy_history
    ) values (
      p_organization_id, p_break_mode::public.time_tracking_break_mode, p_auto_break_threshold_minutes,
      p_auto_break_duration_minutes, p_break_policy_history
    )
    on conflict (organization_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      raise exception 'settings_changed';
    end if;
  end if;

  if v_break_end_count = 0 then
    return;
  end if;

  -- A share lock holds every named membership until commit: a removal waits
  -- for this call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id in (
      select (break_end ->> 'user_id')::uuid from jsonb_array_elements(p_break_ends) break_end
    )
  order by member.user_id
  for share;
  if exists (
    select 1 from jsonb_array_elements(p_break_ends) break_end
    where not exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = (break_end ->> 'user_id')::uuid
    )
  ) then
    raise exception 'target_not_found';
  end if;

  -- Each person's clock timeline is locked as a clock transition locks it
  -- (their employee record, for update), and a break is ended only while its
  -- start is still the person's latest entry: a transition that ended the
  -- break between the action's read and this call leaves nothing to end. A
  -- caller that names the break's start entry (the ten-argument save) has it
  -- matched; the previous release names none.
  perform 1 from public.employee_records employee
  where employee.organization_id = p_organization_id
    and employee.user_id in (
      select (break_end ->> 'user_id')::uuid from jsonb_array_elements(p_break_ends) break_end
    )
  order by employee.id
  for update;

  -- Entries are ordered as the app orders them (compareTimeEntries in
  -- lib/time-tracking/entry-order.ts): at one timestamp a break end, then a
  -- clock-out, a clock-in, a break start.
  -- The break resumes the job of the entry right before its start (a clock-in
  -- or an earlier break end; none after any other entry), read here under a
  -- share lock: an entry edit holds that row for update, so a job changed
  -- after the action's read is the job that resumes.
  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
  select (break_end ->> 'user_id')::uuid, p_organization_id, 'break_end', now(), false, 'approved',
    case when resume.entry_type in ('clock_in', 'break_end') then resume.job_id end
  from jsonb_array_elements(p_break_ends) break_end
  cross join lateral (
    select entry.id, entry.entry_type, entry.timestamp, entry.created_at,
      (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end) as boundary
    from public.time_entries entry
    where entry.user_id = (break_end ->> 'user_id')::uuid
      and entry.organization_id = p_organization_id
      and entry.status not in ('rejected', 'pending_delete')
    order by entry.timestamp desc, (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end) desc, entry.created_at desc, entry.id desc
    limit 1
  ) latest
  left join lateral (
    select entry.entry_type, entry.job_id
    from public.time_entries entry
    where entry.user_id = (break_end ->> 'user_id')::uuid
      and entry.organization_id = p_organization_id
      and entry.status not in ('rejected', 'pending_delete')
      and (entry.timestamp, (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end), entry.created_at, entry.id)
        < (latest.timestamp, latest.boundary, latest.created_at, latest.id)
    order by entry.timestamp desc, (case entry.entry_type when 'break_end' then 0 when 'clock_out' then 1 when 'clock_in' then 2 else 3 end) desc, entry.created_at desc, entry.id desc
    limit 1
    for share
  ) resume on true
  where latest.entry_type = 'break_start'
    and (break_end ->> 'break_start_id' is null or latest.id = (break_end ->> 'break_start_id')::uuid);
end;
$$;
