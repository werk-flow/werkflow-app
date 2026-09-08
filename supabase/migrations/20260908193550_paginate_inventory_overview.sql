create or replace function public.list_inventory_page(p_organization_id uuid, p_query jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
with settings as (
  select greatest(1, least(100000, coalesce((p_query->>'page')::integer, 1))) as page,
    lower(left(coalesce(p_query->>'search',''),200)) as search,
    coalesce(p_query->>'type','all') as item_type,
    coalesce(p_query->>'stock','all') as stock,
    nullif(p_query->>'location','all')::uuid as location_id,
    coalesce(p_query->>'tab','all') as tab
), stock as (
  select item_id, sum(quantity_on_hand) as quantity from public.inventory_stock_levels
  where organization_id=p_organization_id group by item_id
), planned as (
  select item_id, sum(greatest(0,planned_quantity-taken_quantity)) as quantity
  from public.job_material_lines where organization_id=p_organization_id and status<>'cancelled' group by item_id
), facts as (
  select i.*, coalesce(s.quantity,0) as on_hand, coalesce(p.quantity,0) as planned,
    case when not i.track_quantity then 'in_stock' when coalesce(s.quantity,0)<=0 then 'out_of_stock'
      when i.global_minimum_stock>0 and s.quantity<=i.global_minimum_stock then 'low_stock' else 'in_stock' end as stock_status,
    c.name as category_name, supplier.name as supplier_name
  from public.inventory_items i
  left join stock s on s.item_id=i.id left join planned p on p.item_id=i.id
  left join public.inventory_categories c on c.id=i.category_id and c.organization_id=i.organization_id
  left join public.inventory_suppliers supplier on supplier.id=i.supplier_id and supplier.organization_id=i.organization_id
  where i.organization_id=p_organization_id
), filtered as (
  select f.* from facts f cross join settings q where
    (q.tab<>'planned' or f.planned>0)
    and (q.item_type='all' or f.item_type=q.item_type)
    and (q.stock='all' or f.stock_status=q.stock)
    and (q.location_id is null or exists(select 1 from public.inventory_stock_levels s where s.organization_id=p_organization_id and s.item_id=f.id and s.location_id=q.location_id))
    and (q.search='' or strpos(lower(concat_ws(' ',f.name,f.description,f.internal_sku,f.manufacturer,f.supplier_article_number,f.category_name,f.supplier_name)),q.search)>0
      or exists(select 1 from public.inventory_item_barcodes b where b.organization_id=p_organization_id and b.item_id=f.id and strpos(lower(b.barcode_value),q.search)>0))
), page_items as (
  select id from filtered order by lower(name),id limit 50 offset (select (page-1)*50 from settings)
), location_page as (
  select id from public.inventory_locations where organization_id=p_organization_id
  order by sort_order,name,id limit 12 offset (select (page-1)*12 from settings)
), location_preview as (
  select s.location_id,s.item_id,row_number() over(partition by s.location_id order by lower(f.name),f.id) as position
  from public.inventory_stock_levels s join facts f on f.id=s.item_id
  where s.organization_id=p_organization_id and s.location_id in(select id from location_page)
), support_ids as (
  select id from page_items where (select tab from settings) in ('all','planned')
  union select item_id from location_preview where position<=6 and (select tab from settings)='locations'
  union select item_id from (select item_id from public.inventory_movements where organization_id=p_organization_id order by created_at desc,id limit 40) recent
)
select jsonb_build_object(
  'ids',coalesce((select jsonb_agg(id) from page_items),'[]'::jsonb),
  'supportIds',coalesce((select jsonb_agg(id) from support_ids),'[]'::jsonb),
  'total',(select count(*) from filtered),
  'locationIds',coalesce((select jsonb_agg(id) from location_page),'[]'::jsonb),
  'locationCounts',coalesce((select jsonb_object_agg(location_id,total) from (
    select location_id,count(*) as total from public.inventory_stock_levels where organization_id=p_organization_id group by location_id
  ) counts),'{}'::jsonb),
  'summary',(select jsonb_build_object('totalItems',count(*),'lowStockItems',count(*) filter(where stock_status='low_stock'),
    'outOfStockItems',count(*) filter(where stock_status='out_of_stock'),'plannedQuantity',coalesce(sum(planned),0),
    'totalOnHand',coalesce(sum(on_hand),0),'stockedItems',count(*) filter(where on_hand>0),'plannedItems',count(*) filter(where planned>0)) from facts)
);
$$;
revoke all on function public.list_inventory_page(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.list_inventory_page(uuid,jsonb) to service_role;
comment on function public.list_inventory_page(uuid,jsonb) is 'Manager-authorized server reader. Whole-organization summary and literal search, bounded page/support identities; no browser execute grant.';
