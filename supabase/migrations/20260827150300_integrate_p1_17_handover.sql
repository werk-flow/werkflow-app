alter function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
  rename to build_work_gate_snapshot_p1_15;

create or replace function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_snapshot jsonb;
  v_package_state text := 'missing';
  v_incomplete_child_handovers integer := 0;
  v_not_assessable jsonb;
  v_missing_optional_photos integer := 0;
  v_missing_dispatch_context integer := 0;
  v_missing_time_context integer := 0;
  v_missing_material_context integer := 0;
begin
  v_snapshot := app_private.build_work_gate_snapshot_p1_15(
    p_organization_id, p_job_id, p_project_id
  );

  select package.state::text into v_package_state
  from public.work_handover_packages package
  where package.organization_id = p_organization_id
    and ((p_job_id is not null and package.job_id = p_job_id)
      or (p_project_id is not null and package.project_id = p_project_id));
  v_package_state := coalesce(v_package_state, 'missing');

  if p_project_id is not null then
    select count(*) into v_incomplete_child_handovers
    from public.jobs job
    where job.organization_id = p_organization_id
      and job.project_id = p_project_id
      and coalesce(job.execution_state,
        app_private.resolve_legacy_job_execution_state(job.status)) <> 'cancelled'
      and not exists (
        select 1
        from public.work_handover_packages child_package
        where child_package.organization_id = p_organization_id
          and child_package.job_id = job.id
          and child_package.state = 'released'
          and child_package.current_release_id is not null
      );
  end if;

  select coalesce(jsonb_agg(entry.value), '[]'::jsonb) into v_not_assessable
  from jsonb_array_elements(v_snapshot->'notAssessable') entry(value)
  where entry.value <> '"handover_package"'::jsonb;
  v_not_assessable := v_not_assessable
    || jsonb_build_array('billability', 'invoice_readiness');

  select case when exists (
    select 1
    from public.document_links link
    join public.documents document on document.id = link.document_id
    where link.organization_id = p_organization_id
      and document.organization_id = p_organization_id
      and document.deleted_at is null
      and document.mime_type like 'image/%'
      and (
        (p_job_id is not null and link.job_id = p_job_id)
        or (p_project_id is not null and (
          link.project_id = p_project_id
          or link.job_id in (
            select job.id from public.jobs job
            where job.organization_id = p_organization_id
              and job.project_id = p_project_id
          )
        ))
      )
  ) then 0 else 1 end into v_missing_optional_photos;

  select case when exists (
    select 1
    from public.planning_dispatches dispatch
    left join public.planning_occurrences occurrence on occurrence.id = dispatch.occurrence_id
    where dispatch.organization_id = p_organization_id
      and dispatch.status = 'active'
      and (
        (p_job_id is not null and coalesce(dispatch.job_id, occurrence.job_id) = p_job_id)
        or (p_project_id is not null and coalesce(dispatch.job_id, occurrence.job_id) in (
          select job.id from public.jobs job
          where job.organization_id = p_organization_id
            and job.project_id = p_project_id
        ))
      )
  ) then 0 else 1 end into v_missing_dispatch_context;

  select case when exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id
      and entry.status not in ('rejected', 'pending_delete')
      and (
        (p_job_id is not null and entry.job_id = p_job_id)
        or (p_project_id is not null and entry.job_id in (
          select job.id from public.jobs job
          where job.organization_id = p_organization_id
            and job.project_id = p_project_id
        ))
      )
  ) then 0 else 1 end into v_missing_time_context;

  select case when exists (
    select 1 from public.job_material_lines line
    where line.organization_id = p_organization_id
      and (
        (p_job_id is not null and line.job_id = p_job_id)
        or (p_project_id is not null and (
          line.project_id = p_project_id
          or line.job_id in (
            select job.id from public.jobs job
            where job.organization_id = p_organization_id
              and job.project_id = p_project_id
          )
        ))
      )
  ) then 0 else 1 end into v_missing_material_context;

  return v_snapshot
    || jsonb_build_object(
      'handoverPackageState', v_package_state,
      'incompleteChildHandovers', v_incomplete_child_handovers,
      'missingOptionalPhotos', v_missing_optional_photos,
      'missingDispatchContext', v_missing_dispatch_context,
      'missingTimeContext', v_missing_time_context,
      'missingMaterialContext', v_missing_material_context,
      'notAssessable', v_not_assessable
    );
end;
$$;

alter function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) rename to transition_work_execution_p1_15;

