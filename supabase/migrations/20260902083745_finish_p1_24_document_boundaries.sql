-- Keep ordinary document reads set-based and close protected-file boundaries.

create or replace function app_private.can_access_personnel_document_version(
  p_document_id uuid,
  p_version_number integer,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.personnel_documents protected
    join public.documents document on document.id = protected.document_id
    join public.employee_records employee on employee.id = protected.employee_record_id
    where protected.document_id = p_document_id
      and document.deleted_at is null
      and (
        app_private.p1_24_is_admin(protected.organization_id, p_user_id)
        or (
          protected.access_class = 'personnel_standard'
          and app_private.p1_24_is_manager(protected.organization_id, p_user_id)
        )
        or (
          employee.user_id = p_user_id
          and (
            app_private.p1_24_has_effective_access(protected.organization_id, p_user_id)
            or app_private.p1_24_has_prestart_access(protected.organization_id, p_user_id)
          )
          and exists (
            select 1 from public.personnel_document_releases release
            where release.personnel_document_id = protected.id
              and release.document_version_number = p_version_number
              and release.revoked_at is null
          )
        )
      )
  );
$$;

revoke all on function app_private.can_access_personnel_document_version(
  uuid, integer, uuid
) from public, anon, authenticated;
grant execute on function app_private.can_access_personnel_document_version(
  uuid, integer, uuid
) to authenticated, service_role;

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
     or p_storage_path not like
       p_organization_id::text || '/' || p_document_id::text || '/%'
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

create or replace view public.ordinary_documents
with (security_invoker = true)
as
select document.*
from public.documents document
where not exists (
  select 1 from public.personnel_documents protected
  where protected.document_id = document.id
);

revoke all on table public.ordinary_documents from public, anon, authenticated;
grant select on table public.ordinary_documents to service_role;
