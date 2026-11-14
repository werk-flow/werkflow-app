-- Two concurrent calls under one operation id book once
-- (werk-flow/werkflow-planning#406). One session books an unplanned take and
-- a use and keeps its transaction open; a second session sends the same calls
-- meanwhile. Each waits for the first, then answers with the first booking:
-- one line, one movement, one use event, and the stock lowered once.
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
select dblink_connect('material_retry_setup', 'dbname=postgres user=postgres');
select dblink_connect('material_retry_first', 'dbname=postgres user=postgres');
select dblink_connect('material_retry_second', 'dbname=postgres user=postgres');

create temporary table material_retry_cleanup (statement text) on commit drop;
insert into material_retry_cleanup values
  ('delete from public.organizations where id = ''3c000000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id = ''3c000000-0000-4000-8000-000000000001''');
select dblink_exec('material_retry_setup', statement) from material_retry_cleanup;

select dblink_exec('material_retry_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '3c000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'material-retry-race@example.test', '', now(),
    '{}'::jsonb, '{"first_name":"Race","last_name":"Sonnenberg"}'::jsonb, now(), now()
  );
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('3c000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Retry',
   '3c000000-0000-4000-8000-000000000001', 'MATRETR3');
  insert into public.inventory_items (id, organization_id, name, item_type, unit) values
  ('3c000000-0000-4000-8000-000000000020', '3c000000-0000-4000-8000-000000000010',
   'Kupferrohr 18 mm', 'material', 'meter');
  insert into public.inventory_locations (id, organization_id, name, location_type) values
  ('3c000000-0000-4000-8000-000000000030', '3c000000-0000-4000-8000-000000000010', 'Hauptlager', 'storage');
  insert into public.jobs (id, organization_id, title, created_by) values
  ('3c000000-0000-4000-8000-000000000050', '3c000000-0000-4000-8000-000000000010',
   'Heizraum Musterweg', '3c000000-0000-4000-8000-000000000001');
  perform public.record_inventory_movement('3c000000-0000-4000-8000-000000000010',
    '3c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000020',
    '3c000000-0000-4000-8000-000000000030', 'initial_count', 5);
end $$
$setup$);

create temporary table material_retry_second_pid on commit drop as
select pid from dblink('material_retry_second', 'select pg_backend_pid()') as second(pid integer);

-- Waits until the second session waits for a lock the first one holds.
create function pg_temp.await_second_blocked() returns void language plpgsql as $$
declare
  v_pid integer := (select pid from material_retry_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the second call never waited for the first call under the same operation id';
    end if;
  end loop;
end $$;

-- 1. An unplanned take: the first session books it and keeps it open.
select dblink_exec('material_retry_first', 'begin');
select * from dblink('material_retry_first', $take$
  select public.take_unplanned_inventory_material('3c000000-0000-4000-8000-000000000010',
    '3c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000050', null,
    '3c000000-0000-4000-8000-000000000020', '3c000000-0000-4000-8000-000000000030', 2,
    null, null, '3c000000-0000-4000-8000-0000000000a1')
$take$) as first(quantity_after numeric);

select dblink_send_query('material_retry_second', $take$
  select public.take_unplanned_inventory_material('3c000000-0000-4000-8000-000000000010',
    '3c000000-0000-4000-8000-000000000001', '3c000000-0000-4000-8000-000000000050', null,
    '3c000000-0000-4000-8000-000000000020', '3c000000-0000-4000-8000-000000000030', 2,
    null, null, '3c000000-0000-4000-8000-0000000000a1')
$take$);
select pg_temp.await_second_blocked();
select dblink_exec('material_retry_first', 'commit');

do $$
declare
  v_answer numeric;
  v_lines integer;
  v_movements integer;
  v_stock numeric;
begin
  select quantity_after into v_answer
  from dblink_get_result('material_retry_second') as second(quantity_after numeric);
  perform * from dblink_get_result('material_retry_second') as done(quantity_after numeric);
  select lines, movements, stock into v_lines, v_movements, v_stock from dblink('material_retry_setup', $read$
    select
      (select count(*)::integer from public.job_material_lines
       where job_id = '3c000000-0000-4000-8000-000000000050'),
      (select count(*)::integer from public.inventory_movements
       where organization_id = '3c000000-0000-4000-8000-000000000010' and movement_type = 'job_take'),
      (select quantity_on_hand from public.inventory_stock_levels
       where organization_id = '3c000000-0000-4000-8000-000000000010'
         and item_id = '3c000000-0000-4000-8000-000000000020')
  $read$) as facts(lines integer, movements integer, stock numeric);
  if v_answer is distinct from 3 then
    raise exception 'the concurrent repeat of an unplanned take must answer with the first take''s stock after, got %', v_answer;
  end if;
  if v_lines is distinct from 1 or v_movements is distinct from 1 or v_stock is distinct from 3 then
    raise exception 'two concurrent unplanned takes under one id must book once, got % lines, % takes, stock %',
      v_lines, v_movements, v_stock;
  end if;
end $$;

-- 2. A use of that line: the first session books it and keeps it open.
select dblink_exec('material_retry_first', 'begin');
select * from dblink('material_retry_first', $use$
  select public.record_job_material_use('3c000000-0000-4000-8000-000000000010',
    '3c000000-0000-4000-8000-000000000001',
    (select id from public.job_material_lines where job_id = '3c000000-0000-4000-8000-000000000050'),
    1, null, null, '3c000000-0000-4000-8000-0000000000a2')
$use$) as first(used numeric);

select dblink_send_query('material_retry_second', $use$
  select public.record_job_material_use('3c000000-0000-4000-8000-000000000010',
    '3c000000-0000-4000-8000-000000000001',
    (select id from public.job_material_lines where job_id = '3c000000-0000-4000-8000-000000000050'),
    1, null, null, '3c000000-0000-4000-8000-0000000000a2')
$use$);
select pg_temp.await_second_blocked();
select dblink_exec('material_retry_first', 'commit');

do $$
declare
  v_answer numeric;
  v_events integer;
  v_used numeric;
begin
  select used into v_answer from dblink_get_result('material_retry_second') as second(used numeric);
  perform * from dblink_get_result('material_retry_second') as done(used numeric);
  select events, used into v_events, v_used from dblink('material_retry_setup', $read$
    select (select count(*)::integer from public.job_material_use_events
            where organization_id = '3c000000-0000-4000-8000-000000000010'),
           line.used_quantity
    from public.job_material_lines line where line.job_id = '3c000000-0000-4000-8000-000000000050'
  $read$) as facts(events integer, used numeric);
  if v_answer is distinct from 1 or v_events is distinct from 1 or v_used is distinct from 1 then
    raise exception 'two concurrent uses under one id must book once, got answer %, % events, used %',
      v_answer, v_events, v_used;
  end if;
end $$;

select dblink_exec('material_retry_setup', statement) from material_retry_cleanup;
select dblink_disconnect('material_retry_second');
select dblink_disconnect('material_retry_first');
select dblink_disconnect('material_retry_setup');
rollback;
