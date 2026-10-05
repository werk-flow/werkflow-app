-- Document writes that touch several rows apply completely or not at all
-- (migrations 20261004140000_write_document_uploads_and_links_atomically.sql,
-- 20261004140100_write_document_changes_with_their_audit_events.sql and
-- 20261004140200_export_work_artifacts_atomically.sql): a refusal of a later
-- step leaves no document, link, folder or audit event behind. The functions
-- refuse a foreign organization, a field worker outside the assigned job,
-- and, by owner decision, a field worker's export of a project artifact.
-- Only the service role executes them.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26140000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-writes-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Documents"}', now(), now()),
('26140000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-writes-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Documents"}', now(), now()),
('26140000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-writes-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Documents"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('26140000-0000-0000-0000-000000000010', 'Document writes SQL',
 '26140000-0000-0000-0000-000000000001', 'DOCWSQLA'),
('26140000-0000-0000-0000-000000000011', 'Document writes SQL outsider',
 '26140000-0000-0000-0000-000000000003', 'DOCWSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000002', 'employee');

insert into public.projects (id, organization_id, name, created_by) values
('26140000-0000-0000-0000-000000000020', '26140000-0000-0000-0000-000000000010',
 'Dokumentprojekt', '26140000-0000-0000-0000-000000000001');
insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
('26140000-0000-0000-0000-000000000021', '26140000-0000-0000-0000-000000000010',
 '26140000-0000-0000-0000-000000000020', 'Projektauftrag', 'DOCW-1', '26140000-0000-0000-0000-000000000001'),
('26140000-0000-0000-0000-000000000022', '26140000-0000-0000-0000-000000000010',
 null, 'Einzelauftrag', 'DOCW-2', '26140000-0000-0000-0000-000000000001'),
('26140000-0000-0000-0000-000000000023', '26140000-0000-0000-0000-000000000011',
 null, 'Fremder Auftrag', 'DOCW-3', '26140000-0000-0000-0000-000000000003');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000021',
 '26140000-0000-0000-0000-000000000002', '26140000-0000-0000-0000-000000000001'),
('26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000022',
 '26140000-0000-0000-0000-000000000002', '26140000-0000-0000-0000-000000000001');
insert into public.clients (id, organization_id, name) values
('26140000-0000-0000-0000-000000000024', '26140000-0000-0000-0000-000000000010', 'Kunde Dokumente');

-- A folder tree Root > Child with one document each, and a document at the library root.
insert into public.document_folders (id, organization_id, parent_folder_id, name, created_by) values
('26140000-0000-0000-0000-000000000030', '26140000-0000-0000-0000-000000000010', null, 'Ordner',
 '26140000-0000-0000-0000-000000000001'),
('26140000-0000-0000-0000-000000000031', '26140000-0000-0000-0000-000000000010',
 '26140000-0000-0000-0000-000000000030', 'Unterordner', '26140000-0000-0000-0000-000000000001');
insert into public.documents (
  id, organization_id, folder_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by
) values
('26140000-0000-0000-0000-000000000040', '26140000-0000-0000-0000-000000000010',
 '26140000-0000-0000-0000-000000000030', '26140000-0000-0000-0000-000000000010/d40/plan.pdf', 'plan.pdf',
 'plan.pdf', 'contract', 10, '26140000-0000-0000-0000-000000000001'),
('26140000-0000-0000-0000-000000000041', '26140000-0000-0000-0000-000000000010',
 '26140000-0000-0000-0000-000000000031', '26140000-0000-0000-0000-000000000010/d41/foto.jpg', 'foto.jpg',
 'foto.jpg', 'photo', 10, '26140000-0000-0000-0000-000000000001'),
('26140000-0000-0000-0000-000000000042', '26140000-0000-0000-0000-000000000010',
 null, '26140000-0000-0000-0000-000000000010/d42/angebot.pdf', 'angebot.pdf',
 'angebot.pdf', 'offer', 10, '26140000-0000-0000-0000-000000000001'),
('26140000-0000-0000-0000-000000000043', '26140000-0000-0000-0000-000000000011',
 null, '26140000-0000-0000-0000-000000000011/d43/fremd.pdf', 'fremd.pdf',
 'fremd.pdf', 'offer', 10, '26140000-0000-0000-0000-000000000003');
