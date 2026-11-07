-- A filed original keeps its retention period and cannot be changed or erased
-- early (werk-flow/werkflow-planning#283). The invoice module relies on this
-- archive guarantee before WerkFlow issues its first own invoice.
--
-- The owner's schedule (werk-flow/werkflow-planning#24) has one class: ten
-- years from the end of the document's year, for all financial papers. An
-- ordinary upload of an invoice, offer or contract gets it; Admin and Büro move
-- any ordinary document into or out of it, and change its document date
-- (Belegdatum), until they file the document. The retention end is the last day
-- of the document date's year plus ten years; deletion is possible from the day
-- after.
--
-- Division of work: the server actions in lib/documents/ authorize the caller
-- and the document and refuse a filed document or a running period before the
-- call. The functions repeat the checks under the row lock. The trigger
-- documents_retention_guard is the floor for every path, including the
-- existing write functions: a filed document keeps its bytes, versions,
-- document date, class and filed state, and never reaches the trash; a filed
-- document, and any document whose retention end is today or later, is never
-- deleted. Organization teardown passes the delete guard once the
-- organization row is gone, as the personnel delete guard does; the owner path
-- delete_organization refuses first while a document's period runs.
-- Protected personnel documents keep their own rules: they get no class and
-- cannot be filed.
--
-- Prevention: Tier 1 (the trigger), Tier 2 supabase/tests/document_retention.sql
-- and supabase/tests/organization_deletion.sql.

create type public.document_retention_class as enum ('ten_years');

-- @destructive: after release e713fa96: that build never writes filed_at or filed_by, so the check holds for its writes
alter table public.documents
  add column document_date date default ((now() at time zone 'Europe/Berlin')::date),
  add column retention_class public.document_retention_class,
  add column retention_ends_on date generated always as (
    case retention_class
      when 'ten_years' then make_date(extract(year from document_date)::integer + 10, 12, 31)
    end
  ) stored,
  add column filed_at timestamptz,
  add column filed_by uuid references public.profiles(id),
  add constraint documents_filed_by_with_filed_at check ((filed_at is null) = (filed_by is null));

-- Existing documents date from their upload day. Existing ordinary invoices,
-- offers and contracts get the class an upload gives them today.
update public.documents document
set document_date = (document.created_at at time zone 'Europe/Berlin')::date,
  retention_class = case
    when document.category in ('invoice', 'offer', 'contract') and not exists (
      select 1 from public.personnel_documents protected where protected.document_id = document.id
    ) then 'ten_years'::public.document_retention_class
  end;
-- @destructive: after release e713fa96: that build never names document_date, so its inserts take the default
alter table public.documents alter column document_date set not null;

create index documents_retention_ends_on_idx
  on public.documents (organization_id, retention_ends_on)
  where retention_ends_on is not null;
create index documents_filed_by_idx on public.documents (filed_by) where filed_by is not null;

-- The view selected document.* when it was created; replacing it adds the new columns.
create or replace view public.ordinary_documents
with (security_invoker = true)
as
select document.*
from public.documents document
where not app_private.p1_24_is_protected_document(document.id);

create function app_private.guard_document_retention()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.organizations organization where organization.id = old.organization_id
    ) then
      return old;
    end if;
    if old.filed_at is not null then
      raise exception 'document_filed';
    end if;
    if old.retention_ends_on >= (now() at time zone 'Europe/Berlin')::date then
      raise exception 'retention_period_running';
    end if;
    return old;
  end if;
  -- A filed document changes only its name, folder and category label. The
  -- source of a copy may go, which clears copied_from_document_id. A BEFORE
  -- trigger sees no generated value, and retention_ends_on follows the
  -- compared document date and class.
  if old.filed_at is not null
    and to_jsonb(new) - array[
      'display_name', 'folder_id', 'category', 'copied_from_document_id', 'updated_at', 'retention_ends_on'
    ] is distinct from to_jsonb(old) - array[
      'display_name', 'folder_id', 'category', 'copied_from_document_id', 'updated_at', 'retention_ends_on'
    ]
  then
    raise exception 'document_filed';
  end if;
  return new;
