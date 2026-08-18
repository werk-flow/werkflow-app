create index if not exists document_audit_events_folder_idx
  on public.document_audit_events (folder_id)
  where folder_id is not null;

drop policy if exists "Managers can view document audit events" on public.document_audit_events;
drop policy if exists "Assigned employees can view accessible document audit events" on public.document_audit_events;

create policy "Users can view relevant document audit events"
  on public.document_audit_events
  for select
  to authenticated
  using (
    app_private.is_document_manager(organization_id, (select auth.uid()))
    or (
      document_id is not null
      and app_private.can_access_document(document_id, (select auth.uid()))
    )
  );