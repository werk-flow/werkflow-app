-- Service-only page readers of the equipment and service-case lists: scope
-- filters, search and counts apply before the page boundary, the order ends
-- with the id, more than 1,000 rows stay reachable, a foreign organization
-- neither counts nor matches, and browser roles cannot execute either reader.
-- Runs inside one transaction against the local stack and rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('75000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','service-lists-owner@example.test','',now(),'{}','{"first_name":"Service","last_name":"Lists"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('75000000-0000-4000-8000-000000000010','Service list pages','75000000-0000-4000-8000-000000000001','SRVLISTA'),
('75000000-0000-4000-8000-000000000011','Other service list pages','75000000-0000-4000-8000-000000000001','SRVLISTB');
insert into public.clients(id,organization_id,name) values
('75000000-0000-4000-8000-000000000020','75000000-0000-4000-8000-000000000010','Hauptkunde'),
('75000000-0000-4000-8000-000000000021','75000000-0000-4000-8000-000000000010','Suchkunde Nord'),
('75000000-0000-4000-8000-000000000022','75000000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('75000000-0000-4000-8000-000000000030','75000000-0000-4000-8000-000000000010','75000000-0000-4000-8000-000000000020','Heizzentrale',true,'75000000-0000-4000-8000-000000000001'),
('75000000-0000-4000-8000-000000000031','75000000-0000-4000-8000-000000000010','75000000-0000-4000-8000-000000000021','Werkstatt Ost',true,'75000000-0000-4000-8000-000000000001'),
('75000000-0000-4000-8000-000000000032','75000000-0000-4000-8000-000000000011','75000000-0000-4000-8000-000000000022','Fremdort',true,'75000000-0000-4000-8000-000000000001');

-- Equipment: 1,051 rows. Numbers 1-5 are archived, number 7 is ventilation,
-- number 1049 sits at the second customer, number 1050 was replaced by a
-- successor that a correction voided, and number 1051 carries a literal
-- `50%_` identifier.
set local app.installed_equipment_write = 'true';
insert into public.installed_equipment(id,organization_id,client_id,site_id,equipment_number,name,category,state,archived_at,archived_by,archive_reason,created_by,updated_by)
select md5('list-equipment-'||number)::uuid,'75000000-0000-4000-8000-000000000010',
  case when number=1049 then '75000000-0000-4000-8000-000000000021' else '75000000-0000-4000-8000-000000000020' end::uuid,
  case when number=1049 then '75000000-0000-4000-8000-000000000031' else '75000000-0000-4000-8000-000000000030' end::uuid,
  'EQ-'||lpad(number::text,4,'0'),'Anlage '||lpad(number::text,4,'0'),
  (case when number=7 then 'ventilation' else 'heat_generation' end)::public.installed_equipment_category,
  (case when number<=5 then 'decommissioned' when number=1050 then 'replaced' else 'active' end)::public.installed_equipment_state,
  case when number<=5 then now() end,
  case when number<=5 then '75000000-0000-4000-8000-000000000001'::uuid end,
  case when number<=5 then 'Stillgelegt' end,
  '75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001'
from generate_series(1,1051) number;
insert into public.installed_equipment(id,organization_id,client_id,site_id,predecessor_equipment_id,equipment_number,name,category,state,voided_at,voided_by,void_reason,created_by,updated_by) values
('75000000-0000-4000-8000-000000000040','75000000-0000-4000-8000-000000000010','75000000-0000-4000-8000-000000000020','75000000-0000-4000-8000-000000000030',md5('list-equipment-1050')::uuid,'EQ-VOID','Irrtümlicher Nachfolger','heat_generation','active',now(),'75000000-0000-4000-8000-000000000001','Irrtum korrigiert','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001'),
('75000000-0000-4000-8000-000000000041','75000000-0000-4000-8000-000000000011','75000000-0000-4000-8000-000000000022','75000000-0000-4000-8000-000000000032',null,'EQ-FREMD','Fremdanlage','heat_generation','active',null,null,null,'75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001');
insert into public.installed_equipment_identifiers(organization_id,equipment_id,identifier_type,value,created_by) values
('75000000-0000-4000-8000-000000000010',md5('list-equipment-1051')::uuid,'serial_number','SER-TAIL-50%_','75000000-0000-4000-8000-000000000001');

-- Service cases: 1,051 rows, number n changed n minutes after the base.
-- Numbers 1-10 are resolved, 11-15 need a visit, number 30 sits at the second
-- customer, and number 20 links equipment 1048.
set local app.service_case_write = 'true';
insert into public.service_cases(id,organization_id,case_number,intake_type,client_id,site_id,original_statement,summary,status,resolution_note,created_by,updated_by,updated_at)
select md5('list-case-'||number)::uuid,'75000000-0000-4000-8000-000000000010','SRV-'||lpad(number::text,4,'0'),'direct',
  case when number=30 then '75000000-0000-4000-8000-000000000021' else '75000000-0000-4000-8000-000000000020' end::uuid,
  case when number=30 then '75000000-0000-4000-8000-000000000031' else '75000000-0000-4000-8000-000000000030' end::uuid,
  'Meldung','Störung '||lpad(number::text,4,'0'),
  (case when number<=10 then 'resolved' when number<=15 then 'visit_required' else 'new' end)::public.service_case_status,
  case when number<=10 then 'Erledigt' end,
  '75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001',
  '2026-01-01T00:00:00Z'::timestamptz + number * interval '1 minute'
from generate_series(1,1051) number;
insert into public.service_case_equipment_links(organization_id,service_case_id,equipment_id,created_by) values
('75000000-0000-4000-8000-000000000010',md5('list-case-20')::uuid,md5('list-equipment-1048')::uuid,'75000000-0000-4000-8000-000000000001');
insert into public.service_cases(id,organization_id,case_number,intake_type,client_id,site_id,original_statement,summary,created_by,updated_by,updated_at) values
('75000000-0000-4000-8000-000000000050','75000000-0000-4000-8000-000000000011','SRV-FREMD','direct','75000000-0000-4000-8000-000000000022','75000000-0000-4000-8000-000000000032','Meldung','Fremde Störung','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001',now());
reset app.installed_equipment_write;
reset app.service_case_write;

set local role service_role;

do $$ declare
  org_id uuid := '75000000-0000-4000-8000-000000000010';
  result jsonb; next_result jsonb; signature text;
begin
  foreach signature in array array['public.list_equipment_page(uuid,text,text,boolean,integer,integer)','public.list_service_case_page(uuid,text,text,integer,integer)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'service page RPC grant mismatch: %',signature; end if;
  end loop;

  -- Equipment: the default scope hides archived and voided rows and counts before the page boundary.
  result := public.list_equipment_page(org_id,'','all',false,1,50);
  if (result->>'total')::int<>1046 or jsonb_array_length(result->'ids')<>50 or not (result->>'hasAny')::boolean then raise exception 'equipment first page or total wrong: %',result->>'total'; end if;
  if exists(select 1 from jsonb_array_elements_text(result->'ids') with ordinality listed(id,position) where id<>md5('list-equipment-'||(position+5))::uuid::text) then raise exception 'equipment page is not ordered by number'; end if;
  next_result := public.list_equipment_page(org_id,'','all',false,2,50);
  if exists(select 1 from jsonb_array_elements(result->'ids') a join jsonb_array_elements(next_result->'ids') b on a=b) then raise exception 'equipment pages overlap'; end if;
  result := public.list_equipment_page(org_id,'','all',false,21,50);
  if jsonb_array_length(result->'ids')<>46 or result->'ids'->>45<>md5('list-equipment-1051')::uuid::text then raise exception 'equipment tail beyond 1,000 rows unreachable'; end if;
  if (public.list_equipment_page(org_id,'','all',true,1,50)->>'total')::int<>1051 then raise exception 'archived equipment missing from the archived scope'; end if;
  if (public.list_equipment_page(org_id,'EQ-VOID','all',true,1,50)->>'total')::int<>0 then raise exception 'a voided successor is listed'; end if;
  result := public.list_equipment_page(org_id,'','ventilation',false,1,50);
  if (result->>'total')::int<>1 or result->'ids'<>jsonb_build_array(md5('list-equipment-7')::uuid) then raise exception 'equipment category filter wrong'; end if;
  -- Search: identifier values match literally, customer and site names match.
  result := public.list_equipment_page(org_id,'50%_','all',false,1,50);
  if (result->>'total')::int<>1 or result->'ids'<>jsonb_build_array(md5('list-equipment-1051')::uuid) then raise exception 'literal identifier search missed the tail'; end if;
  if public.list_equipment_page(org_id,'suchkunde nord','all',false,1,50)->'ids'<>jsonb_build_array(md5('list-equipment-1049')::uuid)
    or public.list_equipment_page(org_id,'werkstatt ost','all',false,1,50)->'ids'<>jsonb_build_array(md5('list-equipment-1049')::uuid) then raise exception 'equipment customer or site search wrong'; end if;
  if (public.list_equipment_page(org_id,'anlage 0003','all',false,1,50)->>'total')::int<>0 or (public.list_equipment_page(org_id,'anlage 0003','all',true,1,50)->>'total')::int<>1 then raise exception 'equipment search ignores the archived scope'; end if;
  -- Bounds: at most 100 rows, at least one row, never a page before the first, empty past the end.
  if jsonb_array_length(public.list_equipment_page(org_id,'','all',false,1,100000)->'ids')<>100 then raise exception 'equipment page size is not capped at 100'; end if;
  if jsonb_array_length(public.list_equipment_page(org_id,'','all',false,1,0)->'ids')<>1 then raise exception 'equipment page size has no lower bound'; end if;
  if public.list_equipment_page(org_id,'','all',false,-3,50)->'ids'->>0<>md5('list-equipment-6')::uuid::text then raise exception 'equipment page number has no lower bound'; end if;
  result := public.list_equipment_page(org_id,'','all',false,2147483647,100);
  if (result->>'total')::int<>1046 or result->'ids'<>'[]'::jsonb then raise exception 'equipment page past the end is not empty'; end if;
  -- Tenant isolation and an organization without equipment.
  if (public.list_equipment_page(org_id,'Fremdanlage','all',true,1,50)->>'total')::int<>0 then raise exception 'equipment tenant leaked'; end if;
  result := public.list_equipment_page('75000000-0000-4000-8000-000000000011','','all',false,1,50);
  if (result->>'total')::int<>1 or result->'ids'<>jsonb_build_array('75000000-0000-4000-8000-000000000041'::uuid) then raise exception 'foreign organization equipment page wrong'; end if;
  result := public.list_equipment_page('75000000-0000-4000-8000-000000000012','','all',true,1,50);
  if (result->>'total')::int<>0 or (result->>'hasAny')::boolean or result->'ids'<>'[]'::jsonb then raise exception 'empty organization reports equipment'; end if;

  -- Service cases: open scope, newest change first, complete count before the page boundary.
  result := public.list_service_case_page(org_id,'open','',1,50);
  if (result->>'total')::int<>1041 or jsonb_array_length(result->'ids')<>50 or not (result->>'hasAny')::boolean then raise exception 'service case first page or total wrong: %',result->>'total'; end if;
  if exists(select 1 from jsonb_array_elements_text(result->'ids') with ordinality listed(id,position) where id<>md5('list-case-'||(1052-position))::uuid::text) then raise exception 'service case page is not newest first'; end if;
  result := public.list_service_case_page(org_id,'all','',22,50);
  if (result->>'total')::int<>1051 or result->'ids'<>jsonb_build_array(md5('list-case-1')::uuid) then raise exception 'service case tail beyond 1,000 rows unreachable'; end if;
  if (public.list_service_case_page(org_id,'resolved','',1,50)->>'total')::int<>10 or (public.list_service_case_page(org_id,'visit_required','',1,50)->>'total')::int<>5 or (public.list_service_case_page(org_id,'duplicate','',1,50)->>'total')::int<>0 then raise exception 'service case status scope wrong'; end if;
  -- Search: linked equipment, customer and site names match; the status scope still applies.
  result := public.list_service_case_page(org_id,'all','eq-1048',1,50);
  if (result->>'total')::int<>1 or result->'ids'<>jsonb_build_array(md5('list-case-20')::uuid) then raise exception 'service case equipment search wrong'; end if;
  if public.list_service_case_page(org_id,'open','suchkunde',1,50)->'ids'<>jsonb_build_array(md5('list-case-30')::uuid)
    or public.list_service_case_page(org_id,'open','werkstatt ost',1,50)->'ids'<>jsonb_build_array(md5('list-case-30')::uuid) then raise exception 'service case customer or site search wrong'; end if;
  if (public.list_service_case_page(org_id,'open','störung 0001',1,50)->>'total')::int<>0 or (public.list_service_case_page(org_id,'all','störung 0001',1,50)->>'total')::int<>1 then raise exception 'service case search ignores the status scope'; end if;
  -- Bounds.
  if jsonb_array_length(public.list_service_case_page(org_id,'all','',1,100000)->'ids')<>100 then raise exception 'service case page size is not capped at 100'; end if;
  if jsonb_array_length(public.list_service_case_page(org_id,'all','',1,0)->'ids')<>1 then raise exception 'service case page size has no lower bound'; end if;
  if public.list_service_case_page(org_id,'all','',-3,50)->'ids'->>0<>md5('list-case-1051')::uuid::text then raise exception 'service case page number has no lower bound'; end if;
  result := public.list_service_case_page(org_id,'all','',2147483647,100);
  if (result->>'total')::int<>1051 or result->'ids'<>'[]'::jsonb then raise exception 'service case page past the end is not empty'; end if;
  -- Tenant isolation and an organization without cases.
  if (public.list_service_case_page(org_id,'all','Fremde',1,50)->>'total')::int<>0 then raise exception 'service case tenant leaked'; end if;
  result := public.list_service_case_page('75000000-0000-4000-8000-000000000011','all','',1,50);
  if (result->>'total')::int<>1 or result->'ids'<>jsonb_build_array('75000000-0000-4000-8000-000000000050'::uuid) then raise exception 'foreign organization service case page wrong'; end if;
  result := public.list_service_case_page('75000000-0000-4000-8000-000000000012','all','',1,50);
  if (result->>'total')::int<>0 or (result->>'hasAny')::boolean or result->'ids'<>'[]'::jsonb then raise exception 'empty organization reports service cases'; end if;
end $$;

-- Identical change timestamps keep a deterministic identity order.
reset role;
set local app.service_case_write = 'true';
insert into public.service_cases(id,organization_id,case_number,intake_type,client_id,site_id,original_statement,summary,created_by,updated_by,updated_at) values
('75000000-0000-4000-8000-000000000082','75000000-0000-4000-8000-000000000010','SRV-SAME-B','direct','75000000-0000-4000-8000-000000000020','75000000-0000-4000-8000-000000000030','Meldung','Gleichzeitig B','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','2027-01-01'),
('75000000-0000-4000-8000-000000000081','75000000-0000-4000-8000-000000000010','SRV-SAME-A','direct','75000000-0000-4000-8000-000000000020','75000000-0000-4000-8000-000000000030','Meldung','Gleichzeitig A','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','2027-01-01');
reset app.service_case_write;
set local role service_role;
do $$ declare result jsonb;
begin
  result := public.list_service_case_page('75000000-0000-4000-8000-000000000010','open','gleichzeitig',1,1);
  if (result->>'total')::int<>2 or result->'ids'<>jsonb_build_array('75000000-0000-4000-8000-000000000081'::uuid) then raise exception 'identical change timestamps lost the id order on page 1'; end if;
  result := public.list_service_case_page('75000000-0000-4000-8000-000000000010','open','gleichzeitig',2,1);
  if result->'ids'<>jsonb_build_array('75000000-0000-4000-8000-000000000082'::uuid) then raise exception 'identical change timestamps lost the id order on page 2'; end if;
end $$;

-- Equipment numbers sort by year, then by the numeric sequence, across the
-- page boundary: -1000 follows -101, and a number outside the form sorts last.
reset role;
insert into public.organizations(id,name,admin_id,unique_code) values
('75000000-0000-4000-8000-000000000013','Natural number pages','75000000-0000-4000-8000-000000000001','SRVLISTC');
insert into public.clients(id,organization_id,name) values
('75000000-0000-4000-8000-000000000023','75000000-0000-4000-8000-000000000013','Nummernkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('75000000-0000-4000-8000-000000000033','75000000-0000-4000-8000-000000000013','75000000-0000-4000-8000-000000000023','Nummernort',true,'75000000-0000-4000-8000-000000000001');
set local app.installed_equipment_write = 'true';
insert into public.installed_equipment(id,organization_id,client_id,site_id,equipment_number,name,category,state,created_by,updated_by)
select md5('natural-equipment-'||number)::uuid,'75000000-0000-4000-8000-000000000013','75000000-0000-4000-8000-000000000023','75000000-0000-4000-8000-000000000033',
  number,'Anlage '||number,'heat_generation','active','75000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001'
from unnest(array['ANL-2026-1000','ANL-2026-101','ANL-ALT','ANL-2026-100','ANL-2025-1200','ANL-2026-099']) number;
reset app.installed_equipment_write;
set local role service_role;
do $$ declare
  expected text[] := array['ANL-2025-1200','ANL-2026-099','ANL-2026-100','ANL-2026-101','ANL-2026-1000','ANL-ALT'];
  page_number integer; result jsonb;
begin
  for page_number in 1..3 loop
    result := public.list_equipment_page('75000000-0000-4000-8000-000000000013','','all',false,page_number,2);
    if result->'ids'<>jsonb_build_array(md5('natural-equipment-'||expected[page_number*2-1])::uuid,md5('natural-equipment-'||expected[page_number*2])::uuid) then
      raise exception 'equipment numbers do not sort naturally on page %',page_number;
    end if;
  end loop;
end $$;

-- A browser session cannot execute either reader, even for its own organization.
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.list_equipment_page('75000000-0000-4000-8000-000000000010');
    raise exception 'authenticated executed list_equipment_page';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_service_case_page('75000000-0000-4000-8000-000000000010');
    raise exception 'authenticated executed list_service_case_page';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.list_equipment_page('75000000-0000-4000-8000-000000000010');
    raise exception 'anon executed list_equipment_page';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_service_case_page('75000000-0000-4000-8000-000000000010');
    raise exception 'anon executed list_service_case_page';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
