alter table public.client_follow_ups
  drop constraint client_follow_ups_source_type_check;
alter table public.client_follow_ups
  add constraint client_follow_ups_source_type_check check (
    source_type is null
    or source_type in (
      'contact', 'site', 'request', 'job', 'project', 'service_case',
      'maintenance_coverage'
    )
  );

create or replace function app_private.validate_client_follow_up_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.clients client
    where client.id = new.client_id
      and client.organization_id = new.organization_id
  ) then raise exception 'follow-up customer organization mismatch'; end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = new.organization_id
      and member.user_id = new.owner_user_id
      and member.role in ('admin','buero')
  ) then raise exception 'follow-up owner must be an active admin or buero member'; end if;
  if new.source_type = 'contact' and not exists (
    select 1 from public.client_contacts contact
    where contact.id = new.source_id
      and contact.organization_id = new.organization_id
      and contact.client_id = new.client_id
  ) then raise exception 'follow-up contact source mismatch';
  elsif new.source_type = 'site' and not exists (
    select 1 from public.client_sites site
    where site.id = new.source_id
      and site.organization_id = new.organization_id
      and site.client_id = new.client_id
  ) then raise exception 'follow-up site source mismatch';
  elsif new.source_type = 'request' and not exists (
    select 1 from public.client_requests request
    where request.id = new.source_id
      and request.organization_id = new.organization_id
      and request.client_id = new.client_id
  ) then raise exception 'follow-up request source mismatch';
  elsif new.source_type = 'job' and not exists (
    select 1 from public.jobs job
    where job.id = new.source_id
      and job.organization_id = new.organization_id
      and job.client_id = new.client_id
  ) then raise exception 'follow-up job source mismatch';
  elsif new.source_type = 'project' and not exists (
    select 1 from public.projects project
    where project.id = new.source_id
      and project.organization_id = new.organization_id
      and project.client_id = new.client_id
  ) then raise exception 'follow-up project source mismatch';
  elsif new.source_type = 'service_case' and not exists (
    select 1 from public.service_cases service_case
    where service_case.id = new.source_id
      and service_case.organization_id = new.organization_id
      and service_case.client_id = new.client_id
  ) then raise exception 'follow-up service case source mismatch';
  elsif new.source_type = 'maintenance_coverage' and not exists (
    select 1 from public.maintenance_coverages coverage
    where coverage.id = new.source_id
      and coverage.organization_id = new.organization_id
      and coverage.client_id = new.client_id
  ) then raise exception 'follow-up maintenance coverage source mismatch';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
