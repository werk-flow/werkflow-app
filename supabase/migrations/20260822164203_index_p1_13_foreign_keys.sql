create index job_capability_requirement_origins_org_fk_idx
  on public.job_capability_requirement_origins (organization_id);

create index job_instruction_dependencies_source_fk_idx
  on public.job_instruction_item_dependencies (source_work_template_dependency_id)
  where source_work_template_dependency_id is not null;
create index job_instruction_dependencies_created_by_fk_idx
  on public.job_instruction_item_dependencies (created_by)
  where created_by is not null;
create index job_instruction_dependencies_org_fk_idx
  on public.job_instruction_item_dependencies (organization_id);

create index job_instruction_evidence_created_by_fk_idx
  on public.job_instruction_item_evidence_requirements (created_by)
  where created_by is not null;
create index job_instruction_evidence_org_fk_idx
  on public.job_instruction_item_evidence_requirements (organization_id);
create index job_instruction_evidence_updated_by_fk_idx
  on public.job_instruction_item_evidence_requirements (updated_by)
  where updated_by is not null;
create index job_instruction_evidence_source_fk_idx
  on public.job_instruction_item_evidence_requirements (source_work_template_evidence_id)
  where source_work_template_evidence_id is not null;

create index work_template_applications_applied_by_fk_idx
  on public.work_template_applications (applied_by)
  where applied_by is not null;

create index work_template_capabilities_created_by_fk_idx
  on public.work_template_capability_requirements (created_by)
  where created_by is not null;
create index work_template_capabilities_org_fk_idx
  on public.work_template_capability_requirements (organization_id);

create index work_template_events_actor_fk_idx
  on public.work_template_events (actor_id)
  where actor_id is not null;
create index work_template_events_org_fk_idx
  on public.work_template_events (organization_id);
create index work_template_events_version_fk_idx
  on public.work_template_events (template_version_id)
  where template_version_id is not null;

create index work_template_dependencies_created_by_fk_idx
  on public.work_template_item_dependencies (created_by)
  where created_by is not null;
create index work_template_dependencies_org_fk_idx
  on public.work_template_item_dependencies (organization_id);

create index work_template_evidence_created_by_fk_idx
  on public.work_template_item_evidence_requirements (created_by)
  where created_by is not null;
create index work_template_evidence_org_fk_idx
  on public.work_template_item_evidence_requirements (organization_id);

create index work_template_items_created_by_fk_idx
  on public.work_template_items (created_by)
  where created_by is not null;
create index work_template_items_org_fk_idx
  on public.work_template_items (organization_id);

create index work_template_material_created_by_fk_idx
  on public.work_template_material_lines (created_by)
  where created_by is not null;
create index work_template_material_org_fk_idx
  on public.work_template_material_lines (organization_id);

create index work_template_versions_created_by_fk_idx
  on public.work_template_versions (created_by)
  where created_by is not null;
create index work_template_versions_published_by_fk_idx
  on public.work_template_versions (published_by)
  where published_by is not null;

create index work_templates_archived_by_fk_idx
  on public.work_templates (archived_by)
  where archived_by is not null;
create index work_templates_created_by_fk_idx
  on public.work_templates (created_by)
  where created_by is not null;
create index work_templates_published_version_fk_idx
  on public.work_templates (current_published_version_id)
  where current_published_version_id is not null;
create index work_templates_draft_version_fk_idx
  on public.work_templates (draft_version_id)
  where draft_version_id is not null;
create index work_templates_updated_by_fk_idx
  on public.work_templates (updated_by)
  where updated_by is not null;
