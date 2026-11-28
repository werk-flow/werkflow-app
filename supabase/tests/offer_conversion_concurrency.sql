-- Two conversions of one accepted offer at the same time create one work, and
-- the same press twice at the same time answers the first conversion
-- (werk-flow/werkflow-planning#388). The first session converts and keeps its
-- transaction open; the second waits for the offer's row lock and, once the
-- first commits, is refused or answered with the first work.
--
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. The main session only orchestrates and rolls back.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('convert_race_setup', 'dbname=postgres user=postgres');
select dblink_connect('convert_race_first', 'dbname=postgres user=postgres');
select dblink_connect('convert_race_second', 'dbname=postgres user=postgres');

create temporary table convert_race_cleanup (statement text) on commit drop;
insert into convert_race_cleanup values
  ('delete from public.organizations where id = ''38810000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id in (''38810000-0000-4000-8000-000000000001'', ''38810000-0000-4000-8000-000000000002'')');
select dblink_exec('convert_race_setup', statement) from convert_race_cleanup;

-- Two offers, each sent and accepted: 101 for the race of two keys, 102 for the same key twice.
select dblink_exec('convert_race_setup', $setup$
do $$
declare
  v_key uuid;
  v_offer uuid;
  v_document uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  ('38810000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'convert-race-admin@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
  ('38810000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'convert-race-office@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now());
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('38810000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Auftragsrennen',
   '38810000-0000-4000-8000-000000000001', 'CONVRACE');
  insert into public.organization_members (organization_id, user_id, role) values
  ('38810000-0000-4000-8000-000000000010', '38810000-0000-4000-8000-000000000002', 'buero')
  on conflict do nothing;
  insert into public.clients (id, organization_id, name, client_type) values
  ('38810000-0000-4000-8000-000000000020', '38810000-0000-4000-8000-000000000010', 'WEG Lindenstraße 5', 'gewerblich');
  foreach v_key in array array['38810000-0000-4000-8000-000000000101', '38810000-0000-4000-8000-000000000102']::uuid[] loop
    v_document := gen_random_uuid();
    v_offer := public.create_offer('38810000-0000-4000-8000-000000000002', '38810000-0000-4000-8000-000000000010',
      v_key, 'Heizung Lindenstraße', '38810000-0000-4000-8000-000000000020', null, null, null, null);
    perform public.save_offer_content('38810000-0000-4000-8000-000000000002', '38810000-0000-4000-8000-000000000010',
      v_offer, 1, gen_random_uuid(), jsonb_build_array(jsonb_build_object('title', 'Montage', 'netCents', 80000,
        'positions', jsonb_build_array(jsonb_build_object('kind', 'free', 'name', 'Montagepauschale',
          'description', '', 'quantity', '1', 'unit', 'piece', 'unitLabel', 'Stk.', 'unitPriceCents', 80000,
          'priceQuantity', 1, 'taxRateBasisPoints', 1900, 'amountCents', 80000,
          'positionType', jsonb_build_object('kind', 'normal'))))),
      '{"netCents": 80000, "taxCents": 15200, "grossCents": 95200, "positionTypes": true}');
    perform public.send_offer('38810000-0000-4000-8000-000000000002', '38810000-0000-4000-8000-000000000010',
      v_offer, 1, 2, gen_random_uuid(), 'post', (now() at time zone 'Europe/Berlin')::date, 'WEG Lindenstraße 5',
      null, '{"site": null, "positionTypes": true}', v_document,
      '38810000-0000-4000-8000-000000000010/' || v_document || '/Angebot.pdf', 'Angebot ' || v_offer || '.pdf',
      2048, repeat('b', 64));
    perform public.accept_offer('38810000-0000-4000-8000-000000000002', '38810000-0000-4000-8000-000000000010',
      v_offer, 2, gen_random_uuid(), 1, 'Erika Musterfrau', (now() at time zone 'Europe/Berlin')::date, 'email',
      '', '{}', '{"netCents": 80000, "taxCents": 15200, "grossCents": 95200}');
  end loop;
end $$
$setup$);

create temporary table convert_race_offers on commit drop as
select * from dblink('convert_race_setup', $read$
  select event.attempt_key, event.offer_id from public.offer_events event
  where event.organization_id = '38810000-0000-4000-8000-000000000010' and event.event_type = 'created'
$read$) as offer(attempt_key uuid, offer_id uuid);
create function pg_temp.race_offer(p_key text) returns uuid language sql as $$
  select offer_id from convert_race_offers where attempt_key = p_key::uuid;
$$;
create function pg_temp.conversion(p_offer uuid, p_key text) returns text language sql as $$
  select format('select public.convert_offer_to_work(''38810000-0000-4000-8000-000000000002'',
    ''38810000-0000-4000-8000-000000000010'', %L, 3, %L, ''job'', ''Heizung Lindenstraße'')::text', p_offer, p_key);
$$;
create temporary table convert_race_second_pid on commit drop as
select pid from dblink('convert_race_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_exec('convert_race_second', 'set role service_role');

-- Two conversions under two keys: the first holds its transaction open, the second waits.
select dblink_exec('convert_race_first', 'begin');
select dblink_exec('convert_race_first', 'set local role service_role');
select * from dblink('convert_race_first',
  pg_temp.conversion(pg_temp.race_offer('38810000-0000-4000-8000-000000000101'),
    '38810000-0000-4000-8000-000000000201')) as first(answer text);
select dblink_send_query('convert_race_second',
  pg_temp.conversion(pg_temp.race_offer('38810000-0000-4000-8000-000000000101'),
    '38810000-0000-4000-8000-000000000202'));

do $$
declare
  v_pid integer := (select pid from convert_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the second conversion never waited for the first one';
    end if;
  end loop;
end $$;

select dblink_exec('convert_race_first', 'commit');

do $$
declare
  v_counts text;
begin
  perform * from dblink_get_result('convert_race_second', false) as result(answer text);
  if dblink_error_message('convert_race_second') !~ 'offer_converted' then
    raise exception 'the second conversion ended with % instead of offer_converted',
      dblink_error_message('convert_race_second');
  end if;
  perform * from dblink_get_result('convert_race_second', false) as result(answer text);
  select counts into v_counts from dblink('convert_race_setup', $read$
    select (select count(*) from public.orders where organization_id = '38810000-0000-4000-8000-000000000010')
      || ' ' || (select count(*) from public.jobs where organization_id = '38810000-0000-4000-8000-000000000010')
  $read$) as counted(counts text);
  if v_counts is distinct from '1 1' then
    raise exception 'two conversions at the same time left orders and jobs %, expected one each', v_counts;
  end if;
end $$;

-- The same press twice at the same time, as a retry after a lost answer while the first still runs:
-- the second waits for the first, then answers with its work and writes nothing.
select dblink_exec('convert_race_first', 'begin');
select dblink_exec('convert_race_first', 'set local role service_role');
create temporary table convert_race_first_answer on commit drop as
select answer::jsonb from dblink('convert_race_first',
  pg_temp.conversion(pg_temp.race_offer('38810000-0000-4000-8000-000000000102'),
    '38810000-0000-4000-8000-000000000301')) as first(answer text);
select dblink_send_query('convert_race_second',
  pg_temp.conversion(pg_temp.race_offer('38810000-0000-4000-8000-000000000102'),
    '38810000-0000-4000-8000-000000000301'));

do $$
declare
  v_pid integer := (select pid from convert_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the repeated conversion never waited for the first one';
    end if;
  end loop;
end $$;

select dblink_exec('convert_race_first', 'commit');

do $$
declare
  v_answer jsonb;
  v_counts text;
begin
  select answer::jsonb into v_answer from dblink_get_result('convert_race_second', false) as result(answer text);
  if dblink_error_message('convert_race_second') is distinct from 'OK' then
    raise exception 'the repeated conversion failed: %', dblink_error_message('convert_race_second');
  end if;
  perform * from dblink_get_result('convert_race_second', false) as result(answer text);
  if v_answer ->> 'replay' is distinct from 'true'
    or v_answer ->> 'workId' is distinct from (select answer ->> 'workId' from convert_race_first_answer) then
    raise exception 'the repeated conversion answered % instead of the first work', v_answer;
  end if;
  select counts into v_counts from dblink('convert_race_setup', $read$
    select (select count(*) from public.orders where organization_id = '38810000-0000-4000-8000-000000000010')
      || ' ' || (select count(*) from public.jobs where organization_id = '38810000-0000-4000-8000-000000000010')
  $read$) as counted(counts text);
  if v_counts is distinct from '2 2' then
    raise exception 'the repeated conversion left orders and jobs %, expected two each', v_counts;
  end if;
end $$;

select dblink_exec('convert_race_setup', statement) from convert_race_cleanup;
select dblink_disconnect('convert_race_second');
select dblink_disconnect('convert_race_first');
select dblink_disconnect('convert_race_setup');
rollback;
