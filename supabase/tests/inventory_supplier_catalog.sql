-- The office imports a wholesaler delivery into a supplier catalog with a
-- preview, and a catalog article becomes an own article on first use
-- (werk-flow/werkflow-planning#375, migration
-- 20261205090000_keep_a_supplier_catalog_beside_the_own_articles.sql).
-- Made-up organizations, wholesalers and articles only.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('37500000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'catalog-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Sonnenberg"}', now(), now()),
('37500000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'catalog-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Sonnenberg"}', now(), now()),
('37500000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'catalog-employee@example.test', '', now(), '{}',
 '{"first_name":"Monteur","last_name":"Sonnenberg"}', now(), now()),
('37500000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'catalog-outsider@example.test', '', now(), '{}',
 '{"first_name":"Fremd","last_name":"Südrohr"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('37500000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '37500000-0000-4000-8000-000000000001', 'CATLOG01'),
('37500000-0000-4000-8000-000000000011', 'Fremde Haustechnik',
 '37500000-0000-4000-8000-000000000004', 'CATLOG02');
insert into public.organization_members (organization_id, user_id, role) values
('37500000-0000-4000-8000-000000000010', '37500000-0000-4000-8000-000000000002', 'buero'),
('37500000-0000-4000-8000-000000000010', '37500000-0000-4000-8000-000000000003', 'employee');

-- 30 Nordrohr, 31 Westrohr (both ours), 39 another organization's wholesaler.
insert into public.inventory_suppliers (id, organization_id, name) values
('37500000-0000-4000-8000-000000000030', '37500000-0000-4000-8000-000000000010', 'Großhandel Nordrohr'),
('37500000-0000-4000-8000-000000000031', '37500000-0000-4000-8000-000000000010', 'Großhandel Westrohr'),
('37500000-0000-4000-8000-000000000039', '37500000-0000-4000-8000-000000000011', 'Fremder Großhandel');
-- An own article Nordrohr already sells as NR-1501, with a price of its own.
insert into public.inventory_items (id, organization_id, name, item_type, unit) values
('37500000-0000-4000-8000-000000000020', '37500000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm (eigen)', 'material', 'meter');
select public.save_inventory_item_supplier('37500000-0000-4000-8000-000000000010',
  '37500000-0000-4000-8000-000000000002', '37500000-0000-4000-8000-000000000020', 'meter', null,
  '37500000-0000-4000-8000-000000000030', null, 'NR-1501', null, 1, 1, true);
select public.add_inventory_item_price('37500000-0000-4000-8000-000000000010',
  '37500000-0000-4000-8000-000000000002', '37500000-0000-4000-8000-000000000020', 'meter', 'purchase',
  400, 1, '2026-01-01');

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

-- One staged line as the server sends it.
create function pg_temp.article(
  p_ordinal integer, p_number text, p_name text, p_unit text, p_kind text, p_cents integer, p_quantity integer
) returns jsonb language sql as $$
  select jsonb_build_object(
    'ordinal', p_ordinal, 'kind', 'article', 'file_name', 'lieferung-nordrohr', 'line_number', p_ordinal + 1,
    'article_number', p_number, 'name', p_name, 'name_addition', '', 'unit_text', p_unit,
    'price_quantity', p_quantity, 'price_kind', p_kind, 'price_cents', p_cents,
    'rebate_group', 'CU1', 'ean', null
  );
$$;
grant execute on function pg_temp.article(integer, text, text, text, text, integer, integer) to service_role;

-- The tables and functions are server-only: no client role holds a privilege,
-- the service role only reads the tables, and RLS is on.
do $$
declare
  v_role text;
  v_table text;
  v_privilege text;
  v_function text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_table in array array[
      'public.inventory_supplier_catalog_imports', 'public.inventory_supplier_catalog_import_lines',
      'public.inventory_supplier_catalog_articles', 'public.inventory_supplier_rebate_groups'
    ] loop
      foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(v_role, v_table, v_privilege) then
          raise exception '% holds % on %', v_role, v_privilege, v_table;
        end if;
      end loop;
    end loop;
    foreach v_function in array array[
      'public.open_supplier_catalog_import(uuid,uuid,uuid,text[],text,jsonb,jsonb,jsonb)',
      'public.stage_supplier_catalog_import_lines(uuid,uuid,uuid,jsonb)',
      'public.preview_supplier_catalog_import(uuid,uuid,uuid)',
      'public.confirm_supplier_catalog_import(uuid,uuid,uuid,jsonb)',
      'public.abandon_supplier_catalog_import(uuid,uuid,uuid)',
      'public.adopt_supplier_catalog_article(uuid,uuid,uuid)',
      'public.search_supplier_catalog_articles(uuid,text,integer)'
    ] loop
      if has_function_privilege(v_role, v_function, 'EXECUTE') then
        raise exception '% can execute %', v_role, v_function;
      end if;
    end loop;
  end loop;
  foreach v_table in array array[
    'public.inventory_supplier_catalog_imports', 'public.inventory_supplier_catalog_import_lines',
    'public.inventory_supplier_catalog_articles', 'public.inventory_supplier_rebate_groups'
  ] loop
    foreach v_privilege in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege('service_role', v_table, v_privilege) then
        raise exception 'service_role holds % on %; only the functions write', v_privilege, v_table;
      end if;
    end loop;
    if not (select relrowsecurity from pg_class where oid = v_table::regclass) then
      raise exception '% runs without RLS', v_table;
    end if;
  end loop;
  if has_function_privilege('service_role', 'app_private.lock_open_supplier_catalog_import(uuid,uuid,uuid,text[])', 'EXECUTE')
    or has_function_privilege('service_role', 'app_private.supplier_catalog_import_effects(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('service_role', 'app_private.supplier_catalog_import_other_effects(uuid,uuid)', 'EXECUTE') then
    raise exception 'an app_private step of the catalog import is executable by service_role';
  end if;
end;
$$;

set local role service_role;

create temp table catalog_test_state (key text primary key, value uuid) on commit drop;
grant all on table catalog_test_state to service_role;

-- An employee never opens an import, and a manager never imports for another
-- organization's wholesaler.
select pg_temp.expect_refusal('an employee opens an import',
  $$select public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000003', '37500000-0000-4000-8000-000000000030', array['lieferung'],
    repeat('a', 64), null, '[]', '[]')$$, 'not_authorized');
select pg_temp.expect_refusal('a manager names another organization''s wholesaler',
  $$select public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', '37500000-0000-4000-8000-000000000039', array['lieferung'],
    repeat('a', 64), null, '[]', '[]')$$, 'supplier_not_found');
select pg_temp.expect_refusal('a manager of another organization opens an import here',
  $$select public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000004', '37500000-0000-4000-8000-000000000030', array['lieferung'],
    repeat('a', 64), null, '[]', '[]')$$, 'not_authorized');