insert into public.document_links (organization_id, document_id, client_id, created_by) values
('26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000042',
 '26140000-0000-0000-0000-000000000024', '26140000-0000-0000-0000-000000000001');

-- Runs one call and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- A refusal of the last step of a write: the test arms it on a table and a
-- marker value, and the write must then leave nothing behind.
create table pg_temp.refused_last_step (marker text primary key);
grant select on pg_temp.refused_last_step to service_role;
create function pg_temp.refuse_marked_write() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from pg_temp.refused_last_step where marker = tg_table_name) then
    raise exception 'refused_last_step';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger refuse_marked_audit before insert on public.document_audit_events
  for each row execute function pg_temp.refuse_marked_write();
create trigger refuse_marked_folder before update on public.document_folders
  for each row execute function pg_temp.refuse_marked_write();

set local role service_role;

-- Upload: the document, its link and both audit events, or nothing.
do $$
declare
  v_org constant uuid := '26140000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26140000-0000-0000-0000-000000000001';
  v_employee constant uuid := '26140000-0000-0000-0000-000000000002';
  v_document public.documents;
begin
  v_document := public.finalize_document_upload(v_admin, v_org, '26140000-0000-0000-0000-000000000050',
    null, v_org || '/d50/bericht.pdf', 'bericht.pdf', ' bericht.pdf ', 'report', 'application/pdf', 20,
    'job', '26140000-0000-0000-0000-000000000022');
  if v_document.display_name <> 'bericht.pdf'
    or not exists (select 1 from public.document_links where document_id = v_document.id
      and job_id = '26140000-0000-0000-0000-000000000022')
    or (select array_agg(event_type order by event_type) from public.document_audit_events
      where document_id = v_document.id) <> array['linked', 'uploaded']
  then raise exception 'the upload did not write the document, its link and both audit events'; end if;

  -- The field worker uploads to the assigned job, never to the project or a folder.
  perform public.finalize_document_upload(v_employee, v_org, '26140000-0000-0000-0000-000000000051',
    null, v_org || '/d51/foto.jpg', 'foto.jpg', 'foto.jpg', 'photo', 'image/jpeg', 20,
    'job', '26140000-0000-0000-0000-000000000021');
end;
$$;

