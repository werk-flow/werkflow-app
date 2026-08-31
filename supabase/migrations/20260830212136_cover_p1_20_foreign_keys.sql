create index maintenance_coverage_events_root_org_fk_idx
  on public.maintenance_coverage_events (maintenance_coverage_id, organization_id);
create index maintenance_coverages_client_org_fk_idx
  on public.maintenance_coverages (client_id, organization_id);
create index maintenance_coverages_site_org_fk_idx
  on public.maintenance_coverages (site_id, organization_id);

create index maintenance_due_evidence_revision_org_fk_idx
  on public.maintenance_due_evidence_links (work_artifact_revision_id, organization_id);
create index maintenance_due_work_job_org_fk_idx
  on public.maintenance_due_work (job_id, organization_id)
  where job_id is not null;
create index maintenance_due_work_plan_org_fk_idx
  on public.maintenance_due_work (maintenance_plan_id, organization_id);
create index maintenance_due_work_occurrence_org_fk_idx
  on public.maintenance_due_work (planning_occurrence_id, organization_id)
  where planning_occurrence_id is not null;
create index maintenance_due_work_events_root_org_fk_idx
  on public.maintenance_due_work_events (maintenance_due_work_id, organization_id);

create index maintenance_plan_events_root_org_fk_idx
  on public.maintenance_plan_events (maintenance_plan_id, organization_id);
create index maintenance_plan_revision_equipment_equipment_org_fk_idx
  on public.maintenance_plan_revision_equipment (equipment_id, organization_id);
create index maintenance_plan_revision_equipment_revision_org_fk_idx
  on public.maintenance_plan_revision_equipment (
    maintenance_plan_revision_id, organization_id
  );
create index maintenance_plan_revisions_plan_org_fk_idx
  on public.maintenance_plan_revisions (maintenance_plan_id, organization_id);
create index maintenance_plan_revisions_organization_fk_idx
  on public.maintenance_plan_revisions (organization_id);
create index maintenance_plans_client_org_fk_idx
  on public.maintenance_plans (client_id, organization_id);
create index maintenance_plans_site_org_fk_idx
  on public.maintenance_plans (site_id, organization_id);
create index maintenance_service_case_links_case_org_fk_idx
  on public.maintenance_service_case_links (service_case_id, organization_id);
