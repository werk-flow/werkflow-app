-- Saving the break rule of an organization is all or nothing. The server
-- action updateTimeTrackingSettings in lib/time-tracking/settings-actions.ts
-- ended every open break in one statement and then wrote the settings in a
-- second one, so a refused settings write left the breaks ended under the old
-- rule. Both writes are now one function call, and so one transaction.
--
-- Division of work: the action establishes identity, the active organization
-- and the admin role, reads the stored settings, derives which members are on
-- a break today (Europe/Berlin day, effective entries) and passes them with
-- the job each break resumes. The function locks the organization and the
-- settings row, re-checks the admin, refuses when the stored settings differ
-- from the snapshot the action read (a concurrent save would otherwise lose a
-- policy history entry), locks the named memberships, writes the settings and
-- ends the breaks. A refusal of any step changes nothing: the time-entry
-- triggers (closed period WFP01, a job that may no longer start work) abort
-- the whole call in the same way.
--
-- Signals stay as before: the settings row and the inserted break ends reach
-- the Realtime publication, and the action revalidates the settings tag.

-- Refusals: invalid_input, org_not_found, not_authorized, settings_changed,
-- target_not_found; a closed period raises WFP01 'period_closed', a job
-- refusal of the work-start trigger raises its own message.
create function public.update_time_tracking_settings(
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
security definer
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

  insert into public.time_entries (user_id, organization_id, entry_type, timestamp, is_manual, status, job_id)
  select (break_end ->> 'user_id')::uuid, p_organization_id, 'break_end', now(), false, 'approved',
    (break_end ->> 'job_id')::uuid
  from jsonb_array_elements(p_break_ends) break_end;
end;
$$;

revoke all on function public.update_time_tracking_settings(uuid, uuid, jsonb, text, integer, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.update_time_tracking_settings(uuid, uuid, jsonb, text, integer, integer, jsonb, jsonb)
  to service_role;
