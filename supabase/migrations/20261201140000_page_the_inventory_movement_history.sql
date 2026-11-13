-- The office finds any stock movement in a paged, searchable history
-- (werk-flow/werkflow-planning#374).
--
-- 1. list_inventory_movement_page reads one page of an organization's material
--    history: every stock movement and every use event of job material, newest
--    first. Article search, Lager, kind, person and a Berlin date range apply
--    before the page boundary, and the total counts every match. Equal
--    timestamps order by id, so pages never overlap or skip a row. A use event
--    has no Lager and no stock effect: it keeps its own kind (`job_use`, or
--    `job_use_correction` for a negative event that names the event it
--    corrects), and a Lager filter leaves it out. The cost snapshot of a use
--    event never leaves the function. `people` names everyone who booked in
--    the organization, for the person filter.
-- 2. list_inventory_page no longer adds the articles of the 40 latest
--    movements to its support ids: the movement history reads its own article
--    names. Its signature, result shape and grants stay as before, and the
--    previous release adds those articles itself.
--
-- Both functions are server readers: the caller checks Admin or Büro and
-- passes the caller's organization; no client role may execute them.

create function public.list_inventory_movement_page(p_organization_id uuid, p_query jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
with settings as (
  select greatest(1, least(100000, coalesce((p_query->>'page')::integer, 1))) as page,
    lower(left(coalesce(p_query->>'search', ''), 200)) as search,
    nullif(coalesce(p_query->>'location', 'all'), 'all')::uuid as location_id,
    coalesce(p_query->>'kind', 'all') as kind,
    nullif(coalesce(p_query->>'person', 'all'), 'all')::uuid as person_id,
    (nullif(p_query->>'from', '')::date)::timestamp at time zone 'Europe/Berlin' as from_at,
    (nullif(p_query->>'to', '')::date + 1)::timestamp at time zone 'Europe/Berlin' as to_at
), history as (
  select m.id, m.movement_type as kind, m.item_id, null::text as unit, m.location_id,
    m.quantity_delta as quantity, m.quantity_before, m.quantity_after,
    m.job_id, m.project_id, m.reason, m.actor_id, m.created_at, null::uuid as corrects_event_id
  from public.inventory_movements m
  where m.organization_id = p_organization_id
  union all
  select e.id, case when e.corrects_event_id is null then 'job_use' else 'job_use_correction' end,
    e.item_id, e.unit, null::uuid, e.quantity, null::numeric, null::numeric,
    e.job_id, e.project_id, e.note, e.actor_id, e.created_at, e.corrects_event_id
  from public.job_material_use_events e
  where e.organization_id = p_organization_id
), filtered as (
  select h.* from history h
  cross join settings q
  join public.inventory_items i on i.id = h.item_id and i.organization_id = p_organization_id
  where (q.kind = 'all' or h.kind = q.kind)
    and (q.location_id is null or h.location_id = q.location_id)
    and (q.person_id is null or h.actor_id = q.person_id)
    and (q.from_at is null or h.created_at >= q.from_at)
    and (q.to_at is null or h.created_at < q.to_at)
    and (q.search = ''
      or strpos(lower(concat_ws(' ', i.name, i.internal_sku, i.manufacturer, i.supplier_article_number)), q.search) > 0
      or exists (
        select 1 from public.inventory_item_barcodes b
        where b.organization_id = p_organization_id and b.item_id = h.item_id
          and strpos(lower(b.barcode_value), q.search) > 0
      ))
), page_rows as (
  select * from filtered
  order by created_at desc, id desc
  limit 50 offset (select (page - 1) * 50 from settings)
), actors as (
  select actor_id from public.inventory_movements where organization_id = p_organization_id and actor_id is not null
  union
  select actor_id from public.job_material_use_events where organization_id = p_organization_id
)
select jsonb_build_object(
  'total', (select count(*) from filtered),
  'hasAny', exists (select 1 from history),
  'people', coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'firstName', p.first_name, 'lastName', p.last_name, 'email', p.email)
      order by lower(coalesce(nullif(concat_ws(' ', p.first_name, p.last_name), ''), p.email, '')), p.id)
    from actors a join public.profiles p on p.id = a.actor_id
  ), '[]'::jsonb),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'kind', r.kind,
      'itemId', r.item_id,
      'itemName', i.name,
      'unit', coalesce(r.unit, i.unit),
      'locationId', r.location_id,
      'locationName', l.name,
      'quantity', r.quantity,
      'quantityBefore', r.quantity_before,
      'quantityAfter', r.quantity_after,
      'jobId', j.id,
      'jobNumber', j.job_number,
      'jobTitle', j.title,
      'projectId', pr.id,
      'projectNumber', pr.project_number,
      'projectName', pr.name,
      'reason', r.reason,
      'actorId', r.actor_id,
      'createdAt', r.created_at,
      'correctsEventId', r.corrects_event_id
    ) order by r.created_at desc, r.id desc)
    from page_rows r
    join public.inventory_items i on i.id = r.item_id and i.organization_id = p_organization_id
    left join public.inventory_locations l on l.id = r.location_id and l.organization_id = p_organization_id
    left join public.jobs j on j.id = r.job_id and j.organization_id = p_organization_id
    left join public.projects pr on pr.id = r.project_id and pr.organization_id = p_organization_id
  ), '[]'::jsonb)
);
$$;

revoke all on function public.list_inventory_movement_page(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.list_inventory_movement_page(uuid, jsonb) to service_role;
comment on function public.list_inventory_movement_page(uuid, jsonb) is 'Manager-authorized server reader. One page of the organization''s stock movements and material use events with filters, total and the people who booked; never a cost; no browser execute grant.';

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
    case when not i.track_quantity then 'in_stock' when coalesce(s.quantity,0)<coalesce(p.quantity,0) then 'shortfall'
      when coalesce(s.quantity,0)<=0 then 'out_of_stock'
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
)
select jsonb_build_object(
  'ids',coalesce((select jsonb_agg(id) from page_items),'[]'::jsonb),
  'supportIds',coalesce((select jsonb_agg(id) from support_ids),'[]'::jsonb),
  'total',(select count(*) from filtered),
  'locationIds',coalesce((select jsonb_agg(id) from location_page),'[]'::jsonb),
  'locationCounts',coalesce((select jsonb_object_agg(location_id,total) from (
    select location_id,count(*) as total from public.inventory_stock_levels where organization_id=p_organization_id group by location_id
  ) counts),'{}'::jsonb),
  'summary',(select jsonb_build_object('totalItems',count(*),'shortfallItems',count(*) filter(where stock_status='shortfall'),'lowStockItems',count(*) filter(where stock_status='low_stock'),
    'outOfStockItems',count(*) filter(where stock_status='out_of_stock'),'plannedQuantity',coalesce(sum(planned),0),
    'totalOnHand',coalesce(sum(on_hand),0),'stockedItems',count(*) filter(where on_hand>0),'plannedItems',count(*) filter(where planned>0)) from facts)
);
$$;
