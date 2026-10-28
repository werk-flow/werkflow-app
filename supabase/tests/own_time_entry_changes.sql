-- Own time entries (migration 20261028140000_audit_own_time_entry_changes.sql):
-- a Büro member's own entry is refused by the direct edit and deletion
-- functions, whatever the action passed. An Admin's own edit or deletion
-- writes an audit event with the actor, the time and the entry before and
-- after; a change of another person's entry and an edit that changes nothing
-- write none. The audit table is append-only and closed to client roles.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('28100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'own-entry-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Own"}', now(), now()),
('28100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'own-entry-buero@example.test', '', now(), '{}',
 '{"first_name":"Buero","last_name":"Own"}', now(), now()),
('28100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'own-entry-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Own"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('28100000-0000-0000-0000-000000000010', 'Own entries SQL',
  '28100000-0000-0000-0000-000000000001', 'OWNENTSQ');
insert into public.organization_members (organization_id, user_id, role) values
('28100000-0000-0000-0000-000000000010', '28100000-0000-0000-0000-000000000002', 'buero'),
('28100000-0000-0000-0000-000000000010', '28100000-0000-0000-0000-000000000003', 'employee');

insert into public.time_entries (id, user_id, organization_id, entry_type, timestamp, is_manual, status) values
('28100000-0000-0000-0000-000000000021', '28100000-0000-0000-0000-000000000001',
  '28100000-0000-0000-0000-000000000010', 'clock_in', now() - interval '3 hours', true, 'approved'),
('28100000-0000-0000-0000-000000000022', '28100000-0000-0000-0000-000000000001',
  '28100000-0000-0000-0000-000000000010', 'clock_out', now() - interval '1 hour', true, 'approved'),
('28100000-0000-0000-0000-000000000023', '28100000-0000-0000-0000-000000000002',
  '28100000-0000-0000-0000-000000000010', 'clock_in', now() - interval '3 hours', true, 'approved'),
('28100000-0000-0000-0000-000000000024', '28100000-0000-0000-0000-000000000003',
  '28100000-0000-0000-0000-000000000010', 'clock_in', now() - interval '3 hours', true, 'approved');

create temporary table expected_refusals (label text, statement text, refusal text) on commit drop;
grant all on table pg_temp.expected_refusals to service_role;
insert into pg_temp.expected_refusals values
('Büro edit of an own entry', $sql$
  select public.update_time_entry('28100000-0000-0000-0000-000000000002', '28100000-0000-0000-0000-000000000010',
    '28100000-0000-0000-0000-000000000023', jsonb_build_object('timestamp', now() - interval '4 hours'))
$sql$, 'not_authorized'),
('Büro deletion of an own entry', $sql$
  select public.delete_time_entries('28100000-0000-0000-0000-000000000002', '28100000-0000-0000-0000-000000000010',
    array['28100000-0000-0000-0000-000000000023'::uuid], array['28100000-0000-0000-0000-000000000002'::uuid])
$sql$, 'not_authorized'),
('edit of an entry of another organization', $sql$
  select public.update_time_entry('28100000-0000-0000-0000-000000000001', '28100000-0000-0000-0000-000000000011',
    '28100000-0000-0000-0000-000000000021', '{"job_id": null}'::jsonb)
$sql$, 'entry_not_found');

set local role service_role;

do $$
declare
  v_case record;
  v_refusal text;
begin
  for v_case in select * from pg_temp.expected_refusals loop
    v_refusal := null;
    begin
      execute v_case.statement;
    exception when raise_exception then
      v_refusal := sqlerrm;
    end;
    if v_refusal is distinct from v_case.refusal then
      raise exception '% ended with % instead of %', v_case.label, coalesce(v_refusal, 'acceptance'), v_case.refusal;
    end if;
  end loop;
  if (select timestamp from public.time_entries where id = '28100000-0000-0000-0000-000000000023')
    < now() - interval '3 hours 1 minute'
    or exists (select 1 from public.time_entry_audit_events
      where organization_id = '28100000-0000-0000-0000-000000000010')
  then raise exception 'a refused own-entry change wrote something'; end if;
end;
$$;

do $$
declare
  v_org constant uuid := '28100000-0000-0000-0000-000000000010';
  v_admin constant uuid := '28100000-0000-0000-0000-000000000001';
  v_old timestamptz;
  v_new timestamptz := date_trunc('minute', now() - interval '4 hours');
  v_event public.time_entry_audit_events;
begin
  select timestamp into v_old from public.time_entries where id = '28100000-0000-0000-0000-000000000021';

  -- An Admin's own edit applies and is recorded with before and after.
  perform public.update_time_entry(v_admin, v_org, '28100000-0000-0000-0000-000000000021',
    jsonb_build_object('timestamp', v_new));
  select * into strict v_event from public.time_entry_audit_events where organization_id = v_org;
  if v_event.action <> 'edit' or v_event.actor_id <> v_admin
    or v_event.entry_id <> '28100000-0000-0000-0000-000000000021'
    or v_event.entry_timestamp <> v_old
    or (v_event.before_entry ->> 'timestamp')::timestamptz <> v_old
    or (v_event.after_entry ->> 'timestamp')::timestamptz <> v_new
    or v_event.before_entry ->> 'entry_type' <> 'clock_in'
    or v_event.after_entry ->> 'entry_type' <> 'clock_in'
  then raise exception 'an Admin''s own edit was not recorded as it happened: %', row_to_json(v_event); end if;
  if (select timestamp from public.time_entries where id = '28100000-0000-0000-0000-000000000021') <> v_new
  then raise exception 'an Admin''s own edit did not apply'; end if;

  -- An edit that changes nothing, and an edit of another person's entry, record nothing.
  perform public.update_time_entry(v_admin, v_org, '28100000-0000-0000-0000-000000000021',
    jsonb_build_object('timestamp', v_new));
  perform public.update_time_entry(v_admin, v_org, '28100000-0000-0000-0000-000000000024',
    '{"job_id": null}'::jsonb);
  perform public.update_time_entry('28100000-0000-0000-0000-000000000002', v_org,
    '28100000-0000-0000-0000-000000000024', jsonb_build_object('timestamp', v_new));
  if (select count(*) from public.time_entry_audit_events where organization_id = v_org) <> 1
  then raise exception 'an unchanged or foreign-person edit was recorded'; end if;
  if (select timestamp from public.time_entries where id = '28100000-0000-0000-0000-000000000024') <> v_new
  then raise exception 'a Büro edit of an employee entry did not apply'; end if;

  -- An Admin's own deletion, together with another person's entry, records
  -- the own entry only, with its state before.
  if public.delete_time_entries(v_admin, v_org,
    array['28100000-0000-0000-0000-000000000022', '28100000-0000-0000-0000-000000000024']::uuid[],
    array[v_admin, '28100000-0000-0000-0000-000000000003']::uuid[]) <> 2
  then raise exception 'the deletion did not apply'; end if;
  select * into strict v_event from public.time_entry_audit_events
  where organization_id = v_org and action = 'delete';
  if v_event.actor_id <> v_admin or v_event.entry_id <> '28100000-0000-0000-0000-000000000022'
    or v_event.after_entry is not null or v_event.before_entry ->> 'entry_type' <> 'clock_out'
    or v_event.before_entry ->> 'status' <> 'approved'
  then raise exception 'an Admin''s own deletion was not recorded as it happened: %', row_to_json(v_event); end if;

  -- The record is append-only, also for the service role.
  begin
    update public.time_entry_audit_events set actor_id = gen_random_uuid() where organization_id = v_org;
    raise exception 'an audit event update was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.time_entry_audit_events where organization_id = v_org;
    raise exception 'an audit event delete was accepted';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.time_entry_audit_events', 'select')
      or has_table_privilege(v_role, 'public.time_entry_audit_events', 'insert')
      or has_function_privilege(v_role, 'public.update_time_entry(uuid, uuid, uuid, jsonb)', 'execute')
    then raise exception '% reaches the own-entry audit', v_role; end if;
  end loop;
  if not has_function_privilege('service_role', 'public.update_time_entry(uuid, uuid, uuid, jsonb)', 'execute')
  then raise exception 'update_time_entry lost its service_role grant'; end if;
end;
$$;

-- The organization's deletion takes its audit events with it.
delete from public.organizations where id = '28100000-0000-0000-0000-000000000010';
do $$
begin
  if exists (select 1 from public.time_entry_audit_events
    where organization_id = '28100000-0000-0000-0000-000000000010')
  then raise exception 'an organization deletion left audit events'; end if;
end;
$$;

rollback;