-- The first delivery: a pipe twice (the later line wins), a fitting, a valve
-- whose unit text the office leaves unmapped, and a line the reader refused.
insert into catalog_test_state values ('first', public.open_supplier_catalog_import(
  '37500000-0000-4000-8000-000000000010', '37500000-0000-4000-8000-000000000002',
  '37500000-0000-4000-8000-000000000030', array['lieferung-nordrohr'], repeat('a', 64),
  '{"format_version":"4","supplier_text":"Großhandel Nordrohr","date":"2037-11-02","currency":"EUR"}',
  '[{"rebate_group":"CU1","text":"Kupfer","discount":{"kind":"percent","hundredthsOfPercent":3000}}]', '[]'));
do $$
declare
  v_import uuid := (select value from catalog_test_state where key = 'first');
  v_staged integer;
  v_preview jsonb;
begin
  v_staged := public.stage_supplier_catalog_import_lines('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import, jsonb_build_array(
      pg_temp.article(0, 'NR-1501', 'Kupferrohr 15 mm alt', 'Meter', 'list', 60000, 100),
      pg_temp.article(1, 'NR-1502', 'Pressfitting 15 mm', 'Stück', 'net', 389, 1),
      pg_temp.article(2, 'NR-1503', 'Kugelhahn 1/2"', 'XYZ', 'list', 1250, 1),
      pg_temp.article(3, 'NR-1501', 'Kupferrohr 15 mm', 'Meter', 'list', 61000, 100),
      jsonb_build_object('ordinal', 4, 'kind', 'rejection', 'file_name', 'lieferung-nordrohr',
        'line_number', 9, 'reason_code', 'line_incomplete', 'reason', 'Der Zeile fehlen Angaben.')
    ));
  if v_staged is distinct from 5 then
    raise exception 'staging answered % lines, not 5', v_staged;
  end if;

  -- Another person of the organization stages nothing on this batch.
  perform pg_temp.expect_refusal('the admin stages on Büro''s batch',
    format($f$select public.stage_supplier_catalog_import_lines('37500000-0000-4000-8000-000000000010',
      '37500000-0000-4000-8000-000000000001', %L, '[]')$f$, v_import), 'import_not_found');

  v_preview := public.preview_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import);
  if v_preview->'units' is distinct from '[
    {"unit_text":"Meter","articles":1,"new":1,"changed":0,"unchanged":0,"unchanged_by_unit":{},"price_changed":0},
    {"unit_text":"Stück","articles":1,"new":1,"changed":0,"unchanged":0,"unchanged_by_unit":{},"price_changed":0},
    {"unit_text":"XYZ","articles":1,"new":1,"changed":0,"unchanged":0,"unchanged_by_unit":{},"price_changed":0}
  ]'::jsonb or (v_preview->>'rejected')::integer is distinct from 1
    or v_preview->'repeat' is distinct from 'null'::jsonb then
    raise exception 'the first preview answered %', v_preview;
  end if;
  -- A preview writes nothing to the catalog.
  if exists (select 1 from public.inventory_supplier_catalog_articles where organization_id = '37500000-0000-4000-8000-000000000010') then
    raise exception 'the preview wrote catalog rows';
  end if;
  -- A staged batch takes no more lines.
  perform pg_temp.expect_refusal('staging after the preview',
    format($f$select public.stage_supplier_catalog_import_lines('37500000-0000-4000-8000-000000000010',
      '37500000-0000-4000-8000-000000000002', %L, '[]')$f$, v_import), 'import_not_found');
