-- Cover every P1-17 foreign key with its constrained columns as the index prefix.

create index work_handover_draft_items_child_fk_idx
  on public.work_handover_draft_items (child_handover_release_id, organization_id);
create index work_handover_draft_items_created_by_idx
  on public.work_handover_draft_items (created_by);
create index work_handover_draft_items_document_fk_idx
  on public.work_handover_draft_items (document_id);
create index work_handover_draft_items_package_fk_idx
  on public.work_handover_draft_items (package_id, organization_id);
create index work_handover_draft_items_artifact_fk_idx
  on public.work_handover_draft_items (work_artifact_revision_id);

create index work_handover_events_package_fk_idx
  on public.work_handover_events (package_id, organization_id);
create index work_handover_events_previous_release_fk_idx
  on public.work_handover_events (previous_release_id, organization_id);
create index work_handover_events_release_fk_idx
  on public.work_handover_events (release_id, organization_id);

create index work_handover_packages_current_release_fk_idx
  on public.work_handover_packages (current_release_id, organization_id);
create index work_handover_packages_job_fk_idx
  on public.work_handover_packages (job_id);
create index work_handover_packages_project_fk_idx
  on public.work_handover_packages (project_id);

create index work_handover_release_items_child_fk_idx
  on public.work_handover_release_items (child_handover_release_id, organization_id);
create index work_handover_release_items_release_fk_idx
  on public.work_handover_release_items (release_id, organization_id);

create index work_handover_releases_package_fk_idx
  on public.work_handover_releases (package_id, organization_id);
create index work_handover_releases_previous_fk_idx
  on public.work_handover_releases (previous_release_id, organization_id);
