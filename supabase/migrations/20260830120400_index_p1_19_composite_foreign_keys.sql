create index service_case_equipment_links_equipment_fk_idx
  on public.service_case_equipment_links (equipment_id, organization_id);
create index service_case_equipment_links_case_fk_idx
  on public.service_case_equipment_links (service_case_id, organization_id);

create index service_case_events_case_fk_idx
  on public.service_case_events (service_case_id, organization_id);

create index service_case_evidence_links_case_fk_idx
  on public.service_case_evidence_links (service_case_id, organization_id);
create index service_case_evidence_links_revision_fk_idx
  on public.service_case_evidence_links (work_artifact_revision_id, organization_id);

create index service_case_relations_related_case_fk_idx
  on public.service_case_relations (related_service_case_id, organization_id);
create index service_case_relations_case_fk_idx
  on public.service_case_relations (service_case_id, organization_id);

create index service_cases_job_org_fk_idx
  on public.service_cases (job_id, organization_id)
  where job_id is not null;