end;
$$;

-- The confirm writes the mapped articles once, rejects the unmapped one, and
-- changes no own article and no price of one.
create temp table own_before on commit drop as
select (select count(*) from public.inventory_items where organization_id = '37500000-0000-4000-8000-000000000010') as items,
  (select count(*) from public.inventory_item_prices where organization_id = '37500000-0000-4000-8000-000000000010') as prices,
  (select count(*) from public.inventory_item_suppliers where organization_id = '37500000-0000-4000-8000-000000000010') as refs;
grant all on table own_before to service_role;
do $$
declare
  v_import uuid := (select value from catalog_test_state where key = 'first');
  v_result jsonb;
  v_repeat jsonb;
  v_stamp timestamptz;
begin
  perform pg_temp.expect_refusal('an unknown unit code in the mapping',
    format($f$select public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
      '37500000-0000-4000-8000-000000000002', %L, '{"Meter":"Meter!"}')$f$, v_import), 'invalid_input');
  perform pg_temp.expect_refusal('another organization confirms the batch',
    format($f$select public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000011',
      '37500000-0000-4000-8000-000000000004', %L, '{}')$f$, v_import), 'import_not_found');

  v_result := public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import, '{"Meter":"meter","Stück":"piece","XYZ":null}');
  if v_result is distinct from '{"new":2,"changed":0,"unchanged":0,"price_changed":0,"unit_rejected":1,
    "price_updates":0,"price_unmatched":0,"removed":0,"rejected":1,"already_confirmed":false}'::jsonb then
    raise exception 'the confirm answered %', v_result;
  end if;
  if (select array_agg(row(article_number, name, unit, price_kind, price_cents, price_quantity)::text
        order by article_number)
      from public.inventory_supplier_catalog_articles where organization_id = '37500000-0000-4000-8000-000000000010')
    is distinct from array[
      '(NR-1501,"Kupferrohr 15 mm",meter,list,61000,100)', '(NR-1502,"Pressfitting 15 mm",piece,net,389,1)'
    ] then
    raise exception 'the catalog holds %', (select jsonb_agg(c) from public.inventory_supplier_catalog_articles c);
  end if;
  if (select discount from public.inventory_supplier_rebate_groups where rebate_group = 'CU1')
    is distinct from '{"kind":"percent","hundredthsOfPercent":3000}'::jsonb then
    raise exception 'the rebate group was not kept as data';
  end if;
  -- The batch keeps only the lines its report names.
  if (select array_agg(kind || ':' || coalesce(article_number, '-') order by ordinal)
      from public.inventory_supplier_catalog_import_lines where import_id = v_import)
    is distinct from array['article:NR-1503', 'rejection:-'] then
    raise exception 'the confirmed batch kept the wrong lines';
  end if;
  if (select row(items, prices, refs) from own_before) is distinct from row(
    (select count(*) from public.inventory_items where organization_id = '37500000-0000-4000-8000-000000000010'),
    (select count(*) from public.inventory_item_prices where organization_id = '37500000-0000-4000-8000-000000000010'),
    (select count(*) from public.inventory_item_suppliers where organization_id = '37500000-0000-4000-8000-000000000010')
  ) then
    raise exception 'the confirm changed an own article, a price or a supplier reference';
  end if;

  -- A second confirm answers the first result and writes nothing.
  select max(updated_at) into v_stamp from public.inventory_supplier_catalog_articles
  where organization_id = '37500000-0000-4000-8000-000000000010';
  v_repeat := public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import, '{"Meter":"meter","Stück":"piece","XYZ":"piece"}');
  if v_repeat is distinct from (v_result - 'already_confirmed') || '{"already_confirmed":true}'::jsonb
    or (select count(*) from public.inventory_supplier_catalog_articles where organization_id = '37500000-0000-4000-8000-000000000010')
      is distinct from 2::bigint
    or (select max(updated_at) from public.inventory_supplier_catalog_articles where organization_id = '37500000-0000-4000-8000-000000000010')
      is distinct from v_stamp then
    raise exception 'a repeated confirm answered % or wrote again', v_repeat;
  end if;
