-- The hand-out of scrubbed problem reports to report threads, and the
-- Agent's write-back (20261201120000_hand_out_scrubbed_problem_reports.sql,
-- werk-flow/werkflow-planning#336). Client roles execute neither hand-out
-- function. The first hand-out claims the report and writes one history
-- entry without an actor in the same call; a second one is refused and writes
-- nothing. A report without a scrubbed copy, a closed one and one of another
-- organization are refused with their codes. The screenshot leaves only a
-- report already handed out, with its own entry. The Agent's write-back is a
-- triage without an actor: it changes only a report it received, sets no
-- assignee and clears no field, an invalid bucket or status is refused, an
-- answer support wrote after the hand-out is a conflict, its
-- history entries carry no actor, its answer is marked, and it signals the
-- reporter and support. Support's next answer clears the mark.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('33600000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'handout-admin@example.test', '', now(), '{}',
 '{"first_name":"Ada","last_name":"Beispiel"}', now(), now()),
('33600000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'handout-worker@example.test', '', now(), '{}',
 '{"first_name":"Ben","last_name":"Beispiel"}', now(), now()),
('33600000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'handout-support@example.test', '', now(), '{}',
 '{"first_name":"Cem","last_name":"Beispiel"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('33600000-0000-0000-0000-000000000010', 'Übergabe GmbH', '33600000-0000-0000-0000-000000000001', 'HANDOUT10'),
('33600000-0000-0000-0000-000000000011', 'Andere GmbH', '33600000-0000-0000-0000-000000000001', 'HANDOUT11');
insert into public.organization_members (organization_id, user_id, role) values
('33600000-0000-0000-0000-000000000010', '33600000-0000-0000-0000-000000000002', 'employee');

-- 20 open with a copy and a screenshot, 21 waiting for its scrub, 22 not
-- scrubbable, 23 closed with a copy, 24 open with a copy and no screenshot,
-- all sent an hour ago; 25 open with a copy, sent just now.
insert into public.problem_reports (
  id, organization_id, reporter_id, filed_by_id, description, context,
  scrub_state, scrubbed_description, scrubbed_context, status, closed_at, created_at
) values
('33600000-0000-0000-0000-000000000020', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002',
 'Bei Familie Beispiel speichert nichts', '{}', 'bereinigt', 'Bei [Person 1] speichert nichts', '{}', 'eingegangen', null, now() - interval '1 hour'),
('33600000-0000-0000-0000-000000000021', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002',
 'Noch nicht bereinigt', '{}', 'ausstehend', null, null, 'eingegangen', null, now() - interval '1 hour'),
('33600000-0000-0000-0000-000000000022', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002',
 'Nicht bereinigbar', '{}', 'nicht_bereinigbar', null, null, 'eingegangen', null, now() - interval '1 hour'),
('33600000-0000-0000-0000-000000000023', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002',
 'Schon erledigt', '{}', 'bereinigt', 'Schon erledigt', '{}', 'erledigt', now(), now() - interval '1 hour'),
('33600000-0000-0000-0000-000000000024', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002',
 'Ohne Bild', '{}', 'bereinigt', 'Ohne Bild', '{}', 'eingegangen', null, now() - interval '1 hour');
insert into public.problem_reports (
  id, organization_id, reporter_id, filed_by_id, description, context,
  scrub_state, scrubbed_description, scrubbed_context
) values
('33600000-0000-0000-0000-000000000025', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002',
 'Gerade gesendet', '{}', 'bereinigt', 'Gerade gesendet', '{}');
insert into public.problem_report_files (
  id, organization_id, report_id, kind, storage_path, file_name, mime_type, size_bytes
) values
('33600000-0000-0000-0000-000000000030', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000020', 'screenshot',
 '33600000-0000-0000-0000-000000000010/problem-reports/33600000-0000-0000-0000-000000000020/33600000-0000-0000-0000-000000000030/screenshot',
 'screenshot.png', 'image/png', 2048);

-- The copies above are of the current scrub rules, version 1. 26 keeps a copy
-- written before versions, with its originals; 27 keeps one without them.
update public.problem_reports set scrub_version = 1 where scrub_state = 'bereinigt'
  and organization_id = '33600000-0000-0000-0000-000000000010';
insert into public.problem_reports (
  id, organization_id, reporter_id, filed_by_id, description, context,
  scrub_state, scrubbed_description, scrubbed_context, created_at
) values
('33600000-0000-0000-0000-000000000026', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002',
 'Bei der Übergabe GmbH hängt die Liste', '{}', 'bereinigt', 'Bei der Übergabe GmbH hängt die Liste', '{}',
 now() - interval '1 hour');
insert into public.problem_reports (
  id, organization_id, reporter_id, filed_by_id, description, context, originals_deleted_at,
  scrub_state, scrubbed_description, scrubbed_context, created_at
) values
('33600000-0000-0000-0000-000000000027', '33600000-0000-0000-0000-000000000010',
 '33600000-0000-0000-0000-000000000002', '33600000-0000-0000-0000-000000000002', null, null, now(),
 'bereinigt', 'Alte Kopie ohne Originale', '{}', now() - interval '1 hour');

-- Client roles execute no hand-out function.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.hand_out_problem_report(uuid, uuid, integer, bigint, uuid[])', 'EXECUTE')
      or has_function_privilege(v_role, 'public.hand_out_problem_report_screenshot(uuid, uuid, uuid[])', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.record_problem_report_scrub(uuid, uuid, text, jsonb, integer)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.withdraw_problem_report_copy(uuid, uuid, integer)', 'EXECUTE')
    then raise exception '% executes a hand-out function', v_role; end if;
  end loop;
end;
$$;

set local role service_role;

-- The first hand-out claims the report and writes its history entry without
-- an actor; a second one is refused and writes nothing.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_report constant uuid := '33600000-0000-0000-0000-000000000020';
  v_support constant uuid := '33600000-0000-0000-0000-000000000003';
  v_copy jsonb;
begin
  v_copy := public.hand_out_problem_report(v_org, v_report, 1, (select scrub_revision from public.problem_reports where id = v_report), array[v_support]);
  if v_copy is distinct from jsonb_build_object('description', 'Bei [Person 1] speichert nichts',
    'context', '{}'::jsonb, 'status', 'eingegangen', 'bucket', null, 'has_answer', false,
    'has_screenshot', true)
  then raise exception 'the hand-out answered the wrong copy: %', v_copy; end if;
  if (select handed_out_at from public.problem_reports where id = v_report) is null then
    raise exception 'the hand-out did not claim the report';
  end if;
  if (select array_agg(event_type || ':' || coalesce(actor_id::text, 'agent')) from public.problem_report_events
      where report_id = v_report) is distinct from array['copy_handed_out:agent'] then
    raise exception 'the hand-out did not write exactly one entry without an actor';
  end if;
  if not exists (select 1 from public.problem_report_signals where organization_id = v_org and user_id = v_support) then
    raise exception 'the hand-out did not signal support';
  end if;

  begin
    perform public.hand_out_problem_report(v_org, v_report, 1, (select scrub_revision from public.problem_reports where id = v_report), array[v_support]);
    raise exception 'a second hand-out was accepted';
  exception when raise_exception then
    if sqlerrm <> 'already_handed_out' then raise; end if;
  end;
  if (select count(*) from public.problem_report_events where report_id = v_report) <> 1 then
    raise exception 'a refused hand-out wrote history';
  end if;
end;
$$;

-- A report without a scrubbed copy, one sent less than ten minutes ago (its
-- screenshot may still be uploading), one whose copy predates the current
-- rules (pending while its originals exist, never without them), a closed one
-- and a report of another organization are refused with their codes and get
-- no entry.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_case record;
begin
  for v_case in select * from (values
    (v_org, '33600000-0000-0000-0000-000000000021'::uuid, 'copy_pending'),
    (v_org, '33600000-0000-0000-0000-000000000025'::uuid, 'copy_pending'),
    (v_org, '33600000-0000-0000-0000-000000000026'::uuid, 'copy_pending'),
    (v_org, '33600000-0000-0000-0000-000000000027'::uuid, 'copy_unavailable'),
    (v_org, '33600000-0000-0000-0000-000000000022'::uuid, 'copy_unavailable'),
    (v_org, '33600000-0000-0000-0000-000000000023'::uuid, 'report_closed'),
    ('33600000-0000-0000-0000-000000000011'::uuid, '33600000-0000-0000-0000-000000000024'::uuid, 'report_not_found'),
    (v_org, '33600000-0000-0000-0000-0000000000ff'::uuid, 'report_not_found')
  ) as refused (organization_id, report_id, code) loop
    begin
      perform public.hand_out_problem_report(v_case.organization_id, v_case.report_id, 1,
        (select scrub_revision from public.problem_reports where id = v_case.report_id), array[]::uuid[]);
      raise exception 'the hand-out of % was accepted', v_case.report_id;
    exception when raise_exception then
      if sqlerrm <> v_case.code then
        raise exception 'the hand-out of % answered %, not %', v_case.report_id, sqlerrm, v_case.code;
      end if;
    end;
  end loop;
  if exists (select 1 from public.problem_report_events
      where organization_id = v_org and report_id <> '33600000-0000-0000-0000-000000000020')
    or exists (select 1 from public.problem_reports
      where organization_id = v_org and handed_out_at is not null and id <> '33600000-0000-0000-0000-000000000020')
  then raise exception 'a refused hand-out wrote history or claimed a report'; end if;
end;
$$;

-- The screenshot leaves only a report already handed out, with its own entry.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_shot jsonb;
begin
  begin
    perform public.hand_out_problem_report_screenshot(v_org, '33600000-0000-0000-0000-000000000024', array[]::uuid[]);
    raise exception 'the screenshot of a report not handed out was accepted';
  exception when raise_exception then
    if sqlerrm <> 'report_not_handed_out' then raise; end if;
  end;
  v_shot := public.hand_out_problem_report_screenshot(
    v_org, '33600000-0000-0000-0000-000000000020', array[]::uuid[]);
  if v_shot ->> 'path' not like '33600000-0000-0000-0000-000000000010/problem-reports/%'
    or v_shot ->> 'mime_type' <> 'image/png'
  then raise exception 'the screenshot hand-out answered %', v_shot; end if;
  if (select count(*) from public.problem_report_events
      where report_id = '33600000-0000-0000-0000-000000000020'
        and event_type = 'screenshot_handed_out' and actor_id is null) <> 1
  then raise exception 'the screenshot hand-out wrote no entry without an actor'; end if;

  perform public.hand_out_problem_report(v_org, '33600000-0000-0000-0000-000000000024', 1,
    (select scrub_revision from public.problem_reports where id = '33600000-0000-0000-0000-000000000024'), array[]::uuid[]);
  begin
    perform public.hand_out_problem_report_screenshot(v_org, '33600000-0000-0000-0000-000000000024', array[]::uuid[]);
    raise exception 'a report without a screenshot handed one out';
  exception when raise_exception then
    if sqlerrm <> 'no_screenshot' then raise; end if;
  end;
  begin
    perform public.hand_out_problem_report_screenshot(
      '33600000-0000-0000-0000-000000000011', '33600000-0000-0000-0000-000000000020', array[]::uuid[]);
    raise exception 'the screenshot of another organization''s report was handed out';
  exception when raise_exception then
    if sqlerrm <> 'report_not_found' then raise; end if;
  end;
end;
$$;

-- The Agent changes only a report it received, sets no assignee and clears no field.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_case record;
begin
  for v_case in select * from (values
    ('33600000-0000-0000-0000-000000000021'::uuid, '{"status": "in_bearbeitung"}'::jsonb,
      '{"status": "eingegangen"}'::jsonb, 'report_not_handed_out'),
    ('33600000-0000-0000-0000-000000000020'::uuid, '{"assignee_id": "33600000-0000-0000-0000-000000000003"}'::jsonb,
      '{"assignee_id": null}'::jsonb, 'invalid_triage'),
    ('33600000-0000-0000-0000-000000000020'::uuid, '{"bucket": null}'::jsonb, '{"bucket": null}'::jsonb, 'invalid_triage'),
    ('33600000-0000-0000-0000-000000000020'::uuid, '{"response": null}'::jsonb, '{"response": null}'::jsonb, 'invalid_triage'),
    ('33600000-0000-0000-0000-000000000020'::uuid, '{}'::jsonb, '{}'::jsonb, 'invalid_triage')
  ) as refused (report_id, changes, expected, code) loop
    begin
      perform public.triage_problem_report(v_org, v_case.report_id, null, v_case.changes, v_case.expected, array[]::uuid[]);
      raise exception 'the Agent''s change % was accepted', v_case.changes;
    exception when raise_exception then
      if sqlerrm <> v_case.code then
        raise exception 'the Agent''s change % answered %, not %', v_case.changes, sqlerrm, v_case.code;
      end if;
    end;
  end loop;
end;
$$;

-- An invalid bucket or status is refused.
do $$
declare
  v_case record;
begin
  for v_case in select * from (values
    ('{"bucket": "egal"}'::jsonb, '{"bucket": null}'::jsonb),
    ('{"status": "vergessen"}'::jsonb, '{"status": "eingegangen"}'::jsonb)
  ) as refused (changes, expected) loop
    begin
      perform public.triage_problem_report('33600000-0000-0000-0000-000000000010',
        '33600000-0000-0000-0000-000000000020', null, v_case.changes, v_case.expected, array[]::uuid[]);
      raise exception 'the change % was accepted', v_case.changes;
    exception when check_violation then null;
    end;
  end loop;
end;
$$;

-- An answer support wrote after the hand-out is a conflict for the Agent,
-- who expected none: nothing is written, and support's answer stays.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_report constant uuid := '33600000-0000-0000-0000-000000000024';
  v_support constant uuid := '33600000-0000-0000-0000-000000000003';
begin
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('response', 'Wir melden uns.'), jsonb_build_object('response', null), array[]::uuid[]);
  begin
    perform public.triage_problem_report(v_org, v_report, null,
      jsonb_build_object('status', 'erledigt', 'response', 'Behoben.'),
      jsonb_build_object('status', 'eingegangen', 'response', null), array[]::uuid[]);
    raise exception 'the Agent overwrote support''s answer';
  exception when raise_exception then
    if sqlerrm <> 'triage_conflict' then raise; end if;
  end;
  if (select response <> 'Wir melden uns.' or status <> 'eingegangen' or response_by_agent
      from public.problem_reports where id = v_report)
    or exists (select 1 from public.problem_report_events
      where report_id = v_report and actor_id is null and event_type like '%_changed')
  then raise exception 'a conflicting write-back wrote something'; end if;
end;
$$;

-- The write-back writes its entries without an actor, marks its answer as
-- the Agent's, closes the report, and signals the reporter and support.
-- Support's next answer clears the mark; a status change alone keeps it.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_report constant uuid := '33600000-0000-0000-0000-000000000020';
  v_reporter constant uuid := '33600000-0000-0000-0000-000000000002';
  v_support constant uuid := '33600000-0000-0000-0000-000000000003';
  v_row public.problem_reports%rowtype;
begin
  perform public.triage_problem_report(v_org, v_report, null,
    jsonb_build_object('status', 'erledigt', 'bucket', 'fehler', 'response', 'Behoben, ab morgen live.'),
    jsonb_build_object('status', 'eingegangen', 'bucket', null, 'response', null),
    array[v_support]);
  select * into v_row from public.problem_reports where id = v_report;
  if v_row.status <> 'erledigt' or v_row.bucket <> 'fehler' or v_row.response <> 'Behoben, ab morgen live.'
    or not v_row.response_by_agent or v_row.closed_at is null
  then raise exception 'the write-back did not apply: %', row_to_json(v_row); end if;
  if (select array_agg(event_type order by event_type) from public.problem_report_events
      where report_id = v_report and actor_id is null and event_type like '%_changed')
    is distinct from array['bucket_changed', 'response_changed', 'status_changed']
  then raise exception 'the write-back did not write its entries without an actor'; end if;
  if not exists (select 1 from public.problem_report_signals where organization_id = v_org and user_id = v_reporter)
  then raise exception 'the write-back did not signal the reporter'; end if;

  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('status', 'in_bearbeitung'), jsonb_build_object('status', 'erledigt'), array[]::uuid[]);
  if not (select response_by_agent from public.problem_reports where id = v_report) then
    raise exception 'a status change cleared the Agent''s mark';
  end if;
  perform public.triage_problem_report(v_org, v_report, v_support,
    jsonb_build_object('response', 'Wir schauen es uns an.'),
    jsonb_build_object('response', 'Behoben, ab morgen live.'), array[]::uuid[]);
  if (select response_by_agent from public.problem_reports where id = v_report) then
    raise exception 'support''s answer kept the Agent''s mark';
  end if;