end;
$$;

create trigger documents_retention_guard
  before update or delete on public.documents
  for each row execute function app_private.guard_document_retention();

-- The upload infers the class from the category. Otherwise as in
-- 20261004140000_write_document_uploads_and_links_atomically.sql.
create or replace function public.finalize_document_upload(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_folder_id uuid,
  p_storage_path text,
  p_original_file_name text,
  p_display_name text,
  p_category text,
  p_mime_type text,
  p_size_bytes bigint,
  p_link_kind text,
  p_link_target_id uuid
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents;
  v_constraint text;
  v_job_id uuid := case when p_link_kind = 'job' then p_link_target_id end;
  v_project_id uuid := case when p_link_kind = 'project' then p_link_target_id end;
  v_client_id uuid := case when p_link_kind = 'client' then p_link_target_id end;
  v_employee_id uuid := case when p_link_kind = 'employee' then p_link_target_id end;
  v_request_id uuid := case when p_link_kind = 'request' then p_link_target_id end;
  v_equipment_id uuid := case when p_link_kind = 'equipment' then p_link_target_id end;
  v_service_case_id uuid := case when p_link_kind = 'service_case' then p_link_target_id end;
  v_coverage_id uuid := case when p_link_kind = 'maintenance_coverage' then p_link_target_id end;
  v_target_payload jsonb;
begin
  if (p_link_kind is null) <> (p_link_target_id is null)
    or p_link_kind not in (
      'job', 'project', 'client', 'employee', 'request', 'equipment', 'service_case', 'maintenance_coverage'
    )
  then
    raise exception 'invalid_target';
  end if;
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
  ) then
    raise exception 'not_a_member';
  end if;
  if not app_private.is_document_manager(p_organization_id, p_actor_id)
    and not (
      p_link_kind = 'job' and p_folder_id is null and exists (
        select 1 from public.job_assignments assignment
        where assignment.organization_id = p_organization_id
          and assignment.job_id = p_link_target_id
          and assignment.user_id = p_actor_id
      )
    )
  then
    raise exception 'not_authorized';
  end if;
  if p_folder_id is not null and not exists (
    select 1 from public.document_folders folder
    where folder.id = p_folder_id and folder.organization_id = p_organization_id
      and folder.deleted_at is null
  ) then
    raise exception 'folder_not_found';
  end if;

  begin
    insert into public.documents (
      id, organization_id, folder_id, storage_path, original_file_name, display_name,
      category, mime_type, size_bytes, uploaded_by, retention_class
    ) values (
      p_document_id, p_organization_id, p_folder_id, p_storage_path, p_original_file_name,
      p_display_name, p_category, p_mime_type, p_size_bytes, p_actor_id,
      case when p_category in ('invoice', 'offer', 'contract') then 'ten_years'::public.document_retention_class end
    )
    returning * into v_document;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    -- A concurrent finalize of the same upload committed first and owns the object.
    if v_constraint in ('documents_pkey', 'documents_storage_path_key') then
      raise exception 'already_finalized';
    end if;
    raise exception 'create_failed';
  end;

  if p_link_kind is not null then
    begin
      insert into public.document_links (
        organization_id, document_id, job_id, project_id, client_id, employee_id, request_id,
        equipment_id, service_case_id, maintenance_coverage_id, created_by
      ) values (
        p_organization_id, p_document_id, v_job_id, v_project_id, v_client_id, v_employee_id,
        v_request_id, v_equipment_id, v_service_case_id, v_coverage_id, p_actor_id
      );
    exception when others then
      raise exception 'link_failed';
    end;
  end if;

  v_target_payload := jsonb_build_object(
    'jobId', v_job_id, 'projectId', v_project_id, 'clientId', v_client_id,
    'employeeId', v_employee_id, 'requestId', v_request_id, 'equipmentId', v_equipment_id,
    'serviceCaseId', v_service_case_id, 'maintenanceCoverageId', v_coverage_id
  );
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_folder_id, p_actor_id, 'uploaded',
    jsonb_build_object(
      'displayName', v_document.display_name, 'originalFileName', v_document.original_file_name,
      'category', v_document.category, 'sizeBytes', v_document.size_bytes,
      'mimeType', v_document.mime_type
    ) || v_target_payload
  );
  if p_link_kind is not null then
    insert into public.document_audit_events (
      organization_id, document_id, actor_id, event_type, event_payload
    ) values (p_organization_id, p_document_id, p_actor_id, 'linked', v_target_payload);
  end if;
  return v_document;
