-- Reporting, recording, ending, correcting, cancelling a Krankmeldung and
-- setting its evidence state write the report and its history row in one call
-- or nothing, and refuse with the action's failure codes (migration
-- 20261004180100_write_sickness_history_with_its_change.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'sickness-writes-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Krank"}', now(), now()),
('c2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'sickness-writes-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Krank"}', now(), now()),
('c2000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'sickness-writes-worker@example.test', '', now(), '{}',
 '{"first_name":"Worker","last_name":"Krank"}', now(), now()),
('c2000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'sickness-writes-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"Krank"}', now(), now()),
('c2000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'sickness-writes-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Krank"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('c2000000-0000-0000-0000-000000000010', 'Sickness writes SQL',
 'c2000000-0000-0000-0000-000000000001', 'SICKWR'),
('c2000000-0000-0000-0000-000000000011', 'Sickness writes SQL other',
 'c2000000-0000-0000-0000-000000000005', 'SICKWRO');
insert into public.organization_members (organization_id, user_id, role) values
('c2000000-0000-0000-0000-000000000010', 'c2000000-0000-0000-0000-000000000002', 'buero'),
('c2000000-0000-0000-0000-000000000010', 'c2000000-0000-0000-0000-000000000003', 'employee'),
('c2000000-0000-0000-0000-000000000010', 'c2000000-0000-0000-0000-000000000004', 'employee');

-- Membership creates the members' employee records; the record without an
-- account is added here.
insert into public.employee_records (id, organization_id, first_name, last_name) values
('c2000000-0000-0000-0000-000000000022', 'c2000000-0000-0000-0000-000000000010', 'Ohne', 'Konto');

insert into public.sickness_reports (
  id, organization_id, employee_record_id, start_date, end_date, day_portion, status
) values
('c2000000-0000-0000-0000-000000000030', 'c2000000-0000-0000-0000-000000000010',
 (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'), '2026-09-01', '2026-09-03', 'full', 'reported'),
('c2000000-0000-0000-0000-000000000031', 'c2000000-0000-0000-0000-000000000010',
 (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000004'), '2026-09-01', null, 'full', 'reported'),
('c2000000-0000-0000-0000-000000000032', 'c2000000-0000-0000-0000-000000000010',
 (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'), '2026-08-01', '2026-08-01', 'half_day', 'reported'),
('c2000000-0000-0000-0000-000000000033', 'c2000000-0000-0000-0000-000000000010',
 (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'), '2026-07-01', '2026-07-02', 'full', 'cancelled'),
('c2000000-0000-0000-0000-000000000034', 'c2000000-0000-0000-0000-000000000010',
 (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'), '2026-09-10', '2026-09-12', 'full', 'reported'),
('c2000000-0000-0000-0000-000000000039', 'c2000000-0000-0000-0000-000000000011',
 (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000005'), '2026-09-01', null, 'full', 'reported');

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

-- Both organizations' reports and history as one comparable value.
create function pg_temp.sickness_state() returns text language sql as $$
  select coalesce((
    select string_agg(to_jsonb(report)::text, '|' order by report.id)
    from public.sickness_reports report
    where report.organization_id in ('c2000000-0000-0000-0000-000000000010', 'c2000000-0000-0000-0000-000000000011')
  ), '') || '#' || (
    select count(*)::text from public.sickness_report_events event
    where event.organization_id in ('c2000000-0000-0000-0000-000000000010', 'c2000000-0000-0000-0000-000000000011')
  );
$$;

create temporary table sickness_state_before as select pg_temp.sickness_state() as state;

-- Every refusal keeps its code and changes nothing.
set local role service_role;

select pg_temp.expect_refusal('self-report by an outsider', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000005', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'), 'krankheit', '2026-10-01', null, 'full', false, true)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('self-report for a colleague''s record', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000004'), 'krankheit', '2026-10-01', null, 'full', false, true)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('self-report by a manager for another record', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000004'), 'krankheit', '2026-10-01', null, 'full', false, true)
$sql$, 'no_employee_record');
select pg_temp.expect_refusal('self-report for a record of another organization', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000005', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000005'), 'krankheit', '2026-10-01', null, 'full', false, true)
$sql$, 'no_employee_record');
select pg_temp.expect_refusal('office entry by a field worker', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'), 'krankheit', '2026-10-01', null, 'full', false, false)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('office entry for a record of another organization', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000005'), 'krankheit', '2026-10-01', null, 'full', false, false)
$sql$, 'record_not_found');
select pg_temp.expect_refusal('office entry overlapping an active report', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000004'), 'krankheit', '2026-09-10', '2026-09-11', 'full', false, false)
$sql$, 'overlap_conflict');

select pg_temp.expect_refusal('ending a report of another organization', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000039', '2026-09-05')
$sql$, 'not_found');
select pg_temp.expect_refusal('ending a colleague''s report', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000031', '2026-09-05')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('ending a cancelled report', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000033', '2026-07-05')
$sql$, 'report_not_active');
select pg_temp.expect_refusal('ending before the stored start', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', '2026-08-31')
$sql$, 'invalid_range');
select pg_temp.expect_refusal('ending after the longest range', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000031', '2027-09-03')
$sql$, 'range_too_long');
select pg_temp.expect_refusal('ending a half day on another day', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000032', '2026-08-02')
$sql$, 'half_day_needs_single_day');
select pg_temp.expect_refusal('ending into the next active report', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', '2026-09-11')
$sql$, 'overlap_conflict');

select pg_temp.expect_refusal('correcting a report of another organization', $sql$
  select public.correct_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000039', 'krankheit', '2026-09-01', null, 'full', 'Grund')
$sql$, 'not_found');
select pg_temp.expect_refusal('correcting a colleague''s report', $sql$
  select public.correct_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000031', 'krankheit', '2026-09-02', null, 'full', 'Grund')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('correcting a cancelled report', $sql$
  select public.correct_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000033', 'krankheit', '2026-07-01', '2026-07-03', 'full', null)
$sql$, 'report_not_active');
select pg_temp.expect_refusal('correcting someone else''s report without a reason', $sql$
  select public.correct_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000031', 'kind_krank', '2026-09-01', null, 'full', '   ')
$sql$, 'reason_required');
select pg_temp.expect_refusal('correcting into the next active report', $sql$
  select public.correct_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', 'krankheit', '2026-09-10', '2026-09-10', 'full', null)
$sql$, 'overlap_conflict');

select pg_temp.expect_refusal('cancelling a report of another organization', $sql$
  select public.cancel_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000039', 'Grund')
$sql$, 'not_found');
select pg_temp.expect_refusal('cancelling a colleague''s report', $sql$
  select public.cancel_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000031', 'Grund')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('cancelling a cancelled report', $sql$
  select public.cancel_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000033', null)
$sql$, 'report_not_active');
select pg_temp.expect_refusal('cancelling someone else''s report without a reason', $sql$
  select public.cancel_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000031', null)
$sql$, 'reason_required');

select pg_temp.expect_refusal('evidence on a report of another organization', $sql$
  select public.set_sickness_evidence('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000039', true, 'pending')
$sql$, 'not_found');
select pg_temp.expect_refusal('evidence on the own report by a field worker', $sql$
  select public.set_sickness_evidence('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', true, 'pending')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('evidence on a cancelled report', $sql$
  select public.set_sickness_evidence('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000033', true, 'pending')
$sql$, 'report_not_active');
select pg_temp.expect_refusal('evidence required without a pending state', $sql$
  select public.set_sickness_evidence('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', true, 'not_required')
$sql$, 'invalid_evidence_state');

reset role;

-- The history row is the last step. When it is refused, the report write is
-- rolled back with it: no report exists or changes without its history row.
create function pg_temp.refuse_sickness_event() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger refuse_sickness_event before insert on public.sickness_report_events
  for each row execute function pg_temp.refuse_sickness_event();

set local role service_role;
select pg_temp.expect_refusal('self-report whose history row is refused', $sql$
  select public.create_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'), 'krankheit', '2026-10-01', null, 'full', false, true)
$sql$, 'history refused');
select pg_temp.expect_refusal('ending whose history row is refused', $sql$
  select public.end_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', '2026-09-05')
$sql$, 'history refused');
select pg_temp.expect_refusal('correction whose history row is refused', $sql$
  select public.correct_sickness_report('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000031', 'kind_krank', '2026-09-01', null, 'full', 'Grund')
$sql$, 'history refused');
select pg_temp.expect_refusal('cancellation whose history row is refused', $sql$
  select public.cancel_sickness_report('c2000000-0000-0000-0000-000000000003', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', null)
$sql$, 'history refused');
select pg_temp.expect_refusal('evidence whose history row is refused', $sql$
  select public.set_sickness_evidence('c2000000-0000-0000-0000-000000000002', 'c2000000-0000-0000-0000-000000000010',
    'c2000000-0000-0000-0000-000000000030', true, 'pending')
$sql$, 'history refused');
reset role;

drop trigger refuse_sickness_event on public.sickness_report_events;

do $$
begin
  if pg_temp.sickness_state() <> (select state from sickness_state_before) then
    raise exception 'a refused sickness write changed reports or history';
  end if;
end;
$$;

-- Each clean write stores the report and exactly its history row.
set local role service_role;

do $$
declare
  v_org constant uuid := 'c2000000-0000-0000-0000-000000000010';
  v_buero constant uuid := 'c2000000-0000-0000-0000-000000000002';
  v_worker constant uuid := 'c2000000-0000-0000-0000-000000000003';
  v_own_report constant uuid := 'c2000000-0000-0000-0000-000000000030';
  v_colleague_report constant uuid := 'c2000000-0000-0000-0000-000000000031';
  v_report public.sickness_reports;
  v_event public.sickness_report_events;
begin
  v_report := public.create_sickness_report(v_worker, v_org, (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003'),
    'krankheit', '2026-10-01', null, 'full', false, true);
  if v_report.organization_id <> v_org or v_report.status <> 'reported' or v_report.end_date is not null
    or v_report.evidence_required or v_report.evidence_status <> 'not_required' or v_report.reported_by <> v_worker
  then raise exception 'a self-report stored the wrong report: %', to_jsonb(v_report); end if;
  select * into strict v_event from public.sickness_report_events where sickness_report_id = v_report.id;
  if v_event.event_type <> 'reported' or v_event.created_by <> v_worker
    or v_event.employee_record_id <> (select id from public.employee_records where user_id = 'c2000000-0000-0000-0000-000000000003')
    or v_event.event_payload <> '{"absence_type": "krankheit", "start_date": "2026-10-01", "end_date": null,
      "day_portion": "full", "evidence_required": false, "self_reported": true}'::jsonb
  then raise exception 'a self-report recorded the wrong history: %', to_jsonb(v_event); end if;

  v_report := public.create_sickness_report(v_buero, v_org, 'c2000000-0000-0000-0000-000000000022',
    'kind_krank', '2026-10-02', '2026-10-02', 'half_day', true, false);
  if v_report.evidence_status <> 'pending' or v_report.reported_by <> v_buero then
    raise exception 'an office entry stored the wrong report: %', to_jsonb(v_report);
  end if;
  select * into strict v_event from public.sickness_report_events where sickness_report_id = v_report.id;
  if v_event.event_type <> 'reported' or v_event.created_by <> v_buero
    or v_event.event_payload <> '{"absence_type": "kind_krank", "start_date": "2026-10-02",
      "end_date": "2026-10-02", "day_portion": "half_day", "evidence_required": true, "self_reported": false}'::jsonb
  then raise exception 'an office entry recorded the wrong history: %', to_jsonb(v_event); end if;

  v_report := public.end_sickness_report(v_worker, v_org, v_own_report, '2026-09-05');
  if v_report.end_date <> '2026-09-05' then raise exception 'ending did not save the end date'; end if;

  v_report := public.correct_sickness_report(v_buero, v_org, v_colleague_report,
    'sonstige', '2026-09-02', '2026-09-04', 'full', '  Anruf  ');
  if v_report.absence_type <> 'sonstige' or v_report.start_date <> '2026-09-02' or v_report.end_date <> '2026-09-04'
  then raise exception 'a correction stored the wrong report: %', to_jsonb(v_report); end if;

  v_report := public.set_sickness_evidence(v_buero, v_org, v_colleague_report, true, 'received');
  if not v_report.evidence_required or v_report.evidence_status <> 'received' then
    raise exception 'evidence was not saved: %', to_jsonb(v_report);
  end if;

  v_report := public.cancel_sickness_report(v_worker, v_org, v_own_report, null);
  if v_report.status <> 'cancelled' or v_report.cancelled_by <> v_worker or v_report.cancelled_at is null
    or v_report.cancellation_reason is not null
  then raise exception 'a cancellation stored the wrong report: %', to_jsonb(v_report); end if;

  if (
    select jsonb_agg(jsonb_build_object('type', event_type, 'payload', event_payload, 'by', created_by)
      order by event_type)
    from public.sickness_report_events where sickness_report_id = v_own_report
  ) <> jsonb_build_array(
    jsonb_build_object('type', 'cancelled', 'by', v_worker, 'payload',
      '{"start_date": "2026-09-01", "end_date": "2026-09-05", "reason": null}'::jsonb),
    jsonb_build_object('type', 'ended', 'by', v_worker, 'payload',
      '{"before": {"end_date": "2026-09-03"}, "after": {"end_date": "2026-09-05"}}'::jsonb)
  ) then raise exception 'ending and cancelling recorded the wrong history'; end if;

  if (
    select jsonb_agg(jsonb_build_object('type', event_type, 'payload', event_payload, 'by', created_by)
      order by event_type)
    from public.sickness_report_events where sickness_report_id = v_colleague_report
  ) <> jsonb_build_array(
    jsonb_build_object('type', 'corrected', 'by', v_buero, 'payload', '{
      "before": {"absence_type": "krankheit", "start_date": "2026-09-01", "end_date": null, "day_portion": "full"},
      "after": {"absence_type": "sonstige", "start_date": "2026-09-02", "end_date": "2026-09-04", "day_portion": "full"},
      "reason": "Anruf"}'::jsonb),
    jsonb_build_object('type', 'evidence_updated', 'by', v_buero, 'payload', '{
      "before": {"evidence_required": false, "evidence_status": "not_required"},
      "after": {"evidence_required": true, "evidence_status": "received"}}'::jsonb)
  ) then raise exception 'correcting and the evidence recorded the wrong history'; end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.create_sickness_report(uuid, uuid, uuid, text, date, date, text, boolean, boolean)',
    'public.end_sickness_report(uuid, uuid, uuid, date)',
    'public.correct_sickness_report(uuid, uuid, uuid, text, date, date, text, text)',
    'public.cancel_sickness_report(uuid, uuid, uuid, text)',
    'public.set_sickness_evidence(uuid, uuid, uuid, boolean, text)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '% lost its service_role grant', v_function;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'app_private.lock_sickness_actor(uuid, uuid, uuid, boolean)', 'execute')
      or has_function_privilege(v_role, 'app_private.lock_sickness_report(uuid, uuid)', 'execute')
      or has_function_privilege(v_role,
        'app_private.append_sickness_report_event(public.sickness_reports, text, jsonb, uuid)', 'execute')
    then raise exception 'a sickness write helper is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
