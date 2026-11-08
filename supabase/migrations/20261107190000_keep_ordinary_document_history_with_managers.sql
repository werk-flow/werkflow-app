-- The version and audit history of an ordinary document stay with Admin and
-- Büro (docs/features/document-management.md). A job assignment no longer
-- opens them through the Data API; it still opens the document itself. A
-- protected personnel document keeps its own rule.

-- @destructive: after release e713fa96: no deployed code reads these tables with a client JWT; the server reads them with the service role, and the one Realtime consumer also refreshes on documents and document_links
alter policy "Users can view accessible document versions"
  on public.document_versions
  using (
    case
      when app_private.p1_24_is_protected_document(document_id)
        then app_private.current_user_can_access_personnel_document_version(
          document_id, version_number
        )
      else app_private.is_document_manager(organization_id, (select auth.uid()))
        and app_private.can_access_document(document_id, (select auth.uid()))
    end
  );

-- @destructive: after release e713fa96: no deployed code reads these tables with a client JWT; the server reads them with the service role, and the one Realtime consumer also refreshes on documents and document_links
alter policy "Users can view relevant document audit events"
  on public.document_audit_events
  using (
    case
      when document_id is not null
        and app_private.p1_24_is_protected_document(document_id)
        then app_private.current_user_can_access_personnel_document_history(
          document_id
        )
      else app_private.is_document_manager(organization_id, (select auth.uid()))
    end
  );