end;
$$;

-- A second delivery: the pipe's price changes, a price change for an article
-- the catalog lacks, and a deletion of the fitting. The same delivery again
-- names the earlier confirm.
do $$
declare
  v_import uuid;
  v_preview jsonb;
  v_result jsonb;
begin
  v_import := public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', '37500000-0000-4000-8000-000000000030', array['preise'],
    repeat('b', 64), null, '[]', '[]');
  perform public.stage_supplier_catalog_import_lines('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import, jsonb_build_array(
      pg_temp.article(0, 'NR-1501', 'Kupferrohr 15 mm', 'Meter', 'list', 62000, 100),
      jsonb_build_object('ordinal', 1, 'kind', 'price', 'file_name', 'preise', 'line_number', 2,
        'article_number', 'NR-9999', 'price_kind', 'net', 'price_cents', 100),
      jsonb_build_object('ordinal', 2, 'kind', 'deletion', 'file_name', 'preise', 'line_number', 3,
        'article_number', 'NR-1502')
    ));
  v_preview := public.preview_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import);
  if v_preview - 'repeat' is distinct from '{"units":[{"unit_text":"Meter","articles":1,"new":0,"changed":1,
    "unchanged":0,"unchanged_by_unit":{},"price_changed":1}],"price_updates":0,"price_unmatched":1,"removed":1,"rejected":0}'::jsonb then
    raise exception 'the second preview answered %', v_preview;
  end if;
  v_result := public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import, '{"Meter":"meter"}');
  if (v_result->>'changed')::integer is distinct from 1 or (v_result->>'removed')::integer is distinct from 1
    or (select price_cents from public.inventory_supplier_catalog_articles
      where organization_id = '37500000-0000-4000-8000-000000000010' and article_number = 'NR-1501') is distinct from 62000
    or exists (select 1 from public.inventory_supplier_catalog_articles
      where organization_id = '37500000-0000-4000-8000-000000000010' and article_number = 'NR-1502') then
    raise exception 'the second confirm answered % and left the catalog wrong', v_result;
  end if;

  -- The first delivery again: its preview names the earlier confirm by Büro.
  v_import := public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', '37500000-0000-4000-8000-000000000030', array['lieferung-nordrohr'],
    repeat('a', 64), null, '[]', '[]');
  perform public.stage_supplier_catalog_import_lines('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import, jsonb_build_array(
      pg_temp.article(0, 'NR-1501', 'Kupferrohr 15 mm', 'Meter', 'list', 62000, 100)));
  v_preview := public.preview_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_import);
  if v_preview->'repeat'->>'confirmed_by' is distinct from '37500000-0000-4000-8000-000000000002'
    or v_preview->'units'->0->'unchanged_by_unit' is distinct from '{"meter":1}'::jsonb then
    raise exception 'the repeated delivery answered %', v_preview;
  end if;
  insert into catalog_test_state values ('open', v_import);
