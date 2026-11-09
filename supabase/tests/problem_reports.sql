-- Problem reports (20261128090000_store_problem_reports_privately.sql,
-- werk-flow/werkflow-planning#331). Client roles read and write no report
-- table and execute none of its functions. The history refuses UPDATE and
-- DELETE, also for the service role, and leaves only with its report. A
-- report leaves only through the retention run or a cascade, and its
-- originals change only there. The retention run deletes only due originals,
-- keeps the scrubbed copy, and queues every file path; 24 months after
-- closing it deletes the report.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('33100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'report-admin@example.test', '', now(), '{}',
 '{"first_name":"Ada","last_name":"Beispiel"}', now(), now()),
('33100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'report-worker@example.test', '', now(), '{}',
 '{"first_name":"Ben","last_name":"Beispiel"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('33100000-0000-0000-0000-000000000010', 'Meldungen GmbH', '33100000-0000-0000-0000-000000000001', 'REPORT10'),
('33100000-0000-0000-0000-000000000011', 'Weg GmbH', '33100000-0000-0000-0000-000000000001', 'REPORT11');
insert into public.organization_members (organization_id, user_id, role) values
('33100000-0000-0000-0000-000000000010', '33100000-0000-0000-0000-000000000002', 'employee');

-- 20: open, sent 13 months ago: originals due.
-- 21: closed 91 days ago, sent 4 months ago: originals due.
-- 22: closed 30 days ago: nothing due.
-- 23: open, sent 6 months ago: nothing due.
-- 24: closed 25 months ago, originals already gone: the report is due.
-- 25: in organization 11, which is deleted below.
insert into public.problem_reports (
  id, organization_id, reporter_id, filed_by_id, created_at, status, closed_at,
  description, context, originals_deleted_at, scrubbed_description, scrub_state
) values
('33100000-0000-0000-0000-000000000020', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '13 months', 'eingegangen', null, 'Speichern geht nicht', '{"routeTemplate":"/auftraege"}',
 null, 'Speichern geht nicht', 'bereinigt'),
('33100000-0000-0000-0000-000000000021', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '4 months', 'erledigt', now() - interval '91 days', 'Liste leer', '{}', null, null, 'ausstehend'),
('33100000-0000-0000-0000-000000000022', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '4 months', 'abgelehnt', now() - interval '30 days', 'Bitte dunkler', '{}', null, null, 'ausstehend'),
('33100000-0000-0000-0000-000000000023', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '6 months', 'in_bearbeitung', null, 'Knopf fehlt', '{}', null, null, 'ausstehend'),
('33100000-0000-0000-0000-000000000024', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '26 months', 'erledigt', now() - interval '25 months', null, null,
 now() - interval '22 months', 'Alt', 'bereinigt'),
('33100000-0000-0000-0000-000000000025', '33100000-0000-0000-0000-000000000011',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now(), 'eingegangen', null, 'Andere Firma', '{}', null, null, 'ausstehend');

insert into public.problem_report_files (
  id, organization_id, report_id, kind, storage_path, file_name, mime_type, size_bytes
) values
('33100000-0000-0000-0000-000000000030', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000020', 'screenshot',
 '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000020/f30/bild.png',
 'bild.png', 'image/png', 10),
('33100000-0000-0000-0000-000000000031', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000020', 'anhang',
 '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000020/f31/foto.jpg',
 'foto.jpg', 'image/jpeg', 10),
('33100000-0000-0000-0000-000000000032', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000022', 'anhang',
 '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000022/f32/plan.pdf',
 'plan.pdf', 'application/pdf', 10),
('33100000-0000-0000-0000-000000000033', '33100000-0000-0000-0000-000000000011',
 '33100000-0000-0000-0000-000000000025', 'screenshot',
 '33100000-0000-0000-0000-000000000011/problem-reports/33100000-0000-0000-0000-000000000025/f33/bild.png',
 'bild.png', 'image/png', 10);

insert into public.problem_report_events (id, organization_id, report_id, event_type, actor_id) values
('33100000-0000-0000-0000-000000000040', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000020', 'original_opened', '33100000-0000-0000-0000-000000000001'),
('33100000-0000-0000-0000-000000000041', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000024', 'status_changed', '33100000-0000-0000-0000-000000000001');

-- Client roles hold no privilege on a report table and execute no report function.
do $$
declare
  v_table text;
  v_role text;
begin
  foreach v_table in array array['problem_reports', 'problem_report_files', 'problem_report_events'] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, 'public.' || v_table, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
        or has_any_column_privilege(v_role, 'public.' || v_table, 'SELECT,INSERT,UPDATE')
      then raise exception '% holds a privilege on %', v_role, v_table; end if;
    end loop;
  end loop;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.apply_problem_report_retention(uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_problem_reports_due_for_retention(integer, uuid)', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.register_problem_report_file(uuid, uuid, uuid, uuid, text, text, text, text, bigint, integer)',
        'EXECUTE')
      or has_function_privilege(v_role,
        'app_private.problem_report_retention_step(timestamptz, timestamptz, timestamptz)', 'EXECUTE')
    then raise exception '% executes a report function', v_role; end if;
  end loop;
end;
$$;

-- The reporter, signed in, reads and writes nothing through the Data API role.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
begin
  begin
    perform 1 from public.problem_reports;
    raise exception 'authenticated read a report';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.problem_reports (organization_id, reporter_id, description, context)
    values ('33100000-0000-0000-0000-000000000010', '33100000-0000-0000-0000-000000000002', 'x', '{}');
    raise exception 'authenticated wrote a report';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.problem_report_files;
    raise exception 'authenticated read a report file';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.problem_report_events;
    raise exception 'authenticated read the report history';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The history refuses UPDATE and DELETE: the service role holds no grant
-- for either, and the trigger refuses the owner role that holds every grant.
set local role service_role;
do $$
begin
  begin
    update public.problem_report_events set payload = '{"x":1}'
    where id = '33100000-0000-0000-0000-000000000040';
    raise exception 'service-role history update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.problem_report_events where id = '33100000-0000-0000-0000-000000000040';
    raise exception 'service-role history delete was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
begin
  begin
    update public.problem_report_events set payload = '{"x":1}'
    where id = '33100000-0000-0000-0000-000000000040';
    raise exception 'history update was accepted';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_history_append_only' then raise; end if;
  end;
  begin
    delete from public.problem_report_events where id = '33100000-0000-0000-0000-000000000040';
    raise exception 'history delete was accepted';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_history_append_only' then raise; end if;
  end;
end;
$$;

-- A report refuses a direct deletion and a change of its originals or its
-- reporter; its triage fields stay writable for the server.
set local role service_role;
do $$
begin
  begin
    delete from public.problem_reports where id = '33100000-0000-0000-0000-000000000023';
    raise exception 'direct report deletion was accepted';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_deletion_forbidden' then raise; end if;
  end;
  begin
    update public.problem_reports set description = 'geändert' where id = '33100000-0000-0000-0000-000000000023';
    raise exception 'original description change was accepted';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_originals_immutable' then raise; end if;
  end;
  begin
    update public.problem_reports set reporter_id = '33100000-0000-0000-0000-000000000001'
    where id = '33100000-0000-0000-0000-000000000023';
    raise exception 'reporter change was accepted';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_identity_immutable' then raise; end if;
  end;
  -- Triage fields stay writable for the server.
  update public.problem_reports set status = 'erledigt', closed_at = now(), response = 'Behoben'
  where id = '33100000-0000-0000-0000-000000000023';
  update public.problem_reports set status = 'in_bearbeitung', closed_at = null, response = null
  where id = '33100000-0000-0000-0000-000000000023';
end;
$$;

-- A file registers only for the report's own filer while its originals
-- exist: one screenshot, and attachments up to the given limit.
do $$
declare
  v_org constant uuid := '33100000-0000-0000-0000-000000000010';
  v_report constant uuid := '33100000-0000-0000-0000-000000000023';
  v_worker constant uuid := '33100000-0000-0000-0000-000000000002';
  v_prefix constant text := '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000023/';
begin
  begin
    perform public.register_problem_report_file('33100000-0000-0000-0000-000000000001', v_org, v_report,
      gen_random_uuid(), 'anhang', v_prefix || 'a/x.pdf', 'x.pdf', 'application/pdf', 1, 2);
    raise exception 'another member registered a file';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  begin
    perform public.register_problem_report_file(v_worker, '33100000-0000-0000-0000-000000000011', v_report,
      gen_random_uuid(), 'anhang', v_prefix || 'b/x.pdf', 'x.pdf', 'application/pdf', 1, 2);
    raise exception 'a file registered under a foreign organization';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  perform public.register_problem_report_file(v_worker, v_org, v_report,
    '33100000-0000-0000-0000-000000000034', 'screenshot', v_prefix || 'f34/bild.png', 'bild.png', 'image/png', 1, 2);
  begin
    perform public.register_problem_report_file(v_worker, v_org, v_report,
      gen_random_uuid(), 'screenshot', v_prefix || 'c/bild.png', 'bild.png', 'image/png', 1, 2);
    raise exception 'a second screenshot registered';
  exception when raise_exception then
    if sqlerrm <> 'screenshot_exists' then raise; end if;
  end;
  begin
    perform public.register_problem_report_file(v_worker, v_org, v_report,
      '33100000-0000-0000-0000-000000000034', 'anhang', v_prefix || 'd/x.pdf', 'x.pdf', 'application/pdf', 1, 2);
    raise exception 'a finalized file registered again';
  exception when raise_exception then
    if sqlerrm <> 'already_finalized' then raise; end if;
  end;
  perform public.register_problem_report_file(v_worker, v_org, v_report,
    gen_random_uuid(), 'anhang', v_prefix || 'e/x.pdf', 'x.pdf', 'application/pdf', 1, 1);
  begin
    perform public.register_problem_report_file(v_worker, v_org, v_report,
      gen_random_uuid(), 'anhang', v_prefix || 'g/y.pdf', 'y.pdf', 'application/pdf', 1, 1);
    raise exception 'an attachment beyond the limit registered';
  exception when raise_exception then
    if sqlerrm <> 'too_many_attachments' then raise; end if;
  end;
  begin
    perform public.register_problem_report_file(v_worker, v_org, '33100000-0000-0000-0000-000000000024',
      gen_random_uuid(), 'anhang', v_org || '/problem-reports/33100000-0000-0000-0000-000000000024/h/x.pdf',
      'x.pdf', 'application/pdf', 1, 2);
    raise exception 'a file registered after the originals were deleted';
  exception when raise_exception then
    if sqlerrm <> 'report_originals_deleted' then raise; end if;
  end;
end;
$$;

-- Only the due reports are listed, in id order and after the given id.
do $$
begin
  if array(select public.list_problem_reports_due_for_retention(10)) is distinct from array[
    '33100000-0000-0000-0000-000000000020', '33100000-0000-0000-0000-000000000021',
    '33100000-0000-0000-0000-000000000024'
  ]::uuid[] then raise exception 'the due list is wrong: %', array(select public.list_problem_reports_due_for_retention(10)); end if;
  if array(select public.list_problem_reports_due_for_retention(1, '33100000-0000-0000-0000-000000000020'))
    is distinct from array['33100000-0000-0000-0000-000000000021']::uuid[]
  then raise exception 'the due list does not page after the given id'; end if;
end;
$$;

-- Retention deletes due originals only: the description, the context and
-- every file row, whose paths it queues; the scrubbed copy, the status and
-- the history stay. A report not yet due keeps everything.
do $$
declare
  v_org constant uuid := '33100000-0000-0000-0000-000000000010';
begin
  if public.apply_problem_report_retention('33100000-0000-0000-0000-000000000020') <> 'originals_deleted'
    or public.apply_problem_report_retention('33100000-0000-0000-0000-000000000021') <> 'originals_deleted'
  then raise exception 'due originals were not deleted'; end if;
  if public.apply_problem_report_retention('33100000-0000-0000-0000-000000000022') <> 'not_due'
    or public.apply_problem_report_retention('33100000-0000-0000-0000-000000000023') <> 'not_due'
    or public.apply_problem_report_retention(gen_random_uuid()) <> 'not_due'
  then raise exception 'a report that is not due was changed'; end if;

  if exists (
    select 1 from public.problem_reports
    where id in ('33100000-0000-0000-0000-000000000020', '33100000-0000-0000-0000-000000000021')
      and (description is not null or context is not null or originals_deleted_at is null)
  ) then raise exception 'retention kept an original text'; end if;
  if exists (select 1 from public.problem_report_files where report_id = '33100000-0000-0000-0000-000000000020')
  then raise exception 'retention kept a file row'; end if;
  if (select scrubbed_description from public.problem_reports where id = '33100000-0000-0000-0000-000000000020')
    is distinct from 'Speichern geht nicht'
  then raise exception 'retention removed the scrubbed copy'; end if;
  if not exists (select 1 from public.problem_report_events where id = '33100000-0000-0000-0000-000000000040')
  then raise exception 'retention removed the history of a kept report'; end if;
  if (select array_agg(storage_path order by storage_path) from public.storage_purge_queue
      where organization_id = v_org and purge_after = now() + interval '8 days')
    is distinct from array[
      v_org || '/problem-reports/33100000-0000-0000-0000-000000000020/f30/bild.png',
      v_org || '/problem-reports/33100000-0000-0000-0000-000000000020/f31/foto.jpg'
    ]
  then raise exception 'retention did not queue every file path'; end if;
  if (select description from public.problem_reports where id = '33100000-0000-0000-0000-000000000022')
    is distinct from 'Bitte dunkler'
    or not exists (select 1 from public.problem_report_files where id = '33100000-0000-0000-0000-000000000032')
  then raise exception 'retention touched a report that is not due'; end if;
end;
$$;

-- 24 months after closing, the report goes with its scrubbed copy and history.
do $$
begin
  if public.apply_problem_report_retention('33100000-0000-0000-0000-000000000024') <> 'report_deleted' then
    raise exception 'the due report was not deleted';
  end if;
  if exists (select 1 from public.problem_reports where id = '33100000-0000-0000-0000-000000000024')
    or exists (select 1 from public.problem_report_events where id = '33100000-0000-0000-0000-000000000041')
  then raise exception 'the deleted report left rows'; end if;
  if current_setting('app.problem_report_retention', true) is distinct from '' then
    raise exception 'retention left its permission set';
  end if;
  begin
    delete from public.problem_reports where id = '33100000-0000-0000-0000-000000000022';
    raise exception 'a direct deletion passed after a retention call';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_deletion_forbidden' then raise; end if;
  end;
end;
$$;

-- An organization deletion cascades through reports, files and history and
-- queues the files' paths.
reset role;
delete from public.organizations where id = '33100000-0000-0000-0000-000000000011';
do $$
begin
  if exists (select 1 from public.problem_reports where id = '33100000-0000-0000-0000-000000000025') then
    raise exception 'the organization cascade left its report';
  end if;
  if not exists (
    select 1 from public.storage_purge_queue
    where storage_path = '33100000-0000-0000-0000-000000000011/problem-reports/33100000-0000-0000-0000-000000000025/f33/bild.png'
  ) then raise exception 'the organization cascade did not queue the report file'; end if;
end;
$$;

rollback;
