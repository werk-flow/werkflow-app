-- The office finds a legacy original by its old number
-- (werk-flow/werkflow-planning#284). A document carries its origin: the source
-- system and the number that system used. The library search matches that
-- number exactly and by prefix, ignoring case, across every document of the
-- organization before it pages, and never returns another organization's
-- document with the same number. Admin and Büro set the origin through one
-- audited function, which refuses an employee, another organization's
-- document, a protected personnel document and a filed document; the table
-- trigger keeps a filed document's origin fixed on every path. Only the
-- service role executes the function, and no client reads the origin columns.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('28400000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-origin-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Herkunft"}', now(), now()),
('28400000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-origin-office@example.test', '', now(), '{}',
 '{"first_name":"Office","last_name":"Herkunft"}', now(), now()),
('28400000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-origin-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Herkunft"}', now(), now()),
('28400000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'document-origin-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Herkunft"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('28400000-0000-0000-0000-000000000010', 'Herkunft SQL', '28400000-0000-0000-0000-000000000001', 'HERKSQLA'),
('28400000-0000-0000-0000-000000000011', 'Herkunft SQL fremd', '28400000-0000-0000-0000-000000000004', 'HERKSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000002', 'buero'),
('28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000003', 'employee');

-- 40 to 42 legacy invoices whose names do not carry their old number, 43 an
-- offer whose number only contains the searched text, 44 a fresh upload
-- without origin, 45 the foreign organization's invoice with the same number
-- as 42, 46 a filed legacy invoice, 47 a standard personnel document.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  source_system, source_reference
) values
('28400000-0000-0000-0000-000000000040', '28400000-0000-0000-0000-000000000010',
 '28400000-0000-0000-0000-000000000010/d40/scan-a.pdf', 'scan-a.pdf', 'a-scan.pdf', 'invoice', 10,
 '28400000-0000-0000-0000-000000000001', 'Sykasoft', 'RE-2019-0040'),
('28400000-0000-0000-0000-000000000041', '28400000-0000-0000-0000-000000000010',
 '28400000-0000-0000-0000-000000000010/d41/scan-b.pdf', 'scan-b.pdf', 'b-scan.pdf', 'invoice', 10,
 '28400000-0000-0000-0000-000000000001', 'Sykasoft', 'RE-2019-0041'),
('28400000-0000-0000-0000-000000000042', '28400000-0000-0000-0000-000000000010',
 '28400000-0000-0000-0000-000000000010/d42/scan-c.pdf', 'scan-c.pdf', 'c-scan.pdf', 'invoice', 10,
 '28400000-0000-0000-0000-000000000001', 'Sykasoft', 'RE-2019-0042'),
('28400000-0000-0000-0000-000000000043', '28400000-0000-0000-0000-000000000010',
 '28400000-0000-0000-0000-000000000010/d43/scan-d.pdf', 'scan-d.pdf', 'd-scan.pdf', 'offer', 10,
 '28400000-0000-0000-0000-000000000001', 'Sykasoft', 'AN-RE-2019-0042'),
('28400000-0000-0000-0000-000000000044', '28400000-0000-0000-0000-000000000010',
 '28400000-0000-0000-0000-000000000010/d44/notiz.pdf', 'notiz.pdf', 'notiz.pdf', 'other', 10,
 '28400000-0000-0000-0000-000000000001', null, null),
('28400000-0000-0000-0000-000000000045', '28400000-0000-0000-0000-000000000011',
 '28400000-0000-0000-0000-000000000011/d45/scan.pdf', 'scan.pdf', 'fremd.pdf', 'invoice', 10,
 '28400000-0000-0000-0000-000000000004', 'Sykasoft', 'RE-2019-0042'),
('28400000-0000-0000-0000-000000000047', '28400000-0000-0000-0000-000000000010',
 '28400000-0000-0000-0000-000000000010/d47/vertrag.pdf', 'vertrag.pdf', 'vertrag.pdf', 'other', 10,
 '28400000-0000-0000-0000-000000000001', null, null);
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  source_system, source_reference, retention_class, filed_at, filed_by
) values
('28400000-0000-0000-0000-000000000046', '28400000-0000-0000-0000-000000000010',
 '28400000-0000-0000-0000-000000000010/d46/scan-f.pdf', 'scan-f.pdf', 'f-scan.pdf', 'invoice', 10,
 '28400000-0000-0000-0000-000000000001', 'Sykasoft', 'RE-2018-0007', 'ten_years', now(),
 '28400000-0000-0000-0000-000000000001');
