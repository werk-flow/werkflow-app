-- P1-00 baseline reconciliation: the frontend Realtime provider subscribes to
-- 27 tables but the publication only contained 17. Add the 10 missing tables
-- (all RLS-enabled, org-scoped) so document library and inventory surfaces
-- receive live updates as the code already intends.
alter publication supabase_realtime add table
  public.document_folders,
  public.documents,
  public.document_links,
  public.document_audit_events,
  public.document_versions,
  public.inventory_categories,
  public.inventory_suppliers,
  public.inventory_item_barcodes,
  public.inventory_import_batches,
  public.inventory_audit_events;