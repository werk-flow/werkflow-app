-- invoices and offers carry two identical unique (id, organization_id)
-- indexes: the constraint index that the composite foreign keys reference,
-- and a *_replident_idx created for Realtime. The database advisor reports
-- each pair as duplicate_index (WARN), and every write maintains both.
-- Realtime needs the unique columns, not a particular index name.

alter table public.invoices
  replica identity using index invoices_id_organization_key;

-- @destructive: after release 8a73d1d0a: identical to invoices_id_organization_key, which now carries the replica identity; no app code names this index.
drop index public.invoices_replident_idx;

alter table public.offers
  replica identity using index offers_id_organization_key;

-- @destructive: after release 8a73d1d0a: identical to offers_id_organization_key, which now carries the replica identity; no app code names this index.
drop index public.offers_replident_idx;