insert into public.employee_records (id, organization_id, first_name, last_name) values
('28400000-0000-0000-0000-000000000090', '28400000-0000-0000-0000-000000000010', 'Paula', 'Personal');
insert into public.personnel_documents (organization_id, employee_record_id, document_id, document_type, access_class) values
('28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000090',
 '28400000-0000-0000-0000-000000000047', 'Arbeitsvertrag', 'personnel_standard');

-- Runs one statement and requires the named refusal.
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

do $$
declare
  v_column text;
begin
  if not has_function_privilege('service_role', 'public.update_document_origin(uuid, uuid, uuid, text, text)', 'execute')
    or has_function_privilege('anon', 'public.update_document_origin(uuid, uuid, uuid, text, text)', 'execute')
    or has_function_privilege('authenticated', 'public.update_document_origin(uuid, uuid, uuid, text, text)', 'execute')
  then raise exception 'update_document_origin is not executable by the service role alone'; end if;
  if (select prosecdef from pg_proc where oid = 'public.update_document_origin(uuid, uuid, uuid, text, text)'::regprocedure)
  then raise exception 'update_document_origin runs with more rights than its service-role caller'; end if;
  -- A client reads documents only through Realtime and RLS, which admit an
  -- assigned employee: the origin reaches readers only through the server.
  foreach v_column in array array['source_system', 'source_reference'] loop
    if has_column_privilege('authenticated', 'public.documents', v_column, 'select')
      or has_column_privilege('anon', 'public.documents', v_column, 'select')
    then raise exception 'a client may read documents.%', v_column; end if;
  end loop;
end;
$$;

set local role service_role;

-- The search matches the old number by prefix across the whole organization
-- before it pages: the third match lands on page 2 of two per page.
do $$
declare
  v_org constant uuid := '28400000-0000-0000-0000-000000000010';
  v_page jsonb;
begin
  v_page := public.list_document_page(v_org, jsonb_build_object(
    'view', 'all', 'sort', 'name', 'searchQuery', 'RE-2019', 'page', 2, 'pageSize', 2));
  if v_page->'ids' <> '["28400000-0000-0000-0000-000000000042"]'::jsonb or (v_page->>'total')::integer <> 3 then
    raise exception 'the library search missed a legacy original by its old number on a later page: %', v_page;
  end if;
  v_page := public.list_document_page(v_org, jsonb_build_object(
    'view', 'all', 'sort', 'name', 'searchQuery', 're-2019-0042', 'page', 1, 'pageSize', 50));
  if v_page->'ids' <> '["28400000-0000-0000-0000-000000000042"]'::jsonb or (v_page->>'total')::integer <> 1 then
    raise exception 'the library search did not find exactly the one document of the old number: %', v_page;
  end if;
  -- A number that only contains the text is no match: a short number would flood the list.
  v_page := public.list_document_page(v_org, jsonb_build_object(
    'view', 'all', 'sort', 'name', 'searchQuery', '2019-0042', 'page', 1, 'pageSize', 50));
  if (v_page->>'total')::integer <> 0 then
    raise exception 'the library search matched an old number in its middle: %', v_page;
  end if;
  -- The name search still works beside it.
  v_page := public.list_document_page(v_org, jsonb_build_object(
    'view', 'all', 'sort', 'name', 'searchQuery', 'notiz', 'page', 1, 'pageSize', 50));
  if v_page->'ids' <> '["28400000-0000-0000-0000-000000000044"]'::jsonb then
    raise exception 'the library search lost the name match: %', v_page;
  end if;
end;
$$;

-- The foreign organization finds only its own document of the same number.
do $$
declare
  v_page jsonb := public.list_document_page('28400000-0000-0000-0000-000000000011', jsonb_build_object(
    'view', 'all', 'sort', 'name', 'searchQuery', 'RE-2019-0042', 'page', 1, 'pageSize', 50));
begin
  if v_page->'ids' <> '["28400000-0000-0000-0000-000000000045"]'::jsonb then
    raise exception 'the library search crossed the organization boundary on an old number: %', v_page;
  end if;
end;
$$;