select pg_temp.expect_refusal('upload linked to a foreign job', $sql$
  select public.finalize_document_upload('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000052', null,
    '26140000-0000-0000-0000-000000000010/d52/a.pdf', 'a.pdf', 'a.pdf', 'other', null, 1,
    'job', '26140000-0000-0000-0000-000000000023')
$sql$, 'link_failed');
select pg_temp.expect_refusal('upload by a field worker to the project', $sql$
  select public.finalize_document_upload('26140000-0000-0000-0000-000000000002',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000052', null,
    '26140000-0000-0000-0000-000000000010/d52/a.pdf', 'a.pdf', 'a.pdf', 'other', null, 1,
    'project', '26140000-0000-0000-0000-000000000020')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('upload by a field worker into a folder', $sql$
  select public.finalize_document_upload('26140000-0000-0000-0000-000000000002',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000052',
    '26140000-0000-0000-0000-000000000030', '26140000-0000-0000-0000-000000000010/d52/a.pdf', 'a.pdf',
    'a.pdf', 'other', null, 1, 'job', '26140000-0000-0000-0000-000000000022')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('upload by another organization''s admin', $sql$
  select public.finalize_document_upload('26140000-0000-0000-0000-000000000003',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000052', null,
    '26140000-0000-0000-0000-000000000010/d52/a.pdf', 'a.pdf', 'a.pdf', 'other', null, 1, null, null)
$sql$, 'not_a_member');
select pg_temp.expect_refusal('second finalize of one upload', $sql$
  select public.finalize_document_upload('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000050', null,
    '26140000-0000-0000-0000-000000000010/d50/bericht.pdf', 'bericht.pdf', 'bericht (1).pdf', 'report',
    null, 1, null, null)
$sql$, 'already_finalized');
reset role;
insert into pg_temp.refused_last_step values ('document_audit_events');
set local role service_role;
select pg_temp.expect_refusal('upload whose audit event is refused', $sql$
  select public.finalize_document_upload('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000052', null,
    '26140000-0000-0000-0000-000000000010/d52/a.pdf', 'a.pdf', 'a.pdf', 'other', null, 1,
    'client', '26140000-0000-0000-0000-000000000024')
$sql$, 'refused_last_step');
reset role;
delete from pg_temp.refused_last_step;
set local role service_role;
do $$
begin
  if exists (select 1 from public.documents where id = '26140000-0000-0000-0000-000000000052')
    or exists (select 1 from public.document_links where document_id = '26140000-0000-0000-0000-000000000052')
    or exists (select 1 from public.document_audit_events
      where document_id = '26140000-0000-0000-0000-000000000052')
  then raise exception 'a refused upload left a document, link or audit event behind'; end if;
end;
$$;

-- Version upload: the archived version, the new current file and the audit event, or nothing.
do $$
declare
  v_org constant uuid := '26140000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26140000-0000-0000-0000-000000000001';
  v_document public.documents;
begin
  v_document := public.finalize_document_version_upload(v_admin, v_org,
    '26140000-0000-0000-0000-000000000040', 1, v_org || '/d40/versions/2-plan.pdf', 'plan.pdf',
    'application/pdf', 30);
  if v_document.current_version_number <> 2 or v_document.storage_path <> v_org || '/d40/versions/2-plan.pdf'
    or not exists (select 1 from public.document_versions
      where document_id = v_document.id and version_number = 1 and storage_path = v_org || '/d40/plan.pdf')
    or not exists (select 1 from public.document_audit_events
      where document_id = v_document.id and event_type = 'version_uploaded')
  then raise exception 'the version upload did not archive, replace and record'; end if;
end;
$$;
select pg_temp.expect_refusal('version upload on a stale version', $sql$
  select public.finalize_document_version_upload('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000040', 1,
    '26140000-0000-0000-0000-000000000010/d40/versions/2-other.pdf', 'other.pdf', null, 30)
$sql$, 'version_conflict');
select pg_temp.expect_refusal('version upload of a photo', $sql$
  select public.finalize_document_version_upload('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000041', 1,
    '26140000-0000-0000-0000-000000000010/d41/versions/2-foto.jpg', 'foto.jpg', null, 30)
$sql$, 'versioning_not_supported');
select pg_temp.expect_refusal('version upload of a foreign document', $sql$
  select public.finalize_document_version_upload('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000043', 1,
    '26140000-0000-0000-0000-000000000010/d43/versions/2-fremd.pdf', 'fremd.pdf', null, 30)
$sql$, 'document_not_found');
reset role;
insert into pg_temp.refused_last_step values ('document_audit_events');
set local role service_role;
select pg_temp.expect_refusal('version upload whose audit event is refused', $sql$
  select public.finalize_document_version_upload('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000040', 2,
    '26140000-0000-0000-0000-000000000010/d40/versions/3-plan.pdf', 'plan.pdf', null, 30)
$sql$, 'refused_last_step');
reset role;
delete from pg_temp.refused_last_step;
set local role service_role;
do $$
begin
  if (select current_version_number from public.documents where id = '26140000-0000-0000-0000-000000000040') <> 2
    or exists (select 1 from public.document_versions
      where document_id = '26140000-0000-0000-0000-000000000040' and version_number = 2)
  then raise exception 'a refused version upload archived or replaced the file'; end if;
end;
$$;

-- Links: removals and additions with their audit events, or none of them.
do $$
declare
  v_org constant uuid := '26140000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26140000-0000-0000-0000-000000000001';
  v_client_link uuid;
  v_counts record;
begin
  select id into v_client_link from public.document_links
  where document_id = '26140000-0000-0000-0000-000000000042';
  perform pg_temp.expect_refusal('link change with a foreign job last', format($sql$
    select public.update_document_links(%L, %L, %L, array[%L]::uuid[],
      array['26140000-0000-0000-0000-000000000022', '26140000-0000-0000-0000-000000000023']::uuid[],
      null, null, null, null, null, null)
  $sql$, v_admin, v_org, '26140000-0000-0000-0000-000000000042', v_client_link),
    'document link job must belong to the same organization');
  if not exists (select 1 from public.document_links where id = v_client_link)
    or exists (select 1 from public.document_links where document_id = '26140000-0000-0000-0000-000000000042'
      and job_id is not null)
    or exists (select 1 from public.document_audit_events
      where document_id = '26140000-0000-0000-0000-000000000042')
  then raise exception 'a refused link change removed or added a link'; end if;
  perform pg_temp.expect_refusal('removal of another document''s link', format($sql$
    select public.update_document_links(%L, %L, %L, array[%L]::uuid[], null, null, null, null, null, null, null)
  $sql$, v_admin, v_org, '26140000-0000-0000-0000-000000000040', v_client_link), 'link_not_found');

  select * into v_counts from public.update_document_links(v_admin, v_org,
    '26140000-0000-0000-0000-000000000042', array[v_client_link],
    array['26140000-0000-0000-0000-000000000022']::uuid[], array['26140000-0000-0000-0000-000000000020']::uuid[],
    null, null, null, null, null);
  if v_counts.added_count <> 2 or v_counts.removed_count <> 1
    or exists (select 1 from public.document_links where id = v_client_link)
    or (select count(*) from public.document_links where document_id = '26140000-0000-0000-0000-000000000042') <> 2
    or (select array_agg(event_type order by event_type) from public.document_audit_events
      where document_id = '26140000-0000-0000-0000-000000000042') <> array['linked', 'linked', 'unlinked']
  then raise exception 'the link change did not apply with its audit events'; end if;
  -- An existing link counts as added without a second event.
  select * into v_counts from public.update_document_links(v_admin, v_org,
    '26140000-0000-0000-0000-000000000042', null, array['26140000-0000-0000-0000-000000000022']::uuid[],
    null, null, null, null, null, null);
  if v_counts.added_count <> 1 or (select count(*) from public.document_audit_events
      where document_id = '26140000-0000-0000-0000-000000000042') <> 3
  then raise exception 'an existing link was linked twice'; end if;
end;
$$;
select pg_temp.expect_refusal('link change by a field worker', $sql$
  select public.update_document_links('26140000-0000-0000-0000-000000000002',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000042', null,
    array['26140000-0000-0000-0000-000000000021']::uuid[], null, null, null, null, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('link change on a foreign document', $sql$
  select public.update_document_links('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000043', null,
    array['26140000-0000-0000-0000-000000000022']::uuid[], null, null, null, null, null, null)
$sql$, 'document_not_found');

-- Changes of one document: the row and its audit event, or neither.
do $$
declare
  v_org constant uuid := '26140000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26140000-0000-0000-0000-000000000001';
  v_document public.documents;
  v_paths text[];
begin
  v_document := public.rename_document(v_admin, v_org, '26140000-0000-0000-0000-000000000042', 'Angebot.pdf');
  v_document := public.update_document_category(v_admin, v_org, '26140000-0000-0000-0000-000000000042', 'invoice');
  v_document := public.move_document(v_admin, v_org, '26140000-0000-0000-0000-000000000042',
    '26140000-0000-0000-0000-000000000030', 'Angebot.pdf');
  v_document := public.copy_document(v_admin, v_org, '26140000-0000-0000-0000-000000000042',
    '26140000-0000-0000-0000-000000000053', null, v_org || '/d53/angebot.pdf', 'Kopie von Angebot.pdf');
  perform public.trash_document(v_admin, v_org, '26140000-0000-0000-0000-000000000053');
  perform public.restore_document(v_admin, v_org, '26140000-0000-0000-0000-000000000053', 'Kopie von Angebot.pdf');
  perform public.trash_document(v_admin, v_org, '26140000-0000-0000-0000-000000000053');
  v_paths := public.permanently_delete_document(v_admin, v_org, '26140000-0000-0000-0000-000000000053');
  if v_paths <> array[v_org || '/d53/angebot.pdf']
    or exists (select 1 from public.documents where id = '26140000-0000-0000-0000-000000000053')
  then raise exception 'the permanent deletion did not return the object paths'; end if;
  select * into v_document from public.documents where id = '26140000-0000-0000-0000-000000000042';
  if v_document.display_name <> 'Angebot.pdf' or v_document.category <> 'invoice'
    or v_document.folder_id <> '26140000-0000-0000-0000-000000000030'
    or (select count(*) from public.document_audit_events where document_id = v_document.id
      and event_type in ('renamed', 'category_changed', 'moved')) <> 3
    or (select array_agg(event_type order by created_at, event_type) from public.document_audit_events
      where event_payload->>'documentId' = '26140000-0000-0000-0000-000000000053'
        or event_payload->>'copiedFromDocumentId' = v_document.id::text)
      <> array['copied', 'permanently_deleted']
  then raise exception 'a document change was not recorded with its audit event'; end if;
end;
$$;
select pg_temp.expect_refusal('rename of a foreign document', $sql$
  select public.rename_document('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000043', 'x.pdf')
$sql$, 'document_not_found');
select pg_temp.expect_refusal('rename by a field worker', $sql$
  select public.rename_document('26140000-0000-0000-0000-000000000002',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000042', 'x.pdf')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('move into the same folder', $sql$
  select public.move_document('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000042',
    '26140000-0000-0000-0000-000000000030', 'Angebot.pdf')
$sql$, 'invalid_target');
reset role;
insert into pg_temp.refused_last_step values ('document_audit_events');
set local role service_role;
select pg_temp.expect_refusal('rename whose audit event is refused', $sql$
  select public.rename_document('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000042', 'Neu.pdf')
$sql$, 'refused_last_step');
select pg_temp.expect_refusal('trash whose audit event is refused', $sql$
  select public.trash_document('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000042')
$sql$, 'refused_last_step');
reset role;
delete from pg_temp.refused_last_step;
set local role service_role;
do $$
begin
  if (select display_name from public.documents where id = '26140000-0000-0000-0000-000000000042') <> 'Angebot.pdf'
    or (select deleted_at from public.documents where id = '26140000-0000-0000-0000-000000000042') is not null
  then raise exception 'a refused change kept its row change'; end if;
end;
$$;

-- Folder copy: every planned folder, document and audit event, or none.
select pg_temp.expect_refusal('folder copy with a foreign source document', $sql$
  select public.copy_document_folder('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000030', null,
    '[{"id":"26140000-0000-0000-0000-000000000060","parentFolderId":null,"name":"Kopie von Ordner"}]',
    '[{"id":"26140000-0000-0000-0000-000000000061","sourceDocumentId":"26140000-0000-0000-0000-000000000043",
       "folderId":"26140000-0000-0000-0000-000000000060",
       "storagePath":"26140000-0000-0000-0000-000000000010/d61/fremd.pdf","displayName":"Kopie von fremd.pdf"}]')
$sql$, 'document_not_found');
select pg_temp.expect_refusal('folder copy with a folder outside the copy', $sql$
  select public.copy_document_folder('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000030', null,
    '[{"id":"26140000-0000-0000-0000-000000000060","parentFolderId":null,"name":"Kopie von Ordner"},
      {"id":"26140000-0000-0000-0000-000000000062","parentFolderId":"26140000-0000-0000-0000-000000000031",
       "name":"Kopie von Unterordner"}]', '[]')
$sql$, 'invalid_target');
select pg_temp.expect_refusal('folder copy whose second document name is taken', $sql$
  select public.copy_document_folder('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000030', null,
    '[{"id":"26140000-0000-0000-0000-000000000060","parentFolderId":null,"name":"Kopie von Ordner"}]',
    '[{"id":"26140000-0000-0000-0000-000000000061","sourceDocumentId":"26140000-0000-0000-0000-000000000040",
       "folderId":"26140000-0000-0000-0000-000000000060",
       "storagePath":"26140000-0000-0000-0000-000000000010/d61/plan.pdf","displayName":"Gleich.pdf"},
      {"id":"26140000-0000-0000-0000-000000000063","sourceDocumentId":"26140000-0000-0000-0000-000000000041",
       "folderId":"26140000-0000-0000-0000-000000000060",
       "storagePath":"26140000-0000-0000-0000-000000000010/d63/foto.jpg","displayName":"gleich.pdf"}]')
$sql$, 'duplicate key value violates unique constraint "documents_unique_active_folder_name_idx"');
do $$
declare
  v_folder public.document_folders;
begin
  if exists (select 1 from public.document_folders where id = '26140000-0000-0000-0000-000000000060')
    or exists (select 1 from public.documents where id = '26140000-0000-0000-0000-000000000061')
  then raise exception 'a refused folder copy left a folder or document behind'; end if;
  v_folder := public.copy_document_folder('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000030', null,
    '[{"id":"26140000-0000-0000-0000-000000000060","parentFolderId":null,"name":"Kopie von Ordner"},
      {"id":"26140000-0000-0000-0000-000000000062","parentFolderId":"26140000-0000-0000-0000-000000000060",
       "name":"Kopie von Unterordner"}]',
    '[{"id":"26140000-0000-0000-0000-000000000061","sourceDocumentId":"26140000-0000-0000-0000-000000000041",
       "folderId":"26140000-0000-0000-0000-000000000062",
       "storagePath":"26140000-0000-0000-0000-000000000010/d61/foto.jpg","displayName":"Kopie von foto.jpg"}]');
  if v_folder.id <> '26140000-0000-0000-0000-000000000060'
    or (select folder_id from public.documents where id = '26140000-0000-0000-0000-000000000061')
      <> '26140000-0000-0000-0000-000000000062'
    or (select count(*) from public.document_audit_events where event_type = 'copied'
      and (folder_id = '26140000-0000-0000-0000-000000000060'
        or document_id = '26140000-0000-0000-0000-000000000061')) <> 2
  then raise exception 'the folder copy did not write its folders, document and audit events'; end if;
end;
$$;

-- Folder deletion: every document of the subtree with its audit event and
-- every folder, or nothing.
reset role;
insert into pg_temp.refused_last_step values ('document_folders');
set local role service_role;
select pg_temp.expect_refusal('folder deletion whose folder update is refused', $sql$
  select public.delete_document_folder('26140000-0000-0000-0000-000000000001',
    '26140000-0000-0000-0000-000000000010', '26140000-0000-0000-0000-000000000030')
$sql$, 'refused_last_step');
reset role;
delete from pg_temp.refused_last_step;
set local role service_role;
do $$
declare
  v_org constant uuid := '26140000-0000-0000-0000-000000000010';
  v_trashed integer;
begin
  if exists (select 1 from public.documents where folder_id in (
      '26140000-0000-0000-0000-000000000030', '26140000-0000-0000-0000-000000000031') and deleted_at is not null)
  then raise exception 'a refused folder deletion trashed documents'; end if;
  perform pg_temp.expect_refusal('deletion of a foreign folder', format($sql$
    select public.delete_document_folder(%L, %L, '26140000-0000-0000-0000-000000000030')
  $sql$, '26140000-0000-0000-0000-000000000003', '26140000-0000-0000-0000-000000000011'), 'folder_not_found');
  v_trashed := public.delete_document_folder('26140000-0000-0000-0000-000000000001', v_org,
    '26140000-0000-0000-0000-000000000030');
  if v_trashed <> 3
    or exists (select 1 from public.document_folders where id in (
      '26140000-0000-0000-0000-000000000030', '26140000-0000-0000-0000-000000000031') and deleted_at is null)
    or (select count(*) from public.document_audit_events where event_type = 'deleted'
      and folder_id = '26140000-0000-0000-0000-000000000030') <> 3
  then raise exception 'the folder deletion did not trash its subtree with the audit events'; end if;
end;
$$;

-- Export: the report document, its link, the artifact relation and action and
-- the audit event, or nothing. A field worker exports an assigned job's
-- artifact, never a project artifact.
do $$
declare
  v_org constant uuid := '26140000-0000-0000-0000-000000000010';
  v_admin constant uuid := '26140000-0000-0000-0000-000000000001';
  v_employee constant uuid := '26140000-0000-0000-0000-000000000002';
  v_result jsonb;
begin
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => '26140000-0000-0000-0000-000000000070',
    p_revision_id => '26140000-0000-0000-0000-000000000071', p_job_id => null,
    p_project_id => '26140000-0000-0000-0000-000000000020', p_kind => 'work_report',
    p_visibility => 'internal_only', p_title => 'Projektbericht',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_admin);
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => '26140000-0000-0000-0000-000000000072',
    p_revision_id => '26140000-0000-0000-0000-000000000073', p_job_id => '26140000-0000-0000-0000-000000000022',
    p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only', p_title => 'Auftragsbericht',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_employee);

  perform pg_temp.expect_refusal('project export by a field worker', format($sql$
    select public.export_work_artifact(%L, %L, '26140000-0000-0000-0000-000000000070',
      '26140000-0000-0000-0000-000000000071', '26140000-0000-0000-0000-000000000074',
      '26140000-0000-0000-0000-000000000075',
      (select version from public.work_artifacts where id = '26140000-0000-0000-0000-000000000070'),
      '26140000-0000-0000-0000-000000000076', %L, 'bericht.html', 10, 'v1', repeat('a', 64))
  $sql$, v_org, v_employee, v_org || '/work-artifact-exports/71/v1-a.html'), 'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('project finalize by a field worker', format($sql$
    select public.finalize_work_artifact_export(%L, %L, '26140000-0000-0000-0000-000000000070',
      '26140000-0000-0000-0000-000000000071', '26140000-0000-0000-0000-000000000074',
      '26140000-0000-0000-0000-000000000075',
      (select version from public.work_artifacts where id = '26140000-0000-0000-0000-000000000070'),
      '26140000-0000-0000-0000-000000000040', 'v1', repeat('a', 64))
  $sql$, v_org, v_employee), 'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('export on a stale version', format($sql$
    select public.export_work_artifact(%L, %L, '26140000-0000-0000-0000-000000000070',
      '26140000-0000-0000-0000-000000000071', '26140000-0000-0000-0000-000000000074',
      '26140000-0000-0000-0000-000000000075', 99,
      '26140000-0000-0000-0000-000000000076', %L, 'bericht.html', 10, 'v1', repeat('a', 64))
  $sql$, v_org, v_admin, v_org || '/work-artifact-exports/71/v1-a.html'), 'work_artifact_stale_version');
  perform pg_temp.expect_refusal('export by another organization', format($sql$
    select public.export_work_artifact(%L, %L, '26140000-0000-0000-0000-000000000070',
      '26140000-0000-0000-0000-000000000071', '26140000-0000-0000-0000-000000000074',
      '26140000-0000-0000-0000-000000000075', 1,
      '26140000-0000-0000-0000-000000000076', %L, 'bericht.html', 10, 'v1', repeat('a', 64))
  $sql$, '26140000-0000-0000-0000-000000000011', '26140000-0000-0000-0000-000000000003',
    '26140000-0000-0000-0000-000000000011/work-artifact-exports/71/v1-a.html'), 'work_artifact_not_found');
  if exists (select 1 from public.documents where id = '26140000-0000-0000-0000-000000000076')
    or exists (select 1 from public.document_links where document_id = '26140000-0000-0000-0000-000000000076')
  then raise exception 'a refused export left its document or link behind'; end if;

  v_result := public.export_work_artifact(v_org, v_admin, '26140000-0000-0000-0000-000000000070',
    '26140000-0000-0000-0000-000000000071', '26140000-0000-0000-0000-000000000074',
    '26140000-0000-0000-0000-000000000075',
    (select version from public.work_artifacts where id = '26140000-0000-0000-0000-000000000070'),
    '26140000-0000-0000-0000-000000000076', v_org || '/work-artifact-exports/71/v1-a.html', 'bericht.html',
    10, 'v1', repeat('a', 64));
  if (v_result->>'documentId')::uuid <> '26140000-0000-0000-0000-000000000076'
    or (v_result->>'duplicate')::boolean
    or not exists (select 1 from public.document_links where document_id = '26140000-0000-0000-0000-000000000076'
      and project_id = '26140000-0000-0000-0000-000000000020')
    or not exists (select 1 from public.work_artifact_revision_documents
      where document_id = '26140000-0000-0000-0000-000000000076' and relation = 'rendered_export')
    or not exists (select 1 from public.work_artifact_actions
      where artifact_id = '26140000-0000-0000-0000-000000000070' and action_type = 'exported')
    or not exists (select 1 from public.document_audit_events
      where document_id = '26140000-0000-0000-0000-000000000076' and event_type = 'uploaded')
  then raise exception 'the export did not write its document, link, relation, action and audit event'; end if;
  -- The same content again returns the committed export and writes nothing.
  v_result := public.export_work_artifact(v_org, v_admin, '26140000-0000-0000-0000-000000000070',
    '26140000-0000-0000-0000-000000000071', '26140000-0000-0000-0000-000000000077',
    '26140000-0000-0000-0000-000000000078', 0, '26140000-0000-0000-0000-000000000079',
    v_org || '/work-artifact-exports/71/v1-a.html', 'bericht.html', 10, 'v1', repeat('a', 64));
  if not (v_result->>'duplicate')::boolean
    or (v_result->>'documentId')::uuid <> '26140000-0000-0000-0000-000000000076'
    or exists (select 1 from public.documents where id = '26140000-0000-0000-0000-000000000079')
  then raise exception 'a repeated export wrote a second document'; end if;

  -- The field worker exports the assigned job's artifact.
  v_result := public.export_work_artifact(v_org, v_employee, '26140000-0000-0000-0000-000000000072',
    '26140000-0000-0000-0000-000000000073', '26140000-0000-0000-0000-00000000007a',
    '26140000-0000-0000-0000-00000000007b',
    (select version from public.work_artifacts where id = '26140000-0000-0000-0000-000000000072'),
    '26140000-0000-0000-0000-00000000007c', v_org || '/work-artifact-exports/73/v1-b.html', 'auftrag.html',
    10, 'v1', repeat('b', 64));
  if not exists (select 1 from public.document_links where document_id = '26140000-0000-0000-0000-00000000007c'
      and job_id = '26140000-0000-0000-0000-000000000022')
  then raise exception 'the field worker''s job export was not linked to the job'; end if;