create or replace function app_private.transition_work_execution_for_handover(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text,
  p_override_gates boolean,
  p_origin text
)
returns table (
  execution_state public.work_execution_state,
  execution_version bigint,
  event_id uuid,
  gate_snapshot jsonb,
  gate_fingerprint text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
  v_from_state public.work_execution_state;
  v_snapshot jsonb;
  v_fingerprint text;
  v_event_id uuid;
  v_event_type text;
  v_next_version bigint;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_legacy_status text;
  v_package_is_released boolean := false;
begin
  if p_target_type not in ('job', 'project') or p_expected_version < 0
    or v_reason is null or length(v_reason) not between 3 and 1000
    or not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_transition_not_authorized'; end if;

  if p_target_type = 'job' then
    select * into v_job from public.jobs job
    where job.id = p_target_id and job.organization_id = p_organization_id for update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if v_job.execution_version <> p_expected_version
    then raise exception 'work_transition_stale_version'; end if;
    v_from_state := coalesce(v_job.execution_state,
      app_private.resolve_legacy_job_execution_state(v_job.status));
    v_legacy_status := v_job.status::text;
  else
    select * into v_project from public.projects project
    where project.id = p_target_id and project.organization_id = p_organization_id for update;
    if not found then raise exception 'work_transition_target_not_found'; end if;
    if v_project.execution_version <> p_expected_version
    then raise exception 'work_transition_stale_version'; end if;
    v_from_state := coalesce(v_project.execution_state_override,
      app_private.resolve_legacy_project_execution_state(v_project.status_override));
    v_legacy_status := coalesce(v_project.status_override::text, 'derived');
  end if;

  if not (
    (p_origin = 'p1_17_release'
      and v_from_state = 'execution_complete' and p_to_state = 'handed_over')
    or (p_origin = 'p1_17_withdrawal'
      and v_from_state = 'handed_over' and p_to_state = 'execution_complete')
    or (p_origin = 'p1_17_correction'
      and v_from_state = 'execution_complete' and p_to_state = 'in_progress')
  ) then raise exception 'work_transition_not_allowed'; end if;

  v_snapshot := app_private.build_work_gate_snapshot(
    p_organization_id,
    case when p_target_type = 'job' then p_target_id else null end,
    case when p_target_type = 'project' then p_target_id else null end
  );
  v_fingerprint := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');

  if p_origin = 'p1_17_release' then
    v_package_is_released := v_snapshot->>'handoverPackageState' = 'released';
    if not v_package_is_released then raise exception 'work_handover_release_required'; end if;
    if (v_snapshot->>'activeJobClocks')::integer > 0
    then raise exception 'work_handover_active_clock'; end if;
  elsif p_override_gates then
    raise exception 'work_handover_override_not_allowed';
  end if;

  v_next_version := p_expected_version + 1;
  perform set_config('app.work_execution_write', 'true', true);
  if p_target_type = 'job' then
    update public.jobs set
      execution_state = p_to_state,
      execution_version = v_next_version,
      status = case
        when p_to_state = 'in_progress' then 'in_bearbeitung'::public.job_status
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
        when p_to_state = 'in_progress' then 'in_bearbeitung'::public.project_status
        else 'abgeschlossen'::public.project_status
      end,
      updated_at = now()
    where id = v_project.id;
  end if;

  v_event_type := case
    when p_origin = 'p1_17_release' then 'handed_over'
    when p_origin = 'p1_17_withdrawal' then 'handover_withdrawn'
    else 'reopened' end;
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
      'gateOverride', p_override_gates,
      'gatePassed', true,
      'handoverOrigin', p_origin
    ), p_actor_id
  ) returning id into v_event_id;
  return query select p_to_state, v_next_version, v_event_id, v_snapshot, v_fingerprint;
end;
$$;

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
language plpgsql security definer set search_path = ''
as $$
declare
  v_origin text := coalesce(current_setting('app.work_transition_origin', true), '');
begin
  if v_origin in ('p1_17_release', 'p1_17_withdrawal', 'p1_17_correction') then
    perform set_config('app.work_transition_origin', '', true);
    return query select * from app_private.transition_work_execution_for_handover(
      p_organization_id, p_actor_id, p_target_type, p_target_id,
      p_expected_version, p_to_state, p_reason, p_override_gates, v_origin
    );
    return;
  end if;
  if p_to_state = 'handed_over' then raise exception 'work_handover_release_required'; end if;
  return query select * from public.transition_work_execution_p1_15(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_version, p_to_state, p_reason, p_override_gates
  );
end;
$$;

create or replace function public.get_work_handover_gate_snapshot(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_snapshot jsonb;
begin
  if p_target_type not in ('job', 'project')
    or not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;
  if not exists (
    select 1 from public.jobs job
    where p_target_type = 'job' and job.id = p_target_id
      and job.organization_id = p_organization_id
    union all
    select 1 from public.projects project
    where p_target_type = 'project' and project.id = p_target_id
      and project.organization_id = p_organization_id
  ) then raise exception 'work_handover_target_not_found'; end if;
  v_snapshot := app_private.build_work_gate_snapshot(
    p_organization_id,
    case when p_target_type = 'job' then p_target_id else null end,
    case when p_target_type = 'project' then p_target_id else null end
  );
  return jsonb_build_object(
    'snapshot', v_snapshot,
    'fingerprint', encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex')
  );
end;
$$;

create or replace function app_private.prevent_released_document_version_mutation()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if exists (
    select 1 from public.work_handover_release_items item
    where item.document_id = old.document_id
      and item.document_version_number = old.version_number
      and item.document_storage_path = old.storage_path
  ) then raise exception 'work_handover_document_version_is_released'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger document_versions_released_handover_guard
before update or delete on public.document_versions
for each row execute function app_private.prevent_released_document_version_mutation();

alter table public.attention_read_states
  drop constraint if exists attention_read_states_source_type_check;
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'vacation_request_approval', 'client_request_open', 'vacation_decision',
      'sickness_report', 'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review',
      'work_artifact_review', 'work_artifact_correction', 'work_defect_due',
      'work_handover_review'
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
      'job_parking_review', 'work_blocker_review',
      'work_artifact_review', 'work_artifact_correction', 'work_defect_due',
      'work_handover_review'
    ]::text[])
  );

