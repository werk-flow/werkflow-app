-- The people and organization writes that span several rows apply completely
-- or not at all, and only the service role executes them:
-- member removal with the exit date (20261004130000_remove_member_with_exit_atomically.sql),
-- organization creation with its defaults (20261004130100_create_organization_atomically.sql),
-- invite creation with the record connection and the withdrawal of an unsent
-- invite (20261004130200_create_invites_atomically.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('41004000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-owner@example.test', '', now(), '{}',
 '{"first_name":"Owner","last_name":"Atomic"}', now(), now()),
('41004000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-worker@example.test', '', now(), '{}',
 '{"first_name":"Worker","last_name":"Atomic"}', now(), now()),
('41004000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-future@example.test', '', now(), '{}',
 '{"first_name":"Future","last_name":"Atomic"}', now(), now()),
('41004000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'atomic-foreign-owner@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"Atomic"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('41004000-0000-0000-0000-000000000010', 'Atomic people SQL',
  '41004000-0000-0000-0000-000000000001', 'ATOMPPL1'),
('41004000-0000-0000-0000-000000000011', 'Atomic foreign SQL',
  '41004000-0000-0000-0000-000000000004', 'ATOMPPL2');
insert into public.organization_members (organization_id, user_id, role) values
('41004000-0000-0000-0000-000000000010', '41004000-0000-0000-0000-000000000002', 'employee'),
('41004000-0000-0000-0000-000000000010', '41004000-0000-0000-0000-000000000003', 'employee');
-- The future hire starts next month.
update public.employee_records set entry_date = (now() at time zone 'Europe/Berlin')::date + 30
where organization_id = '41004000-0000-0000-0000-000000000010'
  and user_id = '41004000-0000-0000-0000-000000000003';

-- Personnel records without login, for the invite section.
insert into public.employee_records (id, organization_id, first_name, last_name) values
('41004000-0000-0000-0000-000000000020', '41004000-0000-0000-0000-000000000010', 'Rita', 'Record'),
('41004000-0000-0000-0000-000000000021', '41004000-0000-0000-0000-000000000011', 'Fritz', 'Foreign');
insert into public.organization_invites (id, organization_id, email, invite_code, invited_role) values
('41004000-0000-0000-0000-000000000030', '41004000-0000-0000-0000-000000000010',
  'rita-old@example.test', '41004000-0000-0000-0000-0000000000c0', 'employee'),
('41004000-0000-0000-0000-000000000031', '41004000-0000-0000-0000-000000000010',
  'taken@example.test', '41004000-0000-0000-0000-0000000000c1', 'employee');
update public.employee_records set invite_id = '41004000-0000-0000-0000-000000000030'
where id = '41004000-0000-0000-0000-000000000020';

-- Runs one call and requires the named refusal.
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

-- A refusal of the organization settings insert, the step after the
-- organization insert. Owned by postgres; dropped before the success path.
create function public.atomic_people_refuse_settings() returns trigger
language plpgsql as $$ begin raise exception 'settings_refused'; end; $$;
create trigger atomic_people_refuse_settings before insert on public.organization_settings
for each row execute function public.atomic_people_refuse_settings();

set local role service_role;

-- Member removal ------------------------------------------------------------

-- A future hire cannot exit today: the whole removal is refused, nothing changes.
select pg_temp.expect_refusal('removal of a future hire', $sql$
  select public.remove_member_with_time_capture(
    '41004000-0000-0000-0000-000000000010', '41004000-0000-0000-0000-000000000003',
    '41004000-0000-0000-0000-000000000001', gen_random_uuid())
$sql$, 'member_removal_exit_before_entry');
-- Another organization's call does not reach this organization's member.
select pg_temp.expect_refusal('removal through a foreign organization', $sql$
  select public.remove_member_with_time_capture(
    '41004000-0000-0000-0000-000000000011', '41004000-0000-0000-0000-000000000002',
    '41004000-0000-0000-0000-000000000004', gen_random_uuid())
$sql$, 'time_member_removal_target_missing');

do $$
begin
  if (select count(*) from public.organization_members
      where organization_id = '41004000-0000-0000-0000-000000000010'
        and user_id in ('41004000-0000-0000-0000-000000000002', '41004000-0000-0000-0000-000000000003')) <> 2
  then raise exception 'a refused removal removed a membership'; end if;
  if exists (select 1 from public.employee_records
      where organization_id = '41004000-0000-0000-0000-000000000010' and exit_date is not null)
  then raise exception 'a refused removal wrote an exit date'; end if;
  if exists (select 1 from public.employee_record_events
      where organization_id = '41004000-0000-0000-0000-000000000010' and event_type = 'membership_removed')
  then raise exception 'a refused removal recorded an event'; end if;
end;
$$;

-- A removal deletes the membership, marks the record as exited today and records why.
do $$
declare
  v_today constant date := (now() at time zone 'Europe/Berlin')::date;
  v_record public.employee_records;
  v_event public.employee_record_events;
begin
  if public.remove_member_with_time_capture(
    '41004000-0000-0000-0000-000000000010', '41004000-0000-0000-0000-000000000002',
    '41004000-0000-0000-0000-000000000001', gen_random_uuid()
  ) is distinct from false then raise exception 'a removal without session reported a clock-out'; end if;
  if exists (select 1 from public.organization_members
      where organization_id = '41004000-0000-0000-0000-000000000010'
        and user_id = '41004000-0000-0000-0000-000000000002')
  then raise exception 'the removal kept the membership'; end if;
  select * into v_record from public.employee_records
  where organization_id = '41004000-0000-0000-0000-000000000010'
    and user_id = '41004000-0000-0000-0000-000000000002';
  if v_record.exit_date is distinct from v_today then
    raise exception 'the removal wrote exit date % instead of %', v_record.exit_date, v_today;
  end if;
  select * into strict v_event from public.employee_record_events
  where employee_record_id = v_record.id and event_type = 'membership_removed';
  if v_event.created_by <> '41004000-0000-0000-0000-000000000001'
    or v_event.event_payload <> jsonb_build_object('exit_date', v_today, 'auto_clocked_out', false)
  then raise exception 'the removal recorded % by %', v_event.event_payload, v_event.created_by; end if;
end;
$$;

-- Organization creation -----------------------------------------------------

-- The settings insert is refused after the organization insert: nothing stays.
select pg_temp.expect_refusal('creation with refused settings', $sql$
  select public.create_organization_with_defaults(
    '41004000-0000-0000-0000-000000000002', 'Half SQL', 'ATOMHALF')
$sql$, 'settings_refused');
do $$
begin
  if exists (select 1 from public.organizations where unique_code = 'ATOMHALF')
    or exists (select 1 from public.organization_members membership
      join public.organizations organization on organization.id = membership.organization_id
      where organization.name = 'Half SQL')
  then raise exception 'a refused creation left an organization behind'; end if;
end;
$$;

reset role;
drop trigger atomic_people_refuse_settings on public.organization_settings;
drop function public.atomic_people_refuse_settings();
set local role service_role;

-- The owner's name is taken whatever its case and outer spaces.
select pg_temp.expect_refusal('creation with a taken name', $sql$
  select public.create_organization_with_defaults(
    '41004000-0000-0000-0000-000000000001', ' atomic PEOPLE sql ', 'ATOMDUPL')
$sql$, 'name_taken');

-- A creation writes the organization, its settings with the first policy
-- entry, the owner membership and the owner's personnel record.
do $$
declare
  v_organization_id uuid;
  v_settings public.organization_settings;
begin
  v_organization_id := public.create_organization_with_defaults(
    '41004000-0000-0000-0000-000000000002', 'Neue Firma SQL', 'ATOMNEW1');
  if not exists (select 1 from public.organizations
      where id = v_organization_id and admin_id = '41004000-0000-0000-0000-000000000002'
        and name = 'Neue Firma SQL' and unique_code = 'ATOMNEW1')
  then raise exception 'the creation did not write the organization'; end if;
  select * into strict v_settings from public.organization_settings where organization_id = v_organization_id;
  if v_settings.break_mode <> 'manual' or v_settings.auto_break_threshold_minutes <> 360
    or v_settings.auto_break_duration_minutes <> 30
    or jsonb_array_length(v_settings.break_policy_history) <> 1
    or v_settings.break_policy_history -> 0 ->> 'breakMode' <> 'manual'
    or (v_settings.break_policy_history -> 0 ->> 'effectiveFrom') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  then raise exception 'the creation wrote settings %', row_to_json(v_settings); end if;
  if not exists (select 1 from public.organization_members
      where organization_id = v_organization_id
        and user_id = '41004000-0000-0000-0000-000000000002' and role = 'admin')
  then raise exception 'the creation did not add the owner membership'; end if;
  if not exists (select 1 from public.employee_records
      where organization_id = v_organization_id and user_id = '41004000-0000-0000-0000-000000000002')
  then raise exception 'the creation did not add the owner personnel record'; end if;
end;
$$;

-- Invites -------------------------------------------------------------------

-- The insert is refused after the record's earlier invite was cancelled: the
-- earlier invite stays pending and connected.
select pg_temp.expect_refusal('record invite to an address with a pending invite', $sql$
  select * from public.create_organization_invite(
    '41004000-0000-0000-0000-000000000010', 'taken@example.test', gen_random_uuid()::text,
    'employee', '41004000-0000-0000-0000-000000000020')
$sql$, 'invite_already_pending');
do $$
begin
  if (select status from public.organization_invites where id = '41004000-0000-0000-0000-000000000030') <> 'pending'
    or (select invite_id from public.employee_records where id = '41004000-0000-0000-0000-000000000020')
      is distinct from '41004000-0000-0000-0000-000000000030'
    or (select count(*) from public.organization_invites
        where organization_id = '41004000-0000-0000-0000-000000000010') <> 2
  then raise exception 'a refused invite changed the record or its earlier invite'; end if;
end;
$$;

-- Another organization's record, a record with login and an admin role are refused.
select pg_temp.expect_refusal('invite for a foreign record', $sql$
  select * from public.create_organization_invite(
    '41004000-0000-0000-0000-000000000010', 'fritz@example.test', gen_random_uuid()::text,
    'employee', '41004000-0000-0000-0000-000000000021')
$sql$, 'record_not_found');
select pg_temp.expect_refusal('invite for a record with login', $sql$
  select * from public.create_organization_invite(
    '41004000-0000-0000-0000-000000000010', 'future@example.test', gen_random_uuid()::text,
    'employee', (select id from public.employee_records
      where organization_id = '41004000-0000-0000-0000-000000000010'
        and user_id = '41004000-0000-0000-0000-000000000003'))
$sql$, 'already_has_login');
select pg_temp.expect_refusal('invite as admin', $sql$
  select * from public.create_organization_invite(
    '41004000-0000-0000-0000-000000000010', 'boss@example.test', gen_random_uuid()::text,
    'admin', null)
$sql$, 'invalid_role');
select pg_temp.expect_refusal('second pending invite for an address', $sql$
  select * from public.create_organization_invite(
    '41004000-0000-0000-0000-000000000010', 'taken@example.test', gen_random_uuid()::text,
    'employee', null)
$sql$, 'invite_already_pending');

-- A record invite to the same address replaces the earlier one; a failed mail
-- withdraws the new invite and gives the record its earlier invite back.
do $$
declare
  v_created record;
begin
  select * into strict v_created from public.create_organization_invite(
    '41004000-0000-0000-0000-000000000010', 'rita-old@example.test', gen_random_uuid()::text,
    'buero', '41004000-0000-0000-0000-000000000020');
  if v_created.replaced_invite_id is distinct from '41004000-0000-0000-0000-000000000030'
    or (select status from public.organization_invites where id = '41004000-0000-0000-0000-000000000030') <> 'cancelled'
    or (select invite_id from public.employee_records where id = '41004000-0000-0000-0000-000000000020')
      is distinct from v_created.invite_id
    or (select invited_role from public.organization_invites where id = v_created.invite_id) <> 'buero'
  then raise exception 'the record invite did not replace the earlier one'; end if;

  -- Another organization cannot withdraw it.
  if public.discard_unsent_organization_invite(
    '41004000-0000-0000-0000-000000000011', v_created.invite_id, v_created.replaced_invite_id
  ) then raise exception 'a foreign organization withdrew an invite'; end if;
  if not exists (select 1 from public.organization_invites where id = v_created.invite_id)
  then raise exception 'a foreign withdrawal deleted the invite'; end if;

  if not public.discard_unsent_organization_invite(
    '41004000-0000-0000-0000-000000000010', v_created.invite_id, v_created.replaced_invite_id
  ) then raise exception 'the unsent invite was not withdrawn'; end if;
  if exists (select 1 from public.organization_invites where id = v_created.invite_id)
    or (select status from public.organization_invites where id = '41004000-0000-0000-0000-000000000030') <> 'pending'
    or (select invite_id from public.employee_records where id = '41004000-0000-0000-0000-000000000020')
      is distinct from '41004000-0000-0000-0000-000000000030'
  then raise exception 'the withdrawal did not restore the earlier invite'; end if;
end;
$$;

-- An organization invite without record, withdrawn after a failed mail.
do $$
declare
  v_created record;
begin
  select * into strict v_created from public.create_organization_invite(
    '41004000-0000-0000-0000-000000000010', 'neu@example.test', gen_random_uuid()::text,
    'employee', null);
  if v_created.replaced_invite_id is not null
    or (select status from public.organization_invites where id = v_created.invite_id) <> 'pending'
  then raise exception 'the organization invite was not created pending'; end if;
  if not public.discard_unsent_organization_invite(
    '41004000-0000-0000-0000-000000000010', v_created.invite_id, null
  ) then raise exception 'the unsent organization invite was not withdrawn'; end if;
  if exists (select 1 from public.organization_invites where id = v_created.invite_id)
  then raise exception 'the withdrawn organization invite still exists'; end if;
end;
$$;

-- Organization deletion ------------------------------------------------------

-- deleteOrganization (lib/org/delete-action.ts) deletes the organization row
-- alone; the cascade removes the owner membership, the members, the invites,
-- the personnel records and their history in the same statement.
delete from public.organizations where id = '41004000-0000-0000-0000-000000000010';
do $$
begin
  if exists (select 1 from public.organization_members where organization_id = '41004000-0000-0000-0000-000000000010')
    or exists (select 1 from public.organization_invites where organization_id = '41004000-0000-0000-0000-000000000010')
    or exists (select 1 from public.employee_records where organization_id = '41004000-0000-0000-0000-000000000010')
    or exists (select 1 from public.employee_record_events where organization_id = '41004000-0000-0000-0000-000000000010')
  then raise exception 'the organization deletion left rows behind'; end if;
  if not exists (select 1 from public.organization_members where organization_id = '41004000-0000-0000-0000-000000000011')
  then raise exception 'the organization deletion reached another organization'; end if;
end;
$$;

reset role;

-- Only the service role executes the functions.
do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.remove_member_with_time_capture(uuid, uuid, uuid, uuid)',
    'public.create_organization_with_defaults(uuid, text, text)',
    'public.create_organization_invite(uuid, text, text, public.org_role, uuid)',
    'public.discard_unsent_organization_invite(uuid, uuid, uuid)'
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
end;
$$;

rollback;
