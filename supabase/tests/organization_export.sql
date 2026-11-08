-- Admin exports the whole organization (werk-flow/werkflow-planning#287).
-- Only an Admin of the organization starts an export, completes or fails a
-- part and downloads it; Büro, an employee, a suspended Admin and another
-- organization's Admin are refused, and a foreign part answers like an
-- unknown one. The start refuses a plan that misses, repeats or adds a file,
-- or repeats a name in any letter case, so every original lands in exactly
-- one part. The export totals are the sums of its file rows, also when a
-- file changes during the start. A failed part leaves the others as they are
-- and completes alone later; a ready part refuses a second result. A build's
-- claim queues the part's archive for the purge seven days after the build
-- started, not eight, before anything is stored: an archive whose completion
-- is never recorded keeps that entry, and completion keeps it too. The purge
-- takes a due archive although the part names its path, and an export older
-- than seven days builds no part. Every start, part result and download
-- writes an event the ledger guard keeps. Queued again by the organization's
-- deletion, an archive falls due at once. An Admin's session reads the export
-- row; Büro, an employee and another organization read nothing, and no client
-- reads parts, files or events. The page reader returns only the
-- organization's rows. A start removes the file plans of exports whose
-- archives are all past their seven days, and nothing else.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('28700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'export-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Export"}', now(), now()),
('28700000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'export-office@example.test', '', now(), '{}',
 '{"first_name":"Office","last_name":"Export"}', now(), now()),
('28700000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'export-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Export"}', now(), now()),
('28700000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'export-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Export"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('28700000-0000-0000-0000-000000000010', 'Export SQL', '28700000-0000-0000-0000-000000000001', 'EXPSQLAA'),
('28700000-0000-0000-0000-000000000011', 'Export SQL fremd', '28700000-0000-0000-0000-000000000004', 'EXPSQLBB');
insert into public.organization_members (organization_id, user_id, role) values
('28700000-0000-0000-0000-000000000010', '28700000-0000-0000-0000-000000000002', 'buero'),
('28700000-0000-0000-0000-000000000010', '28700000-0000-0000-0000-000000000003', 'employee');

-- Three documents, one with an earlier version, and one foreign document.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, size_bytes, uploaded_by
) values
('28700000-0000-0000-0000-000000000040', '28700000-0000-0000-0000-000000000010',
 '28700000-0000-0000-0000-000000000010/d40/rechnung.pdf', 'rechnung.pdf', 'Rechnung.pdf', 10,
 '28700000-0000-0000-0000-000000000001'),
('28700000-0000-0000-0000-000000000041', '28700000-0000-0000-0000-000000000010',
 '28700000-0000-0000-0000-000000000010/d41/foto.jpg', 'foto.jpg', 'Foto.jpg', 20,
 '28700000-0000-0000-0000-000000000001'),
('28700000-0000-0000-0000-000000000042', '28700000-0000-0000-0000-000000000010',
 '28700000-0000-0000-0000-000000000010/d42/versions/u/2-vertrag.pdf', 'vertrag.pdf', 'Vertrag.pdf', 30,
 '28700000-0000-0000-0000-000000000001'),
('28700000-0000-0000-0000-000000000043', '28700000-0000-0000-0000-000000000011',
 '28700000-0000-0000-0000-000000000011/d43/fremd.pdf', 'fremd.pdf', 'Fremd.pdf', 40,
 '28700000-0000-0000-0000-000000000004');
insert into public.document_versions (
  organization_id, document_id, version_number, storage_path, original_file_name, size_bytes, uploaded_by
) values
('28700000-0000-0000-0000-000000000010', '28700000-0000-0000-0000-000000000042', 1,
 '28700000-0000-0000-0000-000000000010/d42/vertrag.pdf', 'vertrag.pdf', 25,
 '28700000-0000-0000-0000-000000000001');

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

-- A plan of the given parts, each an array of [path, name] pairs.
create function pg_temp.plan(p_parts text[][]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(part.files order by part.index), '[]'::jsonb)
  from (
    select index, jsonb_agg(jsonb_build_object('sourcePath', p_parts[index][file * 2 - 1],
      'archiveName', p_parts[index][file * 2]) order by file) as files
    from generate_subscripts(p_parts, 1) as index
    cross join generate_series(1, array_length(p_parts, 2) / 2) as file
    where p_parts[index][file * 2 - 1] is not null
    group by index
  ) part;
$$;
grant execute on function pg_temp.plan(text[][]) to service_role;

-- Only the service role executes the functions.
do $$
declare
  v_function text;
begin
  foreach v_function in array array[
    'public.start_organization_export(uuid, uuid, jsonb)',
    'public.claim_organization_export_part_build(uuid, uuid, uuid)',
    'public.complete_organization_export_part(uuid, uuid, uuid, bigint)',
    'public.fail_organization_export_part(uuid, uuid, uuid, text)',
    'public.record_organization_export_download(uuid, uuid, uuid)',
    'public.read_organization_export_page(uuid, text, jsonb, integer)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute')
      or has_function_privilege('anon', v_function, 'execute')
      or has_function_privilege('authenticated', v_function, 'execute') then
      raise exception '% is not service-only', v_function;
    end if;
  end loop;
end;
$$;

set local role service_role;

-- The full plan: four files in two file parts, names unique.
create temporary table full_plan on commit drop as
select pg_temp.plan(array[
  array['28700000-0000-0000-0000-000000000010/d40/rechnung.pdf', 'Dateien/Ohne Ordner/Rechnung.pdf',
        '28700000-0000-0000-0000-000000000010/d41/foto.jpg', 'Dateien/Ohne Ordner/Foto.jpg'],
  array['28700000-0000-0000-0000-000000000010/d42/versions/u/2-vertrag.pdf', 'Dateien/Ohne Ordner/Vertrag.pdf',
        '28700000-0000-0000-0000-000000000010/d42/vertrag.pdf', 'Dateien/Ohne Ordner/Vertrag (Version 1).pdf']
]) as plan;

-- Büro, an employee and another organization's Admin start nothing.
select pg_temp.expect_refusal('office start', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000002',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan)), 'not_authorized');
select pg_temp.expect_refusal('employee start', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000003',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan)), 'not_authorized');
select pg_temp.expect_refusal('foreign admin start', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000004',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan)), 'not_authorized');

-- A plan that misses a file, adds a foreign one, repeats a file or a name is refused.
select pg_temp.expect_refusal('plan missing a version', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', pg_temp.plan(array[
    array['28700000-0000-0000-0000-000000000010/d40/rechnung.pdf', 'Dateien/a.pdf',
          '28700000-0000-0000-0000-000000000010/d41/foto.jpg', 'Dateien/b.jpg',
          '28700000-0000-0000-0000-000000000010/d42/versions/u/2-vertrag.pdf', 'Dateien/c.pdf']])),
  'export_plan_stale');
select pg_temp.expect_refusal('plan with a foreign file', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan) || pg_temp.plan(array[
    array['28700000-0000-0000-0000-000000000011/d43/fremd.pdf', 'Dateien/fremd.pdf']])),
  'export_plan_stale');
select pg_temp.expect_refusal('plan repeating a file in two parts', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan) || pg_temp.plan(array[
    array['28700000-0000-0000-0000-000000000010/d40/rechnung.pdf', 'Dateien/Kopie.pdf']])),
  'export_plan_repeats_file');
