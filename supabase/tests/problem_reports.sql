-- Problem reports (20261128090002_store_problem_reports_privately.sql,
-- werk-flow/werkflow-planning#331, and 20261130100000_report_problems_from_the_app.sql,
-- #334). Client roles read and write no report table and execute none of its
-- functions. Each organization numbers its reports from 1, and a number never
-- changes. A report saves once under its device's id. A file registers only
-- for the report's filer while its originals exist. The history refuses UPDATE
-- and DELETE, also for the service role, and leaves only with its report. A
-- report leaves only through the retention run or a cascade, and its
-- originals change only there. The retention run deletes only due originals,
-- keeps the scrubbed copy, and queues every file path; 24 months after
-- closing it deletes the report. The scrub outcome
-- (20261130090005_keep_the_scrubbed_copy_of_a_problem_report.sql, #332)
-- writes both parts of the copy with the state in one call, only inside the
-- report's organization, and never changes a written copy.
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
 '{"first_name":"Ben","last_name":"Beispiel"}', now(), now()),
('33100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'report-support@example.test', '', now(), '{}',
 '{"first_name":"Cem","last_name":"Beispiel"}', now(), now()),
('33100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'report-leaver@example.test', '', now(), '{}',
 '{"first_name":"Dana","last_name":"Beispiel"}', now(), now());

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
-- 26: support filed it for 4, whose account is deleted below.
insert into public.problem_reports (
  id, organization_id, reporter_id, filed_by_id, created_at, status, closed_at,
  description, context, originals_deleted_at, scrubbed_description, scrubbed_context, scrub_state
) values
('33100000-0000-0000-0000-000000000020', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '13 months', 'eingegangen', null, 'Speichern geht nicht', '{"routeTemplate":"/auftraege"}',
 null, 'Speichern geht nicht', '{"routeTemplate":"/auftraege"}', 'bereinigt'),
('33100000-0000-0000-0000-000000000021', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '4 months', 'erledigt', now() - interval '91 days', 'Liste leer', '{}', null, null, null, 'ausstehend'),
('33100000-0000-0000-0000-000000000022', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '4 months', 'abgelehnt', now() - interval '30 days', 'Bitte dunkler', '{}', null, null, null, 'ausstehend'),
('33100000-0000-0000-0000-000000000023', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '6 months', 'in_bearbeitung', null, 'Knopf fehlt', '{}', null, null, null, 'ausstehend'),
('33100000-0000-0000-0000-000000000024', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now() - interval '26 months', 'erledigt', now() - interval '25 months', null, null,
 now() - interval '22 months', 'Alt', '{}', 'bereinigt'),
('33100000-0000-0000-0000-000000000025', '33100000-0000-0000-0000-000000000011',
 '33100000-0000-0000-0000-000000000002', '33100000-0000-0000-0000-000000000002',
 now(), 'eingegangen', null, 'Andere Firma', '{}', null, null, null, 'ausstehend'),
('33100000-0000-0000-0000-000000000026', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000004', '33100000-0000-0000-0000-000000000003',
 now(), 'eingegangen', null, 'Angerufen', '{}', null, null, null, 'ausstehend');

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
 'bild.png', 'image/png', 10),
('33100000-0000-0000-0000-000000000035', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000026', 'anhang',
 '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000026/f35/anhang',
 'zaehler.jpg', 'image/jpeg', 10);

