-- A filed original keeps its retention period and cannot be changed or erased
-- early (werk-flow/werkflow-planning#283). An upload of an invoice, offer or
-- contract gets the ten-year class; the retention end is the last day of the
-- document date's year plus ten years. Admin and Büro change the document date
-- and the class until they file the document. A filed document refuses a new
-- version, a byte replacement, trash and permanent deletion, in every
-- function and in the table trigger; rename, move and category stay possible.
-- Permanent deletion of any document whose retention end is today or later is
-- refused, filed or not. An employee, another organization and a protected
-- personnel document cannot be filed or reclassified. Only the service role
-- executes the functions. A former filer's account deletion is refused while
-- the filed document exists. The migration's backfill gives an existing copy
-- no class, even after its source is deleted.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('28300000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-retention-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Archiv"}', now(), now()),
('28300000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-retention-office@example.test', '', now(), '{}',
 '{"first_name":"Office","last_name":"Archiv"}', now(), now()),
('28300000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-retention-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Archiv"}', now(), now()),
('28300000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-retention-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Archiv"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('28300000-0000-0000-0000-000000000010', 'Archiv SQL', '28300000-0000-0000-0000-000000000001', 'ARCHSQLA'),
('28300000-0000-0000-0000-000000000011', 'Archiv SQL fremd', '28300000-0000-0000-0000-000000000004', 'ARCHSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000002', 'buero'),
('28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000003', 'employee');

insert into public.document_folders (id, organization_id, name, created_by) values
('28300000-0000-0000-0000-000000000030', '28300000-0000-0000-0000-000000000010', 'Buchhaltung',
 '28300000-0000-0000-0000-000000000001');

-- 40 an old invoice whose period ended, 41 a foreign offer, 42 a standard
-- personnel document, 43 a filed invoice already in the trash (written
-- directly: no function lets a filed document reach the trash).
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  document_date, retention_class
) values
('28300000-0000-0000-0000-000000000040', '28300000-0000-0000-0000-000000000010',
 '28300000-0000-0000-0000-000000000010/d40/rechnung-2010.pdf', 'rechnung-2010.pdf', 'rechnung-2010.pdf',
 'invoice', 10, '28300000-0000-0000-0000-000000000001', '2010-06-01', 'ten_years'),
('28300000-0000-0000-0000-000000000041', '28300000-0000-0000-0000-000000000011',
 '28300000-0000-0000-0000-000000000011/d41/angebot.pdf', 'angebot.pdf', 'angebot.pdf',
 'offer', 10, '28300000-0000-0000-0000-000000000004', '2026-03-01', 'ten_years'),
('28300000-0000-0000-0000-000000000042', '28300000-0000-0000-0000-000000000010',
 '28300000-0000-0000-0000-000000000010/d42/vertrag.pdf', 'vertrag.pdf', 'vertrag.pdf',
 'other', 10, '28300000-0000-0000-0000-000000000001', '2026-03-01', null);
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  document_date, retention_class, filed_at, filed_by, deleted_at, deleted_by
) values
('28300000-0000-0000-0000-000000000043', '28300000-0000-0000-0000-000000000010',
 '28300000-0000-0000-0000-000000000010/d43/rechnung-2000.pdf', 'rechnung-2000.pdf', 'rechnung-2000.pdf',
 'invoice', 10, '28300000-0000-0000-0000-000000000001', '2000-01-10', 'ten_years', now(),
 '28300000-0000-0000-0000-000000000001', now(), '28300000-0000-0000-0000-000000000001');