end;
$$;

-- A scrub writes its rules' version with the copy. A newer version rewrites
-- an older copy; a failed scrub never removes a copy and answers `veraltet`
-- while the report keeps an older one; an older version never replaces a
-- newer copy.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_old constant uuid := '33600000-0000-0000-0000-000000000026';
  v_state text;
begin
  -- Each call stands alone: a check in the same statement reads the row as it was before the call.
  v_state := public.record_problem_report_scrub(v_org, v_old, null, null, 1);
  if v_state <> 'veraltet'
    or (select scrubbed_description from public.problem_reports where id = v_old) is null
  then raise exception 'a failed scrub removed an older copy or hid that it stays'; end if;
  v_state := public.record_problem_report_scrub(v_org, v_old, 'Bei [Kunde 1] hängt die Liste', '{}', 1);
  if v_state <> 'bereinigt'
    or (select scrubbed_description <> 'Bei [Kunde 1] hängt die Liste' or scrub_version <> 1
        from public.problem_reports where id = v_old)
  then raise exception 'a newer version did not rewrite the older copy'; end if;
  v_state := public.record_problem_report_scrub(v_org, v_old, null, null, 1);
  if v_state <> 'bereinigt'
    or (select scrubbed_description from public.problem_reports where id = v_old) is null
  then raise exception 'a failed scrub removed a current copy'; end if;
  update public.problem_reports set scrub_version = 2 where id = v_old;
  perform public.record_problem_report_scrub(v_org, v_old, 'Ältere Regeln', '{}', 1);
  if (select scrubbed_description <> 'Bei [Kunde 1] hängt die Liste' or scrub_version <> 2
      from public.problem_reports where id = v_old)
  then raise exception 'an older version replaced a newer copy'; end if;
  -- The hand-out answers only a copy of exactly the rules the server checked.
  begin
    perform public.hand_out_problem_report(v_org, v_old, 1, (select scrub_revision from public.problem_reports where id = v_old), array[]::uuid[]);
    raise exception 'a copy of other rules than the checked ones was handed out';
  exception when raise_exception then
    if sqlerrm <> 'copy_pending' then raise; end if;
  end;
  if (select scrub_version from public.problem_reports where id = '33600000-0000-0000-0000-000000000021') is not null
  then raise exception 'a report without a copy carries a version'; end if;
