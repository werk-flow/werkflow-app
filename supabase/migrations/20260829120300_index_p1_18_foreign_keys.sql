-- P1-18 follow-up: cover every new composite foreign key in child-column order.

drop index if exists public.installed_equipment_events_equipment_idx;
create index installed_equipment_events_equipment_idx
  on public.installed_equipment_events
    (equipment_id, organization_id, effective_at desc, recorded_at desc);

drop index if exists public.installed_equipment_events_correction_fk_idx;
create index installed_equipment_events_correction_fk_idx
  on public.installed_equipment_events (corrects_event_id, organization_id)
  where corrects_event_id is not null;

create index installed_equipment_identifiers_equipment_fk_idx
  on public.installed_equipment_identifiers (equipment_id, organization_id);

drop index if exists public.installed_equipment_event_links_event_idx;
create index installed_equipment_event_links_event_idx
  on public.installed_equipment_event_links (event_id, organization_id);

drop index if exists public.installed_equipment_event_links_job_idx;
create index installed_equipment_event_links_job_idx
  on public.installed_equipment_event_links (job_id, organization_id)
  where job_id is not null;

drop index if exists public.installed_equipment_event_links_project_idx;
create index installed_equipment_event_links_project_idx
  on public.installed_equipment_event_links (project_id, organization_id)
  where project_id is not null;

drop index if exists public.installed_equipment_event_links_artifact_idx;
create index installed_equipment_event_links_artifact_idx
  on public.installed_equipment_event_links (work_artifact_revision_id, organization_id)
  where work_artifact_revision_id is not null;

drop index if exists public.installed_equipment_event_links_handover_idx;
create index installed_equipment_event_links_handover_idx
  on public.installed_equipment_event_links (work_handover_release_id, organization_id)
  where work_handover_release_id is not null;

drop index if exists public.installed_equipment_event_links_document_idx;
create index installed_equipment_event_links_document_idx
  on public.installed_equipment_event_links (document_id, organization_id)
  where document_id is not null;

create index installed_equipment_work_links_equipment_fk_idx
  on public.installed_equipment_work_links (equipment_id, organization_id);

drop index if exists public.installed_equipment_work_links_job_idx;
create index installed_equipment_work_links_job_idx
  on public.installed_equipment_work_links (job_id, organization_id)
  where job_id is not null;

drop index if exists public.installed_equipment_work_links_project_idx;
create index installed_equipment_work_links_project_idx
  on public.installed_equipment_work_links (project_id, organization_id)
  where project_id is not null;

drop index if exists public.document_links_equipment_idx;
create index document_links_equipment_idx
  on public.document_links (equipment_id, organization_id)
  where equipment_id is not null;
