begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('97000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','inventory-page@example.test','',now(),'{}','{}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('97000000-0000-4000-8000-000000000002','Inventory pagination','97000000-0000-4000-8000-000000000001','INVPAGE'),
('97000000-0000-4000-8000-000000000003','Foreign inventory','97000000-0000-4000-8000-000000000001','INVFOREIGN');
insert into public.inventory_items(organization_id,name,item_type,unit,created_by)
select '97000000-0000-4000-8000-000000000002','Item '||lpad(number::text,4,'0'),'material','piece','97000000-0000-4000-8000-000000000001' from generate_series(1,1105) number;
insert into public.inventory_items(organization_id,name,item_type,unit,created_by)
values('97000000-0000-4000-8000-000000000003','Foreign only','material','piece','97000000-0000-4000-8000-000000000001');
insert into public.inventory_locations(organization_id,name,location_type,created_by)
select '97000000-0000-4000-8000-000000000002','Location '||lpad(number::text,2,'0'),'storage','97000000-0000-4000-8000-000000000001' from generate_series(1,13) number;
insert into public.inventory_item_barcodes(organization_id,item_id,barcode_value,is_primary)
select organization_id,id,'literal %_ target',true from public.inventory_items where organization_id='97000000-0000-4000-8000-000000000002' and name='Item 1055';
insert into public.inventory_stock_levels(organization_id,item_id,location_id,quantity_on_hand)
select item.organization_id,item.id,location.id,2 from public.inventory_items item join public.inventory_locations location on location.organization_id=item.organization_id and location.name='Location 01'
where item.organization_id='97000000-0000-4000-8000-000000000002';
do $$
declare first_page jsonb; last_page jsonb; searched jsonb; locations jsonb;
begin
 first_page:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{}');
 last_page:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{"page":23}');
 if (first_page->>'total')::int<>1105 or jsonb_array_length(first_page->'ids')<>50 or jsonb_array_length(last_page->'ids')<>5 then raise exception 'global inventory count or page completeness failed'; end if;
 if exists(select 1 from jsonb_array_elements_text(first_page->'ids') a join jsonb_array_elements_text(last_page->'ids') b on a.value=b.value) then raise exception 'inventory pages overlap'; end if;
 if (first_page->'summary'->>'totalOnHand')::numeric<>2210 or (first_page->'summary'->>'stockedItems')::int<>1105 then raise exception 'inventory summaries were derived from current page'; end if;
 searched:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{"search":"literal %_"}');
 if (searched->>'total')::int<>1 then raise exception 'global literal barcode search failed'; end if;
 searched:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{"search":"Foreign only"}');
 if (searched->>'total')::int<>0 then raise exception 'foreign inventory exposed'; end if;
 locations:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{"tab":"locations","page":2}');
 if jsonb_array_length(locations->'locationIds')<>1 then raise exception 'location paging failed'; end if;
 if has_function_privilege('anon','public.list_inventory_page(uuid,jsonb)','execute') or has_function_privilege('authenticated','public.list_inventory_page(uuid,jsonb)','execute') then raise exception 'inventory reader has direct client grant'; end if;
 if not has_function_privilege('service_role','public.list_inventory_page(uuid,jsonb)','execute') then raise exception 'inventory server reader grant missing'; end if;
end $$;

update public.inventory_items set item_type='tool',global_minimum_stock=3 where organization_id='97000000-0000-4000-8000-000000000002' and name='Item 1055';
insert into public.jobs(id,organization_id,title,job_number,created_by) values('97000000-0000-4000-8000-000000000010','97000000-0000-4000-8000-000000000002','Pagination material','PAGE-MATERIAL','97000000-0000-4000-8000-000000000001');
insert into public.job_material_lines(organization_id,job_id,item_id,planned_quantity,taken_quantity,created_by)
select organization_id,'97000000-0000-4000-8000-000000000010',id,5,2,'97000000-0000-4000-8000-000000000001' from public.inventory_items where organization_id='97000000-0000-4000-8000-000000000002' and name='Item 1055';
do $$ declare result jsonb; target_location uuid; begin
 result:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{"type":"tool","stock":"low_stock"}');
 if (result->>'total')::int<>1 or (result#>>'{summary,lowStockItems}')::int<>1 then raise exception 'type/stock filters or global low-stock count failed'; end if;
 result:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{"tab":"planned"}');
 if (result->>'total')::int<>1 or (result#>>'{summary,plannedQuantity}')::numeric<>3 then raise exception 'remaining planned material or planned filter failed'; end if;
 select id into target_location from public.inventory_locations where organization_id='97000000-0000-4000-8000-000000000002' and name='Location 02';
 result:=public.list_inventory_page('97000000-0000-4000-8000-000000000002',jsonb_build_object('location',target_location));
 if (result->>'total')::int<>0 or (result#>>'{summary,totalItems}')::int<>1105 then raise exception 'location filter lost global summary'; end if;
 result:=public.list_inventory_page('97000000-0000-4000-8000-000000000002','{"stock":"out_of_stock"}');
 if (result->>'total')::int<>0 then raise exception 'out-of-stock filter ignored'; end if;
end $$;

rollback;
