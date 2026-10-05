-- Deciding a change request of a time entry records the decision and applies
-- it to the entries in one transaction, or refuses and changes nothing
-- (migration 20261004180400_decide_entry_change_requests_atomically.sql).
begin;

do $$
begin
  if has_function_privilege('anon', 'public.decide_entry_change_request(uuid, uuid, uuid, text)', 'execute')
    or has_function_privilege('authenticated', 'public.decide_entry_change_request(uuid, uuid, uuid, text)', 'execute')
    or not has_function_privilege('service_role', 'public.decide_entry_change_request(uuid, uuid, uuid, text)', 'execute')
  then
    raise exception 'decide_entry_change_request grants are wrong';
  end if;
end;
$$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
('c5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
 'change-admin@example.test', '', now(), '{}', '{"first_name":"Change","last_name":"Admin"}', now(), now()),
('c5000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
 'change-employee@example.test', '', now(), '{}', '{"first_name":"Change","last_name":"Employee"}', now(), now()),
('c5000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
 'change-office@example.test', '', now(), '{}', '{"first_name":"Change","last_name":"Office"}', now(), now()),
('c5000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
 'change-foreign@example.test', '', now(), '{}', '{"first_name":"Change","last_name":"Foreign"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('c5000000-0000-4000-8000-000000000010', 'Change request SQL', 'c5000000-0000-4000-8000-000000000001', 'CHANGESQ'),
('c5000000-0000-4000-8000-000000000011', 'Foreign change SQL', 'c5000000-0000-4000-8000-000000000004', 'CHANGEFS');
insert into public.organization_members (organization_id, user_id, role) values
('c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000002', 'employee'),
('c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000003', 'buero');
-- Entries: 21/22 an edited entry, 23/24 a pair awaiting deletion for each
-- decision, 27/28 a closed-month pair awaiting deletion, 29 an entry whose
-- edit moved it out of the closed month.
insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status) values
('c5000000-0000-4000-8000-000000000021', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_in', '2026-04-02 08:30+02', true, 'approved'),
('c5000000-0000-4000-8000-000000000022', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_in', '2026-04-03 08:30+02', true, 'approved'),
('c5000000-0000-4000-8000-000000000023', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_in', '2026-04-06 08:00+02', true, 'pending_delete'),
('c5000000-0000-4000-8000-000000000024', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_out', '2026-04-06 16:00+02', true, 'pending_delete'),
('c5000000-0000-4000-8000-000000000025', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_in', '2026-04-07 08:00+02', true, 'pending_delete'),
('c5000000-0000-4000-8000-000000000026', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_out', '2026-04-07 16:00+02', true, 'pending_delete'),
('c5000000-0000-4000-8000-000000000027', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_in', '2026-03-10 08:00+01', true, 'pending_delete'),
('c5000000-0000-4000-8000-000000000028', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_out', '2026-03-10 16:00+01', true, 'pending_delete'),
('c5000000-0000-4000-8000-000000000029', 'c5000000-0000-4000-8000-000000000002', 'c5000000-0000-4000-8000-000000000010', 'clock_in', '2026-04-08 08:00+02', true, 'approved');

insert into public.entry_change_requests
  (id, entry_id, paired_entry_id, organization_id, requested_by, change_type, proposed_timestamp, original_timestamp) values
('c5000000-0000-4000-8000-000000000031', 'c5000000-0000-4000-8000-000000000021', null, 'c5000000-0000-4000-8000-000000000010',
 'c5000000-0000-4000-8000-000000000002', 'edit', '2026-04-02 08:30+02', '2026-04-02 08:00+02'),
('c5000000-0000-4000-8000-000000000032', 'c5000000-0000-4000-8000-000000000022', null, 'c5000000-0000-4000-8000-000000000010',
 'c5000000-0000-4000-8000-000000000002', 'edit', '2026-04-03 08:30+02', '2026-04-03 08:00+02'),
('c5000000-0000-4000-8000-000000000033', 'c5000000-0000-4000-8000-000000000023', 'c5000000-0000-4000-8000-000000000024',
 'c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000002', 'delete', null, null),
('c5000000-0000-4000-8000-000000000034', 'c5000000-0000-4000-8000-000000000025', 'c5000000-0000-4000-8000-000000000026',
 'c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000002', 'delete', null, null),
('c5000000-0000-4000-8000-000000000035', 'c5000000-0000-4000-8000-000000000027', 'c5000000-0000-4000-8000-000000000028',
 'c5000000-0000-4000-8000-000000000010', 'c5000000-0000-4000-8000-000000000002', 'delete', null, null),
('c5000000-0000-4000-8000-000000000036', 'c5000000-0000-4000-8000-000000000029', null, 'c5000000-0000-4000-8000-000000000010',
 'c5000000-0000-4000-8000-000000000002', 'edit', '2026-04-08 08:00+02', '2026-03-20 08:00+01');

-- March closes after its entries were recorded. Its close version is a placeholder: the foreign key is
-- deferred to commit, and this file rolls back (closed_period_writes.sql
-- closes a month through the real workflow).
insert into public.time_periods
  (organization_id, period_start_date, period_end_date, state, prepared_by, current_close_version_id) values
('c5000000-0000-4000-8000-000000000010', '2026-03-01', '2026-03-31', 'closed', 'c5000000-0000-4000-8000-000000000001',
 'c5000000-0000-4000-8000-000000000040');

-- Refusals change nothing: a foreign organization, an invalid decision, a
-- non-member, an office member without the admin role.
do $$
declare
  v_org constant uuid := 'c5000000-0000-4000-8000-000000000010';
  v_admin constant uuid := 'c5000000-0000-4000-8000-000000000001';
  v_case record;
begin
  for v_case in
    select * from (values
      (v_admin, 'c5000000-0000-4000-8000-000000000011'::uuid, 'approve', 'request_not_found'),
      (v_admin, v_org, 'apply', 'invalid_input'),
      ('c5000000-0000-4000-8000-000000000004'::uuid, v_org, 'approve', 'not_a_member'),
      ('c5000000-0000-4000-8000-000000000003'::uuid, v_org, 'approve', 'not_authorized')
    ) as refusal(actor, organization, decision, expected)
  loop
    begin
      perform public.decide_entry_change_request(
        v_case.actor, v_case.organization, 'c5000000-0000-4000-8000-000000000033', v_case.decision);
      raise exception 'decision by % in % was not refused', v_case.actor, v_case.organization;
    exception when raise_exception then
      if sqlerrm <> v_case.expected then raise; end if;
    end;
  end loop;
  if (select status from public.entry_change_requests where id = 'c5000000-0000-4000-8000-000000000033') <> 'pending'
    or (select count(*) from public.time_entries
        where id in ('c5000000-0000-4000-8000-000000000023', 'c5000000-0000-4000-8000-000000000024')
          and status = 'pending_delete') <> 2
  then
    raise exception 'a refused decision changed the request or its entries';
  end if;
end;
$$;

-- All or nothing: the request is decided before the entries are written; when
-- the closed-period trigger refuses the entry write, the decision is gone too.
do $$
declare
  v_org constant uuid := 'c5000000-0000-4000-8000-000000000010';
  v_admin constant uuid := 'c5000000-0000-4000-8000-000000000001';
  v_case record;
begin
  for v_case in
    select * from (values
      ('c5000000-0000-4000-8000-000000000035'::uuid, 'approve'),
      ('c5000000-0000-4000-8000-000000000035'::uuid, 'reject'),
      ('c5000000-0000-4000-8000-000000000036'::uuid, 'reject')
    ) as closed(request_id, decision)
  loop
    begin
      perform public.decide_entry_change_request(v_admin, v_org, v_case.request_id, v_case.decision);
      raise exception 'closed-month decision % of % succeeded', v_case.decision, v_case.request_id;
    exception when sqlstate 'WFP01' then
      if sqlerrm <> 'period_closed' then raise; end if;
    end;
  end loop;
  if exists (
    select 1 from public.entry_change_requests
    where id in ('c5000000-0000-4000-8000-000000000035', 'c5000000-0000-4000-8000-000000000036')
      and (status <> 'pending' or reviewed_by is not null or reviewed_at is not null)
  ) then
    raise exception 'a refused entry write left its request decided';
  end if;
  if (select count(*) from public.time_entries
      where id in ('c5000000-0000-4000-8000-000000000027', 'c5000000-0000-4000-8000-000000000028')
        and status = 'pending_delete') <> 2
    or (select timestamp from public.time_entries where id = 'c5000000-0000-4000-8000-000000000029')
      <> '2026-04-08 08:00+02'
  then
    raise exception 'a refused decision changed its entries';
  end if;
end;
$$;

-- Each decision records the reviewer and applies the immediate-effect model.
set local role service_role;
do $$
declare
  v_org constant uuid := 'c5000000-0000-4000-8000-000000000010';
  v_admin constant uuid := 'c5000000-0000-4000-8000-000000000001';
  v_request public.entry_change_requests;
begin
  -- Approving an edit keeps the entry as edited.
  v_request := public.decide_entry_change_request(v_admin, v_org, 'c5000000-0000-4000-8000-000000000031', 'approve');
  if v_request.status <> 'approved' or v_request.reviewed_by <> v_admin or v_request.reviewed_at is null
    or (select timestamp from public.time_entries where id = 'c5000000-0000-4000-8000-000000000021')
      <> '2026-04-02 08:30+02'
  then
    raise exception 'approving an edit changed the entry or missed the decision';
  end if;

  -- Rejecting an edit restores the original timestamp.
  v_request := public.decide_entry_change_request(v_admin, v_org, 'c5000000-0000-4000-8000-000000000032', 'reject');
  if v_request.status <> 'rejected'
    or (select status from public.entry_change_requests where id = 'c5000000-0000-4000-8000-000000000032') <> 'rejected'
    or (select timestamp from public.time_entries where id = 'c5000000-0000-4000-8000-000000000022')
      <> '2026-04-03 08:00+02'
  then
    raise exception 'rejecting an edit did not restore the original time';
  end if;

  -- Rejecting a deletion restores both entries.
  v_request := public.decide_entry_change_request(v_admin, v_org, 'c5000000-0000-4000-8000-000000000033', 'reject');
  if v_request.status <> 'rejected'
    or (select count(*) from public.time_entries
        where id in ('c5000000-0000-4000-8000-000000000023', 'c5000000-0000-4000-8000-000000000024')
          and status = 'approved') <> 2
  then
    raise exception 'rejecting a deletion did not restore both entries';
  end if;

  -- Approving a deletion removes the pair, and the cascade removes the request.
  v_request := public.decide_entry_change_request(v_admin, v_org, 'c5000000-0000-4000-8000-000000000034', 'approve');
  if v_request.status <> 'approved' or v_request.reviewed_by <> v_admin
    or exists (select 1 from public.time_entries
      where id in ('c5000000-0000-4000-8000-000000000025', 'c5000000-0000-4000-8000-000000000026'))
    or exists (select 1 from public.entry_change_requests where id = 'c5000000-0000-4000-8000-000000000034')
  then
    raise exception 'approving a deletion did not remove the pair';
  end if;

  -- A decided request is not decided again.
  begin
    perform public.decide_entry_change_request(v_admin, v_org, 'c5000000-0000-4000-8000-000000000032', 'approve');
    raise exception 'a decided request was decided again';
  exception when raise_exception then
    if sqlerrm <> 'request_already_reviewed' then raise; end if;
  end;
end;
$$;
reset role;

rollback;