-- Admin sets the origin trimmed, with one audit event; the same origin again
-- writes nothing; Büro clears it, a blank value becoming no value.
do $$
declare
  v_org constant uuid := '28400000-0000-0000-0000-000000000010';
  v_admin constant uuid := '28400000-0000-0000-0000-000000000001';
  v_office constant uuid := '28400000-0000-0000-0000-000000000002';
  v_document_id constant uuid := '28400000-0000-0000-0000-000000000044';
  v_document public.documents;
  v_event public.document_audit_events;
begin
  v_document := public.update_document_origin(v_admin, v_org, v_document_id, '  Sykasoft ', ' RE-2017-0815  ');
  if v_document.source_system is distinct from 'Sykasoft' or v_document.source_reference is distinct from 'RE-2017-0815'
  then raise exception 'the origin was not stored trimmed: %', row_to_json(v_document); end if;
  select * into strict v_event from public.document_audit_events event
  where event.document_id = v_document_id and event.event_type = 'origin_changed';
  if v_event.actor_id <> v_admin or v_event.organization_id <> v_org
    or v_event.event_payload <> jsonb_build_object(
      'fromSourceSystem', null, 'toSourceSystem', 'Sykasoft',
      'fromSourceReference', null, 'toSourceReference', 'RE-2017-0815')
  then raise exception 'the origin change was not audited: %', row_to_json(v_event); end if;

  perform public.update_document_origin(v_admin, v_org, v_document_id, 'Sykasoft', 'RE-2017-0815');
  if (select count(*) from public.document_audit_events event
    where event.document_id = v_document_id and event.event_type = 'origin_changed') <> 1
  then raise exception 'an unchanged origin wrote an audit event'; end if;

  v_document := public.update_document_origin(v_office, v_org, v_document_id, '   ', null);
  if v_document.source_system is not null or v_document.source_reference is not null then
    raise exception 'Büro could not clear the origin: %', row_to_json(v_document);
  end if;
  if (select count(*) from public.document_audit_events event
    where event.document_id = v_document_id and event.event_type = 'origin_changed') <> 2
  then raise exception 'clearing the origin was not audited'; end if;
end;
$$;

select pg_temp.expect_refusal('an employee setting an origin', $sql$
  select public.update_document_origin('28400000-0000-0000-0000-000000000003',
    '28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000044', 'Sykasoft', 'RE-1')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('an origin on another organization''s document', $sql$
  select public.update_document_origin('28400000-0000-0000-0000-000000000001',
    '28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000045', 'Sykasoft', 'RE-1')
$sql$, 'document_not_found');
select pg_temp.expect_refusal('an origin on a protected personnel document', $sql$
  select public.update_document_origin('28400000-0000-0000-0000-000000000001',
    '28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000047', 'Sykasoft', 'RE-1')
$sql$, 'protected_document_boundary');
select pg_temp.expect_refusal('an origin change on a filed document', $sql$
  select public.update_document_origin('28400000-0000-0000-0000-000000000001',
    '28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000046', 'Sykasoft', 'RE-2018-0008')
$sql$, 'document_filed');
select pg_temp.expect_refusal('an overlong old number', $sql$
  select public.update_document_origin('28400000-0000-0000-0000-000000000001',
    '28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000044', 'Sykasoft', repeat('9', 121))
$sql$, 'invalid_input');
select pg_temp.expect_refusal('an overlong source system', $sql$
  select public.update_document_origin('28400000-0000-0000-0000-000000000001',
    '28400000-0000-0000-0000-000000000010', '28400000-0000-0000-0000-000000000044', repeat('S', 81), 'RE-1')
$sql$, 'invalid_input');
-- The table keeps a filed document's origin on every path, not only the function's.
select pg_temp.expect_refusal('a direct origin change on a filed document', $sql$
  update public.documents set source_reference = 'RE-2018-0008'
  where id = '28400000-0000-0000-0000-000000000046'
$sql$, 'document_filed');

do $$
begin
  if (select source_reference from public.documents where id = '28400000-0000-0000-0000-000000000046')
    is distinct from 'RE-2018-0007'
  then raise exception 'a filed document lost its old number'; end if;
  if exists (select 1 from public.document_audit_events event
    where event.document_id in ('28400000-0000-0000-0000-000000000045', '28400000-0000-0000-0000-000000000046',
      '28400000-0000-0000-0000-000000000047'))
  then raise exception 'a refused origin change left an audit event'; end if;
end;
$$;

rollback;
