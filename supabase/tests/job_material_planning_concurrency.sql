-- Two calls that plan the same source at once yield one line
-- (werk-flow/werkflow-planning#376). The first session plans the source and
-- keeps its transaction open; the second session's call for the same source
-- waits for it, and once the first commits it answers with the first line.
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
select dblink_connect('material_plan_setup', 'dbname=postgres user=postgres');
select dblink_connect('material_plan_first', 'dbname=postgres user=postgres');
select dblink_connect('material_plan_second', 'dbname=postgres user=postgres');

create temporary table material_plan_cleanup (statement text) on commit drop;
insert into material_plan_cleanup values
  ('delete from public.organizations where id = ''3a000000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id = ''3a000000-0000-4000-8000-000000000001''');
select dblink_exec('material_plan_setup', statement) from material_plan_cleanup;

select dblink_exec('material_plan_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '3a000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'material-plan-race@example.test', '', now(),
    '{}'::jsonb, '{"first_name":"Race","last_name":"Sonnenberg"}'::jsonb, now(), now()
  );
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('3a000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Plan',
   '3a000000-0000-4000-8000-000000000001', 'MATPLAN3');
  insert into public.inventory_items (id, organization_id, name, item_type, unit) values
  ('3a000000-0000-4000-8000-000000000020', '3a000000-0000-4000-8000-000000000010',
   'Kupferrohr 18 mm', 'material', 'meter');
  insert into public.jobs (id, organization_id, title, created_by) values
  ('3a000000-0000-4000-8000-000000000050', '3a000000-0000-4000-8000-000000000010',
   'Heizraum Musterweg', '3a000000-0000-4000-8000-000000000001');
end $$
$setup$);

-- Both sessions call as the server does.
select dblink_exec('material_plan_first', 'begin');
select dblink_exec('material_plan_first', 'set local role service_role');
create temporary table material_plan_first_line on commit drop as
select line_id from dblink('material_plan_first', $plan$
  select public.plan_job_material('3a000000-0000-4000-8000-000000000010',
    '3a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000050', null,
    '3a000000-0000-4000-8000-000000000020', 2, null, null, 'order_line',
    '3a000000-0000-4000-8000-000000000060')
$plan$) as plan(line_id uuid);

create temporary table material_plan_second_pid on commit drop as
select pid from dblink('material_plan_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_exec('material_plan_second', 'set role service_role');
select dblink_send_query('material_plan_second', $plan$
  select public.plan_job_material('3a000000-0000-4000-8000-000000000010',
    '3a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000050', null,
    '3a000000-0000-4000-8000-000000000020', 5, null, 'Zweiter Aufruf', 'order_line',
    '3a000000-0000-4000-8000-000000000060')
$plan$);

do $$
declare
  v_pid integer := (select pid from material_plan_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the second call never waited for the first call of the same source';
    end if;
  end loop;
end $$;

select dblink_exec('material_plan_first', 'commit');

do $$
declare
  v_first uuid := (select line_id from material_plan_first_line);
  v_second uuid;
  v_lines integer;
  v_planned numeric;
begin
  select line_id into v_second from dblink_get_result('material_plan_second', false) as result(line_id uuid);
  perform * from dblink_get_result('material_plan_second', false) as result(line_id uuid);
  if v_second is distinct from v_first then
    raise exception 'the waiting call must answer with the first line, got % instead of %', v_second, v_first;
  end if;
  select lines, planned into v_lines, v_planned from dblink('material_plan_setup', $read$
    select count(*)::integer, max(planned_quantity) from public.job_material_lines
    where organization_id = '3a000000-0000-4000-8000-000000000010'
  $read$) as line(lines integer, planned numeric);
  if v_lines <> 1 or v_planned <> 2 then
    raise exception 'two calls of one source must leave the first line alone, got % lines planning %', v_lines, v_planned;
  end if;
end $$;

select dblink_exec('material_plan_setup', statement) from material_plan_cleanup;
do $$
begin
  if exists (
    select 1 from dblink('material_plan_setup',
      'select 1 from public.job_material_lines where organization_id = ''3a000000-0000-4000-8000-000000000010''')
      as leftover(found integer)
  ) then
    raise exception 'the organization deletion left planned material';
  end if;
end $$;

select dblink_disconnect('material_plan_second');
select dblink_disconnect('material_plan_first');
select dblink_disconnect('material_plan_setup');
rollback;
