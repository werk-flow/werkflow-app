-- Support's triage of problem reports
-- (20261201100002_triage_problem_reports_as_support.sql,
-- werk-flow/werkflow-planning#335). Client roles execute neither function.
-- A triage writes one history entry per field that really changes, with the
-- actor, and none for a field that stays. Closing sets the closing time and
-- reopening clears it. A report of another organization and an unknown id
-- read as `report_not_found`. A report filed for a caller names the member as
-- reporter and the support person as filer, and is refused for a person who
-- is no member of the organization. An opening of an original is one
-- history entry. Each person reads only their own signal rows. The
-- reporter's row moves on a status or answer change and a report filed for
-- them, not on a bucket or assignee change; the named support persons' rows
-- move on every change, filing and opening, skipping an id without a profile.
-- A write from an outdated state of a field it changes is refused.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('33500000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'triage-admin@example.test', '', now(), '{}',
 '{"first_name":"Ada","last_name":"Muster"}', now(), now()),
('33500000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'triage-worker@example.test', '', now(), '{}',
 '{"first_name":"Ben","last_name":"Muster"}', now(), now()),
('33500000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'triage-support@example.test', '', now(), '{}',
 '{"first_name":"Cem","last_name":"Muster"}', now(), now()),
('33500000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'triage-outsider@example.test', '', now(), '{}',
 '{"first_name":"Dana","last_name":"Muster"}', now(), now()),
('33500000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'triage-caller@example.test', '', now(), '{}',
 '{"first_name":"Eva","last_name":"Muster"}', now(), now()),
('33500000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'triage-colleague@example.test', '', now(), '{}',
 '{"first_name":"Finn","last_name":"Muster"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('33500000-0000-0000-0000-000000000010', 'Triage GmbH', '33500000-0000-0000-0000-000000000001', 'TRIAGE10'),
('33500000-0000-0000-0000-000000000011', 'Andere GmbH', '33500000-0000-0000-0000-000000000001', 'TRIAGE11');
insert into public.organization_members (organization_id, user_id, role) values
('33500000-0000-0000-0000-000000000010', '33500000-0000-0000-0000-000000000002', 'employee'),
('33500000-0000-0000-0000-000000000010', '33500000-0000-0000-0000-000000000005', 'employee');

insert into public.problem_reports (id, organization_id, reporter_id, filed_by_id, description, context) values
('33500000-0000-0000-0000-000000000020', '33500000-0000-0000-0000-000000000010',
 '33500000-0000-0000-0000-000000000002', '33500000-0000-0000-0000-000000000002', 'Speichern geht nicht', '{}');

-- Client roles execute no support function and write no signal row.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.triage_problem_report(uuid, uuid, uuid, jsonb, jsonb, uuid[])', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.file_problem_report_for_caller(uuid, uuid, uuid, uuid, text, uuid[])', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.record_problem_report_opening(uuid, uuid, uuid, uuid, uuid[])', 'EXECUTE')
      or has_function_privilege(v_role, 'app_private.signal_problem_report_users(uuid, uuid[])', 'EXECUTE')
    then raise exception '% executes a support function', v_role; end if;
    if has_table_privilege(v_role, 'public.problem_report_signals', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    then raise exception '% writes the report signals', v_role; end if;
  end loop;
  if has_table_privilege('anon', 'public.problem_report_signals', 'SELECT') then
    raise exception 'anon reads the report signals';
  end if;
end;
$$;

set local role service_role;

-- A triage writes one history entry per changed field, with the actor, and
-- keeps the answer's text out of the history.
do $$
declare
  v_org constant uuid := '33500000-0000-0000-0000-000000000010';
  v_report constant uuid := '33500000-0000-0000-0000-000000000020';
  v_support constant uuid := '33500000-0000-0000-0000-000000000003';
  v_colleague constant uuid := '33500000-0000-0000-0000-000000000006';
  v_ghost constant uuid := '33500000-0000-0000-0000-0000000000ff';
  v_row public.problem_reports%rowtype;
  v_signal timestamptz;
begin
  -- Bucket and assignee change nothing the reporter reads: no signal.
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('bucket', 'fehler', 'assignee_id', v_support),
    jsonb_build_object('bucket', null, 'assignee_id', null), array[v_colleague, v_ghost]);
  select * into v_row from public.problem_reports where id = v_report;
  if v_row.bucket <> 'fehler' or v_row.assignee_id <> v_support or v_row.status <> 'eingegangen' then
    raise exception 'a triage did not set bucket and assignee alone';
  end if;
  if (select array_agg(event_type order by event_type) from public.problem_report_events
      where report_id = v_report and actor_id = v_support)
    <> array['assignee_changed', 'bucket_changed'] then
    raise exception 'a triage did not write one history entry per changed field';
  end if;
  if (select payload from public.problem_report_events
      where report_id = v_report and event_type = 'bucket_changed')
    <> jsonb_build_object('from', null, 'to', 'fehler') then
    raise exception 'a bucket change did not record its old and new value';
  end if;
  if exists (select 1 from public.problem_report_signals
             where organization_id = v_org and user_id = '33500000-0000-0000-0000-000000000002') then
    raise exception 'a bucket or assignee change signalled the reporter';
  end if;
  -- Any change signals the support persons the server named; an id without a
  -- profile is skipped, and the actor is signalled only when named.
  if (select array_agg(user_id) from public.problem_report_signals where organization_id = v_org)
    is distinct from array[v_colleague] then
    raise exception 'a triage did not signal exactly the named support persons with a profile';
  end if;

  -- The same values again change nothing and write nothing.
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('bucket', 'fehler', 'assignee_id', v_support),
    jsonb_build_object('bucket', 'fehler', 'assignee_id', v_support), null);
  if (select count(*) from public.problem_report_events where report_id = v_report) <> 2 then
    raise exception 'an unchanged field wrote a history entry';
  end if;

  -- Closing with an answer: the closing time is set, the reporter is signalled.
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('status', 'erledigt', 'response', 'Behoben, ab morgen live.'),
    jsonb_build_object('status', 'eingegangen', 'response', null), null);
  select * into v_row from public.problem_reports where id = v_report;
  if v_row.status <> 'erledigt' or v_row.closed_at is null or v_row.response <> 'Behoben, ab morgen live.'
    or v_row.bucket <> 'fehler' then
    raise exception 'closing a report did not set its status, closing time and answer alone';
  end if;
  if (select payload from public.problem_report_events
      where report_id = v_report and event_type = 'response_changed') <> '{}'::jsonb then
    raise exception 'the history kept the text of an answer';
  end if;
  if (select payload from public.problem_report_events
      where report_id = v_report and event_type = 'status_changed')
    <> jsonb_build_object('from', 'eingegangen', 'to', 'erledigt') then
    raise exception 'a status change did not record its old and new value';
  end if;
  select updated_at into v_signal from public.problem_report_signals
  where organization_id = v_org and user_id = '33500000-0000-0000-0000-000000000002';
  if v_signal is null then raise exception 'a status change did not signal the reporter'; end if;

  -- Reopening clears the closing time; clearing the assignee is a change too.
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('status', 'in_bearbeitung', 'assignee_id', null),
    jsonb_build_object('status', 'erledigt', 'assignee_id', v_support), null);
  select * into v_row from public.problem_reports where id = v_report;
  if v_row.status <> 'in_bearbeitung' or v_row.closed_at is not null or v_row.assignee_id is not null then
    raise exception 'reopening a report did not clear its closing time and assignee';
  end if;
  if (select count(*) from public.problem_report_signals
      where organization_id = v_org and user_id = '33500000-0000-0000-0000-000000000002') <> 1 then
    raise exception 'a second change added a second signal row for the same reporter';
  end if;
