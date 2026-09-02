-- Close review findings without changing deploy-day data. The wrappers keep
-- the original public signatures while moving raw implementations out of the
-- service-role surface.

alter function public.publish_personnel_onboarding_template(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text
) rename to publish_personnel_onboarding_template_base;

revoke all on function public.publish_personnel_onboarding_template_base(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text
) from public, anon, authenticated, service_role;

create function public.publish_personnel_onboarding_template(
  p_actor_id uuid,
  p_organization_id uuid,
  p_template_id uuid,
  p_expected_version bigint,
  p_name text,
  p_description text,
  p_items jsonb,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if p_template_id is not null and exists (
    select 1 from public.personnel_onboarding_templates template
    where template.id = p_template_id
      and template.organization_id = p_organization_id
      and template.state = 'archived'
  ) then
    raise exception 'archived_template';
  end if;
  return public.publish_personnel_onboarding_template_base(
    p_actor_id, p_organization_id, p_template_id, p_expected_version,
    p_name, p_description, p_items, p_operation_id, p_request_hash
  );
end;
$$;

revoke all on function public.publish_personnel_onboarding_template(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text
) from public, anon, authenticated;
grant execute on function public.publish_personnel_onboarding_template(
  uuid, uuid, uuid, bigint, text, text, jsonb, uuid, text
) to service_role;

alter function public.finalize_personnel_document_metadata(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, bigint,
  text, public.personnel_document_access_class,
  public.personnel_document_evidence_state, date, uuid, text
) rename to finalize_personnel_document_metadata_base;

revoke all on function public.finalize_personnel_document_metadata_base(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, bigint,
  text, public.personnel_document_access_class,
  public.personnel_document_evidence_state, date, uuid, text
) from public, anon, authenticated, service_role;

create function public.finalize_personnel_document_metadata(
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
  if p_storage_path not like
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

drop policy if exists "Users can view accessible document versions"
  on public.document_versions;
create policy "Users can view accessible document versions"
  on public.document_versions for select to authenticated
  using (
    case
      when exists (
        select 1 from public.personnel_documents protected
        where protected.document_id = public.document_versions.document_id
      )
      then app_private.can_access_personnel_document_version(
        public.document_versions.document_id,
        public.document_versions.version_number,
        (select auth.uid())
      )
      else app_private.can_access_document(
        public.document_versions.document_id, (select auth.uid())
      )
    end
  );

drop policy if exists "Users can view relevant document audit events"
  on public.document_audit_events;
create policy "Users can view relevant document audit events"
  on public.document_audit_events for select to authenticated
  using (
    case
      when public.document_audit_events.document_id is not null and exists (
        select 1 from public.personnel_documents protected
        where protected.document_id = public.document_audit_events.document_id
      ) then app_private.can_access_personnel_document_history(
        public.document_audit_events.document_id, (select auth.uid())
      )
      else app_private.is_document_manager(
        public.document_audit_events.organization_id, (select auth.uid())
      ) or (
        public.document_audit_events.document_id is not null
        and app_private.can_access_document(
          public.document_audit_events.document_id, (select auth.uid())
        )
      )
    end
  );
