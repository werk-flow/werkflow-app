-- A raw source can feed one approved overlay only. Later corrections must use
-- that overlay as their source, which produces a single explainable chain.

create table app_private.time_correction_applied_sources (
  organization_id uuid not null,
  source_kind public.time_correction_source_kind not null,
  source_id uuid not null,
  application_id uuid not null,
  primary key (organization_id, source_kind, source_id),
  constraint time_correction_applied_sources_application_fkey
    foreign key (application_id)
    references public.time_correction_applications(id)
    on delete cascade
);

create index time_correction_applied_sources_application_idx
  on app_private.time_correction_applied_sources(application_id);

create or replace function app_private.claim_time_correction_application_sources()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  begin
    insert into app_private.time_correction_applied_sources (
      organization_id, source_kind, source_id, application_id
    )
    select
      new.organization_id,
      source.source_kind,
      coalesce(
        source.time_entry_id,
        source.time_session_id,
        source.time_segment_id,
        source.correction_application_id
      ),
      new.id
    from public.time_correction_request_sources source
    where source.request_id = new.request_id
      and source.revision = new.revision;
  exception when unique_violation then
    raise exception 'time_correction_source_already_applied';
  end;
  return new;
end;
$$;

create trigger claim_time_correction_application_sources
after insert on public.time_correction_applications
for each row execute function app_private.claim_time_correction_application_sources();

revoke all on table app_private.time_correction_applied_sources
from public, anon, authenticated, service_role;
revoke all on function app_private.claim_time_correction_application_sources()
from public, anon, authenticated, service_role;