end;
$$;

-- Opening another import abandons the same person's open one and drops its
-- lines; abandoning a confirmed batch changes nothing.
do $$
declare
  v_open uuid := (select value from catalog_test_state where key = 'open');
  v_next uuid;
begin
  v_next := public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', '37500000-0000-4000-8000-000000000031', array['westrohr'],
    repeat('c', 64), null, '[]', '[]');
  if (select status from public.inventory_supplier_catalog_imports where id = v_open) is distinct from 'abandoned'
    or exists (select 1 from public.inventory_supplier_catalog_import_lines where import_id = v_open) then
    raise exception 'a new import left the earlier open one';
  end if;
  perform pg_temp.expect_refusal('confirming an abandoned batch',
    format($f$select public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
      '37500000-0000-4000-8000-000000000002', %L, '{}')$f$, v_open), 'import_not_found');
  perform public.abandon_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_next);
  perform public.abandon_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', (select value from catalog_test_state where key = 'first'));
  if (select status from public.inventory_supplier_catalog_imports where id = v_next) is distinct from 'abandoned'
    or (select status from public.inventory_supplier_catalog_imports
      where id = (select value from catalog_test_state where key = 'first')) is distinct from 'confirmed' then
    raise exception 'abandon changed the wrong batch';
  end if;
end;
$$;

-- Adopt on first use: the catalog pipe becomes an own article with its
-- supplier reference and its list price as sale price from today, once.
-- Nordrohr's NR-1501 is already an own article, so the pipe from Westrohr is
-- adopted as a new one and Nordrohr's row answers the existing article.
do $$
declare
  v_westrohr_import uuid;
  v_catalog_id uuid;
  v_first jsonb;
  v_second jsonb;
  v_item public.inventory_items;
begin
  v_westrohr_import := public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', '37500000-0000-4000-8000-000000000031', array['westrohr'],
    repeat('d', 64), null, '[]', '[]');
  perform public.stage_supplier_catalog_import_lines('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', v_westrohr_import, jsonb_build_array(
      pg_temp.article(0, 'WR-15', 'Kupferrohr 15 mm', 'm', 'list', 61500, 100)
        || '{"name_addition":"hart","ean":"4000000000024"}',
      pg_temp.article(1, 'WR-16', 'Kupferrohr 16 mm', 'm', 'net', 4200, 1)
        || '{"ean":"4000000000024"}'));
  perform public.preview_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', v_westrohr_import);
  perform public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', v_westrohr_import, '{"m":"meter"}');
  select id into v_catalog_id from public.inventory_supplier_catalog_articles where article_number = 'WR-15';

  perform pg_temp.expect_refusal('an employee adopts a catalog article',
    format($f$select public.adopt_supplier_catalog_article('37500000-0000-4000-8000-000000000010',
      '37500000-0000-4000-8000-000000000003', %L)$f$, v_catalog_id), 'not_authorized');
  perform pg_temp.expect_refusal('another organization adopts the catalog article',
    format($f$select public.adopt_supplier_catalog_article('37500000-0000-4000-8000-000000000011',
      '37500000-0000-4000-8000-000000000004', %L)$f$, v_catalog_id), 'catalog_article_not_found');

  v_first := public.adopt_supplier_catalog_article('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002', v_catalog_id);
  v_second := public.adopt_supplier_catalog_article('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', v_catalog_id);
  if (v_first->>'created')::boolean is not true or (v_second->>'created')::boolean is not false
    or v_first->'item_id' is distinct from v_second->'item_id' then
    raise exception 'adopting twice answered % and %', v_first, v_second;
  end if;
  select item.* into v_item from public.inventory_items item where item.id = (v_first->>'item_id')::uuid;
  if row(v_item.name, v_item.unit, v_item.item_type, v_item.supplier_id, v_item.supplier_article_number)
    is distinct from row('Kupferrohr 15 mm hart', 'meter', 'material',
      '37500000-0000-4000-8000-000000000031'::uuid, 'WR-15') then
    raise exception 'the adopted article is %', row_to_json(v_item);
  end if;
  if (select array_agg(row(kind, amount_cents, price_quantity, source, valid_from)::text)
      from public.inventory_item_prices where item_id = v_item.id)
    is distinct from array[format('(sale,61500,100,datanorm,%s)', (now() at time zone 'Europe/Berlin')::date)] then
    raise exception 'the adopted article''s prices are wrong';
  end if;
  if not exists (
    select 1 from public.inventory_item_barcodes
    where item_id = v_item.id and barcode_value = '4000000000024' and is_primary
  ) or not exists (
    select 1 from public.inventory_item_suppliers
    where item_id = v_item.id and supplier_article_number = 'WR-15' and is_preferred
  ) then
    raise exception 'the adopted article lacks its barcode or preferred supplier reference';
  end if;

  -- Nordrohr's NR-1501 answers the own article that already carries the number.
  v_first := public.adopt_supplier_catalog_article('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002',
    (select id from public.inventory_supplier_catalog_articles where article_number = 'NR-1501'));
  if v_first is distinct from '{"item_id":"37500000-0000-4000-8000-000000000020","created":false}'::jsonb
    or (select count(*) from public.inventory_item_prices where item_id = '37500000-0000-4000-8000-000000000020') <> 1 then
    raise exception 'adopting a number an own article carries answered %', v_first;
  end if;

  -- An EAN another article carries stays with it: the new article gets no barcode, and its net price
  -- becomes the purchase price.
  v_first := public.adopt_supplier_catalog_article('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000002',
    (select id from public.inventory_supplier_catalog_articles
      where organization_id = '37500000-0000-4000-8000-000000000010' and article_number = 'WR-16'));
  if (v_first->>'created')::boolean is not true
    or exists (select 1 from public.inventory_item_barcodes where item_id = (v_first->>'item_id')::uuid)
    or (select array_agg(kind || ':' || amount_cents) from public.inventory_item_prices
      where item_id = (v_first->>'item_id')::uuid) is distinct from array['purchase:4200'] then
    raise exception 'adopting a row whose EAN another article carries answered %', v_first;
  end if;
