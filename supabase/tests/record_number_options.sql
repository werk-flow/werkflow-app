-- Service-only pickers that offer records by number: the equipment picker
-- and the work-predecessor choices select their window in natural number
-- order (year, numeric sequence, then the rest), so `-1000` follows `-101`
-- on every page, a number outside the form comes last, a foreign
-- organization never matches, and browser roles cannot execute either reader.
-- Runs inside one transaction against the local stack and rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('78000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','record-options-owner@example.test','',now(),'{}','{}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('78000000-0000-4000-8000-000000000010','Record number options','78000000-0000-4000-8000-000000000001','RECOPTA'),
('78000000-0000-4000-8000-000000000011','Natural number options','78000000-0000-4000-8000-000000000001','RECOPTB'),
('78000000-0000-4000-8000-000000000012','Foreign number options','78000000-0000-4000-8000-000000000001','RECOPTC');
insert into public.clients(id,organization_id,name) values
('78000000-0000-4000-8000-000000000020','78000000-0000-4000-8000-000000000010','Hauptkunde'),
('78000000-0000-4000-8000-000000000021','78000000-0000-4000-8000-000000000010','Zweitkunde'),
('78000000-0000-4000-8000-000000000022','78000000-0000-4000-8000-000000000011','Nummernkunde'),
('78000000-0000-4000-8000-000000000023','78000000-0000-4000-8000-000000000012','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('78000000-0000-4000-8000-000000000030','78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000020','Heizzentrale',true,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000031','78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000021','Werkstatt',true,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000032','78000000-0000-4000-8000-000000000011','78000000-0000-4000-8000-000000000022','Nummernort',true,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000033','78000000-0000-4000-8000-000000000012','78000000-0000-4000-8000-000000000023','Fremdort',true,'78000000-0000-4000-8000-000000000001');

-- The seed bypasses the number generators and write guards.
set local session_replication_role = replica;
-- Organization 10: equipment ANL-2026-1 to -1051 without padding, so text
-- order would put -10, -100 and -1000 right after -1. Also ANL-2025-1200
-- (first), ANL-ALT (last), a voided ANL-2026-2000 and ANL-2026-1052 at the
-- second customer.
insert into public.installed_equipment(id,organization_id,client_id,site_id,predecessor_equipment_id,equipment_number,name,category,state,voided_at,voided_by,void_reason,created_by,updated_by)
select md5('option-equipment-'||number)::uuid,'78000000-0000-4000-8000-000000000010',
  case when number='ANL-2026-1052' then '78000000-0000-4000-8000-000000000021' else '78000000-0000-4000-8000-000000000020' end::uuid,
  case when number='ANL-2026-1052' then '78000000-0000-4000-8000-000000000031' else '78000000-0000-4000-8000-000000000030' end::uuid,
  case when number='ANL-2026-2000' then md5('option-equipment-ANL-2026-1')::uuid end,
  number,case when number='ANL-2026-1052' then 'Kesselanlage Nord' else 'Anlage '||number end,'heat_generation','active',
  case when number='ANL-2026-2000' then now() end,
  case when number='ANL-2026-2000' then '78000000-0000-4000-8000-000000000001'::uuid end,
  case when number='ANL-2026-2000' then 'Irrtum' end,
  '78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001'
from (select 'ANL-2026-'||sequence as number from generate_series(1,1052) sequence
  union all select unnest(array['ANL-2025-1200','ANL-ALT','ANL-2026-2000'])) numbers;
-- Organization 10: jobs AUF-2026-1 to -1051 and projects PRJ-2026-1 to -1051.
insert into public.jobs(id,organization_id,created_by,job_number,title)
select md5('option-job-'||sequence)::uuid,'78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000001','AUF-2026-'||sequence,'Auftrag '||sequence
from generate_series(1,1051) sequence;
insert into public.projects(id,organization_id,created_by,project_number,name)
select md5('option-project-'||sequence)::uuid,'78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000001','PRJ-2026-'||sequence,'Projekt '||sequence
from generate_series(1,1051) sequence;
-- Organization 11: the boundary numbers in scrambled insertion order.
insert into public.installed_equipment(id,organization_id,client_id,site_id,equipment_number,name,category,state,created_by,updated_by)
select md5('natural-option-equipment-'||number)::uuid,'78000000-0000-4000-8000-000000000011','78000000-0000-4000-8000-000000000022','78000000-0000-4000-8000-000000000032',
  number,'Anlage '||number,'heat_generation','active','78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001'
from unnest(array['ANL-2026-1000','ANL-2026-101','ANL-ALT','ANL-2026-100','ANL-2025-1200','ANL-2026-099']) number;
insert into public.jobs(id,organization_id,created_by,job_number,title)
select md5('natural-option-job-'||coalesce(number,'none'))::uuid,'78000000-0000-4000-8000-000000000011','78000000-0000-4000-8000-000000000001',number,'Auftrag '||coalesce(number,'ohne Nummer')
from unnest(array['AUF-2026-1000','AUF-2026-101',null,'AUF-ALT','AUF-2026-100','AUF-2025-1200','AUF-2026-099']) number;
-- Organization 12: a foreign record with a colliding number.
insert into public.installed_equipment(id,organization_id,client_id,site_id,equipment_number,name,category,state,created_by,updated_by) values
('78000000-0000-4000-8000-000000000040','78000000-0000-4000-8000-000000000012','78000000-0000-4000-8000-000000000023','78000000-0000-4000-8000-000000000033','ANL-2026-1','Fremdanlage','heat_generation','active','78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001');
insert into public.jobs(id,organization_id,created_by,job_number,title) values
('78000000-0000-4000-8000-000000000041','78000000-0000-4000-8000-000000000012','78000000-0000-4000-8000-000000000001','AUF-2026-1','Fremdauftrag');
set local session_replication_role = origin;

set local role service_role;

do $$ declare
  org_id uuid := '78000000-0000-4000-8000-000000000010';
  result jsonb; signature text;
begin
  foreach signature in array array['public.search_equipment_options(uuid,text,uuid,integer)','public.search_work_predecessor_options(uuid,text,text,integer)'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'option RPC grant mismatch: %',signature; end if;
  end loop;

  -- Equipment: natural order on every page, 50 per page, hasMore before the end.
  result := public.search_equipment_options(org_id);
  if jsonb_array_length(result->'options')<>50 or not (result->>'hasMore')::boolean then raise exception 'equipment option first page wrong'; end if;
  if result->'options'->0->>'equipmentNumber'<>'ANL-2025-1200' then raise exception 'an earlier year does not lead'; end if;
  if exists(select 1 from jsonb_array_elements(result->'options') with ordinality listed(option,position) where position>1 and option->>'equipmentNumber'<>'ANL-2026-'||(position-1)) then raise exception 'equipment option page 1 is not in natural order'; end if;
  result := public.search_equipment_options(org_id,'',null,50);
  if exists(select 1 from jsonb_array_elements(result->'options') with ordinality listed(option,position) where option->>'equipmentNumber'<>'ANL-2026-'||(position+49)) then raise exception 'equipment option page 2 is not in natural order'; end if;
  result := public.search_equipment_options(org_id,'',null,1000);
  if exists(select 1 from jsonb_array_elements(result->'options') with ordinality listed(option,position) where option->>'equipmentNumber'<>'ANL-2026-'||(position+999)) then raise exception 'equipment option page beyond 1,000 rows is not in natural order'; end if;
  result := public.search_equipment_options(org_id,'',null,1050);
  if (result->>'hasMore')::boolean or jsonb_path_query_array(result->'options','$[*].equipmentNumber')<>'["ANL-2026-1050","ANL-2026-1051","ANL-2026-1052","ANL-ALT"]'::jsonb then raise exception 'equipment option tail wrong: %',result; end if;
  -- Customer filter, number and name search, voided equipment.
  result := public.search_equipment_options(org_id,'','78000000-0000-4000-8000-000000000021');
  if result->'options'<>jsonb_build_array(jsonb_build_object('id',md5('option-equipment-ANL-2026-1052')::uuid,'equipmentNumber','ANL-2026-1052','name','Kesselanlage Nord','clientId','78000000-0000-4000-8000-000000000021')) then raise exception 'equipment customer filter wrong: %',result; end if;
  if jsonb_path_query_array(public.search_equipment_options(org_id,'kesselanlage')->'options','$[*].equipmentNumber')<>'["ANL-2026-1052"]'::jsonb then raise exception 'equipment name search wrong'; end if;
  if jsonb_path_query_array(public.search_equipment_options(org_id,'2026-105')->'options','$[*].equipmentNumber')<>'["ANL-2026-105","ANL-2026-1050","ANL-2026-1051","ANL-2026-1052"]'::jsonb then raise exception 'equipment number search is not in natural order'; end if;
  if public.search_equipment_options(org_id,'2026-2000')->'options'<>'[]'::jsonb then raise exception 'voided equipment is offered'; end if;
  -- Tenant isolation.
  if exists(select 1 from jsonb_array_elements(public.search_equipment_options(org_id,'fremdanlage')->'options')) then raise exception 'equipment option tenant leaked'; end if;
  if jsonb_path_query_array(public.search_equipment_options('78000000-0000-4000-8000-000000000012')->'options','$[*].id')<>'["78000000-0000-4000-8000-000000000040"]'::jsonb then raise exception 'foreign organization equipment options wrong'; end if;

  -- Predecessors: the window is selected in natural order, not text order.
  result := public.search_work_predecessor_options(org_id,'job','',25);
  if jsonb_array_length(result)<>25 or exists(select 1 from jsonb_array_elements(result) with ordinality listed(option,position) where option->>'number'<>'AUF-2026-'||position) then raise exception 'first job predecessors are not in natural order'; end if;
  result := public.search_work_predecessor_options(org_id,'job','auf-2026-1');
  if jsonb_array_length(result)<>50 or result->0->>'number'<>'AUF-2026-1' or result->1->>'number'<>'AUF-2026-10' or result->10->>'number'<>'AUF-2026-19' or result->11->>'number'<>'AUF-2026-100' or result->49->>'number'<>'AUF-2026-138' then raise exception 'searched job predecessors are not selected in natural order: %',result; end if;
  if (select count(*) from jsonb_array_elements(public.search_work_predecessor_options(org_id,'job','auftrag 1050'))) <> 1 then raise exception 'job predecessor title search wrong'; end if;
  result := public.search_work_predecessor_options(org_id,'project','',3);
  if jsonb_path_query_array(result,'$[*].number')<>'["PRJ-2026-1","PRJ-2026-2","PRJ-2026-3"]'::jsonb or result->0->>'title'<>'Projekt 1' then raise exception 'project predecessors wrong: %',result; end if;
  if jsonb_array_length(public.search_work_predecessor_options(org_id,'job','',1000))<>50 or jsonb_array_length(public.search_work_predecessor_options(org_id,'job','',0))<>1 then raise exception 'predecessor limit is not bounded'; end if;
  if public.search_work_predecessor_options(org_id,'instruction')<>'[]'::jsonb then raise exception 'an unknown predecessor kind lists records'; end if;
  if exists(select 1 from jsonb_array_elements(public.search_work_predecessor_options(org_id,'job','fremdauftrag'))) then raise exception 'predecessor tenant leaked'; end if;

  -- Organization 11: -099, -100, -101, -1000 across the year, a number outside the form and none last.
  if jsonb_path_query_array(public.search_equipment_options('78000000-0000-4000-8000-000000000011')->'options','$[*].equipmentNumber')
    <>'["ANL-2025-1200","ANL-2026-099","ANL-2026-100","ANL-2026-101","ANL-2026-1000","ANL-ALT"]'::jsonb then raise exception 'equipment options do not sort naturally'; end if;
  if jsonb_path_query_array(public.search_work_predecessor_options('78000000-0000-4000-8000-000000000011','job'),'$[*].number')
    <>'["AUF-2025-1200","AUF-2026-099","AUF-2026-100","AUF-2026-101","AUF-2026-1000","AUF-ALT",null]'::jsonb then raise exception 'job predecessors do not sort naturally'; end if;
end $$;

-- A browser session cannot execute either reader, even for its own organization.
reset role;
set local role authenticated;
do $$ begin
  begin
    perform public.search_equipment_options('78000000-0000-4000-8000-000000000010');
    raise exception 'authenticated executed search_equipment_options';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.search_work_predecessor_options('78000000-0000-4000-8000-000000000010','job');
    raise exception 'authenticated executed search_work_predecessor_options';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.search_equipment_options('78000000-0000-4000-8000-000000000010');
    raise exception 'anon executed search_equipment_options';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.search_work_predecessor_options('78000000-0000-4000-8000-000000000010','job');
    raise exception 'anon executed search_work_predecessor_options';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
