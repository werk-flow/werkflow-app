-- Two creates that run at the same time get different numbers, and the same
-- create twice at the same time writes one offer (werk-flow/werkflow-planning#380). The first session creates an offer and
-- keeps its transaction open; the second session's create waits for the
-- organization's number lock and, once the first commits, takes the next number.
--
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. The main session only orchestrates and rolls back.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('offer_race_setup', 'dbname=postgres user=postgres');
select dblink_connect('offer_race_first', 'dbname=postgres user=postgres');
select dblink_connect('offer_race_second', 'dbname=postgres user=postgres');

create temporary table offer_race_cleanup (statement text) on commit drop;
insert into offer_race_cleanup values
  ('delete from public.organizations where id = ''38050000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id in (''38050000-0000-4000-8000-000000000001'', ''38050000-0000-4000-8000-000000000002'')');
select dblink_exec('offer_race_setup', statement) from offer_race_cleanup;

select dblink_exec('offer_race_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  ('38050000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'offer-race-admin@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
  ('38050000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'offer-race-office@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now());
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('38050000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Angebotsrennen',
   '38050000-0000-4000-8000-000000000001', 'OFFRACE');
  insert into public.organization_members (organization_id, user_id, role) values
  ('38050000-0000-4000-8000-000000000010', '38050000-0000-4000-8000-000000000002', 'buero')
  on conflict do nothing;
  insert into public.clients (id, organization_id, name, client_type) values
  ('38050000-0000-4000-8000-000000000020', '38050000-0000-4000-8000-000000000010', 'WEG Lindenstraße 5', 'gewerblich');
end $$
$setup$);

-- The first create holds its transaction open with the number taken.
select dblink_exec('offer_race_first', 'begin');
select dblink_exec('offer_race_first', 'set local role service_role');
select dblink_exec('offer_race_first', $first$
do $$
begin
  perform public.create_offer('38050000-0000-4000-8000-000000000001', '38050000-0000-4000-8000-000000000010',
    '38050000-0000-4000-8000-000000000101', 'Erstes Angebot', '38050000-0000-4000-8000-000000000020',
    null, null, null, null);
end $$
$first$);

create temporary table offer_race_second_pid on commit drop as
select pid from dblink('offer_race_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_exec('offer_race_second', 'set role service_role');
select dblink_send_query('offer_race_second', $second$
  select public.create_offer('38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
    '38050000-0000-4000-8000-000000000102', 'Zweites Angebot', '38050000-0000-4000-8000-000000000020',
    null, null, null, null)
$second$);

do $$
declare
  v_pid integer := (select pid from offer_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the second create never waited for the first one''s number';
    end if;
  end loop;
end $$;

select dblink_exec('offer_race_first', 'commit');

do $$
declare
  v_numbers text[];
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
begin
  perform * from dblink_get_result('offer_race_second', false) as result(offer_id uuid);
  if dblink_error_message('offer_race_second') is distinct from 'OK' then
    raise exception 'the second create failed: %', dblink_error_message('offer_race_second');
  end if;
  perform * from dblink_get_result('offer_race_second', false) as result(offer_id uuid);
  select numbers into v_numbers from dblink('offer_race_setup', $read$
    select array_agg(offer_number order by offer_number) from public.offers
    where organization_id = '38050000-0000-4000-8000-000000000010'
  $read$) as offer(numbers text[]);
  if v_numbers is distinct from array['ANG-' || v_year || '-001', 'ANG-' || v_year || '-002'] then
    raise exception 'two creates at the same time numbered %', v_numbers;
  end if;
end $$;

-- The same press twice at the same time, as a retry after a lost answer while
-- the first is still running: the second waits for the first, then answers
-- with its offer and writes nothing.
select dblink_exec('offer_race_first', 'begin');
select dblink_exec('offer_race_first', 'set local role service_role');
create temporary table offer_race_first_offer on commit drop as
select offer_id from dblink('offer_race_first', $first$
  select public.create_offer('38050000-0000-4000-8000-000000000001', '38050000-0000-4000-8000-000000000010',
    '38050000-0000-4000-8000-000000000201', 'Drittes Angebot', '38050000-0000-4000-8000-000000000020',
    null, null, null, null)
$first$) as first(offer_id uuid);
select dblink_send_query('offer_race_second', $second$
  select public.create_offer('38050000-0000-4000-8000-000000000001', '38050000-0000-4000-8000-000000000010',
    '38050000-0000-4000-8000-000000000201', 'Drittes Angebot', '38050000-0000-4000-8000-000000000020',
    null, null, null, null)
$second$);

do $$
declare
  v_pid integer := (select pid from offer_race_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the repeated create never waited for the first one';
    end if;
  end loop;
end $$;

select dblink_exec('offer_race_first', 'commit');

do $$
declare
  v_answer uuid;
  v_rows integer;
begin
  select offer_id into v_answer from dblink_get_result('offer_race_second', false) as result(offer_id uuid);
  if dblink_error_message('offer_race_second') is distinct from 'OK' then
    raise exception 'the repeated create failed: %', dblink_error_message('offer_race_second');
  end if;
  perform * from dblink_get_result('offer_race_second', false) as result(offer_id uuid);
  if v_answer is distinct from (select offer_id from offer_race_first_offer) then
    raise exception 'the repeated create answered % instead of the first offer', v_answer;
  end if;
  select rows into v_rows from dblink('offer_race_setup', $read$
    select (select count(*) from public.offers
        where organization_id = '38050000-0000-4000-8000-000000000010')
      + (select count(*) from public.offer_events
        where organization_id = '38050000-0000-4000-8000-000000000010')
  $read$) as offer(rows integer);
  if v_rows is distinct from 6 then
    raise exception 'the repeated create left % offers and events instead of 3 each', v_rows;
  end if;
end $$;

select dblink_exec('offer_race_setup', statement) from offer_race_cleanup;
select dblink_disconnect('offer_race_second');
select dblink_disconnect('offer_race_first');
select dblink_disconnect('offer_race_setup');
rollback;
