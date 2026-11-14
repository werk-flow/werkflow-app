-- A unit change that races a new job material line sees the committed line
-- (werk-flow/werkflow-planning#396). One session plans the article on a
-- project and has not committed yet; a second session changes the article's
-- unit with a direct update meanwhile. The update waits for the line and,
-- once it commits, is refused with unit_in_use, so no planned quantity is
-- relabeled in another unit.
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
select dblink_connect('unit_race_setup', 'dbname=postgres user=postgres');
select dblink_connect('unit_race_line', 'dbname=postgres user=postgres');
select dblink_connect('unit_race_unit', 'dbname=postgres user=postgres');

create temporary table unit_race_cleanup (statement text) on commit drop;
insert into unit_race_cleanup values
  ('delete from public.organizations where id = ''39700000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id = ''39700000-0000-4000-8000-000000000001''');
select dblink_exec('unit_race_setup', statement) from unit_race_cleanup;

select dblink_exec('unit_race_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '39700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'inventory-unit-race@example.test', '', now(),
    '{}'::jsonb, '{"first_name":"Race","last_name":"Sonnenberg"}'::jsonb, now(), now()
  );
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('39700000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Race',
   '39700000-0000-4000-8000-000000000001', 'UNITRACE');
  insert into public.inventory_items (id, organization_id, name, item_type, unit) values
  ('39700000-0000-4000-8000-000000000020', '39700000-0000-4000-8000-000000000010',
   'Kupferrohr 15 mm', 'material', 'meter');
  insert into public.projects (id, organization_id, name, created_by) values
  ('39700000-0000-4000-8000-000000000030', '39700000-0000-4000-8000-000000000010',
   'Bad Musterstraße', '39700000-0000-4000-8000-000000000001');
end $$
$setup$);

-- The line session plans 12 m of the pipe and keeps its transaction open.
select dblink_exec('unit_race_line', 'begin');
select dblink_exec('unit_race_line', $line$
insert into public.job_material_lines (organization_id, project_id, item_id, planned_quantity) values
('39700000-0000-4000-8000-000000000010', '39700000-0000-4000-8000-000000000030',
 '39700000-0000-4000-8000-000000000020', 12)
$line$);

-- The other session changes the unit with a direct update, past the save.
create temporary table unit_race_unit_pid on commit drop as
select pid from dblink('unit_race_unit', 'select pg_backend_pid()') as unit_session(pid integer);
select dblink_send_query('unit_race_unit', $update$
update public.inventory_items set unit = 'piece' where id = '39700000-0000-4000-8000-000000000020'
$update$);

do $$
declare
  v_pid integer := (select pid from unit_race_unit_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the unit change never waited for the material line another session is writing';
    end if;
  end loop;
end $$;

select dblink_exec('unit_race_line', 'commit');

do $$
declare
  v_message text;
  v_unit text;
begin
  perform * from dblink_get_result('unit_race_unit', false) as result(status text);
  v_message := dblink_error_message('unit_race_unit');
  perform * from dblink_get_result('unit_race_unit', false) as result(status text);
  if position('unit_in_use' in v_message) = 0 then
    raise exception 'a unit change that waited for a material line must be refused with unit_in_use, got %', v_message;
  end if;
  select unit into v_unit from dblink('unit_race_setup', $read$
    select item.unit from public.inventory_items item where item.id = '39700000-0000-4000-8000-000000000020'
  $read$) as item(unit text);
  if v_unit is distinct from 'meter' then
    raise exception 'the article must keep the unit its material line counts in, got %', v_unit;
  end if;
end $$;

select dblink_exec('unit_race_setup', statement) from unit_race_cleanup;

select dblink_disconnect('unit_race_unit');
select dblink_disconnect('unit_race_line');
select dblink_disconnect('unit_race_setup');
rollback;
