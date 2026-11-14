-- Two calls that plan the same source at once yield one line
-- (werk-flow/werkflow-planning#376). The first session plans the source and
-- keeps its transaction open; the second session's call for the same source
-- waits for it, and once the first commits it answers with the first line.
--
-- A planning and a move of its job to another project end with the line on
-- the job's final project, whichever of the two locks the job first
-- (werk-flow/werkflow-planning#411).
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
  insert into public.projects (id, organization_id, name, created_by) values
  ('3a000000-0000-4000-8000-000000000040', '3a000000-0000-4000-8000-000000000010',
   'Bad Musterweg', '3a000000-0000-4000-8000-000000000001'),
  ('3a000000-0000-4000-8000-000000000041', '3a000000-0000-4000-8000-000000000010',
   'Heizung Lindenhof', '3a000000-0000-4000-8000-000000000001');
  insert into public.jobs (id, organization_id, title, project_id, created_by) values
  ('3a000000-0000-4000-8000-000000000050', '3a000000-0000-4000-8000-000000000010',
   'Heizraum Musterweg', '3a000000-0000-4000-8000-000000000040',
   '3a000000-0000-4000-8000-000000000001');
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

-- Waits until the second session's sent call waits on a lock.
create function pg_temp.await_blocked_second(p_failure text)
returns void
language plpgsql
as $$
declare
  v_pid integer := (select pid from material_plan_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception '%', p_failure;
    end if;
  end loop;
end;
$$;

-- The id the second session's sent call returned; its error fails the test.
create function pg_temp.second_result()
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from dblink_get_result('material_plan_second') as result(id uuid);
  perform * from dblink_get_result('material_plan_second') as result(id uuid);
  return v_id;
end;
$$;

-- Checks that the job, the line planned during the move and every other line
-- of the job carry the given project.
create function pg_temp.assert_job_material_on(p_project_id uuid, p_line_id uuid, p_failure text)
returns void
language plpgsql
as $$
declare
  v_lines integer;
  v_misplaced integer;
  v_planned integer;
  v_job_project uuid;
begin
  select lines, misplaced, planned, job_project into v_lines, v_misplaced, v_planned, v_job_project
  from dblink('material_plan_setup', format($read$
    select count(*)::integer,
      count(*) filter (where line.project_id is distinct from %L::uuid)::integer,
      count(*) filter (where line.id = %L::uuid)::integer,
      (select job.project_id from public.jobs job where job.id = '3a000000-0000-4000-8000-000000000050')
    from public.job_material_lines line
    where line.organization_id = '3a000000-0000-4000-8000-000000000010'
      and line.job_id = '3a000000-0000-4000-8000-000000000050'
  $read$, p_project_id, p_line_id)) as line(lines integer, misplaced integer, planned integer, job_project uuid);
  if v_job_project is distinct from p_project_id or v_misplaced is distinct from 0 or v_planned is distinct from 1 then
    raise exception '%: % of % lines elsewhere, planned line found % times, job on %',
      p_failure, v_misplaced, v_lines, v_planned, v_job_project;
  end if;
end;
$$;

select dblink_send_query('material_plan_second', $plan$
  select public.plan_job_material('3a000000-0000-4000-8000-000000000010',
    '3a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000050', null,
    '3a000000-0000-4000-8000-000000000020', 5, null, 'Zweiter Aufruf', 'order_line',
    '3a000000-0000-4000-8000-000000000060')
$plan$);

select pg_temp.await_blocked_second('the second call never waited for the first call of the same source');

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
  if v_lines is distinct from 1 or v_planned is distinct from 2 then
    raise exception 'two calls of one source must leave the first line alone, got % lines planning %', v_lines, v_planned;
  end if;
end $$;

-- The planning locks the job first: the move waits for it, then moves the
-- committed line along.
select dblink_exec('material_plan_first', 'begin');
select dblink_exec('material_plan_first', 'set local role service_role');
create temporary table material_move_planned_line on commit drop as
select line_id from dblink('material_plan_first', $plan$
  select public.plan_job_material('3a000000-0000-4000-8000-000000000010',
    '3a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000050', null,
    '3a000000-0000-4000-8000-000000000020', 3, null, 'Vor dem Umzug geplant', null, null)
$plan$) as plan(line_id uuid);
select dblink_send_query('material_plan_second', $move$
  select (public.update_job_with_assignments('3a000000-0000-4000-8000-000000000010',
    '3a000000-0000-4000-8000-000000000050', '3a000000-0000-4000-8000-000000000001',
    '{"project_id": "3a000000-0000-4000-8000-000000000041"}', false,
    null, null, null, null, null, null, null, null, null)).id
$move$);
select pg_temp.await_blocked_second('the move never waited for the planning that locked its job');
select dblink_exec('material_plan_first', 'commit');
select pg_temp.second_result();
select pg_temp.assert_job_material_on('3a000000-0000-4000-8000-000000000041',
  (select line_id from material_move_planned_line),
  'a line planned while its job moved must end on the job''s new project');

-- The move locks the job first: the planning waits for it, then reads the
-- job's new project.
select dblink_exec('material_plan_first', 'begin');
select dblink_exec('material_plan_first', 'set local role service_role');
select job_id from dblink('material_plan_first', $move$
  select (public.update_job_with_assignments('3a000000-0000-4000-8000-000000000010',
    '3a000000-0000-4000-8000-000000000050', '3a000000-0000-4000-8000-000000000001',
    '{"project_id": "3a000000-0000-4000-8000-000000000040"}', false,
    null, null, null, null, null, null, null, null, null)).id
$move$) as move(job_id uuid);
select dblink_send_query('material_plan_second', $plan$
  select public.plan_job_material('3a000000-0000-4000-8000-000000000010',
    '3a000000-0000-4000-8000-000000000001', '3a000000-0000-4000-8000-000000000050', null,
    '3a000000-0000-4000-8000-000000000020', 4, null, 'Während des Umzugs geplant', null, null)
$plan$);
select pg_temp.await_blocked_second('the planning never waited for the move that locked its job');
select dblink_exec('material_plan_first', 'commit');
select pg_temp.assert_job_material_on('3a000000-0000-4000-8000-000000000040',
  pg_temp.second_result(),
  'a line planned while its job moved must take the job''s final project');

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