end;
$$;

-- @destructive: after release e713fa96: the constraint returns below with every earlier event type and two new ones
alter table public.document_audit_events
  drop constraint document_audit_events_event_type_check;
-- @destructive: after release e713fa96: that build writes only event types this list keeps
alter table public.document_audit_events
  add constraint document_audit_events_event_type_check
  check (event_type in (
    'uploaded',
    'renamed',
    'moved',
    'copied',
    'category_changed',
    'linked',
    'unlinked',
    'deleted',
    'restored',
    'version_uploaded',
    'permanently_deleted',
    'storage_cleanup',
    'personnel_classified',
    'personnel_released',
    'personnel_release_revoked',
    'retention_changed',
    'filed'
  ));

-- The active ordinary document a retention write may change, locked: the
-- checks of lock_active_document, and no protected personnel document.
-- It runs as the calling function's owner and no role executes it directly.
create function app_private.lock_ordinary_document_for_retention(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid
)
returns public.documents
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_document public.documents;
begin
  -- Waits for a running delete_organization, which then finds the period.
  perform 1 from public.organizations organization where organization.id = p_organization_id for key share;
  v_document := app_private.lock_active_document(p_actor_id, p_organization_id, p_document_id);
  if exists (
    select 1 from public.personnel_documents protected
    where protected.organization_id = p_organization_id and protected.document_id = p_document_id
  ) then
    raise exception 'protected_document_boundary';
  end if;
  if v_document.filed_at is not null then
    raise exception 'document_filed';
  end if;
  return v_document;
end;
$$;

-- Sets the document date and the retention class of an unfiled document, with
-- one audit event when either changes. Refusals: not_authorized,
-- document_not_found, protected_document_boundary, document_filed.
create function public.update_document_retention(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid,
  p_document_date date,
  p_retention_class public.document_retention_class
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents := app_private.lock_ordinary_document_for_retention(
    p_actor_id, p_organization_id, p_document_id
  );
  v_updated public.documents;
begin
  if p_document_date is null then
    raise exception 'invalid_input';
  end if;
  if v_document.document_date = p_document_date
    and v_document.retention_class is not distinct from p_retention_class
  then
    return v_document;
  end if;
  update public.documents document set document_date = p_document_date, retention_class = p_retention_class
  where document.id = p_document_id and document.organization_id = p_organization_id
  returning * into v_updated;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_document.folder_id, p_actor_id, 'retention_changed',
    jsonb_build_object(
      'fromDocumentDate', v_document.document_date, 'toDocumentDate', v_updated.document_date,
      'fromRetentionClass', v_document.retention_class, 'toRetentionClass', v_updated.retention_class,
      'retentionEndsOn', v_updated.retention_ends_on
    )
  );
  return v_updated;
end;
$$;

-- Files an ordinary document: final, with its audit event. The server-only
-- path for a generated original (lib/documents/filing.ts) calls this right
-- after the original's registration. Refusals: not_authorized,
-- document_not_found, protected_document_boundary, document_filed.
create function public.file_document(
  p_actor_id uuid,
  p_organization_id uuid,
  p_document_id uuid
)
returns public.documents
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_document public.documents := app_private.lock_ordinary_document_for_retention(
    p_actor_id, p_organization_id, p_document_id
  );
  v_filed public.documents;
