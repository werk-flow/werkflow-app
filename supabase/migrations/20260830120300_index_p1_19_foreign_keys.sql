create index document_links_service_case_fk_idx
  on public.document_links (service_case_id)
  where service_case_id is not null;

create index service_cases_source_request_fk_idx on public.service_cases (source_request_id)
  where source_request_id is not null;
create index service_cases_client_fk_idx on public.service_cases (client_id);
create index service_cases_contact_fk_idx on public.service_cases (contact_id)
  where contact_id is not null;
create index service_cases_site_fk_idx on public.service_cases (site_id);
create index service_cases_job_fk_idx on public.service_cases (job_id)
  where job_id is not null;
create index service_cases_created_by_fk_idx on public.service_cases (created_by);
create index service_cases_updated_by_fk_idx on public.service_cases (updated_by);

create index service_case_events_actor_fk_idx on public.service_case_events (actor_id);

create index service_case_equipment_links_created_by_fk_idx
  on public.service_case_equipment_links (created_by);

create index service_case_relations_created_by_fk_idx
  on public.service_case_relations (created_by);

create index service_case_evidence_links_created_by_fk_idx
  on public.service_case_evidence_links (created_by);
