create index maintenance_coverage_events_coverage_org_fk_idx
  on public.maintenance_coverage_events (maintenance_coverage_id, organization_id);

create index maintenance_due_work_plan_org_fk_idx
  on public.maintenance_due_work (maintenance_plan_id, organization_id);

create index maintenance_due_work_events_due_org_fk_idx
  on public.maintenance_due_work_events (maintenance_due_work_id, organization_id);

create index maintenance_plan_events_plan_org_fk_idx
  on public.maintenance_plan_events (maintenance_plan_id, organization_id);

create index maintenance_plan_revision_equipment_revision_org_fk_idx
  on public.maintenance_plan_revision_equipment (
    maintenance_plan_revision_id,
    organization_id
  );

create index maintenance_plan_revisions_plan_org_fk_idx
  on public.maintenance_plan_revisions (maintenance_plan_id, organization_id);
