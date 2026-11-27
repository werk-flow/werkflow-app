-- Signal writes that race a change of the record's login
-- (20270503090002_signal_target_changes_to_the_employee.sql,
-- werk-flow/werkflow-planning#589).
-- 1. The first session locks a personnel record and then relinks it to a new
--    login; a condition write in the second session waits for the record
--    before it touches any signal, and once the first commits, moves the new
--    login's signal, never the old one's.
-- 2. A condition write holds the record while the login's account is being
--    deleted; the write's signal waits for no account, so neither session
--    deadlocks, and the cleared login retires the signal.
--
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. The main session only orchestrates and rolls back.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('signal_race_setup', 'dbname=postgres user=postgres');
select dblink_connect('signal_race_first', 'dbname=postgres user=postgres');
select dblink_connect('signal_race_second', 'dbname=postgres user=postgres');

create temporary table signal_race_cleanup (statement text) on commit drop;
insert into signal_race_cleanup values
  ('delete from public.organizations where id = ''58910000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id in (''58910000-0000-4000-8000-000000000001'', ''58910000-0000-4000-8000-000000000002'', ''58910000-0000-4000-8000-000000000003'')');
select dblink_exec('signal_race_setup', statement) from signal_race_cleanup;

select dblink_exec('signal_race_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  ('58910000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'signal-race-admin@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
  ('58910000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'signal-race-old@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now()),
  ('58910000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'signal-race-new@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Moritz","last_name":"Mustermann"}'::jsonb, now(), now());
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('58910000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Signalrennen',
   '58910000-0000-4000-8000-000000000001', 'SIGRACE');
  insert into public.organization_members (organization_id, user_id, role) values
  ('58910000-0000-4000-8000-000000000010', '58910000-0000-4000-8000-000000000002', 'employee')
  on conflict do nothing;
end $$
$setup$);

create temporary table signal_race_record on commit drop as
select record_id from dblink('signal_race_setup', $read$
  select id from public.employee_records
  where organization_id = '58910000-0000-4000-8000-000000000010'
    and user_id = '58910000-0000-4000-8000-000000000002'
$read$) as record(record_id uuid);

-- 1. The first session takes the record and holds it; the condition write waits for it.
select dblink_exec('signal_race_first', 'begin');
create temporary table signal_race_relink_start on commit drop as
select started from dblink('signal_race_first', format(
  'select now() from public.employee_records where id = %L for no key update',
  (select record_id from signal_race_record))) as first(started timestamptz);

create temporary table signal_race_second_pid on commit drop as
select pid from dblink('signal_race_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_send_query('signal_race_second', format(
  'insert into public.employment_conditions (organization_id, employee_record_id, valid_from, employment_type, weekly_hours) values (%L, %L, %L, %L, 30)',
  '58910000-0000-4000-8000-000000000010', (select record_id from signal_race_record), '2026-01-01', 'teilzeit'));

do $$
declare
  v_pid integer := (select pid from signal_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the condition write never waited for the record';
    end if;
  end loop;
end $$;

-- The relink commits; the waiting write then signals the new login.
select dblink_exec('signal_race_first', format(
  'update public.employee_records set user_id = %L where id = %L',
  '58910000-0000-4000-8000-000000000003', (select record_id from signal_race_record)));
select dblink_exec('signal_race_first', 'commit');

do $$
declare
  v_owners uuid[];
  v_moved timestamptz;
begin
  perform * from dblink_get_result('signal_race_second', false) as result(status text);
  if dblink_error_message('signal_race_second') is distinct from 'OK' then
    raise exception 'the condition write failed: %', dblink_error_message('signal_race_second');
  end if;
  perform * from dblink_get_result('signal_race_second', false) as result(status text);
  select owners, moved into v_owners, v_moved from dblink('signal_race_setup', format($read$
    select array_agg(user_id), max(updated_at) from public.employment_target_signals where employee_record_id = %L
  $read$, (select record_id from signal_race_record))) as signal(owners uuid[], moved timestamptz);
  if v_owners is distinct from array['58910000-0000-4000-8000-000000000003'::uuid] then
    raise exception 'a condition write during a relink signalled %', v_owners;
  end if;
  if v_moved <= (select started from signal_race_relink_start) then
    raise exception 'the condition write did not move the new login''s signal';
  end if;
end $$;

-- 2. A record whose signal row is missing, as one linked before this
-- migration: the condition write holds the record, the account's deletion
-- waits for it, and the write then adds the signal.
select dblink_exec('signal_race_setup', format(
  'delete from public.employment_target_signals where employee_record_id = %L',
  (select record_id from signal_race_record)));
select dblink_exec('signal_race_first', 'begin');
select locked from dblink('signal_race_first', format(
  'select 1 from public.employee_records where id = %L for share', (select record_id from signal_race_record)))
  as first(locked integer);
select dblink_send_query('signal_race_second',
  'delete from auth.users where id = ''58910000-0000-4000-8000-000000000003''');

do $$
declare
  v_pid integer := (select pid from signal_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the account deletion never waited for the record';
    end if;
  end loop;
end $$;

select dblink_exec('signal_race_first', format(
  'insert into public.employment_conditions (organization_id, employee_record_id, valid_from, employment_type, weekly_hours) values (%L, %L, %L, %L, 20)',
  '58910000-0000-4000-8000-000000000010', (select record_id from signal_race_record), '2026-02-01', 'teilzeit'));
select dblink_exec('signal_race_first', 'commit');

do $$
declare
  v_signals integer;
  v_login uuid;
begin
  perform * from dblink_get_result('signal_race_second', false) as result(status text);
  if dblink_error_message('signal_race_second') is distinct from 'OK' then
    raise exception 'the account deletion failed: %', dblink_error_message('signal_race_second');
  end if;
  perform * from dblink_get_result('signal_race_second', false) as result(status text);
  select signals, login into v_signals, v_login from dblink('signal_race_setup', format($read$
    select (select count(*)::integer from public.employment_target_signals where employee_record_id = %1$L),
      (select user_id from public.employee_records where id = %1$L)
  $read$, (select record_id from signal_race_record))) as state(signals integer, login uuid);
  if v_login is not null or v_signals is distinct from 0 then
    raise exception 'the deleted account kept its login (%) or signal (%)', v_login, v_signals;
  end if;
end $$;

select dblink_exec('signal_race_setup', statement) from signal_race_cleanup;
select dblink_disconnect('signal_race_setup');
select dblink_disconnect('signal_race_first');
select dblink_disconnect('signal_race_second');
rollback;