insert into public.employee_records (id, organization_id, first_name, last_name) values
('28300000-0000-0000-0000-000000000090', '28300000-0000-0000-0000-000000000010', 'Paula', 'Personal');
insert into public.personnel_documents (organization_id, employee_record_id, document_id, document_type, access_class) values
('28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000090',
 '28300000-0000-0000-0000-000000000042', 'Arbeitsvertrag', 'personnel_standard');

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.file_document(uuid, uuid, uuid)',
    'public.update_document_retention(uuid, uuid, uuid, date, public.document_retention_class)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute')
      or has_function_privilege('anon', v_function, 'execute')
      or has_function_privilege('authenticated', v_function, 'execute')
    then raise exception '% is not executable by the service role alone', v_function; end if;
  end loop;
  if has_function_privilege('authenticated', 'app_private.lock_ordinary_document_for_retention(uuid, uuid, uuid)', 'execute')
    or (select bool_or(prosecdef) from pg_proc where oid in (
      'public.file_document(uuid, uuid, uuid)'::regprocedure,
      'public.update_document_retention(uuid, uuid, uuid, date, public.document_retention_class)'::regprocedure))
  then raise exception 'a retention write runs with more rights than its service-role caller'; end if;
  -- A client reads documents only through Realtime and RLS, which admit an
  -- assigned employee: the archive data never reaches that grant.
  foreach v_function in array array['document_date', 'retention_class', 'retention_ends_on', 'filed_at', 'filed_by'] loop
    if has_column_privilege('authenticated', 'public.documents', v_function, 'select')
      or has_column_privilege('anon', 'public.documents', v_function, 'select')
    then raise exception 'a client may read documents.%', v_function; end if;
  end loop;
  if not has_column_privilege('authenticated', 'public.documents', 'storage_path', 'select') then
    raise exception 'the client lost a document column it read before';
  end if;
  -- The migration's backfill keeps updated_at with the trigger off; it must
  -- leave the trigger on for every later write.
  if (select trigger.tgenabled from pg_trigger trigger
    where trigger.tgrelid = 'public.documents'::regclass and trigger.tgname = 'documents_set_updated_at') is distinct from 'O'
  then raise exception 'the backfill left documents_set_updated_at off'; end if;
end;
$$;

-- The backfill gives an existing original invoice, offer or contract the
-- class, and a copy none, as a copy made today gets none. A copy stays a copy
-- after its source is deleted: copy_document writes the `copied` event on the
-- copy's own id. 53 and 54 are invoices from before the class existed; 55
-- copies 53, 56 copies 54, and 54 is then deleted.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by
) values
('28300000-0000-0000-0000-000000000053', '28300000-0000-0000-0000-000000000010',
 '28300000-0000-0000-0000-000000000010/d53/rechnung-alt.pdf', 'rechnung-alt.pdf', 'rechnung-alt.pdf',
 'invoice', 10, '28300000-0000-0000-0000-000000000001'),
('28300000-0000-0000-0000-000000000054', '28300000-0000-0000-0000-000000000010',
 '28300000-0000-0000-0000-000000000010/d54/rechnung-weg.pdf', 'rechnung-weg.pdf', 'rechnung-weg.pdf',
 'invoice', 10, '28300000-0000-0000-0000-000000000001');
select public.copy_document(
  '28300000-0000-0000-0000-000000000001', '28300000-0000-0000-0000-000000000010',
  '28300000-0000-0000-0000-000000000053', '28300000-0000-0000-0000-000000000055', null,
  '28300000-0000-0000-0000-000000000010/d55/rechnung-alt.pdf', 'rechnung-alt (Kopie).pdf'
);
select public.copy_document(
  '28300000-0000-0000-0000-000000000001', '28300000-0000-0000-0000-000000000010',
  '28300000-0000-0000-0000-000000000054', '28300000-0000-0000-0000-000000000056', null,
  '28300000-0000-0000-0000-000000000010/d56/rechnung-weg.pdf', 'rechnung-weg (Kopie).pdf'
);
delete from public.documents where id = '28300000-0000-0000-0000-000000000054';

do $$
begin
  if (select copied_from_document_id from public.documents where id = '28300000-0000-0000-0000-000000000056') is not null
  then raise exception 'the copy of a deleted source still names its source'; end if;
  if app_private.existing_document_retention_class('28300000-0000-0000-0000-000000000053') is distinct from 'ten_years'
  then raise exception 'the backfill gives an existing original invoice no class'; end if;
  if app_private.existing_document_retention_class('28300000-0000-0000-0000-000000000055') is not null
  then raise exception 'the backfill gives an existing copy the class'; end if;
  if app_private.existing_document_retention_class('28300000-0000-0000-0000-000000000056') is not null
  then raise exception 'the backfill gives the copy of a deleted source the class'; end if;
  if has_function_privilege('service_role', 'app_private.existing_document_retention_class(uuid)', 'execute')
    or has_function_privilege('authenticated', 'app_private.existing_document_retention_class(uuid)', 'execute')
  then raise exception 'a client or the service role may run the backfill rule'; end if;
end;
$$;

set local role service_role;

-- The upload infers the class from the category; the document date is the upload's Berlin day.
do $$
declare
  v_org constant uuid := '28300000-0000-0000-0000-000000000010';
  v_admin constant uuid := '28300000-0000-0000-0000-000000000001';
  v_today constant date := (now() at time zone 'Europe/Berlin')::date;
  v_document public.documents;
