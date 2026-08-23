create index work_execution_events_created_by_idx
  on public.work_execution_events (created_by);

create index work_blockers_created_by_idx
  on public.work_blockers (created_by);
create index work_blockers_updated_by_idx
  on public.work_blockers (updated_by);
create index work_blockers_resolved_by_idx
  on public.work_blockers (resolved_by);

create index work_blocker_events_created_by_idx
  on public.work_blocker_events (created_by);

create index work_dependency_events_created_by_idx
  on public.work_dependency_events (created_by);

create index job_instruction_item_events_organization_id_idx
  on public.job_instruction_item_events (organization_id);
create index job_instruction_item_events_created_by_idx
  on public.job_instruction_item_events (created_by);
