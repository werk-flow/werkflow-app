-- Marking one notification read and marking all read write the read markers
-- and their 'marked_read' events in one call or nothing, only for the caller's
-- own user, and refuse with the action's failure codes (migration
-- 20261004180300_write_attention_read_markers_with_their_events.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('c4000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-read-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Gelesen"}', now(), now()),
('c4000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-read-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Gelesen"}', now(), now()),
('c4000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-read-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Gelesen"}', now(), now()),
('c4000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-read-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"Gelesen"}', now(), now()),
('c4000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'attention-read-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Gelesen"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('c4000000-0000-4000-8000-000000000010', 'Attention read SQL',
 'c4000000-0000-4000-8000-000000000001', 'ATTREAD'),
('c4000000-0000-4000-8000-000000000011', 'Attention read SQL other',
 'c4000000-0000-4000-8000-000000000005', 'ATTREADO');
insert into public.organization_members (organization_id, user_id, role) values
('c4000000-0000-4000-8000-000000000010', 'c4000000-0000-4000-8000-000000000002', 'buero'),
('c4000000-0000-4000-8000-000000000010', 'c4000000-0000-4000-8000-000000000003', 'employee'),
('c4000000-0000-4000-8000-000000000010', 'c4000000-0000-4000-8000-000000000004', 'employee');

-- Membership creates each member's employee record; the other organization's
-- person has a record without a login.
insert into public.employee_records (id, organization_id, user_id, first_name, last_name) values
('c4000000-0000-4000-8000-000000000039', 'c4000000-0000-4000-8000-000000000011', null, 'Fremd', 'Gelesen');
create function pg_temp.record_of(p_user_id uuid) returns uuid language sql as $$
  select record.id from public.employee_records record
  where record.organization_id = 'c4000000-0000-4000-8000-000000000010' and record.user_id = p_user_id;
$$;

insert into public.vacation_requests (id, organization_id, employee_record_id, start_date, end_date, status) values
('c4000000-0000-4000-8000-000000000040', 'c4000000-0000-4000-8000-000000000010',
 pg_temp.record_of('c4000000-0000-4000-8000-000000000003'), '2026-11-02', '2026-11-03', 'approved'),
('c4000000-0000-4000-8000-000000000041', 'c4000000-0000-4000-8000-000000000010',
 pg_temp.record_of('c4000000-0000-4000-8000-000000000004'), '2026-11-02', '2026-11-03', 'approved'),
('c4000000-0000-4000-8000-000000000049', 'c4000000-0000-4000-8000-000000000011',
 'c4000000-0000-4000-8000-000000000039', '2026-11-02', '2026-11-03', 'approved');
insert into public.sickness_reports (id, organization_id, employee_record_id, start_date) values
('c4000000-0000-4000-8000-000000000050', 'c4000000-0000-4000-8000-000000000010',
 pg_temp.record_of('c4000000-0000-4000-8000-000000000003'), '2026-10-01'),
('c4000000-0000-4000-8000-000000000051', 'c4000000-0000-4000-8000-000000000010',
 pg_temp.record_of('c4000000-0000-4000-8000-000000000004'), '2026-10-01');
insert into public.organization_capabilities (id, organization_id, kind, name, created_by) values
('c4000000-0000-4000-8000-000000000060', 'c4000000-0000-4000-8000-000000000010',
 'certification', 'Gasprüfung Gelesen', 'c4000000-0000-4000-8000-000000000001');
insert into public.employee_capabilities (
  id, organization_id, employee_record_id, capability_id, capability_kind, valid_from, valid_until
) values (
  'c4000000-0000-4000-8000-000000000061', 'c4000000-0000-4000-8000-000000000010',
  pg_temp.record_of('c4000000-0000-4000-8000-000000000004'), 'c4000000-0000-4000-8000-000000000060',
  'certification', '2025-01-01', '2026-10-31'
);

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