select pg_temp.expect_refusal('plan repeating a name in another case', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', pg_temp.plan(array[
    array['28700000-0000-0000-0000-000000000010/d40/rechnung.pdf', 'Dateien/a.pdf',
          '28700000-0000-0000-0000-000000000010/d41/foto.jpg', 'Dateien/A.pdf',
          '28700000-0000-0000-0000-000000000010/d42/versions/u/2-vertrag.pdf', 'Dateien/c.pdf',
          '28700000-0000-0000-0000-000000000010/d42/vertrag.pdf', 'Dateien/d.pdf']])),
  'export_plan_repeats_name');
select pg_temp.expect_refusal('plan with an empty part', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan) || '[[]]'::jsonb),
  'export_plan_invalid');

-- The Admin's plan starts the export: a data part, then the file parts, each
-- original in exactly one part with its size and document from the rows.
create temporary table started on commit drop as
select public.start_organization_export('28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan)) as export_id;
do $$
declare
  v_export uuid := (select export_id from started);
begin
  if (select string_agg(part.part_number || ':' || part.kind || ':' || part.state || ':' || part.file_count
        || ':' || part.file_bytes, ',' order by part.part_number)
      from public.organization_export_parts part where part.export_id = v_export)
    <> '1:data:pending:0:0,2:files:pending:2:30,3:files:pending:2:55' then
    raise exception 'the export parts are wrong';
  end if;
  if (select count(*) from public.organization_export_files file where file.export_id = v_export) <> 4
    or (select count(distinct file.source_path) from public.organization_export_files file where file.export_id = v_export) <> 4
    or exists (select 1 from public.organization_export_files file
      where file.export_id = v_export and file.document_id = '28700000-0000-0000-0000-000000000043')
    or (select version_number from public.organization_export_files file
      where file.export_id = v_export and file.source_path = '28700000-0000-0000-0000-000000000010/d42/vertrag.pdf') <> 1
  then
    raise exception 'the export does not hold every file exactly once';
  end if;
  if (select file_count || ':' || file_bytes from public.organization_exports where id = v_export) <> '4:85'
    or (select string_agg(event_type, ',') from public.organization_export_events where export_id = v_export) <> 'started'
  then
    raise exception 'the export totals or its start event are wrong';
  end if;
  if (select file_count || ':' || file_bytes from public.organization_exports where id = v_export)
      <> (select count(*) || ':' || coalesce(sum(file_bytes), 0) from public.organization_export_files
        where export_id = v_export)
    or (select file_count || ':' || file_bytes from public.organization_exports where id = v_export)
      <> (select sum(file_count) || ':' || sum(file_bytes) from public.organization_export_parts
        where export_id = v_export) then
    raise exception 'the export totals differ from its file rows or its part totals';
  end if;
end;
$$;

-- Parts by number for the steps below.
create temporary table export_parts on commit drop as
select part.part_number, part.id from public.organization_export_parts part
where part.export_id = (select export_id from started);

-- Nobody but the organization's Admin records a result, and a foreign part is unknown.
select pg_temp.expect_refusal('office complete', format(
  'select public.complete_organization_export_part(%L, %L, %L, 100)', '28700000-0000-0000-0000-000000000002',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 2)), 'not_authorized');
