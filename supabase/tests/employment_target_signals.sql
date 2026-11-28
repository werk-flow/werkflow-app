-- The employee's target signal
-- (20270503090002_signal_target_changes_to_the_employee.sql,
-- 20270701110001_tell_a_login_its_record_was_taken.sql,
-- werk-flow/werkflow-planning#589). A change of a person's entry or exit
-- date, login or employment conditions moves their own signal row and no
-- other; a change of anything else on the record or the conditions, and the
-- author's account leaving, move nothing. A login that loses its record
-- keeps its row under the same key, cleared of the record and moved, so it
-- hears of the loss (werk-flow/werkflow-planning#621); the cleared row leaves
-- with the login's next record, membership, account or organization. A new
-- login gets a new row, so no event of the old row's key reaches it. The row
-- holds ids and a timestamp, never a column of the personnel tables. Only
-- its own person selects it, while a member of its organization; Realtime
-- delivers by that policy, so no other session hears of the change. No
-- client role writes it, anon reads nothing, and it carries no deletion
-- notice, which would reach every member.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('58900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-admin@example.test', '', now(), '{}',
 '{"first_name":"Ada","last_name":"Signal"}', now(), now()),
('58900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-employee@example.test', '', now(), '{}',
 '{"first_name":"Ben","last_name":"Signal"}', now(), now()),
('58900000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-colleague@example.test', '', now(), '{}',
 '{"first_name":"Cem","last_name":"Signal"}', now(), now()),
('58900000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-outsider@example.test', '', now(), '{}',
 '{"first_name":"Dana","last_name":"Signal"}', now(), now()),
('58900000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-author@example.test', '', now(), '{}',
 '{"first_name":"Emil","last_name":"Signal"}', now(), now()),
('58900000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-new-login@example.test', '', now(), '{}',
 '{"first_name":"Frida","last_name":"Signal"}', now(), now()),
('58900000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-leaver@example.test', '', now(), '{}',
 '{"first_name":"Gül","last_name":"Signal"}', now(), now()),
('58900000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'signal-closed-account@example.test', '', now(), '{}',
 '{"first_name":"Hanna","last_name":"Signal"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('58900000-0000-0000-0000-000000000010', 'Signal GmbH', '58900000-0000-0000-0000-000000000001', 'SIGNAL10'),
('58900000-0000-0000-0000-000000000011', 'Andere GmbH', '58900000-0000-0000-0000-000000000004', 'SIGNAL11');
-- A membership creates the person's record, which signals its person once.
insert into public.organization_members (organization_id, user_id, role) values
('58900000-0000-0000-0000-000000000010', '58900000-0000-0000-0000-000000000002', 'employee'),
('58900000-0000-0000-0000-000000000010', '58900000-0000-0000-0000-000000000003', 'employee');
-- A record without a login has nobody to tell.
insert into public.employee_records (id, organization_id, user_id, first_name, last_name) values
('58900000-0000-0000-0000-000000000020', '58900000-0000-0000-0000-000000000010', null, 'Ohne', 'Login');

create function pg_temp.record_of(p_user_id uuid) returns uuid language sql as $$
  select record.id from public.employee_records record
  where record.organization_id = '58900000-0000-0000-0000-000000000010' and record.user_id = p_user_id;
$$;
-- Ages the fixture's signals, so a step's move reads as a timestamp of this transaction.
create function pg_temp.age_signals() returns void language sql as $$
  update public.employment_target_signals set updated_at = now() - interval '1 hour'
  where organization_id in ('58900000-0000-0000-0000-000000000010', '58900000-0000-0000-0000-000000000011');
$$;
-- The fixture's people whose signal moved since the last aging, in id order.
create function pg_temp.moved() returns uuid[] language sql as $$
  select coalesce(array_agg(user_id order by user_id), array[]::uuid[])
  from public.employment_target_signals
  where organization_id in ('58900000-0000-0000-0000-000000000010', '58900000-0000-0000-0000-000000000011')
    and updated_at = now();
$$;

-- The table's shape and grants: ids and a timestamp, read by the person only.
do $$
declare
  v_role text;
begin
  if (select array_agg(column_name::text order by column_name::text) from information_schema.columns
      where table_schema = 'public' and table_name = 'employment_target_signals')
    is distinct from array['employee_record_id', 'id', 'organization_id', 'updated_at', 'user_id'] then
    raise exception 'the signal carries a column beyond its ids and timestamp';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.employment_target_signals', 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    then raise exception '% writes the target signals', v_role; end if;
    if v_role = 'anon'
      and has_table_privilege(v_role, 'public.employment_target_signals', 'SELECT')
    then raise exception '% reads the target signals', v_role; end if;
    -- Realtime leaves out the columns its subscriber may not select, so a
    -- client never receives the record id, also in an event queued before a clear.
    if v_role = 'authenticated' and (
      has_column_privilege(v_role, 'public.employment_target_signals', 'employee_record_id', 'SELECT')
      or not has_column_privilege(v_role, 'public.employment_target_signals', 'id', 'SELECT')
      or not has_column_privilege(v_role, 'public.employment_target_signals', 'organization_id', 'SELECT')
      or not has_column_privilege(v_role, 'public.employment_target_signals', 'user_id', 'SELECT')
      or not has_column_privilege(v_role, 'public.employment_target_signals', 'updated_at', 'SELECT'))
    then raise exception '% selects the record id or misses an id or the timestamp', v_role; end if;
    if v_role is distinct from 'service_role'
      and has_function_privilege(v_role, 'app_private.signal_employment_target_change()', 'EXECUTE')
    then raise exception '% executes the signal trigger', v_role; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.employment_target_signals'::regclass) then
    raise exception 'the target signals have no row level security';
  end if;
  if not exists (select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'employment_target_signals') then
    raise exception 'the target signals are not published';
  end if;
  if exists (select 1 from pg_trigger
      where tgrelid = 'public.employment_target_signals'::regclass
        and tgfoid = 'app_private.emit_realtime_deletion()'::regprocedure) then
    raise exception 'the target signals notify their organization of a deletion';
  end if;
end;
$$;

-- Each change moves exactly its person's signal.
do $$
declare
  v_admin constant uuid := '58900000-0000-0000-0000-000000000001';
  v_employee constant uuid := '58900000-0000-0000-0000-000000000002';
  v_colleague constant uuid := '58900000-0000-0000-0000-000000000003';
  v_employee_record constant uuid := pg_temp.record_of('58900000-0000-0000-0000-000000000002');
  v_colleague_record constant uuid := pg_temp.record_of('58900000-0000-0000-0000-000000000003');
  v_no_login_record constant uuid := '58900000-0000-0000-0000-000000000020';
  v_condition uuid;
begin
  if (select array_agg(user_id order by user_id) from public.employment_target_signals
      where organization_id = '58900000-0000-0000-0000-000000000010')
    is distinct from array[v_admin, v_employee, v_colleague] then
    raise exception 'a new member''s record did not signal exactly its person';
  end if;

  perform pg_temp.age_signals();
  update public.employee_records set exit_date = '2037-12-31' where id = v_employee_record;
  if pg_temp.moved() is distinct from array[v_employee] then
    raise exception 'an exit date did not signal exactly its person: %', pg_temp.moved();
  end if;

  perform pg_temp.age_signals();
  update public.employee_records set entry_date = '2020-01-01' where id = v_colleague_record;
  if pg_temp.moved() is distinct from array[v_colleague] then
    raise exception 'an entry date did not signal exactly its person: %', pg_temp.moved();
  end if;

  -- The office's note and the contact data set no target: nothing moves.
  perform pg_temp.age_signals();
  update public.employee_records
  set notes = 'Nur fürs Büro', phone = '0123', exit_date = '2037-12-31'
  where id = v_employee_record;
  if pg_temp.moved() is distinct from array[]::uuid[] then
    raise exception 'a note or contact change signalled: %', pg_temp.moved();
  end if;

  perform pg_temp.age_signals();
  insert into public.employment_conditions (organization_id, employee_record_id, valid_from, employment_type, weekly_hours)
  values ('58900000-0000-0000-0000-000000000010', v_employee_record, '2026-01-01', 'teilzeit', 30)
  returning id into v_condition;
  if pg_temp.moved() is distinct from array[v_employee] then
    raise exception 'new conditions did not signal exactly their person: %', pg_temp.moved();
  end if;

  perform pg_temp.age_signals();
  update public.employment_conditions set weekly_hours = 20 where id = v_condition;
  if pg_temp.moved() is distinct from array[v_employee] then
    raise exception 'changed weekly hours did not signal exactly their person: %', pg_temp.moved();
  end if;

  perform pg_temp.age_signals();
  update public.employment_conditions set vacation_days_per_year = 28 where id = v_condition;
  if pg_temp.moved() is distinct from array[v_employee] then
    raise exception 'changed vacation days did not signal exactly their person: %', pg_temp.moved();
  end if;

  -- The note, the employment type, an unchanged save and the author's
  -- account leaving set no target and no entitlement: nothing moves.
  update public.employment_conditions set created_by = '58900000-0000-0000-0000-000000000005' where id = v_condition;
  perform pg_temp.age_signals();
  update public.employment_conditions
  set note = 'Nur fürs Büro', employment_type = 'vollzeit', weekly_hours = 20
  where id = v_condition;
  delete from auth.users where id = '58900000-0000-0000-0000-000000000005';
  if (select created_by from public.employment_conditions where id = v_condition) is not null then
    raise exception 'the author''s account left the conditions';
  end if;
  if pg_temp.moved() is distinct from array[]::uuid[] then
    raise exception 'a note, type, unchanged or author change signalled: %', pg_temp.moved();
  end if;

  perform pg_temp.age_signals();
  delete from public.employment_conditions where id = v_condition;
  if pg_temp.moved() is distinct from array[v_employee] then
    raise exception 'deleted conditions did not signal their person: %', pg_temp.moved();
  end if;

  -- A record without a login gets no signal.
  insert into public.employment_conditions (organization_id, employee_record_id, valid_from, employment_type)
  values ('58900000-0000-0000-0000-000000000010', v_no_login_record, '2026-01-01', 'vollzeit');
  update public.employee_records set exit_date = '2037-06-30' where id = v_no_login_record;
  if exists (select 1 from public.employment_target_signals where employee_record_id = v_no_login_record) then
    raise exception 'a record without a login got a signal';
  end if;
end;
$$;

-- The signal ids the client roles below name.
select set_config('test.employee_signal', (select id::text from public.employment_target_signals
  where user_id = '58900000-0000-0000-0000-000000000002'), true);
select set_config('test.colleague_signal', (select id::text from public.employment_target_signals
  where user_id = '58900000-0000-0000-0000-000000000003'), true);

-- The employee reads their own signal row, by its id or another person's id
-- (the foreign-id read), and nothing else; nobody writes one.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"58900000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select array_agg(user_id) from public.employment_target_signals)
    is distinct from array['58900000-0000-0000-0000-000000000002'::uuid] then
    raise exception 'the employee did not read exactly their own signal row';
  end if;
  if exists (select 1 from public.employment_target_signals
      where id = current_setting('test.colleague_signal')::uuid) then
    raise exception 'the employee read a colleague''s signal by its id';
  end if;
  begin
    perform employee_record_id from public.employment_target_signals;
    raise exception 'the employee read the record id of their signal';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.employment_target_signals set updated_at = now();
    raise exception 'the employee wrote a signal row';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The Admin reads only their own row, not the employee's.
select set_config('request.jwt.claims',
  '{"sub":"58900000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select array_agg(user_id) from public.employment_target_signals)
    is distinct from array['58900000-0000-0000-0000-000000000001'::uuid] then
    raise exception 'the Admin did not read exactly their own signal row';
  end if;
end;
$$;

-- Another organization's Admin reads none of this organization's rows.
select set_config('request.jwt.claims',
  '{"sub":"58900000-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.employment_target_signals
      where organization_id = '58900000-0000-0000-0000-000000000010'
        or id = current_setting('test.employee_signal')::uuid) then
    raise exception 'another organization read a signal row';
  end if;
end;
$$;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform 1 from public.employment_target_signals;
    raise exception 'anon read the target signals';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- A former member hears of no later change. A record that loses its login
-- keeps that login's row under the same key, naming no record, and moves
-- only that row (werk-flow/werkflow-planning#621): the publication sends the
-- update to the login's own policy, without the record it no longer holds.
do $$
declare
  v_employee constant uuid := '58900000-0000-0000-0000-000000000002';
  v_employee_record constant uuid := pg_temp.record_of('58900000-0000-0000-0000-000000000002');
  v_signal uuid;
begin
  delete from public.organization_members
  where organization_id = '58900000-0000-0000-0000-000000000010'
    and user_id = '58900000-0000-0000-0000-000000000003';

  select id into v_signal from public.employment_target_signals where employee_record_id = v_employee_record;
  perform pg_temp.age_signals();
  update public.employee_records set user_id = null where id = v_employee_record;
  if exists (select 1 from public.employment_target_signals where employee_record_id = v_employee_record) then
    raise exception 'a record without its login kept a signal naming it';
  end if;
  if not exists (select 1 from public.employment_target_signals
      where id = v_signal and user_id = v_employee and employee_record_id is null) then
    raise exception 'the former login''s signal did not stay under its key without a record';
  end if;
  if pg_temp.moved() is distinct from array[v_employee] then
    raise exception 'an unlinked record did not move exactly its former login''s signal: %', pg_temp.moved();
  end if;
  perform set_config('test.cleared_signal', v_signal::text, true);
  perform set_config('test.unlinked_record', v_employee_record::text, true);
end;
$$;

-- The former login still reads its one row.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"58900000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select array_agg(id) from public.employment_target_signals)
    is distinct from array[current_setting('test.cleared_signal')::uuid] then
    raise exception 'the former login did not read exactly its cleared signal';
  end if;
end;
$$;
reset role;

-- A login that gets a record back retires its cleared row and gets a new
-- key. A direct relink keeps the old login's key with it, cleared, and gives
-- the new login a new key, so no event of the old row reaches the new login.
do $$
declare
  v_employee constant uuid := '58900000-0000-0000-0000-000000000002';
  v_new_login constant uuid := '58900000-0000-0000-0000-000000000006';
  v_employee_record constant uuid := current_setting('test.unlinked_record')::uuid;
  v_cleared constant uuid := current_setting('test.cleared_signal')::uuid;
  v_old_signal uuid;
begin
  update public.employee_records set user_id = v_employee where id = v_employee_record;
  select id into v_old_signal from public.employment_target_signals
  where employee_record_id = v_employee_record and user_id = v_employee;
  if v_old_signal is null then
    raise exception 'a record that got its login back did not signal its person';
  end if;
  if exists (select 1 from public.employment_target_signals where id = v_cleared)
    or (select count(*) from public.employment_target_signals
      where organization_id = '58900000-0000-0000-0000-000000000010' and user_id = v_employee) <> 1 then
    raise exception 'a login that got a record kept its cleared signal';
  end if;

  perform pg_temp.age_signals();
  update public.employee_records set user_id = v_new_login where id = v_employee_record;
  if (select array_agg(user_id) from public.employment_target_signals where employee_record_id = v_employee_record)
    is distinct from array[v_new_login] then
    raise exception 'a relinked record did not signal exactly its new login';
  end if;
  if not exists (select 1 from public.employment_target_signals
      where id = v_old_signal and user_id = v_employee and employee_record_id is null) then
    raise exception 'a relinked record did not leave the old login its key, cleared';
  end if;
  if pg_temp.moved() is distinct from array[v_employee, v_new_login] then
    raise exception 'a relink moved other signals than the old and new login''s: %', pg_temp.moved();
  end if;

  -- The new login is no member: its account leaving clears the record's
  -- login, and its row goes with nobody to tell.
  delete from auth.users where id = v_new_login;
  if exists (select 1 from public.employment_target_signals
      where employee_record_id = v_employee_record or user_id = v_new_login) then
    raise exception 'a deleted account kept its signal';
  end if;

  -- Deleting a record takes its conditions and its signal, and signals nobody.
  update public.employee_records set user_id = v_employee where id = v_employee_record;
  insert into public.employment_conditions (organization_id, employee_record_id, valid_from, employment_type, weekly_hours)
  values ('58900000-0000-0000-0000-000000000010', v_employee_record, '2026-02-01', 'teilzeit', 25);
  perform pg_temp.age_signals();
  delete from public.employee_records where id = v_employee_record;
  if exists (select 1 from public.employment_conditions where employee_record_id = v_employee_record)
    or exists (select 1 from public.employment_target_signals where user_id = v_employee)
    or pg_temp.moved() is distinct from array[]::uuid[] then
    raise exception 'a deleted record left its conditions or a signal, or moved a signal';
  end if;
end;
$$;

-- No cleared row outlives its person: it leaves with the membership, with
-- the account, and with the organization.
do $$
declare
  v_member constant uuid := '58900000-0000-0000-0000-000000000007';
  v_account constant uuid := '58900000-0000-0000-0000-000000000008';
  v_other_admin constant uuid := '58900000-0000-0000-0000-000000000004';
begin
  insert into public.organization_members (organization_id, user_id, role) values
  ('58900000-0000-0000-0000-000000000010', v_member, 'employee'),
  ('58900000-0000-0000-0000-000000000010', v_account, 'employee');
  update public.employee_records set user_id = null
  where organization_id = '58900000-0000-0000-0000-000000000010' and user_id = v_member;
  update public.employee_records set user_id = null
  where organization_id = '58900000-0000-0000-0000-000000000011' and user_id = v_other_admin;
  if (select array_agg(user_id order by user_id) from public.employment_target_signals
      where user_id in (v_member, v_other_admin) and employee_record_id is null)
    is distinct from array[v_other_admin, v_member] then
    raise exception 'unlinked members did not keep their cleared signals';
  end if;

  delete from public.organization_members
  where organization_id = '58900000-0000-0000-0000-000000000010' and user_id = v_member;
  if exists (select 1 from public.employment_target_signals where user_id = v_member) then
    raise exception 'a cleared signal outlived its membership';
  end if;

  -- The account leaves while its record still holds it: the cascade clears
  -- the login and ends the membership, in either order, and leaves no row.
  delete from auth.users where id = v_account;
  if exists (select 1 from public.employment_target_signals where user_id = v_account) then
    raise exception 'a signal outlived its account';
  end if;

  delete from public.organizations where id = '58900000-0000-0000-0000-000000000011';
  if exists (select 1 from public.employment_target_signals
      where organization_id = '58900000-0000-0000-0000-000000000011') then
    raise exception 'a signal outlived its organization';
  end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"58900000-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.employment_target_signals) then
    raise exception 'a former member read their signal row';
  end if;
end;
$$;
reset role;

rollback;
