
create index teams_created_by_idx on public.teams (created_by);
create index teams_updated_by_idx on public.teams (updated_by);

create index team_memberships_created_by_idx on public.team_memberships (created_by);
create index team_memberships_ended_by_idx on public.team_memberships (ended_by);

create index team_events_created_by_idx on public.team_events (created_by);

create index organization_capabilities_created_by_idx on public.organization_capabilities (created_by);
create index organization_capabilities_updated_by_idx on public.organization_capabilities (updated_by);

create index employee_capabilities_confirmed_by_idx on public.employee_capabilities (confirmed_by);
create index employee_capabilities_created_by_idx on public.employee_capabilities (created_by);
create index employee_capabilities_updated_by_idx on public.employee_capabilities (updated_by);

create index organization_qualification_settings_created_by_idx
  on public.organization_qualification_settings (created_by);
create index organization_qualification_settings_updated_by_idx
  on public.organization_qualification_settings (updated_by);

create index job_capability_requirements_created_by_idx
  on public.job_capability_requirements (created_by);
create index job_capability_requirements_updated_by_idx
  on public.job_capability_requirements (updated_by);

create index qualification_events_created_by_idx on public.qualification_events (created_by);

create index job_qualification_assessments_team_source_id_idx
  on public.job_qualification_assessments (team_source_id);
create index job_qualification_assessments_created_by_idx
  on public.job_qualification_assessments (created_by);
