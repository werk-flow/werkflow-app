-- P1-17: authorize before idempotent replay and contain internal write flags.

create or replace function public.save_work_handover_draft(
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
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;

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

create or replace function public.release_work_handover(
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
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;

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

create or replace function public.withdraw_work_handover(
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
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;

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

create or replace function public.return_work_handover_for_correction(
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
  if not app_private.work_handover_actor_can_review(p_organization_id, p_actor_id)
  then raise exception 'work_handover_not_authorized'; end if;

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

alter function app_private.transition_work_execution_for_handover(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) rename to transition_work_execution_for_handover_p1_17_inner;

revoke all on function app_private.transition_work_execution_for_handover_p1_17_inner(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) from public, anon, authenticated, service_role;

create function app_private.transition_work_execution_for_handover(
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
begin
  return query select * from app_private.transition_work_execution_for_handover_p1_17_inner(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_version, p_to_state, p_reason, p_override_gates, p_origin
  );
  perform set_config('app.work_execution_write', '', true);
exception when others then
  perform set_config('app.work_execution_write', '', true);
  raise;
end;
$$;

revoke all on function app_private.transition_work_execution_for_handover(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) from public, anon, authenticated;
grant execute on function app_private.transition_work_execution_for_handover(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean, text
) to service_role;
