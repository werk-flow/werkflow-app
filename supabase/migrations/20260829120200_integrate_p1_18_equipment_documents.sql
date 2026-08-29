alter table public.document_links
  add column equipment_id uuid;

alter table public.document_links
  add constraint document_links_equipment_fk foreign key (
    equipment_id, organization_id
  ) references public.installed_equipment(id, organization_id) on delete no action;

alter table public.document_links
  drop constraint document_links_exactly_one_target_check;
alter table public.document_links
  add constraint document_links_exactly_one_target_check check (
    num_nonnulls(
      job_id, project_id, client_id, employee_id, request_id, equipment_id
    ) = 1
  );

create unique index document_links_unique_equipment_idx
  on public.document_links (document_id, equipment_id)
  where equipment_id is not null;

create or replace function app_private.record_installed_equipment_document_link()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_document public.documents%rowtype;
  v_equipment public.installed_equipment%rowtype;
  v_event_id uuid;
  v_snapshot jsonb;
begin
  if new.equipment_id is null then return new; end if;
  select * into strict v_document from public.documents document
  where document.id = new.document_id
    and document.organization_id = new.organization_id;
  select * into strict v_equipment from public.installed_equipment equipment
  where equipment.id = new.equipment_id
    and equipment.organization_id = new.organization_id;
  v_snapshot := app_private.installed_equipment_snapshot(
    new.equipment_id, new.organization_id
  );
  v_event_id := app_private.record_installed_equipment_event(
    new.organization_id, new.equipment_id, 'document_linked',
    v_equipment.state, v_equipment.state, new.created_at, new.created_by,
    'Dokument verknüpft', 'document_link_insert', new.id,
    null, v_snapshot, v_snapshot
  );
  insert into public.installed_equipment_event_links (
    organization_id, event_id, document_id,
    document_version_number, document_storage_path
  ) values (
    new.organization_id, v_event_id, new.document_id,
    v_document.current_version_number, v_document.storage_path
  );
  return new;
end;
$$;

create or replace function app_private.guard_installed_equipment_document_unlink()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.equipment_id is null then return old; end if;
  if old.organization_id::text = any(string_to_array(coalesce(
    current_setting('app.installed_equipment_deleting_organization_ids', true), ''
  ), ',')) then return old; end if;
  if coalesce(current_setting('app.installed_equipment_document_unlink', true), '') <> 'true' then
    raise exception 'installed_equipment_document_unlink_forbidden';
  end if;
  return old;
end;
$$;

create or replace function app_private.mark_installed_equipment_organization_delete()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config(
    'app.installed_equipment_deleting_organization_ids',
    concat_ws(
      ',',
      nullif(current_setting(
        'app.installed_equipment_deleting_organization_ids', true
      ), ''),
      old.id::text
    ),
    true
  );
  return old;
end;
$$;

create or replace function public.unlink_installed_equipment_document(
  p_organization_id uuid,
  p_link_id uuid,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_link public.document_links%rowtype;
  v_document public.documents%rowtype;
  v_equipment public.installed_equipment%rowtype;
  v_event_id uuid;
  v_snapshot jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.request_operation = 'document_link_delete'
      and event.idempotency_key = p_idempotency_key
  ) then return true; end if;

  select * into v_link from public.document_links link
  where link.id = p_link_id
    and link.organization_id = p_organization_id
    and link.equipment_id is not null
  for update;
  if not found then raise exception 'installed_equipment_document_link_not_found'; end if;
  select * into strict v_document from public.documents document
  where document.id = v_link.document_id
    and document.organization_id = p_organization_id;
  select * into strict v_equipment from public.installed_equipment equipment
  where equipment.id = v_link.equipment_id
    and equipment.organization_id = p_organization_id;
  v_snapshot := app_private.installed_equipment_snapshot(
    v_link.equipment_id, p_organization_id
  );
  v_event_id := app_private.record_installed_equipment_event(
    p_organization_id, v_link.equipment_id, 'document_unlinked',
    v_equipment.state, v_equipment.state, now(), p_actor_id,
    'Dokumentverknüpfung entfernt', 'document_link_delete', p_idempotency_key,
    null, v_snapshot, v_snapshot
  );
  insert into public.installed_equipment_event_links (
    organization_id, event_id, document_id,
    document_version_number, document_storage_path
  ) values (
    p_organization_id, v_event_id, v_link.document_id,
    v_document.current_version_number, v_document.storage_path
  );
  perform set_config('app.installed_equipment_document_unlink', 'true', true);
  delete from public.document_links link where link.id = p_link_id;
  perform set_config('app.installed_equipment_document_unlink', 'false', true);
  return true;
end;
$$;

create trigger document_links_record_equipment_history
after insert on public.document_links
for each row execute function app_private.record_installed_equipment_document_link();
create trigger document_links_guard_equipment_unlink
before delete on public.document_links
for each row execute function app_private.guard_installed_equipment_document_unlink();
create trigger organizations_mark_installed_equipment_delete
before delete on public.organizations
for each row execute function app_private.mark_installed_equipment_organization_delete();
create index document_links_equipment_idx
  on public.document_links (equipment_id)
  where equipment_id is not null;

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
    where request.id = new.request_id
      and request.organization_id = new.organization_id
  ) then raise exception 'document link request must belong to the same organization'; end if;

  if new.equipment_id is not null and not exists (
    select 1 from public.installed_equipment equipment
    where equipment.id = new.equipment_id
      and equipment.organization_id = new.organization_id
  ) then raise exception 'document link equipment must belong to the same organization'; end if;

  return new;
end;
$$;

create or replace function app_private.can_access_document(
  p_document_id uuid,
  p_user_id uuid
)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.documents document
    where document.id = p_document_id and document.deleted_at is null
      and app_private.is_document_manager(document.organization_id, p_user_id)
  ) or exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    join public.job_assignments assignment on assignment.job_id = link.job_id
    where document.id = p_document_id and document.deleted_at is null
      and link.job_id is not null and assignment.user_id = p_user_id
  ) or exists (
    select 1
    from public.documents document
    join public.work_artifact_revision_documents relation
      on relation.document_id = document.id
    join public.work_artifact_revisions revision on revision.id = relation.revision_id
    join public.work_artifacts artifact on artifact.id = revision.artifact_id
    where document.id = p_document_id and document.deleted_at is null
      and app_private.can_access_work_artifact_target(
        artifact.organization_id, artifact.job_id, artifact.project_id, p_user_id
      )
  );
$$;

revoke all on function app_private.validate_document_link_org()
from public, anon, authenticated;
grant execute on function app_private.validate_document_link_org()
to service_role;

revoke all on function app_private.record_installed_equipment_document_link()
from public, anon, authenticated;
revoke all on function app_private.guard_installed_equipment_document_unlink()
from public, anon, authenticated;
revoke all on function app_private.mark_installed_equipment_organization_delete()
from public, anon, authenticated;
revoke all on function public.unlink_installed_equipment_document(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.record_installed_equipment_document_link()
to service_role;
grant execute on function app_private.guard_installed_equipment_document_unlink()
to service_role;
grant execute on function app_private.mark_installed_equipment_organization_delete()
to service_role;
grant execute on function public.unlink_installed_equipment_document(uuid, uuid, uuid, uuid)
to service_role;

revoke all on function app_private.can_access_document(uuid, uuid)
from public, anon;
grant execute on function app_private.can_access_document(uuid, uuid)
to authenticated, service_role;