create or replace function app_private.validate_attention_source_org()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = new.organization_id and member.user_id = new.user_id
  ) then raise exception 'attention state user is not a member of the organization'; end if;

  if new.source_type in ('vacation_decision', 'vacation_request_approval') then
    if not exists (select 1 from public.vacation_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source vacation request organization mismatch'; end if;
  elsif new.source_type = 'sickness_report' then
    if not exists (select 1 from public.sickness_reports report where report.id = new.source_id and report.organization_id = new.organization_id)
      then raise exception 'attention source sickness report organization mismatch'; end if;
  elsif new.source_type = 'employee_certification_expiry' then
    if not exists (select 1 from public.employee_capabilities capability where capability.id = new.source_id and capability.organization_id = new.organization_id and capability.capability_kind = 'certification')
      then raise exception 'attention source employee certification organization mismatch'; end if;
  elsif new.source_type = 'client_request_open' then
    if not exists (select 1 from public.client_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source client request organization mismatch'; end if;
  elsif new.source_type = 'client_follow_up' then
    if not exists (select 1 from public.client_follow_ups follow_up where follow_up.id = new.source_id and follow_up.organization_id = new.organization_id)
      then raise exception 'attention source client follow-up organization mismatch'; end if;
  elsif new.source_type = 'time_session_approval' then
    if not exists (select 1 from public.time_entries entry where entry.id = new.source_id and entry.organization_id = new.organization_id)
      then raise exception 'attention source time entry organization mismatch'; end if;
  elsif new.source_type = 'time_change_request_approval' then
    if not exists (select 1 from public.entry_change_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source change request organization mismatch'; end if;
  elsif new.source_type = 'dispatch_acknowledgement' then
    if not exists (select 1 from public.planning_dispatches dispatch where dispatch.id = new.source_id and dispatch.organization_id = new.organization_id)
      then raise exception 'attention source dispatch organization mismatch'; end if;
  elsif new.source_type = 'dispatch_challenge_open' then
    if not exists (select 1 from public.planning_dispatch_acknowledgements acknowledgement where acknowledgement.id = new.source_id and acknowledgement.organization_id = new.organization_id and acknowledgement.state = 'challenged')
      then raise exception 'attention source dispatch challenge organization mismatch'; end if;
  elsif new.source_type = 'job_parking_review' then
    if not exists (select 1 from public.jobs job where job.id = new.source_id and job.organization_id = new.organization_id)
      then raise exception 'attention source job organization mismatch'; end if;
  elsif new.source_type = 'work_blocker_review' then
    if not exists (select 1 from public.work_blockers blocker where blocker.id = new.source_id and blocker.organization_id = new.organization_id)
      then raise exception 'attention source work blocker organization mismatch'; end if;
  elsif new.source_type in ('work_artifact_review', 'work_artifact_correction', 'work_defect_due') then
    if not exists (select 1 from public.work_artifacts artifact where artifact.id = new.source_id and artifact.organization_id = new.organization_id)
      then raise exception 'attention source work artifact organization mismatch'; end if;
  elsif new.source_type = 'work_handover_review' then
    if not exists (select 1 from public.work_handover_packages package where package.id = new.source_id and package.organization_id = new.organization_id)
      then raise exception 'attention source work handover organization mismatch'; end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.build_work_gate_snapshot_p1_15(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.transition_work_execution_p1_15(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) from public, anon, authenticated;
revoke all on function app_private.transition_work_execution_for_handover(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) from public, anon, authenticated;
revoke all on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) from public, anon, authenticated;
revoke all on function public.get_work_handover_gate_snapshot(uuid, uuid, text, uuid)
from public, anon, authenticated;
revoke all on function app_private.prevent_released_document_version_mutation()
from public, anon, authenticated;
revoke all on function app_private.validate_attention_source_org()
from public, anon, authenticated;

grant execute on function app_private.build_work_gate_snapshot_p1_15(uuid, uuid, uuid)
to service_role;
grant execute on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
to service_role;
grant execute on function public.transition_work_execution_p1_15(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) to service_role;
grant execute on function app_private.transition_work_execution_for_handover(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) to service_role;
grant execute on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) to service_role;
grant execute on function public.get_work_handover_gate_snapshot(uuid, uuid, text, uuid)
to service_role;
grant execute on function app_private.prevent_released_document_version_mutation()
to postgres, service_role;
grant execute on function app_private.validate_attention_source_org()
to postgres, service_role;
