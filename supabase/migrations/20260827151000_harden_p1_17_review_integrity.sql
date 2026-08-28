-- Preserve the P1-15 action implementation behind a tenant-scoped service wrapper.
alter function public.record_work_artifact_action(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) rename to record_work_artifact_action_p1_17_inner;

revoke all on function public.record_work_artifact_action_p1_17_inner(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) from public, anon, authenticated, service_role;

create function public.record_work_artifact_action(
  p_organization_id uuid,
  p_actor_id uuid,
  p_artifact_id uuid,
  p_revision_id uuid,
  p_action_id uuid,
  p_expected_version bigint,
  p_action_type public.work_artifact_action_type,
  p_reason text,
  p_comment text,
  p_responsibility_snapshot jsonb,
  p_customer_context jsonb,
  p_signature_document_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if exists (
    select 1 from public.work_artifact_actions action
    where action.id = p_action_id
      and action.organization_id <> p_organization_id
  ) then
    raise exception 'work_artifact_action_idempotency_conflict';
  end if;
  return public.record_work_artifact_action_p1_17_inner(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id, p_action_id,
    p_expected_version, p_action_type, p_reason, p_comment,
    p_responsibility_snapshot, p_customer_context, p_signature_document_id
  );
end;
$$;

revoke all on function public.record_work_artifact_action(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.record_work_artifact_action(
  uuid, uuid, uuid, uuid, uuid, bigint, public.work_artifact_action_type,
  text, text, jsonb, jsonb, uuid
) to service_role;

-- Keep the internal write capability inside one RPC call, including caught errors.
alter function public.save_work_handover_draft(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) rename to save_work_handover_draft_p1_17_inner;
revoke all on function public.save_work_handover_draft_p1_17_inner(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) from public, anon, authenticated, service_role;

create function public.save_work_handover_draft(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_package_id uuid,
  p_expected_version bigint,
  p_request_id uuid,
  p_items jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  v_result := public.save_work_handover_draft_p1_17_inner(
    p_organization_id, p_actor_id, p_target_type, p_target_id, p_package_id,
    p_expected_version, p_request_id, p_items
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

revoke all on function public.save_work_handover_draft(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) from public, anon, authenticated;
grant execute on function public.save_work_handover_draft(
  uuid, uuid, text, uuid, uuid, bigint, uuid, jsonb
) to service_role;

alter function public.release_work_handover(
  uuid, uuid, uuid, uuid, uuid, bigint, bigint, text, text, boolean, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, text, text, bigint,
  text, text
) rename to release_work_handover_p1_17_inner;
revoke all on function public.release_work_handover_p1_17_inner(
  uuid, uuid, uuid, uuid, uuid, bigint, bigint, text, text, boolean, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, text, text, bigint,
  text, text
) from public, anon, authenticated, service_role;

create function public.release_work_handover(
  p_organization_id uuid,
  p_actor_id uuid,
  p_package_id uuid,
  p_release_id uuid,
  p_request_id uuid,
  p_expected_package_version bigint,
  p_expected_execution_version bigint,
  p_expected_gate_fingerprint text,
  p_handover_reason text,
  p_override_gates boolean,
  p_override_reason text,
  p_target_snapshot jsonb,
  p_time_summary jsonb,
  p_material_summary jsonb,
  p_responsibility_snapshot jsonb,
  p_unassessed_facts jsonb,
  p_item_payloads jsonb,
  p_document_id uuid,
  p_document_link_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint,
  p_renderer_version text,
  p_content_hash text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  v_result := public.release_work_handover_p1_17_inner(
    p_organization_id, p_actor_id, p_package_id, p_release_id, p_request_id,
    p_expected_package_version, p_expected_execution_version,
    p_expected_gate_fingerprint, p_handover_reason, p_override_gates,
    p_override_reason, p_target_snapshot, p_time_summary, p_material_summary,
    p_responsibility_snapshot, p_unassessed_facts, p_item_payloads,
    p_document_id, p_document_link_id, p_storage_path, p_file_name,
    p_size_bytes, p_renderer_version, p_content_hash
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

revoke all on function public.release_work_handover(
  uuid, uuid, uuid, uuid, uuid, bigint, bigint, text, text, boolean, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, text, text, bigint,
  text, text
) from public, anon, authenticated;
grant execute on function public.release_work_handover(
  uuid, uuid, uuid, uuid, uuid, bigint, bigint, text, text, boolean, text,
  jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid, uuid, text, text, bigint,
  text, text
) to service_role;

alter function public.withdraw_work_handover(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) rename to withdraw_work_handover_p1_17_inner;
revoke all on function public.withdraw_work_handover_p1_17_inner(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) from public, anon, authenticated, service_role;

create function public.withdraw_work_handover(
  p_organization_id uuid,
  p_actor_id uuid,
  p_package_id uuid,
  p_request_id uuid,
  p_expected_package_version bigint,
  p_expected_execution_version bigint,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  v_result := public.withdraw_work_handover_p1_17_inner(
    p_organization_id, p_actor_id, p_package_id, p_request_id,
    p_expected_package_version, p_expected_execution_version, p_reason
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

revoke all on function public.withdraw_work_handover(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.withdraw_work_handover(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) to service_role;

alter function public.return_work_handover_for_correction(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) rename to return_work_handover_for_correction_p1_17_inner;
revoke all on function public.return_work_handover_for_correction_p1_17_inner(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) from public, anon, authenticated, service_role;

create function public.return_work_handover_for_correction(
  p_organization_id uuid,
  p_actor_id uuid,
  p_package_id uuid,
  p_request_id uuid,
  p_expected_package_version bigint,
  p_expected_execution_version bigint,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  v_result := public.return_work_handover_for_correction_p1_17_inner(
    p_organization_id, p_actor_id, p_package_id, p_request_id,
    p_expected_package_version, p_expected_execution_version, p_reason
  );
  perform set_config('app.work_handover_write', '', true);
  return v_result;
exception when others then
  perform set_config('app.work_handover_write', '', true);
  raise;
end;
$$;

revoke all on function public.return_work_handover_for_correction(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.return_work_handover_for_correction(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) to service_role;

-- An accepted exception is not a passed gate; keep both facts explicit.
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
      'gatePassed', not p_override_gates,
      'handoverOrigin', p_origin
    ), p_actor_id
  ) returning id into v_event_id;
  return query select p_to_state, v_next_version, v_event_id, v_snapshot, v_fingerprint;
end;
$$;

revoke all on function app_private.transition_work_execution_for_handover(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) from public, anon, authenticated;
grant execute on function app_private.transition_work_execution_for_handover(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) to service_role;