begin
  v_document := public.finalize_document_upload(v_admin, v_org, '28300000-0000-0000-0000-000000000050',
    null, v_org || '/d50/rechnung.pdf', 'rechnung.pdf', 'rechnung.pdf', 'invoice', 'application/pdf', 20,
    null, null);
  if v_document.retention_class is distinct from 'ten_years' or v_document.document_date is distinct from v_today
    or v_document.retention_ends_on is distinct from make_date(extract(year from v_today)::integer + 10, 12, 31)
    or v_document.filed_at is not null
  then raise exception 'an uploaded invoice did not get the ten-year class from its upload day: %', row_to_json(v_document); end if;
  v_document := public.finalize_document_upload(v_admin, v_org, '28300000-0000-0000-0000-000000000051',
    null, v_org || '/d51/foto.jpg', 'foto.jpg', 'foto.jpg', 'photo', 'image/jpeg', 20, null, null);
  if v_document.retention_class is not null or v_document.retention_ends_on is not null then
    raise exception 'an uploaded photo got a retention period';
  end if;
  v_document := public.finalize_document_upload(v_admin, v_org, '28300000-0000-0000-0000-000000000052',
    null, v_org || '/d52/angebot.pdf', 'angebot.pdf', 'angebot.pdf', 'offer', 'application/pdf', 20, null, null);
  if v_document.retention_class is distinct from 'ten_years' then
    raise exception 'an uploaded offer did not get the ten-year class';
  end if;
end;
$$;

-- The retention end is the last day of the document date's year plus ten years, also at the year turn.
do $$
declare
  v_org constant uuid := '28300000-0000-0000-0000-000000000010';
  v_office constant uuid := '28300000-0000-0000-0000-000000000002';
  v_document public.documents;
begin
  v_document := public.update_document_retention(v_office, v_org, '28300000-0000-0000-0000-000000000052',
    '2025-12-31', 'ten_years');
  if v_document.retention_ends_on is distinct from '2035-12-31' then
    raise exception 'a document of 2025-12-31 is kept until %, not 2035-12-31', v_document.retention_ends_on;
  end if;
  v_document := public.update_document_retention(v_office, v_org, '28300000-0000-0000-0000-000000000052',
    '2026-01-01', 'ten_years');
  if v_document.retention_ends_on is distinct from '2036-12-31' then
    raise exception 'a document of 2026-01-01 is kept until %, not 2036-12-31', v_document.retention_ends_on;
  end if;
  -- The office moves a photo into the class and back out, each change audited.
  v_document := public.update_document_retention(v_office, v_org, '28300000-0000-0000-0000-000000000051',
    '2026-05-04', 'ten_years');
  v_document := public.update_document_retention(v_office, v_org, '28300000-0000-0000-0000-000000000051',
    '2026-05-04', null);
  if v_document.retention_class is not null
    or (select count(*) from public.document_audit_events
      where document_id = '28300000-0000-0000-0000-000000000051' and event_type = 'retention_changed') <> 2
    or not exists (select 1 from public.document_audit_events
      where document_id = '28300000-0000-0000-0000-000000000052' and event_type = 'retention_changed'
        and event_payload->>'fromDocumentDate' = '2025-12-31' and event_payload->>'toDocumentDate' = '2026-01-01')
  then raise exception 'a retention change was not recorded with its audit event'; end if;
end;
$$;

