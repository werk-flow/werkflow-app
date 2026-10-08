-- work_artifacts and work_handover_packages carry two identical unique
-- (id, organization_id) indexes: the constraint index that the composite
-- foreign keys reference, and a *_replident_idx created later for Realtime.
-- The database advisor reports each pair as duplicate_index (WARN), and every
-- write maintains both. Realtime needs a unique (id, organization_id) index as
-- the replica identity, not a particular name, so the identity moves onto the
-- constraint index and the copy goes (bun run advisors:check).

alter table public.work_artifacts
  replica identity using index work_artifacts_id_organization_id_key;

-- @destructive: identical to work_artifacts_id_organization_id_key, which now carries the replica identity.
drop index public.work_artifacts_replident_idx;

alter table public.work_handover_packages
  replica identity using index work_handover_packages_id_organization_id_key;

-- @destructive: identical to work_handover_packages_id_organization_id_key, which now carries the replica identity.
drop index public.work_handover_packages_replident_idx;
