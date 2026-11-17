-- public.match_installed_equipment: the header search of a field worker
-- matches only among the Anlagen the server passes (those of their assigned
-- jobs), with the equipment list's own matching rule. An Anlage that matches
-- but is not passed, a voided one and one of another organization are never
-- returned; browser roles cannot execute the function or its rule.
-- Runs inside one transaction against the local stack and rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('76000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','assigned-equipment-search@example.test','',now(),'{}','{"first_name":"Max","last_name":"Mustermann"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('76000000-0000-4000-8000-000000000010','Haustechnik Sonnenberg GmbH','76000000-0000-4000-8000-000000000001','ASGNEQA'),
('76000000-0000-4000-8000-000000000011','Fremde Haustechnik GmbH','76000000-0000-4000-8000-000000000001','ASGNEQB');
insert into public.clients(id,organization_id,name) values
('76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000010','Hausverwaltung Lindenhof GmbH'),
('76000000-0000-4000-8000-000000000021','76000000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('76000000-0000-4000-8000-000000000030','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000020','Wohnanlage Lindenhof',true,'76000000-0000-4000-8000-000000000001'),
('76000000-0000-4000-8000-000000000031','76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000021','Fremdort',true,'76000000-0000-4000-8000-000000000001');

-- 40: the Anlage of the worker's job, serial number in an identifier.
-- 41: same name, another job's Anlage (replaced by 42), never passed.
-- 42: passed, but voided.
-- 43: another organization's Anlage with the same name, passed by mistake.
-- 44: passed, archived: the job card shows it, so the search finds it.
set local app.installed_equipment_write = 'true';
insert into public.installed_equipment(id,organization_id,client_id,site_id,equipment_number,name,category,state,manufacturer,model,archived_at,archived_by,archive_reason,voided_at,voided_by,void_reason,created_by,updated_by) values
('76000000-0000-4000-8000-000000000040','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','ANL-2026-0001','Gasbrennwerttherme Keller','heat_generation','active','Viessmann','Vitodens 200',null,null,null,null,null,null,'76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001'),
('76000000-0000-4000-8000-000000000041','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','ANL-2026-0002','Gasbrennwerttherme Dach','heat_generation','replaced',null,null,null,null,null,null,null,null,'76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001'),
('76000000-0000-4000-8000-000000000043','76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000021','76000000-0000-4000-8000-000000000031','ANL-2026-0001','Gasbrennwerttherme Keller','heat_generation','active',null,null,null,null,null,null,null,null,'76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001'),
('76000000-0000-4000-8000-000000000044','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','ANL-2026-0004','Speicher Keller','storage_and_hot_water','decommissioned',null,null,now(),'76000000-0000-4000-8000-000000000001','Stillgelegt',null,null,null,'76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
-- A voided Anlage is always a corrected successor.
insert into public.installed_equipment(id,organization_id,client_id,site_id,predecessor_equipment_id,equipment_number,name,category,state,voided_at,voided_by,void_reason,created_by,updated_by) values
('76000000-0000-4000-8000-000000000042','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','76000000-0000-4000-8000-000000000041','ANL-2026-0003','Gasbrennwerttherme Irrtum','heat_generation','active',now(),'76000000-0000-4000-8000-000000000001','Irrtum korrigiert','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
insert into public.installed_equipment_identifiers(organization_id,equipment_id,identifier_type,value,created_by) values
('76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000040','serial_number','7712-SN-50%_','76000000-0000-4000-8000-000000000001');
reset app.installed_equipment_write;

set local role service_role;

do $$ declare
  org_id uuid := '76000000-0000-4000-8000-000000000010';
  passed uuid[] := array[
    '76000000-0000-4000-8000-000000000040','76000000-0000-4000-8000-000000000042',
    '76000000-0000-4000-8000-000000000043','76000000-0000-4000-8000-000000000044'
  ]::uuid[];
  signature text;
begin
  foreach signature in array array['public.match_installed_equipment(uuid,uuid[],text)','app_private.installed_equipment_search_matches(uuid,text,uuid[])'] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'assigned equipment search grant mismatch: %',signature; end if;
  end loop;

  -- Only passed, live Anlagen of the organization match; the other job's, the voided and the foreign one never.
  if public.match_installed_equipment(org_id,passed,'gasbrennwerttherme') is distinct from array['76000000-0000-4000-8000-000000000040']::uuid[] then raise exception 'a search matched an Anlage that was not passed, voided or foreign'; end if;
  -- The list's own rule: serial number literally, manufacturer, model, customer and site names, case-insensitive.
  if public.match_installed_equipment(org_id,passed,'7712-sn-50%_') is distinct from array['76000000-0000-4000-8000-000000000040']::uuid[] then raise exception 'serial number search wrong'; end if;
  if public.match_installed_equipment(org_id,passed,'VITODENS') is distinct from array['76000000-0000-4000-8000-000000000040']::uuid[] then raise exception 'model search wrong'; end if;
  if public.match_installed_equipment(org_id,passed,'anl-2026-000') is distinct from array['76000000-0000-4000-8000-000000000040','76000000-0000-4000-8000-000000000044']::uuid[] then raise exception 'number search or archived Anlage wrong'; end if;
  if public.match_installed_equipment(org_id,passed,'wohnanlage lindenhof') is distinct from array['76000000-0000-4000-8000-000000000040','76000000-0000-4000-8000-000000000044']::uuid[] then raise exception 'site search wrong'; end if;
  -- Nothing passed, nothing matched.
  if public.match_installed_equipment(org_id,array[]::uuid[],'keller') is distinct from array[]::uuid[] or public.match_installed_equipment(org_id,null,'keller') is distinct from array[]::uuid[] then raise exception 'an empty id list matched'; end if;
  if public.match_installed_equipment(org_id,passed,'Badsanierung') is distinct from array[]::uuid[] then raise exception 'a search without a match returned an Anlage'; end if;
  -- The office list reads the same rule.
  if public.list_equipment_page(org_id,'7712-sn','all',false,1,50)->'ids' is distinct from jsonb_build_array('76000000-0000-4000-8000-000000000040'::uuid) then raise exception 'the equipment list lost the shared matching rule'; end if;
end $$;

rollback;
