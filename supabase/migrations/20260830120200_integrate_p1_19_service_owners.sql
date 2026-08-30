alter table public.document_links
  add column service_case_id uuid references public.service_cases(id) on delete cascade;

alter table public.document_links
  drop constraint document_links_exactly_one_target_check;
alter table public.document_links
  add constraint document_links_exactly_one_target_check check (
    num_nonnulls(
      job_id, project_id, client_id, employee_id, request_id,
      equipment_id, service_case_id
    ) = 1
  );

create index document_links_service_case_idx
  on public.document_links (organization_id, service_case_id)
  where service_case_id is not null;

create or replace function app_private.validate_document_link_org()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.documents document
    where document.id = new.document_id
      and document.organization_id = new.organization_id
      and document.deleted_at is null
  ) then raise exception 'document link document must belong to the same organization'; end if;

  if new.job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id
  ) then raise exception 'document link job must belong to the same organization'; end if;
  if new.project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id
  ) then raise exception 'document link project must belong to the same organization'; end if;
  if new.client_id is not null and not exists (
    select 1 from public.clients client
    where client.id = new.client_id and client.organization_id = new.organization_id
  ) then raise exception 'document link client must belong to the same organization'; end if;
  if new.employee_id is not null and not exists (
    select 1 from public.organization_members member
    where member.user_id = new.employee_id
      and member.organization_id = new.organization_id
  ) then raise exception 'document link employee must belong to the same organization'; end if;
  if new.request_id is not null and not exists (
    select 1 from public.client_requests request
    where request.id = new.request_id and request.organization_id = new.organization_id
  ) then raise exception 'document link request must belong to the same organization'; end if;
  if new.equipment_id is not null and not exists (
    select 1 from public.installed_equipment equipment
    where equipment.id = new.equipment_id and equipment.organization_id = new.organization_id
  ) then raise exception 'document link equipment must belong to the same organization'; end if;
  if new.service_case_id is not null and not exists (
    select 1 from public.service_cases service_case
    where service_case.id = new.service_case_id
      and service_case.organization_id = new.organization_id
  ) then raise exception 'document link service case must belong to the same organization'; end if;
  return new;
end;
$$;

create or replace function app_private.record_service_case_document_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_case public.service_cases%rowtype;
  v_document public.documents%rowtype;
  v_before_snapshot jsonb;
  v_payload jsonb;
begin
  if new.service_case_id is null then return new; end if;
  select * into strict v_case from public.service_cases service_case
  where service_case.id = new.service_case_id
    and service_case.organization_id = new.organization_id for update;
  select * into strict v_document from public.documents document
  where document.id = new.document_id
    and document.organization_id = new.organization_id;
  v_before_snapshot := app_private.service_case_snapshot(v_case.id, new.organization_id);
  v_payload := jsonb_build_object(
    'documentLinkId', new.id,
    'documentId', new.document_id,
    'documentVersionNumber', v_document.current_version_number,
    'documentStoragePath', v_document.storage_path
  );
  perform set_config('app.service_case_write', 'true', true);
  update public.service_cases set
    version = version + 1,
    updated_by = new.created_by,
    updated_at = now()
  where id = new.service_case_id and organization_id = new.organization_id;
  perform set_config('app.service_case_write', 'false', true);
  perform app_private.record_service_case_event(
    new.organization_id, new.service_case_id, 'document_linked', new.created_by,
    'Dokument verknüpft', 'document_link_insert', new.id,
    v_payload, v_before_snapshot,
    app_private.service_case_snapshot(new.service_case_id, new.organization_id)
  );
  return new;
end;
$$;

create or replace function app_private.guard_service_case_document_unlink()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.service_case_id is null then return old; end if;
  if pg_trigger_depth() > 1 then return old; end if;
  if coalesce(current_setting('app.service_case_document_unlink', true), '') <> 'true' then
    raise exception 'service_case_document_unlink_requires_guarded_operation';
  end if;
  return old;
end;
$$;

create or replace function public.unlink_service_case_document(
  p_organization_id uuid,
  p_link_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_link public.document_links%rowtype;
  v_case public.service_cases%rowtype;
  v_document public.documents%rowtype;
  v_payload jsonb;
  v_before_snapshot jsonb;
begin
  perform app_private.assert_service_case_manager(p_organization_id, p_actor_id);
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'service_case_reason_required';
  end if;
  if exists (
    select 1 from public.service_case_events event
    where event.organization_id = p_organization_id
      and event.request_operation = 'document_unlink'
      and event.idempotency_key = p_idempotency_key
  ) then return true; end if;
  select * into v_link from public.document_links link
  where link.id = p_link_id and link.organization_id = p_organization_id
    and link.service_case_id is not null for update;
  if not found then raise exception 'service_case_document_link_not_found'; end if;
  select * into strict v_case from public.service_cases service_case
  where service_case.id = v_link.service_case_id
    and service_case.organization_id = p_organization_id for update;
  if v_case.version <> p_expected_version then
    raise exception 'service_case_stale_version';
  end if;
  select * into strict v_document from public.documents document
  where document.id = v_link.document_id
    and document.organization_id = p_organization_id;
  v_payload := jsonb_build_object(
    'documentLinkId', v_link.id,
    'documentId', v_document.id,
    'documentVersionNumber', v_document.current_version_number,
    'documentStoragePath', v_document.storage_path,
    'reason', btrim(p_reason)
  );
  v_before_snapshot := app_private.service_case_snapshot(v_case.id, p_organization_id);
  perform set_config('app.service_case_document_unlink', 'true', true);
  delete from public.document_links
  where id = p_link_id and organization_id = p_organization_id;
  perform set_config('app.service_case_document_unlink', 'false', true);
  perform set_config('app.service_case_write', 'true', true);
  update public.service_cases set
    version = version + 1, updated_by = p_actor_id, updated_at = now()
  where id = v_case.id and organization_id = p_organization_id;
  perform set_config('app.service_case_write', 'false', true);
  perform app_private.record_service_case_event(
    p_organization_id, v_case.id, 'document_unlinked', p_actor_id,
    p_reason, 'document_unlink', p_idempotency_key, v_payload,
    v_before_snapshot,
    app_private.service_case_snapshot(v_case.id, p_organization_id)
  );
  return true;
end;
$$;

create trigger document_links_record_service_case_history
after insert on public.document_links
for each row execute function app_private.record_service_case_document_link();
create trigger document_links_guard_service_case_unlink
before delete on public.document_links
for each row execute function app_private.guard_service_case_document_unlink();

alter table public.client_follow_ups
  drop constraint client_follow_ups_source_type_check;
alter table public.client_follow_ups
  add constraint client_follow_ups_source_type_check check (
    source_type is null
    or source_type in ('contact','site','request','job','project','service_case')
  );

create or replace function app_private.validate_client_follow_up_org()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.clients client
    where client.id = new.client_id
      and client.organization_id = new.organization_id
  )
    then raise exception 'follow-up customer organization mismatch'; end if;
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
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app_private.record_service_case_document_link(),
  app_private.guard_service_case_document_unlink()
from public, anon, authenticated;
grant execute on function app_private.record_service_case_document_link(),
  app_private.guard_service_case_document_unlink() to service_role;
revoke all on function public.unlink_service_case_document(
  uuid, uuid, bigint, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.unlink_service_case_document(
  uuid, uuid, bigint, text, uuid, uuid
) to service_role;
