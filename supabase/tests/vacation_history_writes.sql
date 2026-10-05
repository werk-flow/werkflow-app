-- Requesting, withdrawing, deciding and cancelling a vacation request write the
-- request and its history row in one call or nothing, and refuse with the
-- action's failure codes (migration
-- 20261004180200_write_vacation_history_with_its_change.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('c3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'vacation-history-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Urlaub"}', now(), now()),
('c3000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'vacation-history-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Urlaub"}', now(), now()),
('c3000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'vacation-history-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Urlaub"}', now(), now()),
('c3000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'vacation-history-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Urlaub"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('c3000000-0000-0000-0000-000000000010', 'Vacation history SQL',
 'c3000000-0000-0000-0000-000000000001', 'VACHIST'),
('c3000000-0000-0000-0000-000000000011', 'Vacation history SQL other',
 'c3000000-0000-0000-0000-000000000004', 'VACHISTO');
insert into public.organization_members (organization_id, user_id, role) values
('c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000002', 'buero'),
('c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000003', 'employee')
on conflict do nothing;

-- The membership trigger creates each member's employee record; this names it.
create function pg_temp.record_of(p_user_id uuid, p_organization_id uuid) returns uuid language sql as $$
  select record.id from public.employee_records record
  where record.user_id = p_user_id and record.organization_id = p_organization_id;
$$;
grant execute on function pg_temp.record_of(uuid, uuid) to service_role;

insert into public.vacation_requests (
  id, organization_id, employee_record_id, requested_by, start_date, end_date, status, approved_days_by_year
) values
('c3000000-0000-0000-0000-000000000040', 'c3000000-0000-0000-0000-000000000010',
 pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010'), 'c3000000-0000-0000-0000-000000000003',
 '2026-11-02', '2026-11-04', 'pending', null),
('c3000000-0000-0000-0000-000000000041', 'c3000000-0000-0000-0000-000000000010',
 pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010'), 'c3000000-0000-0000-0000-000000000003',
 '2026-12-01', '2026-12-02', 'approved', '{"2026": 2}'),
('c3000000-0000-0000-0000-000000000042', 'c3000000-0000-0000-0000-000000000010',
 pg_temp.record_of('c3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000010'), 'c3000000-0000-0000-0000-000000000002',
 '2026-11-10', '2026-11-10', 'pending', null),
('c3000000-0000-0000-0000-000000000043', 'c3000000-0000-0000-0000-000000000010',
 pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010'), 'c3000000-0000-0000-0000-000000000003',
 '2026-10-20', '2026-10-20', 'rejected', null),
('c3000000-0000-0000-0000-000000000049', 'c3000000-0000-0000-0000-000000000011',
 pg_temp.record_of('c3000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000011'), 'c3000000-0000-0000-0000-000000000004',
 '2026-11-02', '2026-11-02', 'pending', null);

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

-- The organizations' vacation requests and history as one comparable value.
create function pg_temp.vacation_state() returns text language sql as $$
  select coalesce((
    select string_agg(to_jsonb(request)::text, '|' order by request.id)
    from public.vacation_requests request
    where request.organization_id in ('c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000011')
  ), '') || '#' || (
    select count(*)::text from public.vacation_request_events event
    where event.organization_id in ('c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000011')
  );
$$;

create temporary table vacation_state_before as select pg_temp.vacation_state() as state;

-- Every refusal keeps its code and changes nothing.
set local role service_role;

select pg_temp.expect_refusal('request without dates', $sql$
  select public.create_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010'),
    null, null, 'full', null, null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('request by an outsider', $sql$
  select public.create_vacation_request('c3000000-0000-0000-0000-000000000004',
    'c3000000-0000-0000-0000-000000000010', pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010'),
    '2027-02-01', '2027-02-01', 'full', null, '{}')
$sql$, 'not_a_member');
select pg_temp.expect_refusal('request for another person''s record', $sql$
  select public.create_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', pg_temp.record_of('c3000000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000010'),
    '2027-02-01', '2027-02-01', 'full', null, '{}')
$sql$, 'no_employee_record');
select pg_temp.expect_refusal('request for a record of another organization', $sql$
  select public.create_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', pg_temp.record_of('c3000000-0000-0000-0000-000000000004', 'c3000000-0000-0000-0000-000000000011'),
    '2027-02-01', '2027-02-01', 'full', null, '{}')
$sql$, 'no_employee_record');
select pg_temp.expect_refusal('request overlapping a pending one', $sql$
  select public.create_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010'),
    '2026-11-04', '2026-11-06', 'full', null, '{}')
$sql$, 'overlap_conflict');

select pg_temp.expect_refusal('withdrawal of a request of another organization', $sql$
  select public.withdraw_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000049')
$sql$, 'request_not_found');
select pg_temp.expect_refusal('withdrawal by an outsider', $sql$
  select public.withdraw_vacation_request('c3000000-0000-0000-0000-000000000004',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040')
$sql$, 'not_a_member');
select pg_temp.expect_refusal('withdrawal of another person''s request', $sql$
  select public.withdraw_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('withdrawal of an approved request', $sql$
  select public.withdraw_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000041')
$sql$, 'request_not_pending');

select pg_temp.expect_refusal('decision of a request of another organization', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000049', 'approve', null, '{}')
$sql$, 'request_not_found');
select pg_temp.expect_refusal('decision by an outsider', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000004',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040', 'approve', null, '{}')
$sql$, 'not_a_member');
select pg_temp.expect_refusal('decision of an unknown kind', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040', 'maybe', 'x', '{}')
$sql$, 'invalid_decision');
select pg_temp.expect_refusal('rejection without a reason', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040', 'reject', '  ', null)
$sql$, 'reason_required');
select pg_temp.expect_refusal('approval without its day counts', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040', 'approve', null, null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('approval of the own request', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000042', 'approve', null, '{}')
$sql$, 'self_approval_not_allowed');
select pg_temp.expect_refusal('decision of a rejected request', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000043', 'approve', null, '{}')
$sql$, 'request_not_pending');

select pg_temp.expect_refusal('cancellation of a request of another organization', $sql$
  select public.cancel_approved_vacation_request('c3000000-0000-0000-0000-000000000001',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000049', 'Grund')
$sql$, 'request_not_found');
select pg_temp.expect_refusal('cancellation by an outsider', $sql$
  select public.cancel_approved_vacation_request('c3000000-0000-0000-0000-000000000004',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000041', 'Grund')
$sql$, 'not_a_member');
select pg_temp.expect_refusal('cancellation without a reason', $sql$
  select public.cancel_approved_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000041', ' ')
$sql$, 'reason_required');
select pg_temp.expect_refusal('cancellation of the own request', $sql$
  select public.cancel_approved_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000041', 'Grund')
$sql$, 'self_approval_not_allowed');
select pg_temp.expect_refusal('cancellation of a pending request', $sql$
  select public.cancel_approved_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040', 'Grund')
$sql$, 'request_not_approved');

reset role;

-- The history row is the last step. When it is refused, the request write is
-- rolled back with it: no request exists or changes without its history row.
create function pg_temp.refuse_vacation_event() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger refuse_vacation_event before insert on public.vacation_request_events
  for each row execute function pg_temp.refuse_vacation_event();

set local role service_role;
select pg_temp.expect_refusal('request whose history row is refused', $sql$
  select public.create_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010'),
    '2027-02-01', '2027-02-01', 'full', null, '{"2027": 1}')
$sql$, 'history refused');
select pg_temp.expect_refusal('withdrawal whose history row is refused', $sql$
  select public.withdraw_vacation_request('c3000000-0000-0000-0000-000000000003',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040')
$sql$, 'history refused');
select pg_temp.expect_refusal('approval whose history row is refused', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040', 'approve', null, '{"2026": 3}')
$sql$, 'history refused');
select pg_temp.expect_refusal('rejection whose history row is refused', $sql$
  select public.decide_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000040', 'reject', 'Engpass', null)
$sql$, 'history refused');
select pg_temp.expect_refusal('cancellation whose history row is refused', $sql$
  select public.cancel_approved_vacation_request('c3000000-0000-0000-0000-000000000002',
    'c3000000-0000-0000-0000-000000000010', 'c3000000-0000-0000-0000-000000000041', 'Grund')
$sql$, 'history refused');
reset role;

drop trigger refuse_vacation_event on public.vacation_request_events;

do $$
begin
  if pg_temp.vacation_state() <> (select state from vacation_state_before) then
    raise exception 'a refused vacation write changed requests or history';
  end if;
end;
$$;

-- Each clean write stores the request and exactly its history row.
set local role service_role;

do $$
declare
  v_org constant uuid := 'c3000000-0000-0000-0000-000000000010';
  v_admin constant uuid := 'c3000000-0000-0000-0000-000000000001';
  v_buero constant uuid := 'c3000000-0000-0000-0000-000000000002';
  v_employee constant uuid := 'c3000000-0000-0000-0000-000000000003';
  v_employee_record constant uuid := pg_temp.record_of('c3000000-0000-0000-0000-000000000003', 'c3000000-0000-0000-0000-000000000010');
  v_request public.vacation_requests;
  v_created public.vacation_requests;
  v_event text;
begin
  v_created := public.create_vacation_request(v_employee, v_org, v_employee_record,
    '2027-01-04', '2027-01-05', 'full', '  Skiurlaub  ', '{"2027": 2}');
  if v_created.organization_id <> v_org or v_created.employee_record_id <> v_employee_record
    or v_created.requested_by <> v_employee or v_created.start_date <> '2027-01-04'
    or v_created.end_date <> '2027-01-05' or v_created.day_portion <> 'full'
    or v_created.status <> 'pending' or v_created.comment <> 'Skiurlaub'
  then raise exception 'a request stored the wrong row: %', to_jsonb(v_created); end if;
  select string_agg(event_type || ':' || event_payload::text || ':' || created_by::text
    || ':' || employee_record_id::text, '|') into v_event
  from public.vacation_request_events where vacation_request_id = v_created.id;
  if v_event is distinct from 'requested:' || jsonb_build_object('start_date', '2027-01-04',
    'end_date', '2027-01-05', 'day_portion', 'full', 'comment', 'Skiurlaub',
    'preview_days_by_year', '{"2027": 2}'::jsonb)::text || ':' || v_employee || ':' || v_employee_record
  then raise exception 'a request recorded the wrong history: %', v_event; end if;

  -- A request without a comment and without a preview records both as null.
  v_request := public.create_vacation_request(v_employee, v_org, v_employee_record,
    '2027-03-01', '2027-03-01', 'half_day', null, null);
  select string_agg(event_payload::text, '|') into v_event
  from public.vacation_request_events where vacation_request_id = v_request.id;
  if v_event is distinct from jsonb_build_object('start_date', '2027-03-01', 'end_date', '2027-03-01',
    'day_portion', 'half_day', 'comment', null, 'preview_days_by_year', null)::text
  then raise exception 'a request without a preview recorded: %', v_event; end if;

  v_request := public.withdraw_vacation_request(v_employee, v_org, 'c3000000-0000-0000-0000-000000000040');
  if v_request.status <> 'withdrawn' then raise exception 'a withdrawal kept the status %', v_request.status; end if;
  select string_agg(event_type || ':' || event_payload::text || ':' || created_by::text, '|') into v_event
  from public.vacation_request_events where vacation_request_id = 'c3000000-0000-0000-0000-000000000040';
  if v_event is distinct from 'withdrawn:{"end_date": "2026-11-04", "start_date": "2026-11-02"}:' || v_employee
  then raise exception 'a withdrawal recorded the wrong history: %', v_event; end if;

  v_request := public.decide_vacation_request(v_admin, v_org, 'c3000000-0000-0000-0000-000000000042',
    'approve', null, '{"2026": 1}');
  if v_request.status <> 'approved' or v_request.decided_by <> v_admin or v_request.decided_at is null
    or v_request.decision_comment is not null or v_request.approved_days_by_year <> '{"2026": 1}'
  then raise exception 'an approval stored the wrong row: %', to_jsonb(v_request); end if;
  select string_agg(event_type || ':' || event_payload::text || ':' || created_by::text, '|') into v_event
  from public.vacation_request_events where vacation_request_id = 'c3000000-0000-0000-0000-000000000042';
  if v_event is distinct from 'approved:' || jsonb_build_object('start_date', '2026-11-10',
    'end_date', '2026-11-10', 'day_portion', 'full', 'decision_comment', null,
    'approved_days_by_year', '{"2026": 1}'::jsonb)::text || ':' || v_admin
  then raise exception 'an approval recorded the wrong history: %', v_event; end if;

  v_request := public.decide_vacation_request(v_buero, v_org, v_created.id, 'reject', ' Engpass ', '{"2027": 9}');
  if v_request.status <> 'rejected' or v_request.decided_by <> v_buero
    or v_request.decision_comment <> 'Engpass' or v_request.approved_days_by_year is not null
  then raise exception 'a rejection stored the wrong row: %', to_jsonb(v_request); end if;
  select string_agg(event_type || ':' || event_payload::text || ':' || created_by::text, '|') into v_event
  from public.vacation_request_events where vacation_request_id = v_created.id and event_type = 'rejected';
  if v_event is distinct from 'rejected:' || jsonb_build_object('start_date', '2027-01-04',
    'end_date', '2027-01-05', 'day_portion', 'full', 'decision_comment', 'Engpass')::text || ':' || v_buero
  then raise exception 'a rejection recorded the wrong history: %', v_event; end if;

  v_request := public.cancel_approved_vacation_request(v_buero, v_org, 'c3000000-0000-0000-0000-000000000041',
    '  Baustelle vorgezogen ');
  if v_request.status <> 'cancelled' or v_request.cancelled_by <> v_buero or v_request.cancelled_at is null
    or v_request.cancellation_reason <> 'Baustelle vorgezogen'
  then raise exception 'a cancellation stored the wrong row: %', to_jsonb(v_request); end if;
  select string_agg(event_type || ':' || event_payload::text || ':' || created_by::text, '|') into v_event
  from public.vacation_request_events where vacation_request_id = 'c3000000-0000-0000-0000-000000000041';
  if v_event is distinct from 'cancelled:' || jsonb_build_object('start_date', '2026-12-01',
    'end_date', '2026-12-02', 'cancellation_reason', 'Baustelle vorgezogen',
    'restored_days_by_year', '{"2026": 2}'::jsonb)::text || ':' || v_buero
  then raise exception 'a cancellation recorded the wrong history: %', v_event; end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.create_vacation_request(uuid, uuid, uuid, date, date, text, text, jsonb)',
    'public.withdraw_vacation_request(uuid, uuid, uuid)',
    'public.decide_vacation_request(uuid, uuid, uuid, text, text, jsonb)',
    'public.cancel_approved_vacation_request(uuid, uuid, uuid, text)'
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
    if has_function_privilege(v_role, 'app_private.lock_vacation_actor(uuid, uuid)', 'execute')
      or has_function_privilege(v_role, 'app_private.lock_vacation_request(uuid, uuid)', 'execute')
    then raise exception 'a vacation write helper is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