end;
$$;

-- An unknown report, a report under another organization, a key outside the
-- four fields and a value outside its vocabulary are refused and write nothing.
do $$
declare
  v_org constant uuid := '33500000-0000-0000-0000-000000000010';
  v_report constant uuid := '33500000-0000-0000-0000-000000000020';
  v_support constant uuid := '33500000-0000-0000-0000-000000000003';
  v_events constant bigint := (select count(*) from public.problem_report_events);
begin
  begin
    perform public.triage_problem_report(v_org, gen_random_uuid(), v_support, '{"bucket":"wunsch"}',
      '{"bucket":null}', null);
    raise exception 'a triage of an unknown report was accepted';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  begin
    perform public.triage_problem_report('33500000-0000-0000-0000-000000000011', v_report, v_support,
      '{"bucket":"wunsch"}', '{"bucket":null}', null);
    raise exception 'a triage reached a report through another organization';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  begin
    perform public.triage_problem_report(v_org, v_report, v_support, '{"description":"geändert"}',
      '{"description":"Speichern geht nicht"}', null);
    raise exception 'a triage changed a field outside its four';
  exception when raise_exception then
    if sqlerrm <> 'invalid_triage' then raise; end if;
  end;
  begin
    perform public.triage_problem_report(v_org, v_report, v_support, '{"status":null}',
      '{"status":"in_bearbeitung"}', null);
    raise exception 'a triage emptied the status';
  exception when raise_exception then
    if sqlerrm <> 'invalid_triage' then raise; end if;
  end;
  begin
    perform public.triage_problem_report(v_org, v_report, v_support, '{"bucket":"dringend"}',
      '{"bucket":"fehler"}', null);
    raise exception 'a bucket outside the four was accepted';
  exception when check_violation then null;
  end;
  if (select count(*) from public.problem_report_events) <> v_events then
    raise exception 'a refused triage wrote history';
  end if;
