-- A time entry can reference a job while the clock or another entry starts
-- work on it (werk-flow/werkflow-planning#361).
--
-- A time_entries insert, or an update that moves an entry onto a job, takes a
-- key-share lock on the job row through its foreign key check, then the
-- organization's timeline revision row (app_private.advance_time_timeline_revision).
-- A clock-in or break end on a job then locked the job FOR UPDATE
-- (app_private.transition_work_on_time_start), as did
-- public.transition_work_execution_p1_15 when the clock starts work on a job
-- that had not started. FOR UPDATE conflicts with a key share: a writer that
-- held the revision row and asked for the job waited for a second writer's key
-- share, while that writer waited for the revision row, and one of them failed
-- with `deadlock detected`. Two manual entries on one job did it, and so did a
-- clock switch onto a job that had not started against a manual entry on it.
--
-- Both now lock the job FOR NO KEY UPDATE, as
-- app_private.validate_time_segment_input does (#348). It still conflicts with
-- every other writer of the job row (a park, a finish, another transition) but
-- not with a key share, so the second writer no longer blocks the first. Each
-- function changes only non-key columns of the job (its keys are id and
-- id, organization_id), which needs no stronger lock. No other lock moves, so
-- no new lock order arises. Both functions keep their signatures, owner and
-- grants; their bodies are unchanged apart from the lock clause.

create or replace function app_private.transition_work_on_time_start()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job public.jobs%rowtype;
  v_state public.work_execution_state;
begin
  if new.job_id is null or new.entry_type not in ('clock_in', 'break_end')
    or new.status in ('rejected', 'pending_delete')
  then return new; end if;
  select * into v_job from public.jobs j
  where j.id = new.job_id and j.organization_id = new.organization_id
  for no key update;
  if not found then raise exception 'work_time_start_job_not_found'; end if;
  v_state := coalesce(
    v_job.execution_state,
    app_private.resolve_legacy_job_execution_state(v_job.status)
  );
  if v_state in ('execution_complete', 'handed_over', 'cancelled') then
    raise exception 'work_time_start_terminal';
  end if;
  if v_state in ('not_started', 'interrupted') then
    perform set_config('app.work_transition_origin', 'automatic_time_start', true);
    perform public.transition_work_execution(
      new.organization_id,
      new.user_id,
      'job',
      new.job_id,
      v_job.execution_version,
      'in_progress',
      null,
      false
    );
    perform set_config('app.work_transition_origin', '', true);
  end if;
  return new;
end;
$function$;

create or replace function public.transition_work_execution_p1_15(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text DEFAULT NULL::text,
  p_override_gates boolean DEFAULT false
)
returns table(execution_state public.work_execution_state, execution_version bigint, event_id uuid, gate_snapshot jsonb, gate_fingerprint text)
language plpgsql
security definer
set search_path = ''
as $function$
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
  if p_target_type not in ('job', 'project') or p_expected_version < 0
  then raise exception 'work_transition_invalid_input'; end if;
  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id;
  if v_role is null then raise exception 'work_transition_not_authorized'; end if;
  v_is_manager := v_role in ('admin', 'buero');

  if p_target_type = 'job' then
    select * into v_job from public.jobs job
    where job.id = p_target_id and job.organization_id = p_organization_id for no key update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if not v_is_manager and not exists (
      select 1 from public.job_assignments assignment
      where assignment.job_id = v_job.id and assignment.user_id = p_actor_id
    ) then raise exception 'work_transition_not_authorized'; end if;
    if v_job.execution_version <> p_expected_version then raise exception 'work_transition_stale_version'; end if;
    v_from_state := coalesce(v_job.execution_state, app_private.resolve_legacy_job_execution_state(v_job.status));
    v_legacy_status := v_job.status::text;
  else
    if not v_is_manager then raise exception 'work_transition_not_authorized'; end if;
    select * into v_project from public.projects project
    where project.id = p_target_id and project.organization_id = p_organization_id for update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if v_project.execution_version <> p_expected_version then raise exception 'work_transition_stale_version'; end if;
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
    or p_target_type = 'project' or p_override_gates
  ) and (v_reason is null or length(v_reason) not between 3 and 1000)
  then raise exception 'work_transition_reason_required'; end if;

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
      and (v_snapshot->>'incompleteInstructionEvidence')::integer = 0
      and (v_snapshot->>'openBlockers')::integer = 0
      and (v_snapshot->>'openCompletionDependencies')::integer = 0
      and (v_snapshot->>'activeJobClocks')::integer = 0
      and (v_snapshot->>'incompleteProjectChildren')::integer = 0;
    if p_to_state = 'handed_over' then
      v_gates_pass := v_gates_pass
        and (v_snapshot->>'requiredCustomerDecisions')::integer = 0
        and (v_snapshot->>'requiredSignatures')::integer = 0;
    end if;
    if not v_gates_pass and not (v_is_manager and p_override_gates)
    then raise exception 'work_transition_completion_blocked'; end if;
  end if;

  v_next_version := p_expected_version + 1;
  perform set_config('app.work_execution_write', 'true', true);
  if p_target_type = 'job' then
    update public.jobs set
      execution_state = p_to_state,
      execution_version = v_next_version,
      status = case
        when p_to_state = 'not_started' and exists (
          select 1 from public.work_blockers blocker
          where blocker.job_id = v_job.id and blocker.kind = 'parking' and blocker.state = 'open'
        ) then 'geparkt'::public.job_status
        when p_to_state = 'not_started' then 'nicht_bearbeitet'::public.job_status
        when p_to_state in ('in_progress', 'interrupted') then 'in_bearbeitung'::public.job_status
        else 'fertig'::public.job_status
      end,
      actual_completion_date = case
        when p_to_state in ('execution_complete', 'handed_over')
          then coalesce(actual_completion_date, (now() at time zone 'Europe/Berlin')::date)
        else null end,
      updated_at = now()
    where id = v_job.id;
  else
    update public.projects set
      execution_state_override = p_to_state,
      execution_version = v_next_version,
      execution_override_reason = v_reason,
      status_override = case
        when p_to_state = 'not_started' then 'nicht_begonnen'::public.project_status
        when p_to_state in ('in_progress', 'interrupted') then 'in_bearbeitung'::public.project_status
        when p_to_state in ('execution_complete', 'handed_over', 'cancelled')
          then 'abgeschlossen'::public.project_status end,
      updated_at = now()
    where id = v_project.id;
  end if;

  v_event_type := case
    when current_setting('app.work_transition_origin', true) = 'automatic_time_start' then 'automatic_time_start'
    when p_to_state = 'cancelled' then 'cancelled'
    when v_from_state = 'cancelled' then 'restored'
    when p_to_state = 'handed_over' then 'handed_over'
    when v_from_state = 'handed_over' then 'handover_withdrawn'
    when v_from_state = 'execution_complete' and p_to_state = 'in_progress' then 'reopened'
    when p_target_type = 'project' then 'override_set'
    else 'transitioned' end;

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
        then v_job.execution_state is null else v_project.execution_state_override is null end,
      'gateOverride', p_override_gates, 'gatePassed', v_gates_pass
    ), p_actor_id
  ) returning id into v_event_id;
  return query select p_to_state, v_next_version, v_event_id, v_snapshot, v_fingerprint;
end;
$function$;