end;
$$;

-- A withdrawal clears a copy's rule version only while it is still the
-- version the server checked, and leaves its text and state; another
-- organization's report is untouched.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_report constant uuid := '33600000-0000-0000-0000-000000000024';
  v_withdrawn boolean;
begin
  v_withdrawn := public.withdraw_problem_report_copy(v_org, v_report, 2);
  if v_withdrawn or (select scrub_version from public.problem_reports where id = v_report) is distinct from 1
  then raise exception 'a withdrawal of another version changed the copy'; end if;
  v_withdrawn := public.withdraw_problem_report_copy('33600000-0000-0000-0000-000000000011', v_report, 1);
  if v_withdrawn or (select scrub_version from public.problem_reports where id = v_report) is distinct from 1
  then raise exception 'a withdrawal reached another organization''s report'; end if;
  v_withdrawn := public.withdraw_problem_report_copy(v_org, v_report, 1);
  if not v_withdrawn or (select scrub_version is not null or scrub_state <> 'bereinigt'
      or scrubbed_description <> 'Ohne Bild' from public.problem_reports where id = v_report)
  then raise exception 'the withdrawal did not clear only the version'; end if;
end;
$$;

-- A copy's revision rises with every change of its text, context, state or
-- rule version, whichever path writes it, and a direct write of the revision
-- alone changes nothing. The hand-out answers only the revision the server
-- checked: after a withdrawal and a new scrub at the same rule version, a
-- call with the old revision is refused and claims nothing.
do $$
declare
  v_org constant uuid := '33600000-0000-0000-0000-000000000010';
  v_report constant uuid := '33600000-0000-0000-0000-000000000026';
  v_checked bigint;
  v_copy jsonb;
