-- Preserve acknowledgement replay semantics and require one storage filename.

create or replace function public.acknowledge_personnel_item(
  p_actor_id uuid,
  p_organization_id uuid,
  p_acknowledgement_kind public.personnel_acknowledgement_kind,
  p_personnel_document_id uuid,
  p_document_version_number integer,
  p_requirement_id uuid,
  p_requirement_version bigint,
  p_statement text,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  requirement_state public.personnel_requirement_state;
  result_id uuid;
begin
  result_id := app_private.p1_24_assert_replay(
    p_organization_id, p_operation_id, p_request_hash
  );
  if result_id is not null then return result_id; end if;
  if p_acknowledgement_kind = 'requirement_completed' then
    select state into requirement_state
    from public.personnel_onboarding_requirements
    where id = p_requirement_id and organization_id = p_organization_id
    for update;
    if requirement_state is null then raise exception 'requirement_not_found'; end if;
    if requirement_state not in ('missing', 'pending') then
      raise exception 'requirement_not_open';
    end if;
  end if;

  result_id := public.acknowledge_personnel_item_review_base(
    p_actor_id, p_organization_id, p_acknowledgement_kind,
    p_personnel_document_id, p_document_version_number, p_requirement_id,
    p_requirement_version, p_statement, p_operation_id, p_request_hash
  );
  if p_acknowledgement_kind = 'requirement_completed' then
    update public.personnel_onboarding_requirements
    set blocker_reason = null
    where id = p_requirement_id and organization_id = p_organization_id;
  end if;
  return result_id;
end;
$$;

revoke all on function public.acknowledge_personnel_item(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.acknowledge_personnel_item(
  uuid, uuid, public.personnel_acknowledgement_kind, uuid, integer,
  uuid, bigint, text, uuid, text
) to service_role;

create or replace function public.finalize_personnel_document_metadata(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_document_id uuid,
  p_storage_bucket text,
  p_storage_path text,
  p_original_file_name text,
  p_display_name text,
  p_category text,
  p_mime_type text,
  p_size_bytes bigint,
  p_document_type text,
  p_access_class public.personnel_document_access_class,
  p_evidence_state public.personnel_document_evidence_state,
  p_valid_until date,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_storage_bucket is distinct from 'organization-documents'
     or p_storage_path is null
     or p_storage_path !~ (
       '^' || p_organization_id::text || '/' || p_document_id::text || '/[^/]+$'
     )
  then
    raise exception 'invalid_document_storage_path';
  end if;
  return public.finalize_personnel_document_metadata_base(
    p_actor_id, p_organization_id, p_employee_record_id, p_document_id,
    p_storage_bucket, p_storage_path, p_original_file_name, p_display_name,
    p_category, p_mime_type, p_size_bytes, p_document_type, p_access_class,
    p_evidence_state, p_valid_until, p_operation_id, p_request_hash
  );
end;
$$;

revoke all on function public.finalize_personnel_document_metadata(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, bigint,
  text, public.personnel_document_access_class,
  public.personnel_document_evidence_state, date, uuid, text
) from public, anon, authenticated;
grant execute on function public.finalize_personnel_document_metadata(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, bigint,
  text, public.personnel_document_access_class,
  public.personnel_document_evidence_state, date, uuid, text
) to service_role;
