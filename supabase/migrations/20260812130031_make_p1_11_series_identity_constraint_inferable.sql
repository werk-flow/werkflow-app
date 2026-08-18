
drop index public.planning_occurrences_series_identity_unique;
alter table public.planning_occurrences
  add constraint planning_occurrences_series_identity_unique
  unique (organization_id, series_lineage_id, original_start_local);
