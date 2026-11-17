-- Two opens of a wholesaler import by one person run one after the other
-- (werk-flow/werkflow-planning#375). One session opens an import and keeps its
-- transaction; a second session opens another for the same person meanwhile.
-- The second waits, and once the first commits it abandons the first batch, so
-- the person keeps one open batch.
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
select dblink_connect('catalog_setup', 'dbname=postgres user=postgres');
select dblink_connect('catalog_first', 'dbname=postgres user=postgres');
select dblink_connect('catalog_second', 'dbname=postgres user=postgres');

create temporary table catalog_cleanup (statement text) on commit drop;
insert into catalog_cleanup values
  ('delete from public.organizations where id = ''39000000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id = ''39000000-0000-4000-8000-000000000001''');
select dblink_exec('catalog_setup', statement) from catalog_cleanup;

select dblink_exec('catalog_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '39000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'catalog-race@example.test', '', now(),
    '{}'::jsonb, '{"first_name":"Race","last_name":"Sonnenberg"}'::jsonb, now(), now()
  );
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('39000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Katalog',
   '39000000-0000-4000-8000-000000000001', 'CATRACE1');
  insert into public.inventory_suppliers (id, organization_id, name) values
  ('39000000-0000-4000-8000-000000000020', '39000000-0000-4000-8000-000000000010', 'Großhandel Nordrohr');
end $$
$setup$);

-- The first session opens an import and keeps its transaction open.
select dblink_exec('catalog_first', 'begin');
select dblink_exec('catalog_first', $open$
do $$
begin
  perform public.open_supplier_catalog_import('39000000-0000-4000-8000-000000000010',
    '39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000020',
    array['lieferung-a'], repeat('a', 64), null, '[]'::jsonb, '[]'::jsonb);
end $$
$open$);

-- The second session opens another import for the same person meanwhile.
create temporary table catalog_second_pid on commit drop as
select pid from dblink('catalog_second', 'select pg_backend_pid()') as second(pid integer);
select dblink_send_query('catalog_second', $open$
select public.open_supplier_catalog_import('39000000-0000-4000-8000-000000000010',
  '39000000-0000-4000-8000-000000000001', '39000000-0000-4000-8000-000000000020',
  array['lieferung-b'], repeat('b', 64), null, '[]'::jsonb, '[]'::jsonb)
$open$);

do $$
declare
  v_pid integer := (select pid from catalog_second_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'a second open by the same person never waited for the first';
    end if;
  end loop;
end $$;

select dblink_exec('catalog_first', 'commit');

do $$
declare
  v_message text;
  v_open integer;
  v_open_file text;
begin
  perform * from dblink_get_result('catalog_second', false) as result(import_id uuid);
  v_message := dblink_error_message('catalog_second');
  perform * from dblink_get_result('catalog_second', false) as result(import_id uuid);
  if v_message is distinct from 'OK' then
    raise exception 'the second open must succeed once the first committed, got %', v_message;
  end if;
  select open_count, open_file into v_open, v_open_file from dblink('catalog_setup', $read$
    select count(*)::integer, max(batch.file_names[1])
    from public.inventory_supplier_catalog_imports batch
    where batch.organization_id = '39000000-0000-4000-8000-000000000010'
      and batch.created_by = '39000000-0000-4000-8000-000000000001'
      and batch.status in ('staging', 'previewed')
  $read$) as batches(open_count integer, open_file text);
  if v_open is distinct from 1 or v_open_file is distinct from 'lieferung-b' then
    raise exception 'one person must keep exactly the latest open batch, got % open, latest %', v_open, v_open_file;
  end if;
end $$;

select dblink_exec('catalog_setup', statement) from catalog_cleanup;
select dblink_disconnect('catalog_second');
select dblink_disconnect('catalog_first');
select dblink_disconnect('catalog_setup');
rollback;
