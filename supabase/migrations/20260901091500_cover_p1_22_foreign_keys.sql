-- Cover every P1-22 foreign-key lookup in its declared column order. These
-- indexes keep parent updates and organization cleanup from scanning history.

create index time_correction_requests_subject_org_fkey_idx
  on public.time_correction_requests(subject_employee_record_id, organization_id);
create index time_correction_revisions_request_org_fkey_idx
  on public.time_correction_request_revisions(request_id, organization_id);
create index time_correction_sources_request_org_fkey_idx
  on public.time_correction_request_sources(request_id, organization_id);
create index time_correction_events_request_org_fkey_idx
  on public.time_correction_events(request_id, organization_id);
create index time_correction_applications_request_org_fkey_idx
  on public.time_correction_applications(request_id, organization_id);
create index time_correction_applications_revision_fkey_idx
  on public.time_correction_applications(request_id, revision);
create index time_correction_applications_previous_fkey_idx
  on public.time_correction_applications(previous_application_id)
  where previous_application_id is not null;
