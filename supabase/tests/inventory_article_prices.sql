-- An article knows its suppliers and pack sizes, and every price has a date
-- and a source (werk-flow/werkflow-planning#373, migration
-- 20261203090000_keep_article_suppliers_and_dated_prices.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('48000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'article-price-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Sonnenberg"}', now(), now()),
('48000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'article-price-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Sonnenberg"}', now(), now()),
('48000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'article-price-employee@example.test', '', now(), '{}',
 '{"first_name":"Monteur","last_name":"Sonnenberg"}', now(), now()),
('48000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'article-price-outsider@example.test', '', now(), '{}',
 '{"first_name":"Fremd","last_name":"Nordrohr"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('48000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '48000000-0000-4000-8000-000000000001', 'ARTPRC01'),
('48000000-0000-4000-8000-000000000011', 'Fremde Haustechnik',
 '48000000-0000-4000-8000-000000000004', 'ARTPRC02');
insert into public.organization_members (organization_id, user_id, role) values
('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002', 'buero'),
('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000003', 'employee');

-- 20 pipe, 21 fitting, 22 archived valve, 29 another organization's article.
insert into public.inventory_items (id, organization_id, name, item_type, unit, is_active) values
('48000000-0000-4000-8000-000000000020', '48000000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm', 'material', 'meter', true),
('48000000-0000-4000-8000-000000000021', '48000000-0000-4000-8000-000000000010', 'Pressfitting 15 mm', 'material', 'piece', true),
('48000000-0000-4000-8000-000000000022', '48000000-0000-4000-8000-000000000010', 'Kugelhahn 1/2"', 'material', 'piece', false),
('48000000-0000-4000-8000-000000000029', '48000000-0000-4000-8000-000000000011', 'Fremdes Rohr', 'material', 'meter', true);
insert into public.inventory_suppliers (id, organization_id, name) values
('48000000-0000-4000-8000-000000000030', '48000000-0000-4000-8000-000000000010', 'Großhandel Nordrohr'),
('48000000-0000-4000-8000-000000000031', '48000000-0000-4000-8000-000000000010', 'Großhandel Südrohr'),
('48000000-0000-4000-8000-000000000039', '48000000-0000-4000-8000-000000000011', 'Fremder Großhandel');
insert into public.inventory_locations (id, organization_id, name, location_type) values
('48000000-0000-4000-8000-000000000040', '48000000-0000-4000-8000-000000000010', 'Hauptlager', 'storage');
insert into public.projects (id, organization_id, name, created_by) values
('48000000-0000-4000-8000-000000000041', '48000000-0000-4000-8000-000000000010',
 'Bad Musterstraße', '48000000-0000-4000-8000-000000000001');
insert into public.job_material_lines (id, organization_id, project_id, item_id, planned_quantity) values
('48000000-0000-4000-8000-000000000050', '48000000-0000-4000-8000-000000000010',
 '48000000-0000-4000-8000-000000000041', '48000000-0000-4000-8000-000000000020', 5);
insert into public.inventory_import_batches (id, organization_id, file_name, created_by) values
('48000000-0000-4000-8000-000000000060', '48000000-0000-4000-8000-000000000010', 'artikel.csv',
 '48000000-0000-4000-8000-000000000002');

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal and sqlstate is distinct from p_refusal then
      raise exception '% refused with % (%) instead of %', p_label, sqlerrm, sqlstate, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role, authenticated;

-- The new tables and functions are server-only: no client role holds a privilege,
-- the service role only reads the tables, and RLS is on.
do $$
declare
  v_role text;
  v_table text;
  v_privilege text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_table in array array['public.inventory_item_suppliers', 'public.inventory_item_prices'] loop
      foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(v_role, v_table, v_privilege) then
          raise exception '% holds % on %', v_role, v_privilege, v_table;
        end if;
      end loop;
    end loop;
    if has_function_privilege(v_role, 'public.inventory_item_prices_on_day(uuid,uuid[],date)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.add_inventory_item_price(uuid,uuid,uuid,text,integer,integer,date)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.save_inventory_item_supplier(uuid,uuid,uuid,uuid,uuid,text,text,text,numeric,numeric,boolean)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.remove_inventory_item_supplier(uuid,uuid,uuid)', 'EXECUTE') then
      raise exception '% can execute an article price or supplier function', v_role;
    end if;
  end loop;
  foreach v_table in array array['public.inventory_item_suppliers', 'public.inventory_item_prices'] loop
    foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('service_role', v_table, v_privilege) then
        raise exception 'service_role holds % on %; only the functions write', v_privilege, v_table;
      end if;
    end loop;
    if not (select relrowsecurity from pg_class where oid = v_table::regclass) then
      raise exception '% runs without RLS', v_table;
    end if;
  end loop;
  if has_function_privilege('service_role', 'app_private.record_inventory_item_price(uuid,uuid,uuid,text,integer,integer,date,text)', 'EXECUTE')
    or has_function_privilege('service_role', 'app_private.write_inventory_item_supplier(uuid,uuid,uuid,uuid,text,text,numeric,numeric,boolean)', 'EXECUTE') then
    raise exception 'an app_private step of the article writes is executable by service_role';
  end if;
end;
$$;

-- Prices of the pipe: purchase 4,00 € from 2020-01-01; 5,00 € and then 5,20 €
-- both from 2020-07-01 (the later recording corrects the first); 610,00 € per
-- 100 m from 2021-01-01; and a coming price 30 days from today. Sale: 12,34 €
-- per 100 m from 2021-01-01, then 15,00 € per 10 m from 2021-02-01.
set local role service_role;

create temp table prices_of_pipe on commit drop as
select
  public.add_inventory_item_price('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
    '48000000-0000-4000-8000-000000000020', 'purchase', 400, 1, '2020-01-01') as first_purchase,
  public.add_inventory_item_price('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
    '48000000-0000-4000-8000-000000000020', 'purchase', 500, 1, '2020-07-01') as typo_purchase;
select public.add_inventory_item_price('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
  '48000000-0000-4000-8000-000000000020', 'purchase', 520, 1, '2020-07-01');
select public.add_inventory_item_price('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000001',
  '48000000-0000-4000-8000-000000000020', 'purchase', 61000, 100, '2021-01-01');
select public.add_inventory_item_price('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
  '48000000-0000-4000-8000-000000000020', 'sale', 1234, 100, '2021-01-01');

-- A sale price that is no whole cent per meter leaves the previous release's column empty.
do $$
begin
  if (select sale_price_cents from public.inventory_items where id = '48000000-0000-4000-8000-000000000020') is not null then
    raise exception 'a price of a fraction of a cent per base unit must leave the per-unit column empty';
  end if;
end;
$$;

select public.add_inventory_item_price('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
  '48000000-0000-4000-8000-000000000020', 'sale', 1500, 10, '2021-02-01');
select public.add_inventory_item_price('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
  '48000000-0000-4000-8000-000000000020', 'purchase', 700, 1, (now() at time zone 'Europe/Berlin')::date + 30);

-- The current price is the latest row that has begun, per kind; among rows of
-- one first day the latest recorded.
do $$
declare
  v_today constant date := (now() at time zone 'Europe/Berlin')::date;
  v_case record;
  v_found record;
begin
  for v_case in
    select * from (values
      ('2019-12-31'::date, null::integer, null::integer, null::date, null::integer, null::integer),
      ('2020-01-01', 400, 1, '2020-01-01'::date, null, null),
      ('2020-06-30', 400, 1, '2020-01-01', null, null),
      ('2020-07-01', 520, 1, '2020-07-01', null, null),
      ('2020-12-31', 520, 1, '2020-07-01', null, null),
      ('2021-01-01', 61000, 100, '2021-01-01', 1234, 100),
      ('2021-02-01', 61000, 100, '2021-01-01', 1500, 10),
      (v_today, 61000, 100, '2021-01-01', 1500, 10),
      (v_today + 30, 700, 1, v_today + 30, 1500, 10)
    ) as cases (on_day, purchase, purchase_quantity, purchase_from, sale, sale_quantity)
  loop
    select * into v_found from public.inventory_item_prices_on_day(
      '48000000-0000-4000-8000-000000000010', array['48000000-0000-4000-8000-000000000020'::uuid], v_case.on_day
    );
    if v_found.purchase_amount_cents is distinct from v_case.purchase
      or v_found.purchase_price_quantity is distinct from v_case.purchase_quantity
      or v_found.purchase_valid_from is distinct from v_case.purchase_from
      or v_found.sale_amount_cents is distinct from v_case.sale
      or v_found.sale_price_quantity is distinct from v_case.sale_quantity then
      raise exception 'the price on % is %/% from % and %/%, not %/% from % and %/%', v_case.on_day,
        v_found.purchase_amount_cents, v_found.purchase_price_quantity, v_found.purchase_valid_from,
        v_found.sale_amount_cents, v_found.sale_price_quantity,
        v_case.purchase, v_case.purchase_quantity, v_case.purchase_from, v_case.sale, v_case.sale_quantity;
    end if;
    if v_case.purchase is not null and v_found.purchase_source is distinct from 'manual' then
      raise exception 'a price the office enters must carry the source manual';
    end if;
  end loop;

  -- The previous release's columns show today's price per one base unit; a coming price waits for its day.
  if (select purchase_price_cents from public.inventory_items where id = '48000000-0000-4000-8000-000000000020') is distinct from 610
    or (select sale_price_cents from public.inventory_items where id = '48000000-0000-4000-8000-000000000020') is distinct from 150 then
    raise exception 'the per-unit columns must show today''s price per one base unit';
  end if;
  if (select count(*) from public.inventory_item_prices where item_id = '48000000-0000-4000-8000-000000000020') <> 7 then
    raise exception 'a corrected price must stay as history beside its correction';
  end if;
  if (select created_by from public.inventory_item_prices where id = (select typo_purchase from prices_of_pipe))
    is distinct from '48000000-0000-4000-8000-000000000002' then
    raise exception 'a price must keep the person who recorded it';
  end if;
end;
$$;

-- An archived article answers; another organization's article and a foreign
-- organization's call find nothing.
do $$
declare
  v_ids uuid[] := array[
    '48000000-0000-4000-8000-000000000020', '48000000-0000-4000-8000-000000000022',
    '48000000-0000-4000-8000-000000000029'
  ]::uuid[];
begin
  if (select array_agg(item_id order by item_id) from public.inventory_item_prices_on_day(
        '48000000-0000-4000-8000-000000000010', v_ids, '2021-01-01'))
    is distinct from array['48000000-0000-4000-8000-000000000020', '48000000-0000-4000-8000-000000000022']::uuid[] then
    raise exception 'the price on a day must answer the organization''s articles, archived ones too, and no other';
  end if;
  if exists (select 1 from public.inventory_item_prices_on_day(
      '48000000-0000-4000-8000-000000000011', v_ids, '2021-01-01') where item_id <> '48000000-0000-4000-8000-000000000029') then
    raise exception 'another organization read this organization''s prices';
  end if;
end;
$$;

-- A price row is never updated or deleted, also not by the service role or the table owner.
select pg_temp.expect_refusal('a service-role price update',
  'update public.inventory_item_prices set amount_cents = 1 where item_id = ''48000000-0000-4000-8000-000000000020''',
  '42501');
reset role;
select pg_temp.expect_refusal('an owner''s price update',
  'update public.inventory_item_prices set amount_cents = 1 where item_id = ''48000000-0000-4000-8000-000000000020''',
  'inventory_ledger_append_only');
select pg_temp.expect_refusal('an owner''s price delete',
  'delete from public.inventory_item_prices where item_id = ''48000000-0000-4000-8000-000000000020''',
  'inventory_ledger_append_only');

-- An employee selects nothing from the new tables, not through the Data API either.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"48000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select pg_temp.expect_refusal('an employee''s price read',
  'select * from public.inventory_item_prices', '42501');
select pg_temp.expect_refusal('an employee''s supplier reference read',
  'select * from public.inventory_item_suppliers', '42501');
select pg_temp.expect_refusal('an employee''s price function call',
  'select * from public.inventory_item_prices_on_day(''48000000-0000-4000-8000-000000000010'', array[''48000000-0000-4000-8000-000000000020''::uuid], current_date)',
  '42501');
reset role;
set local role service_role;

-- The refusals of a price: role, foreign article, values.
select pg_temp.expect_refusal('an employee''s price',
  'select public.add_inventory_item_price(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000003'', ''48000000-0000-4000-8000-000000000020'', ''sale'', 100, 1, current_date)',
  'not_authorized');
select pg_temp.expect_refusal('a price for another organization''s article',
  'select public.add_inventory_item_price(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000029'', ''sale'', 100, 1, current_date)',
  'item_not_found');
select pg_temp.expect_refusal('a price per 25 units',
  'select public.add_inventory_item_price(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000020'', ''sale'', 100, 25, current_date)',
  'invalid_input');
select pg_temp.expect_refusal('a negative price',
  'select public.add_inventory_item_price(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000020'', ''purchase'', -1, 1, current_date)',
  'invalid_input');

-- A use of job material snapshots today's purchase price per its price quantity.
do $$
declare
  v_event public.job_material_use_events%rowtype;
begin
  perform public.record_inventory_movement('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
    '48000000-0000-4000-8000-000000000020', '48000000-0000-4000-8000-000000000040', 'initial_count', 10);
  perform public.record_inventory_movement('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
    '48000000-0000-4000-8000-000000000020', '48000000-0000-4000-8000-000000000040', 'job_take', -5,
    null, '48000000-0000-4000-8000-000000000041', '48000000-0000-4000-8000-000000000050');
  perform public.record_job_material_use('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
    '48000000-0000-4000-8000-000000000050', 2);
  select * into v_event from public.job_material_use_events where job_material_line_id = '48000000-0000-4000-8000-000000000050';
  if v_event.cost_amount_cents is distinct from 61000 or v_event.cost_price_quantity is distinct from 100 then
    raise exception 'a use must snapshot today''s purchase price per its price quantity, not %/%',
      v_event.cost_amount_cents, v_event.cost_price_quantity;
  end if;
end;
$$;

-- Supplier references: one preferred per article, mirrored on the article.
create temp table refs (name text primary key, id uuid) on commit drop;
grant all on refs to service_role;
insert into refs values ('nordrohr', public.save_inventory_item_supplier(
  '48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002', '48000000-0000-4000-8000-000000000020',
  null, '48000000-0000-4000-8000-000000000030', null, ' NR-4711 ', 'bundle', 1, 25, false));
insert into refs values ('suedrohr', public.save_inventory_item_supplier(
  '48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002', '48000000-0000-4000-8000-000000000020',
  null, '48000000-0000-4000-8000-000000000031', null, 'SR-0815', null, null, null, false));

do $$
declare
  v_item public.inventory_items;
  v_ref public.inventory_item_suppliers;
begin
  -- The first reference becomes preferred although the call did not ask for it; the second does not.
  select * into v_ref from public.inventory_item_suppliers where id = (select id from refs where name = 'nordrohr');
  if not v_ref.is_preferred or v_ref.supplier_article_number is distinct from 'NR-4711'
    or v_ref.purchase_unit is distinct from 'bundle' or v_ref.pack_quantity is distinct from 1
    or v_ref.base_quantity is distinct from 25 then
    raise exception 'the first reference must be preferred and keep its trimmed number and its pack';
  end if;
  if (select is_preferred from public.inventory_item_suppliers where id = (select id from refs where name = 'suedrohr')) then
    raise exception 'a second reference must not take the preferred mark unasked';
  end if;
  select * into v_item from public.inventory_items where id = '48000000-0000-4000-8000-000000000020';
  if v_item.supplier_id is distinct from '48000000-0000-4000-8000-000000000030'
    or v_item.supplier_article_number is distinct from 'NR-4711' then
    raise exception 'the article must mirror its preferred reference';
  end if;
end;
$$;

-- Preferring the second reference moves the mark; one preferred per article.
select public.save_inventory_item_supplier(
  '48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000001', '48000000-0000-4000-8000-000000000020',
  (select id from refs where name = 'suedrohr'), '48000000-0000-4000-8000-000000000031', null, 'SR-0815', 'roll', 2, 100, true);
do $$
begin
  if (select count(*) from public.inventory_item_suppliers
      where item_id = '48000000-0000-4000-8000-000000000020' and is_preferred) <> 1
    or not (select is_preferred from public.inventory_item_suppliers where id = (select id from refs where name = 'suedrohr')) then
    raise exception 'preferring a reference must take the mark from the other one';
  end if;
  if (select supplier_id from public.inventory_items where id = '48000000-0000-4000-8000-000000000020')
    is distinct from '48000000-0000-4000-8000-000000000031' then
    raise exception 'the article must mirror its new preferred reference';
  end if;
end;
$$;
reset role;
select pg_temp.expect_refusal('a second preferred reference written directly',
  'update public.inventory_item_suppliers set is_preferred = true where id = (select id from refs where name = ''nordrohr'')',
  '23505');
set local role service_role;

-- A conversion of zero or less is refused, and the other refusals of a reference.
select pg_temp.expect_refusal('a pack of 0 base units',
  'select public.save_inventory_item_supplier(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000021'', null, ''48000000-0000-4000-8000-000000000030'', null, null, ''box'', 1, 0, false)',
  'invalid_input');
select pg_temp.expect_refusal('a pack of -1 purchase units',
  'select public.save_inventory_item_supplier(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000021'', null, ''48000000-0000-4000-8000-000000000030'', null, null, ''box'', -1, 50, false)',
  'invalid_input');
select pg_temp.expect_refusal('the same supplier article number on a second article',
  'select public.save_inventory_item_supplier(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000021'', null, ''48000000-0000-4000-8000-000000000030'', null, ''NR-4711'', null, null, null, false)',
  'supplier_reference_taken');
select pg_temp.expect_refusal('an employee''s supplier reference',
  'select public.save_inventory_item_supplier(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000003'', ''48000000-0000-4000-8000-000000000021'', null, ''48000000-0000-4000-8000-000000000030'', null, null, null, null, null, false)',
  'not_authorized');
select pg_temp.expect_refusal('a reference on another organization''s article',
  'select public.save_inventory_item_supplier(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000029'', null, ''48000000-0000-4000-8000-000000000030'', null, null, null, null, null, false)',
  'item_not_found');
select pg_temp.expect_refusal('another organization''s supplier',
  'select public.save_inventory_item_supplier(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000021'', null, ''48000000-0000-4000-8000-000000000039'', null, null, null, null, null, false)',
  'supplier_not_found');
select pg_temp.expect_refusal('another article''s reference changed through this article',
  'select public.save_inventory_item_supplier(''48000000-0000-4000-8000-000000000010'', ''48000000-0000-4000-8000-000000000002'', ''48000000-0000-4000-8000-000000000021'', (select id from refs where name = ''nordrohr''), ''48000000-0000-4000-8000-000000000030'', null, null, null, null, null, false)',
  'supplier_reference_not_found');
select pg_temp.expect_refusal('a reference removed by another organization',
  'select public.remove_inventory_item_supplier(''48000000-0000-4000-8000-000000000011'', ''48000000-0000-4000-8000-000000000004'', (select id from refs where name = ''nordrohr''))',
  'supplier_reference_not_found');

-- Removing the preferred reference makes the oldest remaining one preferred;
-- removing the last empties the article's supplier columns.
select public.remove_inventory_item_supplier('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
  (select id from refs where name = 'suedrohr'));
do $$
begin
  if not (select is_preferred from public.inventory_item_suppliers where id = (select id from refs where name = 'nordrohr'))
    or (select supplier_id from public.inventory_items where id = '48000000-0000-4000-8000-000000000020')
      is distinct from '48000000-0000-4000-8000-000000000030' then
    raise exception 'removing the preferred reference must prefer the remaining one';
  end if;
end;
$$;
select public.remove_inventory_item_supplier('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000002',
  (select id from refs where name = 'nordrohr'));
do $$
begin
  if (select supplier_id from public.inventory_items where id = '48000000-0000-4000-8000-000000000020') is not null
    or (select supplier_article_number from public.inventory_items where id = '48000000-0000-4000-8000-000000000020') is not null then
    raise exception 'an article without references must carry no supplier';
  end if;
end;
$$;

-- save_inventory_item: a save without supplier and price keys leaves them; a
-- save in the previous release's shape makes its supplier preferred and
-- records a changed price from today; a cleared price changes nothing.
do $$
declare
  v_org constant uuid := '48000000-0000-4000-8000-000000000010';
  v_buero constant uuid := '48000000-0000-4000-8000-000000000002';
  v_fitting constant uuid := '48000000-0000-4000-8000-000000000021';
  v_base jsonb := jsonb_build_object('item_type', 'material', 'name', 'Pressfitting 15 mm', 'unit', 'piece',
    'is_billable', true, 'global_minimum_stock', 0, 'track_quantity', true, 'track_individual_assets', false);
  v_item public.inventory_items;
  v_new public.inventory_items;
begin
  perform public.save_inventory_item(v_org, v_buero, v_fitting,
    v_base || jsonb_build_object('supplier_id', '48000000-0000-4000-8000-000000000031', 'supplier_article_number', 'SR-15',
      'purchase_price_cents', 95, 'sale_price_cents', null), null, null, null, 0);
  select * into v_item from public.inventory_items where id = v_fitting;
  if v_item.supplier_id is distinct from '48000000-0000-4000-8000-000000000031' or v_item.supplier_article_number is distinct from 'SR-15'
    or v_item.purchase_price_cents is distinct from 95 or v_item.sale_price_cents is not null
    or not exists (select 1 from public.inventory_item_suppliers where item_id = v_fitting and is_preferred and supplier_article_number = 'SR-15') then
    raise exception 'a save with a supplier and a price must record the preferred reference and the price';
  end if;
  if (select source from public.inventory_item_prices where item_id = v_fitting) is distinct from 'manual'
    or (select valid_from from public.inventory_item_prices where item_id = v_fitting) is distinct from (now() at time zone 'Europe/Berlin')::date then
    raise exception 'a saved price must be a manual price from today';
  end if;

  -- The same values again, then a cleared price, then a save without the keys: nothing new.
  perform public.save_inventory_item(v_org, v_buero, v_fitting,
    v_base || jsonb_build_object('supplier_id', '48000000-0000-4000-8000-000000000031', 'supplier_article_number', 'SR-15',
      'purchase_price_cents', 95, 'sale_price_cents', null), null, null, null, 0);
  perform public.save_inventory_item(v_org, v_buero, v_fitting,
    v_base || jsonb_build_object('supplier_id', null, 'supplier_article_number', null,
      'purchase_price_cents', null, 'sale_price_cents', null), null, null, null, 0);
  perform public.save_inventory_item(v_org, v_buero, v_fitting, v_base || jsonb_build_object('name', 'Pressfitting 15 mm V'),
    null, null, null, 0);
  select * into v_item from public.inventory_items where id = v_fitting;
  if (select count(*) from public.inventory_item_prices where item_id = v_fitting) <> 1
    or (select count(*) from public.inventory_item_suppliers where item_id = v_fitting) <> 1
    or v_item.purchase_price_cents is distinct from 95 or v_item.supplier_id is distinct from '48000000-0000-4000-8000-000000000031'
    or v_item.name is distinct from 'Pressfitting 15 mm V' then
    raise exception 'a repeated, cleared or keyless save must keep the references and prices';
  end if;

  -- A new article with a supplier created by name and both prices.
  v_new := public.save_inventory_item(v_org, v_buero, null,
    v_base || jsonb_build_object('name', 'Thermostatkopf', 'supplier_id', null, 'supplier_article_number', 'TK-1',
      'purchase_price_cents', 1890, 'sale_price_cents', 2990), 'Großhandel Westrohr', null, null, 0);
  if v_new.purchase_price_cents is distinct from 1890 or v_new.sale_price_cents is distinct from 2990
    or v_new.supplier_id is null or v_new.supplier_article_number is distinct from 'TK-1'
    or (select count(*) from public.inventory_item_prices where item_id = v_new.id and source = 'manual' and created_by = v_buero) <> 2 then
    raise exception 'a new article must start with its supplier reference and its two prices';
  end if;
end;
$$;

-- A changed unit leaves the prices of the earlier unit as history: none of
-- them applies in the new unit. A unit change is refused while a supplier
-- sells the article in packs, whose conversion counts in the unit.
do $$
declare
  v_org constant uuid := '48000000-0000-4000-8000-000000000010';
  v_buero constant uuid := '48000000-0000-4000-8000-000000000002';
  v_fitting constant uuid := '48000000-0000-4000-8000-000000000021';
  v_base jsonb := jsonb_build_object('item_type', 'material', 'name', 'Pressfitting 15 mm V', 'unit', 'package',
    'is_billable', true, 'global_minimum_stock', 0, 'track_quantity', true, 'track_individual_assets', false);
  v_found record;
  v_refusal text;
begin
  perform public.save_inventory_item(v_org, v_buero, v_fitting, v_base, null, null, null, 0);
  select * into v_found from public.inventory_item_prices_on_day(v_org, array[v_fitting], (now() at time zone 'Europe/Berlin')::date);
  if v_found.unit is distinct from 'package' or v_found.purchase_amount_cents is not null
    or (select purchase_price_cents from public.inventory_items where id = v_fitting) is not null then
    raise exception 'a price stated per piece must not apply to the article counted in packages';
  end if;
  if (select unit from public.inventory_item_prices where item_id = v_fitting) is distinct from 'piece' then
    raise exception 'a recorded price must keep the unit it was stated in';
  end if;

  perform public.save_inventory_item_supplier(v_org, v_buero, v_fitting, null, '48000000-0000-4000-8000-000000000030',
    null, 'NR-PF15', 'box', 1, 20, false);
  begin
    perform public.save_inventory_item(v_org, v_buero, v_fitting, v_base || jsonb_build_object('unit', 'piece'),
      null, null, null, 0);
  exception when raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'unit_has_pack_sizes'
    or (select unit from public.inventory_items where id = v_fitting) is distinct from 'package' then
    raise exception 'a unit change with a pack conversion must be refused, not %', v_refusal;
  end if;
end;
$$;

-- An article with price history is archived, never deleted: the fitting has a
-- price and a reference, nothing else.
reset role;
select pg_temp.expect_refusal('deleting an article with price history',
  'delete from public.inventory_items where id = ''48000000-0000-4000-8000-000000000021''',
  '23503');
set local role service_role;

-- The CSV import records a new article's supplier and prices, source csv_import;
-- a matched article keeps its prices.
do $$
declare
  v_org constant uuid := '48000000-0000-4000-8000-000000000010';
  v_buero constant uuid := '48000000-0000-4000-8000-000000000002';
  v_item public.inventory_items;
begin
  perform public.import_inventory_row(v_org, v_buero, '48000000-0000-4000-8000-000000000060',
    jsonb_build_object('item_type', 'material', 'name', 'Heizkörperventil', 'unit', 'piece', 'internal_sku', 'HV-1',
      'supplier_article_number', 'NR-HV1', 'purchase_price_cents', 1250, 'sale_price_cents', 1990, 'is_billable', true,
      'global_minimum_stock', 0),
    null, 'Großhandel Nordrohr', null, null, 0, 'CSV-Import');
  select * into v_item from public.inventory_items where organization_id = v_org and internal_sku = 'HV-1';
  if v_item.supplier_id is distinct from '48000000-0000-4000-8000-000000000030' or v_item.supplier_article_number is distinct from 'NR-HV1'
    or v_item.purchase_price_cents is distinct from 1250 or v_item.sale_price_cents is distinct from 1990
    or (select count(*) from public.inventory_item_prices where item_id = v_item.id and source = 'csv_import' and created_by = v_buero) <> 2
    or not exists (select 1 from public.inventory_item_suppliers where item_id = v_item.id and is_preferred) then
    raise exception 'an imported article must start with its supplier reference and its CSV-import prices';
  end if;

  perform public.import_inventory_row(v_org, v_buero, '48000000-0000-4000-8000-000000000060',
    jsonb_build_object('item_type', 'material', 'name', 'Heizkörperventil', 'unit', 'piece', 'internal_sku', 'HV-1',
      'purchase_price_cents', 999, 'sale_price_cents', 999, 'is_billable', true, 'global_minimum_stock', 0),
    null, null, null, null, 0, 'CSV-Import');
  if (select count(*) from public.inventory_item_prices where item_id = v_item.id) <> 2
    or (select purchase_price_cents from public.inventory_items where id = v_item.id) is distinct from 1250 then
    raise exception 'a matched import row must keep the article''s prices';
  end if;
end;
$$;

-- A price recorded before its first day reaches the per-unit column on that
-- day through the hourly job: a row of today recorded yesterday.
reset role;
insert into public.inventory_item_prices (organization_id, item_id, kind, unit, amount_cents, price_quantity, valid_from, source, created_at)
values ('48000000-0000-4000-8000-000000000010', '48000000-0000-4000-8000-000000000022', 'sale', 'piece', 4900, 1,
  (now() at time zone 'Europe/Berlin')::date, 'manual', now() - interval '1 day');
do $$
begin
  if (select sale_price_cents from public.inventory_items where id = '48000000-0000-4000-8000-000000000022') is not null then
    raise exception 'fixture: the archived valve must start without a per-unit sale price';
  end if;
  perform app_private.sync_begun_inventory_item_prices();
  if (select sale_price_cents from public.inventory_items where id = '48000000-0000-4000-8000-000000000022') is distinct from 4900 then
    raise exception 'a price that began today must reach the per-unit column through the hourly job';
  end if;
  if not exists (select 1 from cron.job where jobname = 'werkflow-inventory-begun-prices') then
    raise exception 'the hourly job of begun prices is not scheduled';
  end if;
end;
$$;

-- Deleting the organization removes its price history and references (legitimate teardown).
delete from public.organizations where id = '48000000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.inventory_item_prices where organization_id = '48000000-0000-4000-8000-000000000010')
    or exists (select 1 from public.inventory_item_suppliers where organization_id = '48000000-0000-4000-8000-000000000010') then
    raise exception 'organization cascade left article prices or supplier references';
  end if;
end;
$$;

rollback;
