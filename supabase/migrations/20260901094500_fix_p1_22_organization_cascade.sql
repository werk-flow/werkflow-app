-- Preserve immutable correction history during normal operation while allowing
-- an organization and every row it owns to be removed in one transaction.

alter table public.time_correction_applications
  drop constraint time_correction_applications_request_org_fkey,
  add constraint time_correction_applications_request_org_fkey
    foreign key (request_id, organization_id)
    references public.time_correction_requests(id, organization_id)
    on delete cascade;

alter table public.time_correction_applications
  drop constraint time_correction_applications_revision_fkey,
  add constraint time_correction_applications_revision_fkey
    foreign key (request_id, revision)
    references public.time_correction_request_revisions(request_id, revision)
    deferrable initially deferred;

alter table public.time_correction_applications
  drop constraint time_correction_applications_previous_fkey,
  add constraint time_correction_applications_previous_fkey
    foreign key (previous_application_id)
    references public.time_correction_applications(id)
    deferrable initially deferred;

alter table public.time_correction_request_sources
  drop constraint time_correction_sources_application_fkey,
  add constraint time_correction_sources_application_fkey
    foreign key (correction_application_id)
    references public.time_correction_applications(id)
    deferrable initially deferred;

alter table public.time_correction_request_sources
  drop constraint time_correction_sources_entry_org_fkey,
  add constraint time_correction_sources_entry_org_fkey
    foreign key (time_entry_id, organization_id)
    references public.time_entries(id, organization_id)
    deferrable initially deferred,
  drop constraint time_correction_sources_session_org_fkey,
  add constraint time_correction_sources_session_org_fkey
    foreign key (time_session_id, organization_id)
    references public.time_sessions(id, organization_id)
    deferrable initially deferred,
  drop constraint time_correction_sources_segment_org_fkey,
  add constraint time_correction_sources_segment_org_fkey
    foreign key (time_segment_id, organization_id)
    references public.time_segments(id, organization_id)
    deferrable initially deferred;