end;
$$;

-- A write names the values its page showed for the fields it changes. Two
-- writes from the same state: the first is saved, the second is refused as
-- `triage_conflict` and writes nothing, so it never replaces the newer answer.
-- A change of another field from that state is no conflict. A write whose
-- expected values name other fields than its changes, and a new assignee
-- without an account, are refused.
do $$
declare
  v_org constant uuid := '33500000-0000-0000-0000-000000000010';
  v_report constant uuid := '33500000-0000-0000-0000-000000000020';
  v_support constant uuid := '33500000-0000-0000-0000-000000000003';
  v_colleague constant uuid := '33500000-0000-0000-0000-000000000006';
  v_seen constant jsonb := jsonb_build_object('response', 'Behoben, ab morgen live.');
  v_events bigint;
begin
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('response', 'Erste Antwort'), v_seen, null);
  v_events := (select count(*) from public.problem_report_events);
  begin
    perform public.triage_problem_report(v_org, v_report, v_colleague,
      jsonb_build_object('response', 'Zweite Antwort'), v_seen, null);
    raise exception 'a write from an outdated state replaced a newer answer';
  exception when raise_exception then
    if sqlerrm <> 'triage_conflict' then raise; end if;
  end;
  if (select response from public.problem_reports where id = v_report) <> 'Erste Antwort'
    or (select count(*) from public.problem_report_events) <> v_events then
    raise exception 'a refused write changed the report or its history';
  end if;

  perform public.triage_problem_report(v_org, v_report, v_colleague,
    jsonb_build_object('bucket', 'wunsch'), jsonb_build_object('bucket', 'fehler'), null);
  if (select bucket from public.problem_reports where id = v_report) <> 'wunsch' then
    raise exception 'a change of another field from the same state was refused';
  end if;

  begin
    perform public.triage_problem_report(v_org, v_report, v_support,
      jsonb_build_object('bucket', 'fehler'), '{}'::jsonb, null);
    raise exception 'a write without its expected values was accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid_triage' then raise; end if;
  end;
  begin
    perform public.triage_problem_report(v_org, v_report, v_support,
      jsonb_build_object('assignee_id', '33500000-0000-0000-0000-0000000000ff'),
      jsonb_build_object('assignee_id', null), null);
    raise exception 'an assignee without an account was accepted';
  exception when raise_exception then
    if sqlerrm <> 'assignee_not_support' then raise; end if;
  end;
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('bucket', 'fehler'), jsonb_build_object('bucket', 'wunsch'), null);

  -- An assignee is compared as an id, whatever the case of its spelling.
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('assignee_id', v_support), jsonb_build_object('assignee_id', null), null);
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('assignee_id', null),
    jsonb_build_object('assignee_id', upper(v_support::text)), null);
  if (select assignee_id from public.problem_reports where id = v_report) is not null then
    raise exception 'an assignee spelled in upper case read as a conflict';
  end if;