begin
  update public.problem_reports set scrub_version = 1 where id = v_report;
  v_checked := (select scrub_revision from public.problem_reports where id = v_report);
  update public.problem_reports set scrub_revision = 0 where id = v_report;
  if (select scrub_revision from public.problem_reports where id = v_report) <> v_checked then
    raise exception 'a direct write changed the revision';
  end if;
  perform public.withdraw_problem_report_copy(v_org, v_report, 1);
  perform public.record_problem_report_scrub(v_org, v_report, 'Die neue Kopie', '{}', 1);
  if (select scrub_revision from public.problem_reports where id = v_report) <> v_checked + 2 then
    raise exception 'the withdrawal and the new scrub did not each raise the revision';
  end if;
  begin
    perform public.hand_out_problem_report(v_org, v_report, 1, v_checked, array[]::uuid[]);
    raise exception 'a copy other than the checked one was handed out';
  exception when raise_exception then
    if sqlerrm <> 'copy_pending' then raise; end if;
  end;
  if (select handed_out_at from public.problem_reports where id = v_report) is not null
    or exists (select 1 from public.problem_report_events where report_id = v_report)
  then raise exception 'a refused hand-out of a rewritten copy claimed or wrote history'; end if;
  v_copy := public.hand_out_problem_report(v_org, v_report, 1, v_checked + 2, array[]::uuid[]);
  if v_copy ->> 'description' <> 'Die neue Kopie' then
    raise exception 'the hand-out did not answer the newly checked copy: %', v_copy;
  end if;
end;
$$;

-- An opening and an assignee change always name a person.
do $$
begin
  begin
    insert into public.problem_report_events (organization_id, report_id, event_type, actor_id)
    values ('33600000-0000-0000-0000-000000000010', '33600000-0000-0000-0000-000000000020', 'original_opened', null);
    raise exception 'an opening without an actor was accepted';
  exception when check_violation then null;
  end;
end;
$$;

rollback;
