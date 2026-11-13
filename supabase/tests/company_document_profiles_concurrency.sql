-- A suspension that commits while a profile write runs (werk-flow/werkflow-planning#378).
-- A suspension writes only the access lifecycle, under the access lifecycle's
-- advisory lock (set_personnel_access_transition). The first session takes
-- that lock as the transition does and suspends the Büro member without
-- committing. The Büro member's logo change in the second session waits for
-- it, and once the suspension commits, is refused and writes nothing.
--
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. Only the stack's superuser may open dblink
-- without password authentication; the main session only orchestrates and
-- rolls back.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('profile_race_setup', 'dbname=postgres user=postgres');
select dblink_connect('profile_race_first', 'dbname=postgres user=postgres');
select dblink_connect('profile_race_second', 'dbname=postgres user=postgres');

create temporary table profile_race_cleanup (statement text) on commit drop;
insert into profile_race_cleanup values
  ('delete from public.organizations where id = ''37900000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id in (''37900000-0000-4000-8000-000000000001'', ''37900000-0000-4000-8000-000000000002'')');
select dblink_exec('profile_race_setup', statement) from profile_race_cleanup;

select dblink_exec('profile_race_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  ('37900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'profile-race-admin@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
  ('37900000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'profile-race-office@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now());
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('37900000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Race',
   '37900000-0000-4000-8000-000000000001', 'PROFRC');
  insert into public.organization_members (organization_id, user_id, role) values
  ('37900000-0000-4000-8000-000000000010', '37900000-0000-4000-8000-000000000002', 'buero')
  on conflict do nothing;
end $$
$setup$);

-- The first session suspends the Büro member as the access transition does:
-- under the advisory lock, writing the lifecycle, and keeps its transaction open.
select dblink_exec('profile_race_first', 'begin');
select dblink_exec('profile_race_first', $suspend$
do $$
declare
  v_record uuid := (
    select record.id from public.employee_records record
    where record.organization_id = '37900000-0000-4000-8000-000000000010'
      and record.user_id = '37900000-0000-4000-8000-000000000002'
  );
begin
  if v_record is null then raise exception 'the Büro member has no employee record'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    '37900000-0000-4000-8000-000000000010' || ':p1-24-access:' || v_record::text, 0
  ));
  insert into public.personnel_access_lifecycles (organization_id, employee_record_id, state, state_effective_at)
  values ('37900000-0000-4000-8000-000000000010', v_record, 'suspended', now());
end $$
$suspend$);

create temporary table profile_race_second_pid on commit drop as
select pid from dblink('profile_race_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_exec('profile_race_second', 'set role service_role');

-- The Büro member's logo change, as the server sends it.
select dblink_send_query('profile_race_second', $replace$
  select 1 from public.replace_company_document_file('37900000-0000-4000-8000-000000000002',
    '37900000-0000-4000-8000-000000000010', 'logo', null, null,
    '37900000-0000-4000-8000-000000000010/briefpapier/race/logo', 'image/png', 2048,
    '37900000-0000-4000-8000-000000000030')
$replace$);

do $$
declare
  v_pid integer := (select pid from profile_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the logo change never waited for the suspension under way';
    end if;
  end loop;
end $$;

select dblink_exec('profile_race_first', 'commit');

do $$
declare
  v_error text;
  v_rows integer;
begin
  perform * from dblink_get_result('profile_race_second', false) as result(done integer);
  v_error := dblink_error_message('profile_race_second');
  perform * from dblink_get_result('profile_race_second', false) as result(done integer);
  if v_error not like '%not_authorized%' then
    raise exception 'a logo change during the suspension answered: %', v_error;
  end if;
  select rows into v_rows from dblink('profile_race_setup', $read$
    select (select count(*) from public.company_document_profiles
        where organization_id = '37900000-0000-4000-8000-000000000010')
      + (select count(*) from public.company_document_profile_events
        where organization_id = '37900000-0000-4000-8000-000000000010')
  $read$) as profile(rows integer);
  if v_rows <> 0 then
    raise exception 'a refused logo change wrote % rows', v_rows;
  end if;
end $$;

select dblink_exec('profile_race_setup', statement) from profile_race_cleanup;
select dblink_disconnect('profile_race_second');
select dblink_disconnect('profile_race_first');
select dblink_disconnect('profile_race_setup');
rollback;