-- A document date outside 1900 to one year after today never starts or ends a
-- period: a paused partial year (20 for 2020) is refused; both bounds are taken.
select pg_temp.expect_refusal('a document date in the year 20', $sql$
  select public.update_document_retention('28300000-0000-0000-0000-000000000002',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000052', '0020-03-14', 'ten_years')
$sql$, 'document_date_out_of_range');
select pg_temp.expect_refusal('a document date before 1900', $sql$
  select public.update_document_retention('28300000-0000-0000-0000-000000000002',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000052', '1899-12-31', 'ten_years')
$sql$, 'document_date_out_of_range');
select pg_temp.expect_refusal('a document date more than a year ahead', $sql$
  select public.update_document_retention('28300000-0000-0000-0000-000000000002',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000052',
    ((now() at time zone 'Europe/Berlin')::date + interval '1 year' + interval '1 day')::date, 'ten_years')
$sql$, 'document_date_out_of_range');
do $$
declare
  v_org constant uuid := '28300000-0000-0000-0000-000000000010';
  v_office constant uuid := '28300000-0000-0000-0000-000000000002';
  v_latest constant date := ((now() at time zone 'Europe/Berlin')::date + interval '1 year')::date;
  v_document public.documents;
begin
  if (select document_date from public.documents where id = '28300000-0000-0000-0000-000000000052') is distinct from '2026-01-01'
  then raise exception 'a refused document date changed the document'; end if;
  v_document := public.update_document_retention(v_office, v_org, '28300000-0000-0000-0000-000000000052',
    '1900-01-01', 'ten_years');
  v_document := public.update_document_retention(v_office, v_org, '28300000-0000-0000-0000-000000000052',
    v_latest, 'ten_years');
  if v_document.document_date is distinct from v_latest then
    raise exception 'the latest allowed document date % was not saved', v_latest;
  end if;
end;
$$;

-- Who may not file or reclassify.
select pg_temp.expect_refusal('filing by an employee', $sql$
  select public.file_document('28300000-0000-0000-0000-000000000003',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000050')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('reclassification by an employee', $sql$
  select public.update_document_retention('28300000-0000-0000-0000-000000000003',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000050', '2026-01-01', null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('filing by another organization''s admin', $sql$
  select public.file_document('28300000-0000-0000-0000-000000000004',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000050')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('filing of a foreign document', $sql$
  select public.file_document('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000041')
$sql$, 'document_not_found');
select pg_temp.expect_refusal('reclassification of a foreign document', $sql$
  select public.update_document_retention('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000041', '2026-01-01', null)
$sql$, 'document_not_found');
select pg_temp.expect_refusal('filing of a personnel document by the office', $sql$
  select public.file_document('28300000-0000-0000-0000-000000000002',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000042')
$sql$, 'protected_document_boundary');
select pg_temp.expect_refusal('reclassification of a personnel document by the office', $sql$
  select public.update_document_retention('28300000-0000-0000-0000-000000000002',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000042', '2026-01-01', 'ten_years')
$sql$, 'protected_document_boundary');
do $$
begin
  if exists (select 1 from public.documents where id in (
      '28300000-0000-0000-0000-000000000041', '28300000-0000-0000-0000-000000000042',
      '28300000-0000-0000-0000-000000000050') and filed_at is not null)
    or (select retention_class from public.documents where id = '28300000-0000-0000-0000-000000000050')
      is distinct from 'ten_years'
  then raise exception 'a refused filing or reclassification changed a document'; end if;
end;
$$;

-- The office files the invoice; filing is audited and final.
do $$
declare
  v_org constant uuid := '28300000-0000-0000-0000-000000000010';
  v_office constant uuid := '28300000-0000-0000-0000-000000000002';
  v_document public.documents;
begin
  v_document := public.file_document(v_office, v_org, '28300000-0000-0000-0000-000000000050');
  if v_document.filed_at is null or v_document.filed_by is distinct from v_office
    or not exists (select 1 from public.document_audit_events
      where document_id = v_document.id and event_type = 'filed' and actor_id = v_office
        and event_payload->>'retentionEndsOn' = v_document.retention_ends_on::text)
  then raise exception 'filing did not record the filed state with its audit event'; end if;
end;
$$;

select pg_temp.expect_refusal('second filing', $sql$
  select public.file_document('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000050')
$sql$, 'document_filed');
select pg_temp.expect_refusal('new version of a filed document', $sql$
  select public.finalize_document_version_upload('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000050', 1,
    '28300000-0000-0000-0000-000000000010/d50/versions/2-rechnung.pdf', 'rechnung.pdf', 'application/pdf', 30)
$sql$, 'document_filed');
select pg_temp.expect_refusal('trash of a filed document', $sql$
  select public.trash_document('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000050')
$sql$, 'document_filed');
select pg_temp.expect_refusal('reclassification of a filed document', $sql$
  select public.update_document_retention('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000050', '2020-01-01', null)
$sql$, 'document_filed');
select pg_temp.expect_refusal('permanent deletion of a filed document after its period', $sql$
  select public.permanently_delete_document('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000043')
$sql$, 'document_filed');
-- The table refuses every path, not only the functions.
select pg_temp.expect_refusal('byte replacement of a filed document', $sql$
  update public.documents set storage_path = storage_path || '.replaced', size_bytes = 99
  where id = '28300000-0000-0000-0000-000000000050'
$sql$, 'document_filed');
select pg_temp.expect_refusal('unfiling of a filed document', $sql$
  update public.documents set filed_at = null, filed_by = null where id = '28300000-0000-0000-0000-000000000050'
$sql$, 'document_filed');
select pg_temp.expect_refusal('row deletion of a filed document', $sql$
  delete from public.documents where id = '28300000-0000-0000-0000-000000000050'
$sql$, 'document_filed');

-- Rename, move and category label of a filed document stay possible and audited.
do $$
declare
  v_org constant uuid := '28300000-0000-0000-0000-000000000010';
  v_admin constant uuid := '28300000-0000-0000-0000-000000000001';
  v_document public.documents;
begin
  v_document := public.rename_document(v_admin, v_org, '28300000-0000-0000-0000-000000000050', 'Rechnung 1.pdf');
  v_document := public.update_document_category(v_admin, v_org, '28300000-0000-0000-0000-000000000050', 'other');
  v_document := public.move_document(v_admin, v_org, '28300000-0000-0000-0000-000000000050',
    '28300000-0000-0000-0000-000000000030', 'Rechnung 1.pdf');
end;
$$;
do $$
declare
  v_document public.documents;
begin
  select * into v_document from public.documents where id = '28300000-0000-0000-0000-000000000050';
  if v_document.display_name is distinct from 'Rechnung 1.pdf' or v_document.category is distinct from 'other'
    or v_document.folder_id is distinct from '28300000-0000-0000-0000-000000000030'
    or v_document.filed_at is null or v_document.storage_path is distinct from v_document.organization_id || '/d50/rechnung.pdf'
    or (select count(*) from public.document_audit_events where document_id = v_document.id
      and event_type in ('renamed', 'category_changed', 'moved')) <> 3
  then raise exception 'a filed document refused its rename or category label'; end if;
end;
$$;

-- Early deletion: an unfiled invoice inside its period goes to the trash but
-- is never deleted permanently; one whose period ended and a photo are.
do $$
declare
  v_org constant uuid := '28300000-0000-0000-0000-000000000010';
  v_admin constant uuid := '28300000-0000-0000-0000-000000000001';
begin
  perform public.trash_document(v_admin, v_org, '28300000-0000-0000-0000-000000000052');
  perform pg_temp.expect_refusal('permanent deletion inside the period', $sql$
    select public.permanently_delete_document('28300000-0000-0000-0000-000000000001',
      '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000052')
  $sql$, 'retention_period_running');
  if not exists (select 1 from public.documents where id = '28300000-0000-0000-0000-000000000052') then
    raise exception 'a refused early deletion removed the document';
  end if;
  perform public.trash_document(v_admin, v_org, '28300000-0000-0000-0000-000000000040');
  perform public.permanently_delete_document(v_admin, v_org, '28300000-0000-0000-0000-000000000040');
  perform public.trash_document(v_admin, v_org, '28300000-0000-0000-0000-000000000051');
  perform public.permanently_delete_document(v_admin, v_org, '28300000-0000-0000-0000-000000000051');
  if exists (select 1 from public.documents where id in (
    '28300000-0000-0000-0000-000000000040', '28300000-0000-0000-0000-000000000051'))
  then raise exception 'a document outside any running period was not deleted'; end if;
end;
$$;
-- The last day of the period still counts.
reset role;
update public.documents set document_date = make_date(
  extract(year from (now() at time zone 'Europe/Berlin')::date)::integer - 10, 1, 1)
where id = '28300000-0000-0000-0000-000000000052';
set local role service_role;
select pg_temp.expect_refusal('permanent deletion on the last day of the period', $sql$
  select public.permanently_delete_document('28300000-0000-0000-0000-000000000001',
    '28300000-0000-0000-0000-000000000010', '28300000-0000-0000-0000-000000000052')
$sql$, 'retention_period_running');

-- A former Büro member who filed a document keeps their account as long as the
-- document exists, as a former uploader does: the profile, the filer and the
-- actor of the `filed` event stay.
reset role;
delete from public.organization_members
where organization_id = '28300000-0000-0000-0000-000000000010'
  and user_id = '28300000-0000-0000-0000-000000000002';
select pg_temp.expect_refusal('account deletion of a former filer', $sql$
  delete from auth.users where id = '28300000-0000-0000-0000-000000000002'
$sql$, 'update or delete on table "profiles" violates foreign key constraint "documents_filed_by_fkey" on table "documents"');
do $$
begin
  if not exists (select 1 from public.profiles where id = '28300000-0000-0000-0000-000000000002')
    or (select filed_by from public.documents where id = '28300000-0000-0000-0000-000000000050')
      is distinct from '28300000-0000-0000-0000-000000000002'
    or not exists (select 1 from public.document_audit_events
      where document_id = '28300000-0000-0000-0000-000000000050' and event_type = 'filed'
        and actor_id = '28300000-0000-0000-0000-000000000002')
  then raise exception 'a refused account deletion lost the filer of a filed document'; end if;
end;
$$;

rollback;
