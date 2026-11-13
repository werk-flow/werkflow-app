-- A cancellation that waits for a use sees the use's committed events
-- (werk-flow/werkflow-planning#370). One session records a use and its full
-- correction under the line's lock, so the line's used quantity is 0 again; a
-- second session cancels the line meanwhile. The cancel waits for the lock,
-- and once the use commits, the line guard sees its events and refuses.
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
select dblink_connect('material_use_setup', 'dbname=postgres user=postgres');
select dblink_connect('material_use_worker', 'dbname=postgres user=postgres');
select dblink_connect('material_use_office', 'dbname=postgres user=postgres');

create temporary table material_use_cleanup (statement text) on commit drop;
insert into material_use_cleanup values
  ('delete from public.organizations where id = ''38000000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id = ''38000000-0000-4000-8000-000000000001''');
select dblink_exec('material_use_setup', statement) from material_use_cleanup;

select dblink_exec('material_use_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '38000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'material-use-race@example.test', '', now(),
    '{}'::jsonb, '{"first_name":"Race","last_name":"Sonnenberg"}'::jsonb, now(), now()
  );
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('38000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Race',
   '38000000-0000-4000-8000-000000000001', 'MATRACE1');
  insert into public.inventory_items (id, organization_id, name, item_type, unit) values
  ('38000000-0000-4000-8000-000000000020', '38000000-0000-4000-8000-000000000010',
   'Kupferrohr 18 mm', 'material', 'meter');
  insert into public.inventory_locations (id, organization_id, name, location_type) values
  ('38000000-0000-4000-8000-000000000030', '38000000-0000-4000-8000-000000000010', 'Hauptlager', 'storage');
  insert into public.projects (id, organization_id, name, created_by) values
  ('38000000-0000-4000-8000-000000000040', '38000000-0000-4000-8000-000000000010',
   'Heizraum Musterweg', '38000000-0000-4000-8000-000000000001');
  insert into public.job_material_lines (id, organization_id, project_id, item_id, planned_quantity) values
  ('38000000-0000-4000-8000-000000000050', '38000000-0000-4000-8000-000000000010',
   '38000000-0000-4000-8000-000000000040', '38000000-0000-4000-8000-000000000020', 2);
  perform public.record_inventory_movement('38000000-0000-4000-8000-000000000010',
    '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000020',
    '38000000-0000-4000-8000-000000000030', 'initial_count', 5);
  perform public.record_inventory_movement('38000000-0000-4000-8000-000000000010',
    '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000020',
    '38000000-0000-4000-8000-000000000030', 'job_take', -2, null,
    '38000000-0000-4000-8000-000000000040', '38000000-0000-4000-8000-000000000050');
end $$
$setup$);

-- The worker's session records a use and its full correction and keeps the
-- line's lock: used_quantity is 0 again, nothing is committed yet.
select dblink_exec('material_use_worker', 'begin');
select dblink_exec('material_use_worker', $use$
do $$
declare
  v_event uuid;
begin
  perform public.record_job_material_use('38000000-0000-4000-8000-000000000010',
    '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000050', 1);
  select id into v_event from public.job_material_use_events
  where job_material_line_id = '38000000-0000-4000-8000-000000000050';
  perform public.record_job_material_use('38000000-0000-4000-8000-000000000010',
    '38000000-0000-4000-8000-000000000001', '38000000-0000-4000-8000-000000000050', -1,
    'Falsch erfasst', v_event);
end $$
$use$);

-- The office's session cancels the line, as deleteJobMaterialLine does after
-- its own check saw used_quantity 0 and no event.
create temporary table material_use_office_pid on commit drop as
select pid from dblink('material_use_office', 'select pg_backend_pid()') as office(pid integer);
select dblink_send_query('material_use_office',
  'update public.job_material_lines set status = ''cancelled'' where id = ''38000000-0000-4000-8000-000000000050'' and used_quantity = 0');

do $$
declare
  v_pid integer := (select pid from material_use_office_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the cancellation never waited for the line lock the use holds';
    end if;
  end loop;
end $$;

select dblink_exec('material_use_worker', 'commit');

do $$
declare
  v_message text;
  v_status text;
  v_events integer;
begin
  perform * from dblink_get_result('material_use_office', false) as result(status text);
  v_message := dblink_error_message('material_use_office');
  perform * from dblink_get_result('material_use_office', false) as result(status text);
  if position('material_use_recorded' in v_message) = 0 then
    raise exception 'a cancellation that waited for a use must be refused with material_use_recorded, got %', v_message;
  end if;
  select status, events into v_status, v_events from dblink('material_use_setup', $read$
    select line.status, (select count(*)::integer from public.job_material_use_events event
                         where event.job_material_line_id = line.id)
    from public.job_material_lines line where line.id = '38000000-0000-4000-8000-000000000050'
  $read$) as line(status text, events integer);
  if v_status = 'cancelled' or v_events is distinct from 2 then
    raise exception 'the line must stay with both its events, got status % and % events', v_status, v_events;
  end if;
end $$;

-- The organization deletion still removes everything it wrote.
select dblink_exec('material_use_setup', statement) from material_use_cleanup;
do $$
begin
  if exists (
    select 1 from dblink('material_use_setup',
      'select 1 from public.job_material_use_events where organization_id = ''38000000-0000-4000-8000-000000000010''')
      as leftover(found integer)
  ) then
    raise exception 'the organization deletion left material use events';
  end if;
end $$;

select dblink_disconnect('material_use_office');
select dblink_disconnect('material_use_worker');
select dblink_disconnect('material_use_setup');
rollback;
