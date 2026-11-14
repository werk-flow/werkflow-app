-- A unit change that waits for a supplier's pack sees the committed pack
-- (werk-flow/werkflow-planning#373). One session adds a pack conversion under
-- the article's row lock; a second session changes the article's unit
-- meanwhile. The unit change waits for the lock and, once the pack commits,
-- is refused with unit_has_pack_sizes, so no pack is reread in another unit.
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
select dblink_connect('article_terms_setup', 'dbname=postgres user=postgres');
select dblink_connect('article_terms_supplier', 'dbname=postgres user=postgres');
select dblink_connect('article_terms_unit', 'dbname=postgres user=postgres');

create temporary table article_terms_cleanup (statement text) on commit drop;
insert into article_terms_cleanup values
  ('delete from public.organizations where id = ''49000000-0000-4000-8000-000000000010'''),
  ('delete from auth.users where id = ''49000000-0000-4000-8000-000000000001''');
select dblink_exec('article_terms_setup', statement) from article_terms_cleanup;

select dblink_exec('article_terms_setup', $setup$
do $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '49000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'article-terms-race@example.test', '', now(),
    '{}'::jsonb, '{"first_name":"Race","last_name":"Sonnenberg"}'::jsonb, now(), now()
  );
  insert into public.organizations (id, name, admin_id, unique_code) values
  ('49000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Race',
   '49000000-0000-4000-8000-000000000001', 'ARTRACE1');
  insert into public.inventory_items (id, organization_id, name, item_type, unit) values
  ('49000000-0000-4000-8000-000000000020', '49000000-0000-4000-8000-000000000010',
   'Mehrschichtverbundrohr 16 mm', 'material', 'meter');
  insert into public.inventory_suppliers (id, organization_id, name) values
  ('49000000-0000-4000-8000-000000000030', '49000000-0000-4000-8000-000000000010', 'Großhandel Nordrohr');
end $$
$setup$);

-- The supplier session adds „1 Rolle = 50 Meter“ and keeps the article's lock.
select dblink_exec('article_terms_supplier', 'begin');
select dblink_exec('article_terms_supplier', $pack$
do $$
begin
  perform public.save_inventory_item_supplier('49000000-0000-4000-8000-000000000010',
    '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000020', 'meter', null,
    '49000000-0000-4000-8000-000000000030', null, 'NR-MV16', 'roll', 1, 50, true);
end $$
$pack$);

-- The other session saves the article in pieces, as the form does.
create temporary table article_terms_unit_pid on commit drop as
select pid from dblink('article_terms_unit', 'select pg_backend_pid()') as unit_session(pid integer);
select dblink_send_query('article_terms_unit', $save$
select public.save_inventory_item('49000000-0000-4000-8000-000000000010',
  '49000000-0000-4000-8000-000000000001', '49000000-0000-4000-8000-000000000020',
  jsonb_build_object('item_type', 'material', 'name', 'Mehrschichtverbundrohr 16 mm', 'unit', 'piece',
    'is_billable', true, 'global_minimum_stock', 0, 'track_quantity', true, 'track_individual_assets', false),
  null, null, null, 0)
$save$);

do $$
declare
  v_pid integer := (select pid from article_terms_unit_pid);
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while cardinality(pg_blocking_pids(v_pid)) = 0 loop
    if clock_timestamp() > v_deadline then
      raise exception 'the unit change never waited for the article lock the pack holds';
    end if;
  end loop;
end $$;

select dblink_exec('article_terms_supplier', 'commit');

do $$
declare
  v_message text;
  v_unit text;
begin
  perform * from dblink_get_result('article_terms_unit', false) as result(status text);
  v_message := dblink_error_message('article_terms_unit');
  perform * from dblink_get_result('article_terms_unit', false) as result(status text);
  if position('unit_has_pack_sizes' in v_message) = 0 then
    raise exception 'a unit change that waited for a pack must be refused with unit_has_pack_sizes, got %', v_message;
  end if;
  select unit into v_unit from dblink('article_terms_setup', $read$
    select item.unit from public.inventory_items item where item.id = '49000000-0000-4000-8000-000000000020'
  $read$) as item(unit text);
  if v_unit is distinct from 'meter' then
    raise exception 'the article must keep the unit its pack counts in, got %', v_unit;
  end if;
end $$;

-- The organization deletion still removes everything it wrote.
select dblink_exec('article_terms_setup', statement) from article_terms_cleanup;
do $$
begin
  if exists (
    select 1 from dblink('article_terms_setup',
      'select 1 from public.inventory_item_suppliers where organization_id = ''49000000-0000-4000-8000-000000000010''')
      as leftover(found integer)
  ) then
    raise exception 'the organization deletion left supplier references';
  end if;
end $$;

select dblink_disconnect('article_terms_unit');
select dblink_disconnect('article_terms_supplier');
select dblink_disconnect('article_terms_setup');
rollback;