insert into public.problem_report_events (id, organization_id, report_id, event_type, actor_id) values
('33100000-0000-0000-0000-000000000040', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000020', 'original_opened', '33100000-0000-0000-0000-000000000001'),
('33100000-0000-0000-0000-000000000041', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000024', 'status_changed', '33100000-0000-0000-0000-000000000001'),
('33100000-0000-0000-0000-000000000042', '33100000-0000-0000-0000-000000000010',
 '33100000-0000-0000-0000-000000000023', 'original_opened', '33100000-0000-0000-0000-000000000003');

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
    if has_function_privilege(v_role, 'public.apply_problem_report_retention(uuid, uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_problem_reports_due_for_retention(integer, uuid)', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.register_problem_report_file(uuid, uuid, uuid, uuid, text, text, text, text, bigint, integer)',
        'EXECUTE')
      or has_function_privilege(v_role, 'public.submit_problem_report(uuid, uuid, uuid, text, jsonb)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.record_problem_report_scrub(uuid, uuid, text, jsonb)', 'EXECUTE')
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
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
  end;
  begin
    delete from public.problem_report_events where id = '33100000-0000-0000-0000-000000000040';
    raise exception 'history delete was accepted';
  exception when raise_exception then
    if sqlerrm <> 'event_ledger_history_immutable' then raise; end if;
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

-- Each organization numbers its reports from 1 in sending order, and a
-- number never changes.
do $$
declare
  v_org constant uuid := '33100000-0000-0000-0000-000000000010';
  v_next integer;
begin
  if (select number from public.problem_reports where id = '33100000-0000-0000-0000-000000000025') <> 1 then
    raise exception 'an organization does not number its reports from 1';
  end if;
  v_next := (select max(number) + 1 from public.problem_reports where organization_id = v_org);
  insert into public.problem_reports (id, organization_id, reporter_id, filed_by_id, description, context)
  values ('33100000-0000-0000-0000-000000000027', v_org, '33100000-0000-0000-0000-000000000002',
    '33100000-0000-0000-0000-000000000002', 'Neu', '{}');
  if (select number from public.problem_reports where id = '33100000-0000-0000-0000-000000000027') <> v_next then
    raise exception 'a new report did not take the next number of its organization';
  end if;
  insert into public.problem_reports (id, organization_id, reporter_id, filed_by_id, description, context, number)
  values ('33100000-0000-0000-0000-000000000028', v_org, '33100000-0000-0000-0000-000000000002',
    '33100000-0000-0000-0000-000000000002', 'Eigene Nummer', '{}', 1);
  if (select number from public.problem_reports where id = '33100000-0000-0000-0000-000000000028') <> v_next + 1 then
    raise exception 'a report kept a number the writer chose';
  end if;
  begin
    update public.problem_reports set number = 999 where id = '33100000-0000-0000-0000-000000000027';
    raise exception 'a report number change was accepted';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_identity_immutable' then raise; end if;
  end;
end;
$$;

-- A report saves once under its device's id: a retry gets the same number,
-- and an id of another person's or another organization's report conflicts.
do $$
declare
  v_org constant uuid := '33100000-0000-0000-0000-000000000010';
  v_worker constant uuid := '33100000-0000-0000-0000-000000000002';
  v_report constant uuid := '33100000-0000-0000-0000-000000000029';
  v_first integer;
begin
  v_first := public.submit_problem_report(v_report, v_org, v_worker, 'Einmal', '{}');
  if public.submit_problem_report(v_report, v_org, v_worker, 'Noch einmal', '{}') <> v_first
    or (select count(*) from public.problem_reports where id = v_report) <> 1
    or (select description from public.problem_reports where id = v_report) <> 'Einmal'
  then raise exception 'a retried report save did not find its own report'; end if;
  begin
    perform public.submit_problem_report(v_report, v_org, '33100000-0000-0000-0000-000000000001', 'Fremd', '{}');
    raise exception 'another person reached a report through its id';
  exception when raise_exception then
    if sqlerrm <> 'report_conflict' then raise; end if;
  end;
  begin
    perform public.submit_problem_report(v_report, '33100000-0000-0000-0000-000000000011', v_worker, 'Fremd', '{}');
    raise exception 'a report id reached another organization';
  exception when raise_exception then
    if sqlerrm <> 'report_conflict' then raise; end if;
  end;
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
      gen_random_uuid(), 'anhang', v_prefix || 'a/anhang', 'x.pdf', 'application/pdf', 1, 2);
    raise exception 'another member registered a file';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  begin
    perform public.register_problem_report_file(v_worker, '33100000-0000-0000-0000-000000000011', v_report,
      gen_random_uuid(), 'anhang', v_prefix || 'b/anhang', 'x.pdf', 'application/pdf', 1, 2);
    raise exception 'a file registered under a foreign organization';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  perform public.register_problem_report_file(v_worker, v_org, v_report,
    '33100000-0000-0000-0000-000000000034', 'screenshot', v_prefix || 'f34/screenshot', 'bild.png', 'image/png', 1, 2);
  begin
    perform public.register_problem_report_file(v_worker, v_org, v_report,
      gen_random_uuid(), 'screenshot', v_prefix || 'c/screenshot', 'bild.png', 'image/png', 1, 2);
    raise exception 'a second screenshot registered';
  exception when raise_exception then
    if sqlerrm <> 'screenshot_exists' then raise; end if;
  end;
  begin
    perform public.register_problem_report_file(v_worker, v_org, v_report,
      '33100000-0000-0000-0000-000000000034', 'anhang', v_prefix || 'd/anhang', 'x.pdf', 'application/pdf', 1, 2);
    raise exception 'a finalized file registered again';
  exception when raise_exception then
    if sqlerrm <> 'already_finalized' then raise; end if;
  end;
  perform public.register_problem_report_file(v_worker, v_org, v_report,
    gen_random_uuid(), 'anhang', v_prefix || 'e/anhang', 'x.pdf', 'application/pdf', 1, 1);
  begin
    perform public.register_problem_report_file(v_worker, v_org, v_report,
      gen_random_uuid(), 'anhang', v_prefix || 'g/anhang', 'y.pdf', 'application/pdf', 1, 1);
    raise exception 'an attachment beyond the limit registered';
  exception when raise_exception then
    if sqlerrm <> 'too_many_attachments' then raise; end if;
  end;
  begin
    perform public.register_problem_report_file(v_worker, v_org, '33100000-0000-0000-0000-000000000024',
      gen_random_uuid(), 'anhang', v_org || '/problem-reports/33100000-0000-0000-0000-000000000024/h/anhang',
      'x.pdf', 'application/pdf', 1, 2);
    raise exception 'a file registered after the originals were deleted';
  exception when raise_exception then
    if sqlerrm <> 'report_originals_deleted' then raise; end if;
  end;
end;
$$;

-- A report keeps one screenshot, and a file key lies inside its report.
do $$
begin
  begin
    insert into public.problem_report_files (
      id, organization_id, report_id, kind, storage_path, file_name, mime_type, size_bytes
    ) values (
      gen_random_uuid(), '33100000-0000-0000-0000-000000000010', '33100000-0000-0000-0000-000000000020',
      'screenshot',
      '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000020/f39/bild.png',
      'bild.png', 'image/png', 10
    );
    raise exception 'a second screenshot was stored';
  exception when unique_violation then null;
  end;
  begin
    insert into public.problem_report_files (
      id, organization_id, report_id, kind, storage_path, file_name, mime_type, size_bytes
    ) values (
      gen_random_uuid(), '33100000-0000-0000-0000-000000000010', '33100000-0000-0000-0000-000000000020',
      'anhang', '33100000-0000-0000-0000-000000000010/d1/foto.jpg', 'foto.jpg', 'image/jpeg', 10
    );
    raise exception 'a file key outside its report was stored';
  exception when check_violation then null;
  end;
  -- A report whose originals are gone takes no file, so the run never misses one.
  begin
    insert into public.problem_report_files (
      id, organization_id, report_id, kind, storage_path, file_name, mime_type, size_bytes
    ) values (
      gen_random_uuid(), '33100000-0000-0000-0000-000000000010', '33100000-0000-0000-0000-000000000024',
      'anhang',
      '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000024/f38/anhang',
      'foto.jpg', 'image/jpeg', 10
    );
    raise exception 'a file joined a report without originals';
  exception when raise_exception then
    if sqlerrm <> 'report_originals_deleted' then raise; end if;
  end;
  -- A file leaves only through the run or with its report.
  begin
    delete from public.problem_report_files where id = '33100000-0000-0000-0000-000000000032';
    raise exception 'a direct file deletion was accepted';
  exception when raise_exception then
    if sqlerrm <> 'problem_report_file_deletion_forbidden' then raise; end if;
  end;
end;
$$;

-- A nested trigger of another table is no cascade: it deletes no report,
-- file or history while their parents exist.
reset role;
create table pg_temp.cascade_probe (target text);
create function pg_temp.delete_report_rows() returns trigger language plpgsql as $probe$
begin
  if new.target = 'report' then
    delete from public.problem_reports where id = '33100000-0000-0000-0000-000000000023';
  elsif new.target = 'file' then
    delete from public.problem_report_files where id = '33100000-0000-0000-0000-000000000032';
  else
    delete from public.problem_report_events where id = '33100000-0000-0000-0000-000000000040';
  end if;
  return new;
end;
$probe$;
create trigger delete_report_rows after insert on pg_temp.cascade_probe
  for each row execute function pg_temp.delete_report_rows();
do $$
declare
  v_target text;
begin
  foreach v_target in array array['report', 'file', 'history'] loop
    begin
      insert into pg_temp.cascade_probe values (v_target);
      raise exception 'a nested trigger deleted a % row', v_target;
    exception when raise_exception then
      if sqlerrm not in (
        'problem_report_deletion_forbidden', 'problem_report_file_deletion_forbidden',
        'event_ledger_history_immutable'
      ) then raise; end if;
    end;
  end loop;
end;
$$;
drop table pg_temp.cascade_probe;
set local role service_role;

-- The scrub outcome writes both parts of the copy and the state in one call.
-- No copy is the failed state, and a later scrub may still succeed. A written
-- copy never changes: not through a failed run beside it, not through a
-- second copy. A report named under another organization is not found, half
-- a copy is refused, and the original stays as it was.
do $$
declare
  v_org constant uuid := '33100000-0000-0000-0000-000000000010';
  v_report constant uuid := '33100000-0000-0000-0000-000000000022';
begin
  begin
    perform public.record_problem_report_scrub('33100000-0000-0000-0000-000000000011', v_report, 'Kopie', '{}');
    raise exception 'a scrub wrote a report named under another organization';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  begin
    perform public.record_problem_report_scrub(v_org, v_report, 'Kopie', null);
    raise exception 'half a scrubbed copy was accepted';
  exception when raise_exception then
    if sqlerrm <> 'scrubbed_copy_incomplete' then raise; end if;
  end;
  if (select scrub_state from public.problem_reports where id = v_report) <> 'ausstehend'
  then raise exception 'a refused scrub changed the report'; end if;

  if public.record_problem_report_scrub(v_org, v_report, null, null) <> 'nicht_bereinigbar'
  then raise exception 'a failed scrub did not answer the failed state'; end if;
  if not exists (
    select 1 from public.problem_reports
    where id = v_report and scrub_state = 'nicht_bereinigbar'
      and scrubbed_description is null and scrubbed_context is null
  ) then raise exception 'a failed scrub left a copy or the wrong state'; end if;
  if public.record_problem_report_scrub(v_org, v_report, 'Bitte [Person 1] dunkler', '{"offline":false}')
    <> 'bereinigt'
  then raise exception 'a scrub after a failed one was not written'; end if;
  if public.record_problem_report_scrub(v_org, v_report, null, null) <> 'bereinigt'
    or public.record_problem_report_scrub(v_org, v_report, 'Andere Kopie', '{}') <> 'bereinigt'
  then raise exception 'a report with its copy did not answer `bereinigt`'; end if;
  if not exists (
    select 1 from public.problem_reports
    where id = v_report and scrub_state = 'bereinigt' and description = 'Bitte dunkler'
      and scrubbed_description = 'Bitte [Person 1] dunkler' and scrubbed_context = '{"offline":false}'
  ) then raise exception 'a written scrubbed copy changed, or the scrub changed the original'; end if;

  -- The state and both parts of the copy agree, whoever writes the row.
  begin
    update public.problem_reports set scrub_state = 'bereinigt', scrubbed_description = 'Kopie'
    where id = '33100000-0000-0000-0000-000000000023';
    raise exception 'a scrubbed state without the scrubbed context was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.problem_reports
    set scrub_state = 'bereinigt', scrubbed_description = 'Kopie', scrubbed_context = '[]'
    where id = '33100000-0000-0000-0000-000000000023';
    raise exception 'a scrubbed context that is no object was accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Only the due reports are listed, in id order and after the given id.
do $$
begin
  if array(select id from public.list_problem_reports_due_for_retention(10)) is distinct from array[
    '33100000-0000-0000-0000-000000000020', '33100000-0000-0000-0000-000000000021',
    '33100000-0000-0000-0000-000000000024'
  ]::uuid[] then raise exception 'the due list is wrong: %', array(select id from public.list_problem_reports_due_for_retention(10)); end if;
  if array(select id from public.list_problem_reports_due_for_retention(1, '33100000-0000-0000-0000-000000000020'))
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
  if public.apply_problem_report_retention('33100000-0000-0000-0000-000000000011', '33100000-0000-0000-0000-000000000020')
    <> 'not_due'
    or (select description from public.problem_reports where id = '33100000-0000-0000-0000-000000000020') is null
  then raise exception 'retention changed a report named under another organization'; end if;
  if public.apply_problem_report_retention(v_org, '33100000-0000-0000-0000-000000000020') <> 'originals_deleted'
    or public.apply_problem_report_retention(v_org, '33100000-0000-0000-0000-000000000021') <> 'originals_deleted'
  then raise exception 'due originals were not deleted'; end if;
  if public.apply_problem_report_retention(v_org, '33100000-0000-0000-0000-000000000022') <> 'not_due'
    or public.apply_problem_report_retention(v_org, '33100000-0000-0000-0000-000000000023') <> 'not_due'
    or public.apply_problem_report_retention(v_org, gen_random_uuid()) <> 'not_due'
  then raise exception 'a report that is not due was changed'; end if;

  if exists (
    select 1 from public.problem_reports
    where id in ('33100000-0000-0000-0000-000000000020', '33100000-0000-0000-0000-000000000021')
      and (description is not null or context is not null or originals_deleted_at is null)
  ) then raise exception 'retention kept an original text'; end if;
  if exists (select 1 from public.problem_report_files where report_id = '33100000-0000-0000-0000-000000000020')
  then raise exception 'retention kept a file row'; end if;
  if not exists (
    select 1 from public.problem_reports
    where id = '33100000-0000-0000-0000-000000000020' and scrubbed_description = 'Speichern geht nicht'
      and scrubbed_context = '{"routeTemplate":"/auftraege"}'
  ) then raise exception 'retention removed the scrubbed copy'; end if;
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
declare
  v_org constant uuid := '33100000-0000-0000-0000-000000000010';
begin
  if public.apply_problem_report_retention(v_org, '33100000-0000-0000-0000-000000000024') <> 'report_deleted' then
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

-- A deleted account takes the reports it reported along and queues their
-- files; the history it wrote on another person's report stays, and a
-- report it filed for someone else loses only its filer.
delete from auth.users where id = '33100000-0000-0000-0000-000000000003';
do $$
begin
  if (select actor_id from public.problem_report_events where id = '33100000-0000-0000-0000-000000000042')
    is distinct from '33100000-0000-0000-0000-000000000003'
  then raise exception 'the account deletion changed the history it wrote'; end if;
  if (select filed_by_id from public.problem_reports where id = '33100000-0000-0000-0000-000000000026')
    is not null
  then raise exception 'the account deletion kept the filer'; end if;
end;
$$;
delete from auth.users where id = '33100000-0000-0000-0000-000000000004';
do $$
begin
  if exists (select 1 from public.problem_reports where id = '33100000-0000-0000-0000-000000000026') then
    raise exception 'the account deletion kept its report';
  end if;
  if not exists (
    select 1 from public.storage_purge_queue
    where storage_path = '33100000-0000-0000-0000-000000000010/problem-reports/33100000-0000-0000-0000-000000000026/f35/anhang'
  ) then raise exception 'the account deletion did not queue the report file'; end if;
end;
$$;

rollback;
