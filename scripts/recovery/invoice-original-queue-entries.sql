-- Restore procedure (database), step 5 (docs/technical/recovery-and-incidents.md).
-- Lists the restored storage_purge_queue entries that may name an invoice
-- original filed after the backup: lib/invoices/original.ts queues an
-- original's key before its issue, Storno or filing commits, so a backup taken
-- in between restores the entry without the document row. Run it on the
-- restored database while the purge is paused, with the backup time:
--   psql -v backup_at="'<backup timestamp with offset>'" -f <this file>
--
-- Every entry it leaves out keeps its purge:
-- - a key a document row names: the purge releases it anyway;
-- - an organization deletion's: the organization is gone;
-- - a permanent deletion's: a `permanently_deleted` document history entry
--   names the path;
-- - an export archive, letterhead file, problem report file or document
--   version: its key has a folder of its own, so it is not
--   `{organization}/{document}/{file}`.
select q.id, q.storage_path
from public.storage_purge_queue q
where q.queued_at >= :backup_at::timestamptz - interval '1 hour'
  and q.storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/]+$'
  and exists (select from public.organizations o where o.id = q.organization_id)
  and not exists (select from public.documents d where d.storage_path = q.storage_path)
  and not exists (
    select from public.document_audit_events e
    where e.organization_id = q.organization_id
      and e.event_type = 'permanently_deleted'
      and e.event_payload -> 'storagePaths' ? q.storage_path
  )
order by q.queued_at;