select pg_temp.expect_refusal('employee fail', format(
  'select public.fail_organization_export_part(%L, %L, %L, %L)', '28700000-0000-0000-0000-000000000003',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 2), 'build_failed'),
  'not_authorized');
select pg_temp.expect_refusal('foreign admin complete in own organization', format(
  'select public.complete_organization_export_part(%L, %L, %L, 100)', '28700000-0000-0000-0000-000000000004',
  '28700000-0000-0000-0000-000000000011', (select id from export_parts where part_number = 2)), 'export_part_not_found');
select pg_temp.expect_refusal('office claim', format(
  'select public.claim_organization_export_part_build(%L, %L, %L)', '28700000-0000-0000-0000-000000000002',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 2)), 'not_authorized');
select pg_temp.expect_refusal('foreign admin claim in own organization', format(
  'select public.claim_organization_export_part_build(%L, %L, %L)', '28700000-0000-0000-0000-000000000004',
  '28700000-0000-0000-0000-000000000011', (select id from export_parts where part_number = 2)), 'export_part_not_found');
select pg_temp.expect_refusal('unknown part', format(
  'select public.fail_organization_export_part(%L, %L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', gen_random_uuid(), 'build_failed'), 'export_part_not_found');

-- Every part's archive path is fixed at the start; nothing is stored or queued before a build claims it.
do $$
begin
  if (select count(*) from public.organization_export_parts part
      where part.export_id = (select export_id from started)
        and part.archive_path = format('%s/datenexporte/%s/teil-%s.zip', part.organization_id, part.export_id, part.part_number)
        and part.build_started_at is null) <> 3
    or exists (select 1 from public.storage_purge_queue
      where storage_path like '28700000-0000-0000-0000-000000000010/datenexporte/%') then
    raise exception 'the start did not fix every archive path, or queued one before a build';
  end if;
end;
$$;