end;
$$;

-- A report filed for a caller names the member as reporter and support as
-- filer, starts pending, saves once, and signals the reporter. A person who
-- is no member of the organization is refused.
do $$
declare
  v_org constant uuid := '33500000-0000-0000-0000-000000000010';
  v_worker constant uuid := '33500000-0000-0000-0000-000000000005';
  v_support constant uuid := '33500000-0000-0000-0000-000000000003';
  v_report constant uuid := '33500000-0000-0000-0000-000000000021';
  v_row public.problem_reports%rowtype;
  v_number integer;
begin
  v_number := public.file_problem_report_for_caller(v_report, v_org, v_worker, v_support, 'Am Telefon gemeldet', null);
  select * into v_row from public.problem_reports where id = v_report;
  if v_row.reporter_id <> v_worker or v_row.filed_by_id <> v_support or v_row.number <> v_number
    or v_row.status <> 'eingegangen' or v_row.scrub_state <> 'ausstehend'
    or v_row.scrubbed_description is not null or v_row.context <> '{}'::jsonb then
    raise exception 'a report filed for a caller did not name reporter and filer, or did not start pending';
  end if;
  if not exists (select 1 from public.problem_report_signals where organization_id = v_org and user_id = v_worker) then
    raise exception 'a report filed for a caller did not signal the reporter';
  end if;
  if public.file_problem_report_for_caller(v_report, v_org, v_worker, v_support, 'Noch einmal', null) <> v_number
    or (select description from public.problem_reports where id = v_report) <> 'Am Telefon gemeldet' then
    raise exception 'a retried filing did not find its own report';
  end if;
  -- The filer, and nobody else, adds the attachments.
  perform public.register_problem_report_file(v_support, v_org, v_report, gen_random_uuid(), 'anhang',
    v_org::text || '/problem-reports/' || v_report::text || '/a/anhang', 'zaehler.jpg', 'image/jpeg', 1, 5);
  begin
    perform public.file_problem_report_for_caller(gen_random_uuid(), v_org,
      '33500000-0000-0000-0000-000000000004', v_support, 'Kein Mitglied', null);
    raise exception 'a report was filed for a person outside the organization';
  exception when raise_exception then
    if sqlerrm <> 'reporter_not_member' then raise; end if;
  end;
  begin
    perform public.file_problem_report_for_caller(gen_random_uuid(), '33500000-0000-0000-0000-000000000011',
      v_worker, v_support, 'Falsche Firma', null);
    raise exception 'a report was filed for a member under another organization';
  exception when raise_exception then
    if sqlerrm <> 'reporter_not_member' then raise; end if;
  end;
  begin
    perform public.file_problem_report_for_caller(v_report, v_org, v_worker,
      '33500000-0000-0000-0000-000000000001', 'Anderer Aufnehmer', null);
    raise exception 'another filer reached a filed report through its id';
  exception when raise_exception then
    if sqlerrm <> 'report_conflict' then raise; end if;
  end;
  -- C4's own-report save still refuses a filer who is not the reporter.
  begin
    perform public.submit_problem_report(v_report, v_org, v_worker, 'Eigene', '{}');
    raise exception 'the reporter took over a report support filed';
  exception when raise_exception then
    if sqlerrm <> 'report_conflict' then raise; end if;
  end;