-- Every marker and event of both organizations as one comparable value.
create function pg_temp.attention_state() returns text language sql as $$
  select coalesce((
    select string_agg(
      concat_ws(':', marker.organization_id, marker.user_id, marker.source_type, marker.source_id,
        marker.state_version, marker.read_at),
      '|' order by marker.user_id, marker.source_id
    )
    from public.attention_read_states marker
    where marker.organization_id in ('c4000000-0000-4000-8000-000000000010', 'c4000000-0000-4000-8000-000000000011')
  ), '') || '#' || (
    select count(*)::text from public.attention_events event
    where event.organization_id in ('c4000000-0000-4000-8000-000000000010', 'c4000000-0000-4000-8000-000000000011')
  );
$$;
grant execute on function pg_temp.attention_state() to service_role;

create temporary table attention_state_before as select pg_temp.attention_state() as state;
grant select on attention_state_before to service_role;

-- Every refusal keeps its code and changes nothing.
set local role service_role;

select pg_temp.expect_refusal('no markers', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010', '[]', null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('an unknown via', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"v1"}]',
    'somewhere')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('an empty version', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":""}]',
    null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a malformed source id', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"not-a-uuid","state_version":"v1"}]', null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a duplicate marker', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"v1"},
      {"source_type":"vacation_decision","source_id":"C4000000-0000-4000-8000-000000000040","state_version":"v2"}]',
    'mark_all')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a source type that cannot be marked', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000002',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"client_request_open","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"v1"}]',
    null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('marking by an outsider', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000005',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"v1"}]',
    null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a decision of another organization', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000049","state_version":"v1"}]',
    null)
$sql$, 'request_not_found');
select pg_temp.expect_refusal('a colleague''s decision', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000041","state_version":"v1"}]',
    null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a manager marking another person''s decision', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000002',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"v1"}]',
    null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a colleague''s sickness report by a field worker', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"sickness_report","source_id":"c4000000-0000-4000-8000-000000000051","state_version":"v1"}]',
    null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a certification by a field worker', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000004',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"employee_certification_expiry","source_id":"c4000000-0000-4000-8000-000000000061","state_version":"v1"}]',
    null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('a missing certification', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000002',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"employee_certification_expiry","source_id":"c4000000-0000-4000-8000-000000000069","state_version":"v1"}]',
    null)
$sql$, 'request_not_found');
-- All or nothing: the first marker is valid, the second is refused, and the
-- first marker and its event are not stored.
select pg_temp.expect_refusal('mark all with a later foreign marker', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"v1"},
      {"source_type":"sickness_report","source_id":"c4000000-0000-4000-8000-000000000051","state_version":"v1"}]',
    'mark_all')
$sql$, 'not_authorized');

do $$
begin
  if pg_temp.attention_state() <> (select state from attention_state_before) then
    raise exception 'a refused call changed markers or events';
  end if;
end;
$$;

-- One notification: the marker and its event with the version only.
select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
  'c4000000-0000-4000-8000-000000000010',
  '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"approved:1"}]',
  null);
-- The same marker again: the marker keeps one row and, as before, a second
-- event is recorded.
select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
  'c4000000-0000-4000-8000-000000000010',
  '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"approved:1"}]',
  null);
-- The affected person marks their own sickness report.
select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
  'c4000000-0000-4000-8000-000000000010',
  '[{"source_type":"sickness_report","source_id":"c4000000-0000-4000-8000-000000000050","state_version":"reported:1"}]',
  null);
-- Mark all by a manager: every sickness report and the certification.
select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000002',
  'c4000000-0000-4000-8000-000000000010',
  '[{"source_type":"sickness_report","source_id":"c4000000-0000-4000-8000-000000000050","state_version":"reported:1"},
    {"source_type":"sickness_report","source_id":"c4000000-0000-4000-8000-000000000051","state_version":"reported:2"},
    {"source_type":"employee_certification_expiry","source_id":"c4000000-0000-4000-8000-000000000061","state_version":"expired"}]',
  'mark_all');

reset role;

do $$
declare
  v_employee constant uuid := 'c4000000-0000-4000-8000-000000000003';
  v_buero constant uuid := 'c4000000-0000-4000-8000-000000000002';
