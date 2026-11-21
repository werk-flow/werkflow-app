-- A completed maintenance visit gives a customer-safe Servicebericht as a
-- filed PDF (werk-flow/werkflow-planning#471).
--
-- * public.maintenance_service_reports holds one row per generated report of
--   a completed visit, append-only. A regenerated report is a new row with the
--   next report number that names the report it replaces, and a new document:
--   a filed document refuses a new version.
-- * public.register_maintenance_service_report registers the rendered PDF as
--   a document of category `report` without a retention class, under the
--   first free name in the library root, links it to the visit job, each
--   Anlage of the visit and the customer, writes its audit event and report
--   row, and files it through E9's public.file_document, in one call.

create table public.maintenance_service_reports (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  maintenance_due_work_id uuid not null,
  document_id uuid not null references public.documents(id) on delete cascade,
  report_number integer not null,
  replaces_report_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint maintenance_service_reports_id_organization_key unique (id, organization_id),
  constraint maintenance_service_reports_number_key unique (maintenance_due_work_id, report_number),
  constraint maintenance_service_reports_document_key unique (document_id),
  constraint maintenance_service_reports_chain check (
    (report_number = 1 and replaces_report_id is null)
    or (report_number > 1 and replaces_report_id is not null)
  ),
  foreign key (maintenance_due_work_id, organization_id)
    references public.maintenance_due_work(id, organization_id) on delete no action,
  foreign key (replaces_report_id, organization_id)
    references public.maintenance_service_reports(id, organization_id) on delete no action
);
create index maintenance_service_reports_organization_idx
  on public.maintenance_service_reports (organization_id);
create index maintenance_service_reports_due_work_idx
  on public.maintenance_service_reports (maintenance_due_work_id, organization_id);
create index maintenance_service_reports_replaces_idx
  on public.maintenance_service_reports (replaces_report_id, organization_id)
  where replaces_report_id is not null;
create index maintenance_service_reports_created_by_idx
  on public.maintenance_service_reports (created_by);

-- No client role reads it; service_role may only select and insert.
alter table public.maintenance_service_reports enable row level security;
revoke all on table public.maintenance_service_reports from public, anon, authenticated, service_role;
grant select, insert on table public.maintenance_service_reports to service_role;
create trigger maintenance_service_reports_immutable
before update or delete on public.maintenance_service_reports
for each row execute function app_private.prevent_maintenance_history_mutation();

-- „Servicebericht erstellen“: the rendered PDF as the visit's report. Only
-- service_role executes it, as invoker (security.md, „Add a privileged
-- function“), and it checks the actor's Admin or Büro role first. The
-- caller names the report it replaces (null for the first), so two managers
-- who regenerate at once do not both pass. A retry of a committed report id
-- answers with that report.
create function public.register_maintenance_service_report(
  p_organization_id uuid,
  p_actor_id uuid,
  p_report_id uuid,
  p_maintenance_due_work_id uuid,
  p_replaces_report_id uuid,
  p_document_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_existing public.maintenance_service_reports%rowtype;
  v_due public.maintenance_due_work%rowtype;
  v_latest public.maintenance_service_reports%rowtype;
  v_client_id uuid;
  v_name text := btrim(coalesce(p_file_name, ''));
  v_counter integer := 0;
  v_constraint text;
begin
  if not app_private.maintenance_actor_is_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  if p_report_id is null or p_document_id is null
     or p_storage_path is null or split_part(p_storage_path, '/', 1) <> p_organization_id::text
     or right(p_storage_path, 4) <> '.pdf'
     or length(v_name) not between 5 and 240 or right(v_name, 4) <> '.pdf'
     or p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'invalid_input';
  end if;

  -- The lock orders two reports of one visit, and a retry after its attempt.
  select * into v_due from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id
  for update;
  if not found then raise exception 'maintenance_due_not_found'; end if;
  -- After the lock, so a retry that overlapped the committing attempt finds it.
  select * into v_existing from public.maintenance_service_reports report
  where report.id = p_report_id;
  if found then
    if v_existing.organization_id <> p_organization_id
       or v_existing.maintenance_due_work_id <> p_maintenance_due_work_id then
      raise exception 'service_report_idempotency_conflict';
    end if;
    return jsonb_build_object('reportId', v_existing.id, 'documentId', v_existing.document_id, 'duplicate', true);
  end if;

  if v_due.status <> 'completed' or v_due.job_id is null then
    raise exception 'service_report_visit_not_completed';
  end if;
  select * into v_latest from public.maintenance_service_reports report
  where report.maintenance_due_work_id = v_due.id and report.organization_id = p_organization_id
  order by report.report_number desc
  limit 1;
  if v_latest.id is distinct from p_replaces_report_id then raise exception 'service_report_stale'; end if;
  select plan.client_id into strict v_client_id from public.maintenance_plans plan
  where plan.id = v_due.maintenance_plan_id and plan.organization_id = p_organization_id;

  -- Reports land in the library root, where an active name is unique: the
  -- first free `name (n).pdf`, as the library names a copy.
  while exists (
    select 1 from public.documents document
    where document.organization_id = p_organization_id and document.folder_id is null
      and document.deleted_at is null and lower(btrim(document.display_name)) = lower(v_name)
  ) loop
    v_counter := v_counter + 1;
    v_name := left(btrim(p_file_name), -4) || ' (' || v_counter || ').pdf';
  end loop;

  -- A report of another item of the same job may take the name meanwhile:
  -- then the next free name, as long as the library refuses only the name.
  loop
    begin
      insert into public.documents (
        id, organization_id, folder_id, storage_bucket, storage_path,
        original_file_name, display_name, category, mime_type, size_bytes,
        uploaded_by, metadata
      ) values (
        p_document_id, p_organization_id, null, 'organization-documents', p_storage_path,
        v_name, v_name, 'report', 'application/pdf', p_size_bytes,
        p_actor_id, jsonb_build_object('maintenanceServiceReportId', p_report_id,
          'maintenanceDueWorkId', v_due.id)
      );
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'documents_unique_active_folder_name_idx' then raise; end if;
      v_counter := v_counter + 1;
      v_name := left(btrim(p_file_name), -4) || ' (' || v_counter || ').pdf';
    end;
  end loop;
  insert into public.document_links (organization_id, document_id, job_id, created_by)
  values (p_organization_id, p_document_id, v_due.job_id, p_actor_id);
  insert into public.document_links (organization_id, document_id, equipment_id, created_by)
  select p_organization_id, p_document_id, link.equipment_id, p_actor_id
  from public.maintenance_plan_revision_equipment link
  where link.maintenance_plan_revision_id = v_due.maintenance_plan_revision_id
    and link.organization_id = p_organization_id;
  insert into public.document_links (organization_id, document_id, client_id, created_by)
  values (p_organization_id, p_document_id, v_client_id, p_actor_id);
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'uploaded',
    jsonb_build_object('source', 'maintenance_service_report',
      'maintenanceServiceReportId', p_report_id, 'maintenanceDueWorkId', v_due.id,
      'storagePath', p_storage_path)
  );
  insert into public.maintenance_service_reports (
    id, organization_id, maintenance_due_work_id, document_id, report_number,
    replaces_report_id, created_by
  ) values (
    p_report_id, p_organization_id, v_due.id, p_document_id,
    coalesce(v_latest.report_number, 0) + 1, v_latest.id, p_actor_id
  );
  -- Filed in the same call through E9's filing, so no report stands unfiled.
  perform public.file_document(p_actor_id, p_organization_id, p_document_id);
  return jsonb_build_object('reportId', p_report_id, 'documentId', p_document_id, 'duplicate', false);
end;
$$;

revoke all on function public.register_maintenance_service_report(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.register_maintenance_service_report(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, bigint
) to service_role;
