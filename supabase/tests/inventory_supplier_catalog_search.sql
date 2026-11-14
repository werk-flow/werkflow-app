-- The supplier catalog search reads its trigram index at 200 000 rows, and
-- finds its text literally (werk-flow/werkflow-planning#375, migration
-- 20261205090000_keep_a_supplier_catalog_beside_the_own_articles.sql). The
-- plan is of public.search_supplier_catalog_articles' own statement, with its
-- parameters filled in. Synthetic rows only.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('37510000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'catalog-search-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Sonnenberg"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('37510000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '37510000-0000-4000-8000-000000000001', 'CATSRC01');
insert into public.inventory_suppliers (id, organization_id, name) values
('37510000-0000-4000-8000-000000000030', '37510000-0000-4000-8000-000000000010', 'Großhandel Nordrohr');
insert into public.inventory_supplier_catalog_imports (
  id, organization_id, supplier_id, status, file_names, content_hash, created_by, confirmed_at
) values (
  '37510000-0000-4000-8000-000000000040', '37510000-0000-4000-8000-000000000010',
  '37510000-0000-4000-8000-000000000030', 'confirmed', array['lieferung'], repeat('e', 64),
  '37510000-0000-4000-8000-000000000001', now()
);

insert into public.inventory_supplier_catalog_articles (
  organization_id, supplier_id, article_number, name, name_addition, unit, unit_text, price_quantity,
  price_kind, price_cents, ean, import_id
)
select '37510000-0000-4000-8000-000000000010', '37510000-0000-4000-8000-000000000030',
  'NR-' || lpad(n::text, 6, '0'),
  (array['Kupferrohr', 'Pressfitting', 'Kugelhahn', 'Heizkörper', 'Thermostatkopf'])[1 + n % 5]
    || ' ' || (10 + n % 40) || ' mm',
  'Typ ' || n, 'piece', 'Stück', 1, 'list', 100 + n % 9000, lpad(n::text, 13, '4'),
  '37510000-0000-4000-8000-000000000040'
from generate_series(1, 200000) n;
analyze public.inventory_supplier_catalog_articles;

-- One article whose number holds * and _, which must match only themselves.
insert into public.inventory_supplier_catalog_articles (
  organization_id, supplier_id, article_number, name, unit, unit_text, price_quantity, import_id
) values (
  '37510000-0000-4000-8000-000000000010', '37510000-0000-4000-8000-000000000030', 'XY-15*1_A',
  'Sonderteil', 'piece', 'Stück', 1, '37510000-0000-4000-8000-000000000040'
);
analyze public.inventory_supplier_catalog_articles;

do $$
declare
  v_statement text;
  v_plan jsonb;
begin
  select replace(replace(replace(proc.prosrc,
      'p_organization_id', quote_literal('37510000-0000-4000-8000-000000000010') || '::uuid'),
      'p_search', quote_literal('Typ 123456')),
      'p_limit', '21')
  into v_statement
  from pg_proc proc
  where proc.oid = 'public.search_supplier_catalog_articles(uuid,text,integer)'::regprocedure;
  execute 'explain (format json) ' || v_statement into v_plan;
  if v_plan::text not like '%inventory_supplier_catalog_articles_search_idx%' then
    raise exception 'the catalog search does not read its index: %', v_plan;
  end if;

  if (select array_agg(found.article_number) from public.search_supplier_catalog_articles(
      '37510000-0000-4000-8000-000000000010', 'Typ 123456', 21) found)
    is distinct from array['NR-123456'] then
    raise exception 'the catalog search did not find the one match';
  end if;
  -- * and _ are text, never wildcards: each search finds the one article that holds it.
  if (select array_agg(found.article_number) from public.search_supplier_catalog_articles(
      '37510000-0000-4000-8000-000000000010', '15*1_a', 21) found)
    is distinct from array['XY-15*1_A'] then
    raise exception 'a search with * and _ matched other articles';
  end if;
  if exists (select 1 from public.search_supplier_catalog_articles(
      '37510000-0000-4000-8000-000000000010', '___', 21)) then
    raise exception 'a search of three _ matched articles without one';
  end if;
  -- Another organization's catalog stays out.
  if exists (select 1 from public.search_supplier_catalog_articles(
      '37510000-0000-4000-8000-000000000011', 'Typ 123456', 21)) then
    raise exception 'the search read another organization';
  end if;
end;
$$;

rollback;
