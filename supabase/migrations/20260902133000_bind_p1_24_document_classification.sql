-- Keep protected-document classification independent of caller-visible rows.

create or replace function app_private.p1_24_is_protected_document(
  p_document_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.personnel_documents protected
    where protected.document_id = p_document_id
  );
$$;

revoke all on function app_private.p1_24_is_protected_document(uuid)
  from public, anon, authenticated;
grant execute on function app_private.p1_24_is_protected_document(uuid)
  to authenticated, service_role;

drop policy if exists "Users can view accessible document versions"
  on public.document_versions;
create policy "Users can view accessible document versions"
  on public.document_versions for select to authenticated
  using (
    case
      when app_private.p1_24_is_protected_document(document_id)
        then app_private.current_user_can_access_personnel_document_version(
          document_id, version_number
        )
      else app_private.can_access_document(
        document_id, (select auth.uid())
      )
    end
  );

drop policy if exists "Users can view relevant document audit events"
  on public.document_audit_events;
create policy "Users can view relevant document audit events"
  on public.document_audit_events for select to authenticated
  using (
    case
      when document_id is not null
        and app_private.p1_24_is_protected_document(document_id)
        then app_private.current_user_can_access_personnel_document_history(
          document_id
        )
      else app_private.is_document_manager(
        organization_id, (select auth.uid())
      ) or (
        document_id is not null
        and app_private.can_access_document(
          document_id, (select auth.uid())
        )
      )
    end
  );

create or replace view public.ordinary_documents
with (security_invoker = true)
as
select document.*
from public.documents document
where not app_private.p1_24_is_protected_document(document.id);

revoke all on table public.ordinary_documents from public, anon, authenticated;
grant select on table public.ordinary_documents to service_role;
