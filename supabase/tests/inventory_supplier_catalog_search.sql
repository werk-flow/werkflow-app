-- The supplier catalog search reads its trigram index at 200 000 rows
-- (werk-flow/werkflow-planning#375, migration
-- 20261205090000_keep_a_supplier_catalog_beside_the_own_articles.sql). The
-- statement below is the one lib/inventory/supplier-catalog-actions.ts sends
-- through the Data API: the organization, the lower-cased search as a
-- substring of search_text, name order, 20 rows. Synthetic rows only.
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

do $$
declare
  v_plan jsonb;
  v_rows integer;
begin
  execute $q$
    explain (format json)
    select id, article_number, name, name_addition, unit, price_kind, price_cents, price_quantity
    from public.inventory_supplier_catalog_articles
    where organization_id = '37510000-0000-4000-8000-000000000010' and search_text like '%typ 123456%'
    order by name, id
    limit 20
  $q$ into v_plan;
  if v_plan::text not like '%inventory_supplier_catalog_articles_search_idx%' then
    raise exception 'the catalog search does not read its index: %', v_plan;
  end if;
  select count(*) into v_rows from public.inventory_supplier_catalog_articles
  where organization_id = '37510000-0000-4000-8000-000000000010' and search_text like '%typ 123456%';
  if v_rows is distinct from 1 then
    raise exception 'the catalog search found % rows, not 1', v_rows;
  end if;
end;
$$;

rollback;