begin
  if (select count(*) from public.attention_read_states marker
      where marker.user_id = v_employee and marker.source_type = 'vacation_decision'
        and marker.source_id = 'c4000000-0000-4000-8000-000000000040'
        and marker.organization_id = 'c4000000-0000-4000-8000-000000000010'
        and marker.state_version = 'approved:1') <> 1 then
    raise exception 'the single marker was not stored once';
  end if;
  if (select count(*) from public.attention_events event
      where event.user_id = v_employee and event.source_type = 'vacation_decision'
        and event.source_id = 'c4000000-0000-4000-8000-000000000040' and event.event_type = 'marked_read'
        and event.event_payload = '{"state_version":"approved:1"}'::jsonb) <> 2 then
    raise exception 'each single mark did not record its own event with the version only';
  end if;
  if not exists (select 1 from public.attention_events event
      where event.user_id = v_employee and event.source_id = 'c4000000-0000-4000-8000-000000000050'
        and event.event_payload = '{"state_version":"reported:1"}'::jsonb) then
    raise exception 'the own sickness marker has no event';
  end if;
  if (select count(*) from public.attention_read_states marker where marker.user_id = v_buero) <> 3
    or (select count(*) from public.attention_events event
        where event.user_id = v_buero and event.event_type = 'marked_read'
          and event.event_payload = jsonb_build_object(
            'state_version', (select marker.state_version from public.attention_read_states marker
              where marker.user_id = v_buero and marker.source_id = event.source_id),
            'via', 'mark_all')) <> 3 then
    raise exception 'mark all did not store three markers with their mark_all events';
  end if;
  -- The manager's mark-all left the employee's own marker of report 50 alone.
  if (select count(*) from public.attention_read_states marker
      where marker.source_id = 'c4000000-0000-4000-8000-000000000050') <> 2
    or exists (select 1 from public.attention_read_states marker
      where marker.organization_id <> 'c4000000-0000-4000-8000-000000000010'
        or marker.user_id not in (v_employee, v_buero)) then
    raise exception 'a call wrote markers of another user or organization';
  end if;
end;
$$;

-- The event is the last step. When it is refused, the marker write is rolled
-- back with it: no marker changes without its event.
create table pg_temp.attention_state_before_failure as select pg_temp.attention_state() as state;
grant select on pg_temp.attention_state_before_failure to service_role;
create function pg_temp.refuse_attention_event() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger "ZZ_test_refuse_attention_event" before insert on public.attention_events
  for each row execute function pg_temp.refuse_attention_event();

set local role service_role;
select pg_temp.expect_refusal('a single mark whose event is refused', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000003',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000040","state_version":"cancelled:2"}]',
    null)
$sql$, 'history refused');
select pg_temp.expect_refusal('a mark all whose events are refused', $sql$
  select public.mark_attention_notifications_read('c4000000-0000-4000-8000-000000000004',
    'c4000000-0000-4000-8000-000000000010',
    '[{"source_type":"vacation_decision","source_id":"c4000000-0000-4000-8000-000000000041","state_version":"approved:3"},
      {"source_type":"sickness_report","source_id":"c4000000-0000-4000-8000-000000000051","state_version":"reported:3"}]',
    'mark_all')
$sql$, 'history refused');
reset role;
drop trigger "ZZ_test_refuse_attention_event" on public.attention_events;

do $$
begin
  if pg_temp.attention_state() <> (select state from pg_temp.attention_state_before_failure) then
    raise exception 'a refused event left a marker change behind';
  end if;
end;
$$;

-- Grants: only service_role executes the function; the private helpers are
-- reachable through it alone.
do $$
declare
  v_role text;
begin
  if not has_function_privilege('service_role',
    'public.mark_attention_notifications_read(uuid, uuid, jsonb, text)', 'execute') then
    raise exception 'mark_attention_notifications_read lost its service_role grant';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.mark_attention_notifications_read(uuid, uuid, jsonb, text)', 'execute')
    then
      raise exception '% can execute mark_attention_notifications_read', v_role;
    end if;
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'app_private.lock_attention_reader(uuid, uuid)', 'execute')
      or has_function_privilege(v_role,
        'app_private.assert_attention_marker_source(uuid, uuid, text, text, uuid)', 'execute')
    then
      raise exception '% can execute a private attention helper', v_role;
    end if;
  end loop;
end;
$$;

rollback;
