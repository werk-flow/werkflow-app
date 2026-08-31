create index maintenance_coverages_created_by_fk_idx on public.maintenance_coverages (created_by);
create index maintenance_coverages_updated_by_fk_idx on public.maintenance_coverages (updated_by);
create index maintenance_coverage_events_actor_fk_idx on public.maintenance_coverage_events (actor_id);
create index maintenance_coverage_events_org_fk_idx on public.maintenance_coverage_events (organization_id);

create index maintenance_plans_coverage_fk_idx
  on public.maintenance_plans (maintenance_coverage_id, organization_id)
  where maintenance_coverage_id is not null;
create index maintenance_plans_current_revision_fk_idx
  on public.maintenance_plans (current_revision_id, organization_id)
  where current_revision_id is not null;
create index maintenance_plans_archived_by_fk_idx
  on public.maintenance_plans (archived_by) where archived_by is not null;
create index maintenance_plans_created_by_fk_idx on public.maintenance_plans (created_by);
create index maintenance_plans_updated_by_fk_idx on public.maintenance_plans (updated_by);

create index maintenance_plan_revisions_template_fk_idx
  on public.maintenance_plan_revisions (template_version_id, organization_id);
create index maintenance_plan_revisions_created_by_fk_idx
  on public.maintenance_plan_revisions (created_by);
create index maintenance_plan_revision_equipment_org_fk_idx
  on public.maintenance_plan_revision_equipment (organization_id);
create index maintenance_plan_revision_equipment_created_by_fk_idx
  on public.maintenance_plan_revision_equipment (created_by);
create index maintenance_plan_events_actor_fk_idx on public.maintenance_plan_events (actor_id);
create index maintenance_plan_events_org_fk_idx on public.maintenance_plan_events (organization_id);

create index maintenance_due_work_revision_fk_idx
  on public.maintenance_due_work (maintenance_plan_revision_id, organization_id);
create index maintenance_due_work_created_by_fk_idx on public.maintenance_due_work (created_by);
create index maintenance_due_work_updated_by_fk_idx on public.maintenance_due_work (updated_by);
create index maintenance_due_work_events_actor_fk_idx on public.maintenance_due_work_events (actor_id);
create index maintenance_due_work_events_org_fk_idx on public.maintenance_due_work_events (organization_id);

create index maintenance_due_evidence_links_due_fk_idx
  on public.maintenance_due_evidence_links (maintenance_due_work_id, organization_id);
create index maintenance_due_evidence_links_created_by_fk_idx
  on public.maintenance_due_evidence_links (created_by);
create index maintenance_service_case_links_due_fk_idx
  on public.maintenance_service_case_links (maintenance_due_work_id, organization_id)
  where maintenance_due_work_id is not null;
create index maintenance_service_case_links_plan_fk_idx
  on public.maintenance_service_case_links (maintenance_plan_id, organization_id);
create index maintenance_service_case_links_created_by_fk_idx
  on public.maintenance_service_case_links (created_by);

create index document_links_maintenance_coverage_fk_idx
  on public.document_links (maintenance_coverage_id, organization_id)
  where maintenance_coverage_id is not null;
