create index time_segments_session_org_fk_idx
  on public.time_segments(session_id, organization_id);

drop index public.time_operations_result_session_idx;
create index time_operations_result_session_idx
  on public.time_operations(resulting_session_id, organization_id)
  where resulting_session_id is not null;

drop index public.time_operations_result_segment_idx;
create index time_operations_result_segment_idx
  on public.time_operations(resulting_segment_id, organization_id)
  where resulting_segment_id is not null;

create index time_segment_events_session_org_fk_idx
  on public.time_segment_events(session_id, organization_id)
  where session_id is not null;

create index time_segment_events_segment_org_fk_idx
  on public.time_segment_events(segment_id, organization_id)
  where segment_id is not null;

drop index public.work_artifact_revision_sources_time_segment_lookup_idx;
create index work_artifact_revision_sources_time_segment_lookup_idx
  on public.work_artifact_revision_sources(time_segment_id, organization_id)
  where time_segment_id is not null;