end;
$$;

-- An unchanged article mapped to another unit than the catalog stores counts
-- as changed, and the confirm changes its unit.
do $$
declare
  v_import uuid;
  v_preview jsonb;
  v_result jsonb;
begin
  v_import := public.open_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', '37500000-0000-4000-8000-000000000031', array['westrohr'],
    repeat('f', 64), null, '[]', '[]');
  perform public.stage_supplier_catalog_import_lines('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', v_import, jsonb_build_array(
      pg_temp.article(0, 'WR-16', 'Kupferrohr 16 mm', 'm', 'net', 4200, 1) || '{"ean":"4000000000024"}'));
  v_preview := public.preview_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', v_import);
  if v_preview->'units'->0->'unchanged_by_unit' is distinct from '{"meter":1}'::jsonb then
    raise exception 'the preview of an unchanged article answered %', v_preview;
  end if;
  v_result := public.confirm_supplier_catalog_import('37500000-0000-4000-8000-000000000010',
    '37500000-0000-4000-8000-000000000001', v_import, '{"m":"rod"}');
  if (v_result->>'changed')::integer is distinct from 1 or (v_result->>'unchanged')::integer is distinct from 0
    or (select unit from public.inventory_supplier_catalog_articles
      where organization_id = '37500000-0000-4000-8000-000000000010' and article_number = 'WR-16')
      is distinct from 'rod' then
    raise exception 'a confirm with another unit answered %', v_result;
  end if;
end;
$$;

-- No client role reads the catalog through the Data API, an employee and a
-- manager included: every catalog table refuses the select.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"37500000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect_refusal('an employee reads the catalog',
  'select count(*) from public.inventory_supplier_catalog_articles', '42501');
select pg_temp.expect_refusal('an employee reads a batch',
  'select count(*) from public.inventory_supplier_catalog_imports', '42501');
select pg_temp.expect_refusal('an employee reads staged lines',
  'select count(*) from public.inventory_supplier_catalog_import_lines', '42501');
select pg_temp.expect_refusal('an employee reads rebate groups',
  'select count(*) from public.inventory_supplier_rebate_groups', '42501');
reset role;
select set_config('request.jwt.claims',
  '{"sub":"37500000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.expect_refusal('Büro reads the catalog through the Data API',
  'select count(*) from public.inventory_supplier_catalog_articles', '42501');
reset role;

rollback;