end;
$$;

-- An opening of an original is one history entry with the actor, naming the
-- attachment it opened, and signals the named support persons; a report of
-- another organization is refused and writes nothing.
do $$
declare
  v_org constant uuid := '33500000-0000-0000-0000-000000000010';
  v_report constant uuid := '33500000-0000-0000-0000-000000000020';
  v_support constant uuid := '33500000-0000-0000-0000-000000000003';
  v_file constant uuid := '33500000-0000-0000-0000-000000000040';
  v_events bigint;
begin
  perform public.record_problem_report_opening(v_org, v_report, v_support, null,
    array['33500000-0000-0000-0000-000000000006'::uuid]);
  perform public.record_problem_report_opening(v_org, v_report, v_support, v_file, null);
  if (select array_agg(payload order by payload ? 'file_id') from public.problem_report_events
      where report_id = v_report and event_type = 'original_opened' and actor_id = v_support)
    is distinct from array['{}'::jsonb, jsonb_build_object('file_id', v_file)] then
    raise exception 'an opening did not record one entry, naming the attachment it opened';
  end if;
  v_events := (select count(*) from public.problem_report_events);
  begin
    perform public.record_problem_report_opening('33500000-0000-0000-0000-000000000011', v_report, v_support,
      null, null);
    raise exception 'an opening reached a report through another organization';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
  if (select count(*) from public.problem_report_events) <> v_events then
    raise exception 'a refused opening wrote history';
  end if;
end;
$$;

-- The service role deletes no signal row by hand: it holds no grant.
do $$
begin
  delete from public.problem_report_signals;
  raise exception 'service-role signal delete was accepted';
exception when insufficient_privilege then null;
end;
$$;
reset role;

-- Only the reporter reads their own signal row; an admin of the same
-- organization reads none, and nobody reads a report table.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"33500000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.problem_report_signals) <> 1 then
    raise exception 'the reporter did not read exactly their own signal row';
  end if;
  begin
    update public.problem_report_signals set updated_at = now();
    raise exception 'the reporter wrote a signal row';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claims',
  '{"sub":"33500000-0000-0000-0000-000000000006","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.problem_report_signals
             where user_id <> '33500000-0000-0000-0000-000000000006')
    or not exists (select 1 from public.problem_report_signals) then
    raise exception 'a support person did not read exactly their own signal rows';
  end if;
end;
$$;
select set_config('request.jwt.claims',
  '{"sub":"33500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.problem_report_signals) then
    raise exception 'an admin read a colleague''s signal row';
  end if;
  begin
    perform 1 from public.problem_reports;
    raise exception 'an admin read a report';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- A deleted account empties the assignee it held and takes its signal row along.
do $$
declare
  v_leaver constant uuid := '33500000-0000-0000-0000-000000000004';
begin
  perform public.triage_problem_report('33500000-0000-0000-0000-000000000010',
    '33500000-0000-0000-0000-000000000020', '33500000-0000-0000-0000-000000000003',
    jsonb_build_object('assignee_id', v_leaver), jsonb_build_object('assignee_id', null), null);
  perform app_private.signal_problem_report_users('33500000-0000-0000-0000-000000000011', array[v_leaver]);
  delete from auth.users where id = v_leaver;
  if (select assignee_id from public.problem_reports where id = '33500000-0000-0000-0000-000000000020') is not null then
    raise exception 'a deleted assignee stayed on the report';
  end if;
  if exists (select 1 from public.problem_report_signals where user_id = v_leaver) then
    raise exception 'a signal row outlived its account';
  end if;
  -- Its signal row left without a deletion notice, which would reach every
  -- member of the organization.
  if exists (select 1 from public.realtime_deletions where table_name = 'problem_report_signals') then
    raise exception 'a signal row''s deletion notified the organization';
  end if;
end;
$$;

rollback;
