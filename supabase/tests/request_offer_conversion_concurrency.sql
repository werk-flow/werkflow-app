-- Two conversions of one request into an offer at the same time make one offer
-- (werk-flow/werkflow-planning#386). The first session converts the request and
-- keeps its transaction open; the second session's conversion waits for the
-- request's row lock. Under another key it is then refused; under the same
-- key, as a retry after a lost answer, it answers with the first offer.
--
-- The sessions need committed rows, so this file writes one synthetic
-- organization through dblink connections and deletes it at the start (a run
-- that broke off) and at the end. The main session only orchestrates and rolls back.
\connect postgres supabase_admin
begin;
set local search_path = public, extensions, pg_temp;
create extension if not exists dblink with schema extensions;
select dblink_connect('request_offer_setup', 'dbname=postgres user=postgres');
select dblink_connect('request_offer_first', 'dbname=postgres user=postgres');
select dblink_connect('request_offer_second', 'dbname=postgres user=postgres');

create temporary table request_offer_cleanup (statement text) on commit drop;
insert into request_offer_cleanup values
  ('delete from public.organizations where id = ''38600000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id in (''38600000-0000-4000-8000-000000000001'', ''38600000-0000-4000-8000-000000000002'')');
select dblink_exec('request_offer_setup', statement) from request_offer_cleanup;

select dblink_exec('request_offer_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  ('38600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'request-offer-admin@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Erika","last_name":"Musterfrau"}'::jsonb, now(), now()),
  ('38600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'request-offer-office@example.test', '', now(), '{}'::jsonb,
   '{"first_name":"Max","last_name":"Mustermann"}'::jsonb, now(), now());
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('38600000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Anfragerennen',
   '38600000-0000-4000-8000-000000000001', 'REQOFRC');
  insert into public.organization_members (organization_id, user_id, role) values
  ('38600000-0000-4000-8000-000000000010', '38600000-0000-4000-8000-000000000002', 'buero')
  on conflict do nothing;
  insert into public.clients (id, organization_id, name) values
  ('38600000-0000-4000-8000-000000000020', '38600000-0000-4000-8000-000000000010', 'Hausverwaltung Lindenhof GmbH');
  -- 40: two offices convert it with their own keys; 41: one office presses twice.
  insert into public.client_requests (id, organization_id, summary, client_id) values
  ('38600000-0000-4000-8000-000000000040', '38600000-0000-4000-8000-000000000010', 'Bad neu',
   '38600000-0000-4000-8000-000000000020'),
  ('38600000-0000-4000-8000-000000000041', '38600000-0000-4000-8000-000000000010', 'Heizung tauschen',
   '38600000-0000-4000-8000-000000000020');
end $$
$setup$);

create temporary table request_offer_second_pid on commit drop as
select pid from dblink('request_offer_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_exec('request_offer_second', 'set role service_role');

-- Waits until the second session waits for a lock the first one holds.
create function pg_temp.await_second_blocked(p_label text) returns void language plpgsql as $$
declare
  v_pid integer := (select pid from request_offer_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception '% never waited for the first conversion', p_label;
    end if;
  end loop;
end;
$$;

-- Two offices under their own keys: the second is refused once the first commits.
select dblink_exec('request_offer_first', 'begin');
select dblink_exec('request_offer_first', 'set local role service_role');
select dblink_exec('request_offer_first', $first$
do $$
begin
  perform public.convert_client_request_to_offer('38600000-0000-4000-8000-000000000010',
    '38600000-0000-4000-8000-000000000001', '38600000-0000-4000-8000-000000000040',
    '38600000-0000-4000-8000-000000000101', '38600000-0000-4000-8000-000000000020', 'Bad neu', null, null);
end $$
$first$);
select dblink_send_query('request_offer_second', $second$
  select id from public.convert_client_request_to_offer('38600000-0000-4000-8000-000000000010',
    '38600000-0000-4000-8000-000000000002', '38600000-0000-4000-8000-000000000040',
    '38600000-0000-4000-8000-000000000102', '38600000-0000-4000-8000-000000000020', 'Bad neu, zweites Büro', null, null)
$second$);
select pg_temp.await_second_blocked('the other office''s conversion');
select dblink_exec('request_offer_first', 'commit');

do $$
declare
  v_error text;
  v_offers integer;
begin
  perform * from dblink_get_result('request_offer_second', false) as result(offer_id uuid);
  v_error := dblink_error_message('request_offer_second');
  perform * from dblink_get_result('request_offer_second', false) as result(offer_id uuid);
  if v_error not like '%already_converted%' then
    raise exception 'a second conversion of a converted request answered: %', v_error;
  end if;
  select offers into v_offers from dblink('request_offer_setup', $read$
    select count(*)::integer from public.offers
    where organization_id = '38600000-0000-4000-8000-000000000010'
      and request_id = '38600000-0000-4000-8000-000000000040'
  $read$) as offer(offers integer);
  if v_offers is distinct from 1 then
    raise exception 'two conversions at the same time made % offers', v_offers;
  end if;
end $$;

-- One office presses twice under one key: the second answers with the first offer.
select dblink_exec('request_offer_first', 'begin');
select dblink_exec('request_offer_first', 'set local role service_role');
create temporary table request_offer_first_offer on commit drop as
select offer_id from dblink('request_offer_first', $first$
  select id from public.convert_client_request_to_offer('38600000-0000-4000-8000-000000000010',
    '38600000-0000-4000-8000-000000000002', '38600000-0000-4000-8000-000000000041',
    '38600000-0000-4000-8000-000000000201', '38600000-0000-4000-8000-000000000020', 'Heizung tauschen', null, null)
$first$) as first(offer_id uuid);
select dblink_send_query('request_offer_second', $second$
  select id from public.convert_client_request_to_offer('38600000-0000-4000-8000-000000000010',
    '38600000-0000-4000-8000-000000000002', '38600000-0000-4000-8000-000000000041',
    '38600000-0000-4000-8000-000000000201', '38600000-0000-4000-8000-000000000020', 'Heizung tauschen', null, null)
$second$);
select pg_temp.await_second_blocked('the repeated conversion');
select dblink_exec('request_offer_first', 'commit');

do $$
declare
  v_answer uuid;
  v_rows integer;
begin
  select offer_id into v_answer from dblink_get_result('request_offer_second', false) as result(offer_id uuid);
  if dblink_error_message('request_offer_second') is distinct from 'OK' then
    raise exception 'the repeated conversion failed: %', dblink_error_message('request_offer_second');
  end if;
  perform * from dblink_get_result('request_offer_second', false) as result(offer_id uuid);
  if v_answer is distinct from (select offer_id from request_offer_first_offer) then
    raise exception 'the repeated conversion answered % instead of the first offer', v_answer;
  end if;
  select rows into v_rows from dblink('request_offer_setup', $read$
    select ((select count(*) from public.offers
        where organization_id = '38600000-0000-4000-8000-000000000010'
          and request_id = '38600000-0000-4000-8000-000000000041')
      + (select count(*) from public.client_request_events
        where organization_id = '38600000-0000-4000-8000-000000000010'
          and request_id = '38600000-0000-4000-8000-000000000041' and event_type = 'converted'))::integer
  $read$) as offer(rows integer);
  if v_rows is distinct from 2 then
    raise exception 'the repeated conversion left % offers and history rows instead of one each', v_rows;
  end if;
end $$;

select dblink_exec('request_offer_setup', statement) from request_offer_cleanup;
select dblink_disconnect('request_offer_second');
select dblink_disconnect('request_offer_first');
select dblink_disconnect('request_offer_setup');
rollback;