-- At the end of the export's seven days a build claims part 3. The claim
-- queues its archive for the purge seven days after the build started,
-- before the build stores it, so the archive is deleted although its
-- completion is never recorded.
reset role;
update public.organization_exports set requested_at = now() - interval '6 days 23 hours'
where id = (select export_id from started);
set local role service_role;
do $$
declare
  v_claimed jsonb;
  v_part public.organization_export_parts;
begin
  v_claimed := public.claim_organization_export_part_build('28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 3));
  select * into v_part from public.organization_export_parts where id = (select id from export_parts where part_number = 3);
  if v_claimed <> jsonb_build_object('exportId', v_part.export_id, 'kind', 'files',
      'archivePath', v_part.archive_path, 'partCount', 3) then
    raise exception 'the claim answered %', v_claimed;
  end if;
  if v_part.state <> 'pending' or v_part.build_started_at <> now() or v_part.expires_at is not null
    or (select purge_after from public.storage_purge_queue where storage_path = v_part.archive_path)
      is distinct from now() + interval '7 days' then
    raise exception 'an archive whose completion is never recorded has no purge entry seven days after its build started';
  end if;
end;
$$;

-- Queued again, as the organization's deletion queues every listed object,
-- an archive falls due at once instead of eight days later; a document file
-- still waits eight days.
do $$
declare
  v_archive text := (select archive_path from public.organization_export_parts
    where id = (select id from export_parts where part_number = 3));
begin
  perform public.queue_storage_purge('28700000-0000-0000-0000-000000000010',
    array[v_archive, '28700000-0000-0000-0000-000000000010/d40/rechnung.pdf']);
  if (select purge_after from public.storage_purge_queue where storage_path = v_archive) <> now()
    or (select purge_after from public.storage_purge_queue
      where storage_path = '28700000-0000-0000-0000-000000000010/d40/rechnung.pdf') <> now() + interval '8 days' then
    raise exception 'queueing again extended an archive or shortened a document file';
  end if;
end;
$$;

-- Part 2 fails: the others stay pending, and it completes alone later.
do $$
declare
  v_part uuid := (select id from export_parts where part_number = 2);
begin
  perform pg_temp.expect_refusal('completion without a claim', format(
    'select public.complete_organization_export_part(%L, %L, %L, 100)', '28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part), 'export_part_not_claimed');
  perform public.claim_organization_export_part_build('28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part);
  perform public.fail_organization_export_part('28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part, 'storage_object_missing');
  if (select string_agg(part.part_number || ':' || part.state, ',' order by part.part_number)
      from public.organization_export_parts part where part.export_id = (select export_id from started))
    <> '1:pending,2:failed,3:pending' then
    raise exception 'a failed part changed another part';
  end if;
  -- The failed build's archive, had it stored one, is still queued; the retry claims the part again.
  if not exists (select 1 from public.storage_purge_queue where storage_path =
      (select archive_path from public.organization_export_parts where id = v_part)) then
    raise exception 'a failed build left its archive unqueued';
  end if;
  perform public.claim_organization_export_part_build('28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part);
end;
$$;

-- The retry's build took an hour before its completion.
reset role;
update public.organization_export_parts set build_started_at = now() - interval '1 hour'
where id = (select id from export_parts where part_number = 2);
update public.storage_purge_queue set purge_after = now() - interval '1 hour' + interval '7 days'
where storage_path = (select archive_path from public.organization_export_parts
  where id = (select id from export_parts where part_number = 2));
set local role service_role;
do $$
declare
  v_part uuid := (select id from export_parts where part_number = 2);
begin
  perform public.complete_organization_export_part('28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part, 100);
  if (select string_agg(part.part_number || ':' || part.state, ',' order by part.part_number)
      from public.organization_export_parts part where part.export_id = (select export_id from started))
    <> '1:pending,2:ready,3:pending' then
    raise exception 'the retried part did not complete alone';
  end if;
  perform pg_temp.expect_refusal('claim of a ready part', format(
    'select public.claim_organization_export_part_build(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part), 'export_part_ready');
  perform pg_temp.expect_refusal('second result of a ready part', format(
    'select public.fail_organization_export_part(%L, %L, %L, %L)', '28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part, 'build_failed'), 'export_part_ready');
  perform pg_temp.expect_refusal('second completion of a ready part', format(
    'select public.complete_organization_export_part(%L, %L, %L, 5)', '28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', v_part), 'export_part_ready');
end;
$$;

-- The ready archive stays downloadable until its claim's purge entry falls
-- due, seven days after its build started: completion keeps the entry. The
-- purge takes every due archive although its part names the path.
do $$
declare
  v_part public.organization_export_parts;
begin
  select * into v_part from public.organization_export_parts where id = (select id from export_parts where part_number = 2);
  if v_part.state <> 'ready' or v_part.failure_reason is not null or v_part.archive_bytes <> 100
    or v_part.built_at <> now() or v_part.build_started_at <> now() - interval '1 hour'
    or v_part.expires_at <> v_part.build_started_at + interval '7 days' then
    raise exception 'the ready part is wrong';
  end if;
  if (select purge_after from public.storage_purge_queue where storage_path = v_part.archive_path)
    is distinct from v_part.build_started_at + interval '7 days' then
    raise exception 'completion moved the archive''s purge away from seven days after its build started';
  end if;
  update public.storage_purge_queue set purge_after = now() - interval '1 second'
  where storage_path like '28700000-0000-0000-0000-000000000010/datenexporte/%';
  if (select count(*) from public.claim_storage_purge(500) claimed
      where claimed.storage_path like '28700000-0000-0000-0000-000000000010/datenexporte/%') <> 2 then
    raise exception 'the purge kept a due archive';
  end if;
end;
$$;

-- A suspended Admin starts, claims, records and downloads nothing: each
-- function checks effective access, not the Admin role alone. The product
-- refuses to suspend the organization's owner, so the fixture writes the
-- entry directly; the Admin is active again afterwards.
reset role;
insert into public.personnel_access_lifecycles (organization_id, employee_record_id, state, state_effective_at)
select record.organization_id, record.id, 'suspended', now() from public.employee_records record
where record.organization_id = '28700000-0000-0000-0000-000000000010'
  and record.user_id = '28700000-0000-0000-0000-000000000001';
set local role service_role;
select pg_temp.expect_refusal('suspended admin start', format(
  'select public.start_organization_export(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan)), 'not_authorized');
select pg_temp.expect_refusal('suspended admin claim', format(
  'select public.claim_organization_export_part_build(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 3)), 'not_authorized');
select pg_temp.expect_refusal('suspended admin complete', format(
  'select public.complete_organization_export_part(%L, %L, %L, 100)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 3)), 'not_authorized');
select pg_temp.expect_refusal('suspended admin fail', format(
  'select public.fail_organization_export_part(%L, %L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 3), 'build_failed'),
  'not_authorized');
select pg_temp.expect_refusal('suspended admin download', format(
  'select public.record_organization_export_download(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 2)), 'not_authorized');
reset role;
delete from public.personnel_access_lifecycles lifecycle
using public.employee_records record
where lifecycle.employee_record_id = record.id
  and record.organization_id = '28700000-0000-0000-0000-000000000010'
  and record.user_id = '28700000-0000-0000-0000-000000000001';
set local role service_role;

-- Only the Admin downloads; a download is recorded; an expired part is refused.
select pg_temp.expect_refusal('office download', format(
  'select public.record_organization_export_download(%L, %L, %L)', '28700000-0000-0000-0000-000000000002',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 2)), 'not_authorized');
select pg_temp.expect_refusal('download of a pending part', format(
  'select public.record_organization_export_download(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 3)), 'export_part_not_ready');
do $$
declare
  v_download jsonb;
begin
  v_download := public.record_organization_export_download('28700000-0000-0000-0000-000000000001',
    '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 2));
  if (v_download ->> 'partNumber')::integer <> 2 or (v_download ->> 'partCount')::integer <> 3
    or v_download ->> 'archivePath' not like '%/teil-2.zip' then
    raise exception 'the download answer is wrong: %', v_download;
  end if;
  if (select string_agg(event_type, ',' order by occurred_at, event_type)
      from public.organization_export_events where export_id = (select export_id from started))
    <> 'downloaded,part_failed,part_ready,started' then
    raise exception 'the ledger misses an event: %', (select string_agg(event_type, ',')
      from public.organization_export_events where export_id = (select export_id from started));
  end if;
end;
$$;
reset role;
update public.organization_export_parts set built_at = now() - interval '8 days', expires_at = now() - interval '1 day'
where id = (select id from export_parts where part_number = 2);
set local role service_role;
select pg_temp.expect_refusal('download of an expired part', format(
  'select public.record_organization_export_download(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 2)), 'export_part_expired');

-- An export older than seven days builds no part, so nothing is stored after its window.
reset role;
update public.organization_exports set requested_at = now() - interval '7 days'
where id = (select export_id from started);
set local role service_role;
select pg_temp.expect_refusal('claim in an expired export', format(
  'select public.claim_organization_export_part_build(%L, %L, %L)', '28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select id from export_parts where part_number = 1)), 'export_part_expired');

-- The service role holds no change privilege on the ledger, and the guard
-- refuses a change by the owner too.
reset role;
do $$
begin
  if has_table_privilege('service_role', 'public.organization_export_events', 'UPDATE,DELETE,TRUNCATE') then
    raise exception 'the service role can change the export ledger';
  end if;
end;
$$;
select pg_temp.expect_refusal('event update', format(
  'update public.organization_export_events set event_payload = %L where export_id = %L', '{}',
  (select export_id from started)), 'event_ledger_history_immutable');
select pg_temp.expect_refusal('event delete', format(
  'delete from public.organization_export_events where export_id = %L', (select export_id from started)),
  'event_ledger_history_immutable');
set local role service_role;

-- The page reader returns the organization's rows only, in key order, page by page.
do $$
declare
  v_first jsonb;
  v_second jsonb;
begin
  v_first := public.read_organization_export_page('28700000-0000-0000-0000-000000000010', 'documents', null, 2) -> 'rows';
  v_second := public.read_organization_export_page('28700000-0000-0000-0000-000000000010', 'documents', v_first -> 1, 2) -> 'rows';
  if (public.read_organization_export_page('28700000-0000-0000-0000-000000000010', 'documents', null, 1) -> 'columns' ->> 0) <> 'id' then
    raise exception 'the page reader lost the column order';
  end if;
  if jsonb_array_length(v_first) <> 2 or jsonb_array_length(v_second) <> 1
    or (v_first -> 0 ->> 'id') <> '28700000-0000-0000-0000-000000000040'
    or (v_second -> 0 ->> 'id') <> '28700000-0000-0000-0000-000000000042'
    or exists (select 1 from jsonb_array_elements(v_first || v_second) row_value
      where row_value ->> 'organization_id' <> '28700000-0000-0000-0000-000000000010') then
    raise exception 'the page reader returned the wrong rows';
  end if;
  perform pg_temp.expect_refusal('table without organization', format(
    'select public.read_organization_export_page(%L, %L, null, 10)', '28700000-0000-0000-0000-000000000010',
    'profiles'), 'export_table_unknown');
end;
$$;
reset role;

-- An Admin's session reads the export row; nobody else, and no client reads the rest.
create function pg_temp.visible_exports(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.organization_exports;
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.visible_exports('28700000-0000-0000-0000-000000000001') <> 1
    or pg_temp.visible_exports('28700000-0000-0000-0000-000000000002') <> 0
    or pg_temp.visible_exports('28700000-0000-0000-0000-000000000003') <> 0
    or pg_temp.visible_exports('28700000-0000-0000-0000-000000000004') <> 0 then
    raise exception 'an export row reached someone other than the Admin';
  end if;
  if has_table_privilege('authenticated', 'public.organization_export_parts', 'SELECT')
    or has_table_privilege('authenticated', 'public.organization_export_files', 'SELECT')
    or has_table_privilege('authenticated', 'public.organization_export_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.organization_exports', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.organization_exports', 'SELECT') then
    raise exception 'a client role reaches export data beyond the export row';
  end if;
end;
$$;

-- A start removes the file plan of an export whose archives are all past
-- their seven days, fourteen days after its start, and keeps a younger plan,
-- every export's parts and the ledger; another organization's plan stays.
insert into public.organization_exports (id, organization_id, requested_by, requested_at, part_count, file_count, file_bytes)
values ('28700000-0000-0000-0000-000000000090', '28700000-0000-0000-0000-000000000011',
  '28700000-0000-0000-0000-000000000004', now() - interval '30 days', 2, 1, 40);
insert into public.organization_export_parts (id, organization_id, export_id, part_number, kind, archive_path)
values ('28700000-0000-0000-0000-000000000091', '28700000-0000-0000-0000-000000000011',
  '28700000-0000-0000-0000-000000000090', 2, 'files',
  '28700000-0000-0000-0000-000000000011/datenexporte/28700000-0000-0000-0000-000000000090/teil-2.zip');
insert into public.organization_export_files (
  organization_id, export_id, part_id, document_id, source_path, archive_name, file_bytes
) values ('28700000-0000-0000-0000-000000000011', '28700000-0000-0000-0000-000000000090',
  '28700000-0000-0000-0000-000000000091', '28700000-0000-0000-0000-000000000043',
  '28700000-0000-0000-0000-000000000011/d43/fremd.pdf', 'Dateien/fremd.pdf', 40);
update public.organization_exports set requested_at = now() - interval '13 days 23 hours'
where id = (select export_id from started);
create temporary table ledger_before on commit drop as
select count(*) as events from public.organization_export_events
where organization_id = '28700000-0000-0000-0000-000000000010';
set local role service_role;
create temporary table later_starts on commit drop as
select public.start_organization_export('28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan)) as export_id;
reset role;
do $$
begin
  if (select count(*) from public.organization_export_files where export_id = (select export_id from started)) <> 4 then
    raise exception 'a start removed the plan of an export whose archives may still be built';
  end if;
end;
$$;
update public.organization_exports set requested_at = now() - interval '14 days'
where id = (select export_id from started);
set local role service_role;
insert into later_starts
select public.start_organization_export('28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan));
reset role;
do $$
begin
  if exists (select 1 from public.organization_export_files where export_id = (select export_id from started)) then
    raise exception 'a start kept the plan of an export whose archives are past their seven days';
  end if;
  if (select count(*) from public.organization_export_files
      where export_id in (select export_id from later_starts)) <> 8
    or (select count(*) from public.organization_export_files
      where export_id = '28700000-0000-0000-0000-000000000090') <> 1
    or (select count(*) from public.organization_export_parts where export_id = (select export_id from started)) <> 3
    or (select count(*) from public.organization_export_events
      where organization_id = '28700000-0000-0000-0000-000000000010') <> (select events from ledger_before) + 2 then
    raise exception 'a start removed more than the expired plan';
  end if;
end;
$$;

-- A file that changes while the export starts, as an upload committed
-- between two of its statements can, moves the export totals with the file
-- rows: the test trigger resizes a file right after the export row exists.
create function pg_temp.resize_file_during_start() returns trigger language plpgsql as $$
begin
  update public.documents set size_bytes = size_bytes + 1000
  where id = '28700000-0000-0000-0000-000000000040';
  return null;
end;
$$;
grant execute on function pg_temp.resize_file_during_start() to service_role;
create trigger resize_file_during_start after insert on public.organization_exports
  for each row execute function pg_temp.resize_file_during_start();
set local role service_role;
create temporary table resized_start on commit drop as
select public.start_organization_export('28700000-0000-0000-0000-000000000001',
  '28700000-0000-0000-0000-000000000010', (select plan from full_plan)) as export_id;
reset role;
drop trigger resize_file_during_start on public.organization_exports;
do $$
declare
  v_export uuid := (select export_id from resized_start);
begin
  if (select file_count || ':' || file_bytes from public.organization_exports where id = v_export) <> '4:1085'
    or (select sum(file_bytes) from public.organization_export_files where export_id = v_export) <> 1085
    or (select sum(file_bytes) from public.organization_export_parts where export_id = v_export) <> 1085
    or (select event_payload ->> 'fileBytes' from public.organization_export_events
      where export_id = v_export and event_type = 'started') <> '1085' then
    raise exception 'the export totals differ from the file rows of a file that changed during the start';
  end if;
end;
$$;

-- Organization deletion takes the export and its ledger along.
delete from public.organizations where id = '28700000-0000-0000-0000-000000000010';
do $$
begin
  if exists (select 1 from public.organization_export_events where organization_id = '28700000-0000-0000-0000-000000000010')
    or exists (select 1 from public.organization_exports where organization_id = '28700000-0000-0000-0000-000000000010') then
    raise exception 'the organization deletion left export rows';
  end if;
end;
$$;

rollback;