end;
$$;

-- Only the service role executes the write functions; their helpers nobody.
do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.finalize_document_upload(uuid, uuid, uuid, uuid, text, text, text, text, text, bigint, text, uuid)',
    'public.finalize_document_version_upload(uuid, uuid, uuid, integer, text, text, text, bigint)',
    'public.delete_document_folder(uuid, uuid, uuid)',
    'public.update_document_links(uuid, uuid, uuid, uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[], uuid[])',
    'public.copy_document_folder(uuid, uuid, uuid, uuid, jsonb, jsonb)',
    'public.rename_document(uuid, uuid, uuid, text)',
    'public.update_document_category(uuid, uuid, uuid, text)',
    'public.move_document(uuid, uuid, uuid, uuid, text)',
    'public.copy_document(uuid, uuid, uuid, uuid, uuid, text, text)',
    'public.trash_document(uuid, uuid, uuid)',
    'public.restore_document(uuid, uuid, uuid, text)',
    'public.permanently_delete_document(uuid, uuid, uuid)',
    'public.finalize_work_artifact_export(uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text)',
    'public.export_work_artifact(uuid, uuid, uuid, uuid, uuid, uuid, bigint, uuid, text, text, bigint, text, text)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '% lost its service_role grant', v_function;
    end if;
    foreach v_role in array array['public', 'anon', 'authenticated'] loop
      if (v_role = 'public' and exists (
          select 1 from pg_proc proc, aclexplode(coalesce(proc.proacl, acldefault('f', proc.proowner))) acl
          where proc.oid = v_function::regprocedure and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'))
        or (v_role <> 'public' and has_function_privilege(v_role, v_function, 'execute'))
      then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
  foreach v_function in array array[
    'app_private.lock_active_document(uuid, uuid, uuid)',
    'app_private.assert_work_artifact_export_allowed(uuid, uuid, uuid, uuid)'
  ] loop
    if has_function_privilege('service_role', v_function, 'execute')
      or has_function_privilege('authenticated', v_function, 'execute')
    then raise exception '% is executable by a client or the service role', v_function; end if;
  end loop;
end;
$$;

rollback;