begin
  update public.documents document set filed_at = now(), filed_by = p_actor_id
  where document.id = p_document_id and document.organization_id = p_organization_id
  returning * into v_filed;
  insert into public.document_audit_events (
    organization_id, document_id, folder_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, v_document.folder_id, p_actor_id, 'filed',
    jsonb_build_object(
      'documentDate', v_filed.document_date, 'retentionClass', v_filed.retention_class,
      'retentionEndsOn', v_filed.retention_ends_on, 'versionNumber', v_filed.current_version_number,
      'storagePath', v_filed.storage_path
    )
  );
  return v_filed;
end;
$$;

revoke all on function app_private.guard_document_retention() from public, anon, authenticated, service_role;
revoke all on function app_private.lock_ordinary_document_for_retention(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_document_retention(uuid, uuid, uuid, date, public.document_retention_class)
  from public, anon, authenticated;
revoke all on function public.file_document(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.update_document_retention(uuid, uuid, uuid, date, public.document_retention_class)
  to service_role;
grant execute on function public.file_document(uuid, uuid, uuid) to service_role;

-- Organization deletion counts and refuses documents inside their period, as
-- it does recorded time. Otherwise as in
-- 20261029205025_refuse_organization_delete_with_time_records.sql.
create or replace function public.get_organization_deletion_scope(p_organization_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select jsonb_build_object(
    'members', (select count(*) from public.organization_members m where m.organization_id = p_organization_id),
    'open_invites', (select count(*) from public.organization_invites i
      where i.organization_id = p_organization_id and i.status = 'pending'),
    'clients', (select count(*) from public.clients c where c.organization_id = p_organization_id),
    'projects', (select count(*) from public.projects p where p.organization_id = p_organization_id),
    'jobs', (select count(*) from public.jobs j where j.organization_id = p_organization_id),
    'employee_records', (select count(*) from public.employee_records r where r.organization_id = p_organization_id),
    'documents', (select count(*) from public.documents d where d.organization_id = p_organization_id),
    'retained_documents', (select count(*) from public.documents d
      where d.organization_id = p_organization_id
        and d.retention_ends_on >= (now() at time zone 'Europe/Berlin')::date),
    'time_tracked_people', (select count(*) from (
      select e.user_id from public.time_entries e where e.organization_id = p_organization_id
      union
      select s.user_id from public.time_sessions s where s.organization_id = p_organization_id
    ) people),
    'closed_periods', (select count(distinct v.period_id) from public.time_period_close_versions v
      where v.organization_id = p_organization_id),
    'payroll_exports', (select count(*) from public.payroll_exports x where x.organization_id = p_organization_id)
  );
$$;

create or replace function public.delete_organization(
  p_organization_id uuid,
  p_actor_id uuid,
  p_confirmation_name text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_organization public.organizations%rowtype;
begin
  select * into v_organization
  from public.organizations organization
  where organization.id = p_organization_id
  for update;
  if not found then raise exception 'org_not_found'; end if;

  if p_actor_id is null or v_organization.admin_id <> p_actor_id then
    raise exception 'not_authorized';
  end if;
  if p_confirmation_name is null or btrim(p_confirmation_name) <> v_organization.name then
    raise exception 'name_mismatch';
  end if;

  if exists (select 1 from public.time_entries e where e.organization_id = p_organization_id)
    or exists (select 1 from public.time_sessions s where s.organization_id = p_organization_id)
    or exists (
      select 1 from public.time_period_close_versions v where v.organization_id = p_organization_id
    )
  then raise exception 'has_time_records'; end if;
  -- An upload or a retention change waits on the locked organization row
  -- and then fails, so no period starts after this check.
  if exists (
    select 1 from public.documents d
    where d.organization_id = p_organization_id
      and d.retention_ends_on >= (now() at time zone 'Europe/Berlin')::date
  ) then raise exception 'has_retained_documents'; end if;

  delete from public.organizations organization where organization.id = p_organization_id;
end;
$$;
