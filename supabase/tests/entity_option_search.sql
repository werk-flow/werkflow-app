-- Service-only entity searches of the pickers: projects, clock jobs, inventory
-- items, service cases and coverages. Each searches the whole organization in
-- the database and returns one page with a continuation, more than 1,000 rows
-- stay reachable in natural number order, filters apply before the page
-- boundary, `%` and `_` match literally, a foreign organization neither counts
-- nor matches, and browser roles cannot execute the readers.
-- Runs inside one transaction against the local stack and rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('78000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','options-owner@example.test','',now(),'{}','{"first_name":"Optionen","last_name":"Inhaber"}',now(),now()),
('78000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','options-worker@example.test','',now(),'{}','{"first_name":"Optionen","last_name":"Monteur"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('78000000-0000-4000-8000-000000000010','Entity options','78000000-0000-4000-8000-000000000001','OPTSQLA'),
('78000000-0000-4000-8000-000000000011','Other entity options','78000000-0000-4000-8000-000000000001','OPTSQLB');
insert into public.organization_members(organization_id,user_id,role) values
('78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000002','employee');
insert into public.clients(id,organization_id,name) values
('78000000-0000-4000-8000-000000000020','78000000-0000-4000-8000-000000000010','Hauptkunde'),
('78000000-0000-4000-8000-000000000021','78000000-0000-4000-8000-000000000010','Nebenkunde 50%_'),
('78000000-0000-4000-8000-000000000022','78000000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('78000000-0000-4000-8000-000000000030','78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000020','Heizzentrale',true,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000031','78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000021','Werkstatt',true,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000032','78000000-0000-4000-8000-000000000011','78000000-0000-4000-8000-000000000022','Fremdort',true,'78000000-0000-4000-8000-000000000001');

set local session_replication_role = replica;

-- Projects: PRJ-2026-1 .. PRJ-2026-1051 of the main customer; project 1051
-- has three finished jobs (closed), project 1050 one open job, project 1049 an
-- override `abgeschlossen`, project 1048 belongs to the second customer, and
-- one project carries no number. The foreign organization holds PRJ-2026-9999.
insert into public.projects(id,organization_id,name,project_number,client_id,created_by)
select md5('opt-project-'||n)::uuid,'78000000-0000-4000-8000-000000000010','Projekt '||n,'PRJ-2026-'||n,
  case when n=1048 then '78000000-0000-4000-8000-000000000021' else '78000000-0000-4000-8000-000000000020' end::uuid,
  '78000000-0000-4000-8000-000000000001'
from generate_series(1,1051) n;
update public.projects set status_override='abgeschlossen' where id=md5('opt-project-1049')::uuid;
update public.projects set site_id='78000000-0000-4000-8000-000000000030' where id=md5('opt-project-1047')::uuid;
insert into public.projects(id,organization_id,name,project_number,created_by) values
('78000000-0000-4000-8000-000000000040','78000000-0000-4000-8000-000000000010','Ohne Nummer',null,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000041','78000000-0000-4000-8000-000000000011','Fremdprojekt','PRJ-2026-9999','78000000-0000-4000-8000-000000000001');

-- Jobs: JOB-1 .. JOB-1051 open and unassigned; job 1 and job 2 are assigned
-- to the worker, job 2 has the worker's visit today and job 3 a visit of
-- another day; job 1051 is finished. Project jobs carry the counts above.
insert into public.jobs(id,organization_id,title,job_number,client_id,status,created_by)
select md5('opt-job-'||n)::uuid,'78000000-0000-4000-8000-000000000010','Auftrag '||lpad(n::text,4,'0'),'AUF-2026-'||n,
  '78000000-0000-4000-8000-000000000020',(case when n=1051 then 'fertig' else 'nicht_bearbeitet' end)::public.job_status,
  '78000000-0000-4000-8000-000000000001'
from generate_series(1,1051) n;
insert into public.jobs(id,organization_id,title,job_number,project_id,status,created_by)
select md5('opt-project-job-'||n)::uuid,'78000000-0000-4000-8000-000000000010','Projektarbeit '||n,'PJ-'||n,
  case when n<=3 then md5('opt-project-1051')::uuid else md5('opt-project-1050')::uuid end,
  (case when n<=3 then 'fertig' else 'nicht_bearbeitet' end)::public.job_status,'78000000-0000-4000-8000-000000000001'
from generate_series(1,4) n;
insert into public.jobs(id,organization_id,title,job_number,status,created_by) values
('78000000-0000-4000-8000-000000000050','78000000-0000-4000-8000-000000000011','Fremdauftrag Auftrag','AUF-2026-1','nicht_bearbeitet','78000000-0000-4000-8000-000000000001');
insert into public.job_assignments(organization_id,job_id,user_id,assigned_by) values
('78000000-0000-4000-8000-000000000010',md5('opt-job-1')::uuid,'78000000-0000-4000-8000-000000000002','78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000010',md5('opt-job-2')::uuid,'78000000-0000-4000-8000-000000000002','78000000-0000-4000-8000-000000000001');
-- The membership created the worker's employee record; 0061 is a record without a login.
insert into public.employee_records(id,organization_id,user_id) values
('78000000-0000-4000-8000-000000000061','78000000-0000-4000-8000-000000000010',null);
insert into public.planning_occurrences(id,organization_id,job_id,entry_kind,time_kind,status,start_at,end_at) values
('78000000-0000-4000-8000-000000000070','78000000-0000-4000-8000-000000000010',md5('opt-job-2')::uuid,'job_visit','timed','scheduled','2026-10-09T08:00:00Z','2026-10-09T10:00:00Z'),
('78000000-0000-4000-8000-000000000071','78000000-0000-4000-8000-000000000010',md5('opt-job-3')::uuid,'job_visit','timed','scheduled','2026-10-10T08:00:00Z','2026-10-10T10:00:00Z'),
('78000000-0000-4000-8000-000000000072','78000000-0000-4000-8000-000000000010',md5('opt-job-4')::uuid,'job_visit','timed','scheduled','2026-10-09T08:00:00Z','2026-10-09T10:00:00Z');
insert into public.planning_occurrences(id,organization_id,job_id,entry_kind,time_kind,status,start_date,end_date_exclusive) values
('78000000-0000-4000-8000-000000000073','78000000-0000-4000-8000-000000000010',md5('opt-job-5')::uuid,'job_visit','all_day','scheduled','2026-10-08','2026-10-10');
insert into public.planning_occurrence_assignments(organization_id,occurrence_id,employee_record_id) values
('78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000070',(select id from public.employee_records where organization_id='78000000-0000-4000-8000-000000000010' and user_id='78000000-0000-4000-8000-000000000002')),
('78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000071',(select id from public.employee_records where organization_id='78000000-0000-4000-8000-000000000010' and user_id='78000000-0000-4000-8000-000000000002')),
('78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000072','78000000-0000-4000-8000-000000000061'),
('78000000-0000-4000-8000-000000000010','78000000-0000-4000-8000-000000000073',(select id from public.employee_records where organization_id='78000000-0000-4000-8000-000000000010' and user_id='78000000-0000-4000-8000-000000000002'));

-- Inventory: 1,105 active items, one inactive, one with a literal `50%_`
-- name, one found only by its barcode; one foreign item.
insert into public.inventory_items(id,organization_id,name,item_type,unit,created_by)
select md5('opt-item-'||n)::uuid,'78000000-0000-4000-8000-000000000010','Artikel '||lpad(n::text,4,'0'),'material','piece','78000000-0000-4000-8000-000000000001'
from generate_series(1,1105) n;
insert into public.inventory_items(id,organization_id,name,item_type,unit,is_active,is_billable,internal_sku,created_by) values
('78000000-0000-4000-8000-000000000080','78000000-0000-4000-8000-000000000010','Inaktiver Artikel','material','piece',false,true,null,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000081','78000000-0000-4000-8000-000000000010','Rabatt 50%_ Ventil','material','meter',true,false,'SKU-81','78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000082','78000000-0000-4000-8000-000000000010','Rabatt 500 Ventil','material','piece',true,true,null,'78000000-0000-4000-8000-000000000001'),
('78000000-0000-4000-8000-000000000083','78000000-0000-4000-8000-000000000011','Fremdartikel','material','piece',true,true,null,'78000000-0000-4000-8000-000000000001');
insert into public.inventory_item_barcodes(organization_id,item_id,barcode_type,barcode_value) values
('78000000-0000-4000-8000-000000000010',md5('opt-item-7')::uuid,'ean','4001234567890');

-- Service cases: SRV-2026-1 .. 1051 at the main customer's site; case 1051
-- is resolved, case 1050 sits at the second customer.
insert into public.service_cases(id,organization_id,case_number,intake_type,client_id,site_id,original_statement,summary,status,resolution_note,created_by,updated_by)
select md5('opt-case-'||n)::uuid,'78000000-0000-4000-8000-000000000010','SRV-2026-'||n,'direct',
  case when n=1050 then '78000000-0000-4000-8000-000000000021' else '78000000-0000-4000-8000-000000000020' end::uuid,
  case when n=1050 then '78000000-0000-4000-8000-000000000031' else '78000000-0000-4000-8000-000000000030' end::uuid,
  'Meldung','Störung '||n,(case when n=1051 then 'resolved' else 'new' end)::public.service_case_status,case when n=1051 then 'Erledigt' end,
  '78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001'
from generate_series(1,1051) n;
insert into public.service_cases(id,organization_id,case_number,intake_type,client_id,site_id,original_statement,summary,created_by,updated_by) values
('78000000-0000-4000-8000-000000000090','78000000-0000-4000-8000-000000000011','SRV-2026-1','direct','78000000-0000-4000-8000-000000000022','78000000-0000-4000-8000-000000000032','Meldung','Fremde Störung','78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001');

-- Coverages: WDV-2026-1 .. 1051 at the main customer's site, coverage 1050 at
-- the second customer, coverage 1049 with a literal `50%_` reference.
insert into public.maintenance_coverages(id,organization_id,coverage_number,client_id,site_id,reference,created_by,updated_by)
select md5('opt-coverage-'||n)::uuid,'78000000-0000-4000-8000-000000000010','WDV-2026-'||n,
  case when n=1050 then '78000000-0000-4000-8000-000000000021' else '78000000-0000-4000-8000-000000000020' end::uuid,
  case when n=1050 then '78000000-0000-4000-8000-000000000031' else '78000000-0000-4000-8000-000000000030' end::uuid,
  case when n=1049 then 'Vertrag 50%_' when n=1048 then 'Vertrag 500' end,
  '78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001'
from generate_series(1,1051) n;
insert into public.maintenance_coverages(id,organization_id,coverage_number,client_id,site_id,created_by,updated_by) values
('78000000-0000-4000-8000-000000000095','78000000-0000-4000-8000-000000000011','WDV-2026-1','78000000-0000-4000-8000-000000000022','78000000-0000-4000-8000-000000000032','78000000-0000-4000-8000-000000000001','78000000-0000-4000-8000-000000000001');
set local session_replication_role = origin;

do $$ declare
  org uuid := '78000000-0000-4000-8000-000000000010';
  owner_id uuid := '78000000-0000-4000-8000-000000000001';
  worker uuid := '78000000-0000-4000-8000-000000000002';
  result jsonb; signature text; offset_value integer; seen integer := 0;
begin
  foreach signature in array array[
    'public.search_project_options(uuid,text,uuid,boolean,integer,uuid)',
    'public.search_clock_job_options(uuid,uuid,boolean,date,timestamptz,timestamptz,text,integer,uuid)',
    'public.search_inventory_item_options(uuid,text,integer)',
    'public.search_service_case_options(uuid,text,uuid,uuid,boolean,integer)',
    'public.search_coverage_options(uuid,text,uuid,uuid,integer)'
  ] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then
      raise exception 'option search grant mismatch: %',signature;
    end if;
  end loop;

  -- Projects: newest number first across the page boundary, the unnumbered last.
  result := public.search_project_options(org,'',null,false,0);
  if jsonb_array_length(result->'options')<>50 or not (result->>'hasMore')::boolean
    or result#>>'{options,0,projectNumber}'<>'PRJ-2026-1051' or result#>>'{options,49,projectNumber}'<>'PRJ-2026-1002' then
    raise exception 'project first page wrong: %',result#>>'{options,0,projectNumber}';
  end if;
  if result#>>'{options,0,clientName}'<>'Hauptkunde' or (result#>>'{options,0,jobCount}')::int<>3
    or (result#>>'{options,0,completedJobCount}')::int<>3 then raise exception 'project counts or customer lost'; end if;
  result := public.search_project_options(org,'',null,false,1050);
  if jsonb_array_length(result->'options')<>2 or (result->>'hasMore')::boolean
    or result#>>'{options,0,projectNumber}'<>'PRJ-2026-1' or result#>>'{options,1,name}'<>'Ohne Nummer' then
    raise exception 'project last page wrong: %',result->'options';
  end if;
  -- Open only: the closed project 1051 and the override 1049 drop before the page boundary.
  result := public.search_project_options(org,'',null,true,0);
  if jsonb_array_length(result->'options')<>50 or result#>>'{options,0,projectNumber}'<>'PRJ-2026-1050'
    or result#>>'{options,1,projectNumber}'<>'PRJ-2026-1048' then raise exception 'open projects wrong'; end if;
  -- Customer filter keeps projects without a customer and drops the other customer's.
  result := public.search_project_options(org,'',  '78000000-0000-4000-8000-000000000021',false,0);
  if jsonb_array_length(result->'options')<>2 or result#>>'{options,0,projectNumber}'<>'PRJ-2026-1048'
    or result#>>'{options,1,name}'<>'Ohne Nummer' then raise exception 'project customer filter wrong'; end if;
  result := public.search_project_options(org,'nebenkunde 50%_',null,false,0);
  if jsonb_array_length(result->'options')<>1 then raise exception 'project search by customer name failed'; end if;
  -- A site filter keeps only the projects at that site.
  result := public.search_project_options(org,'',null,false,0,'78000000-0000-4000-8000-000000000030');
  if jsonb_array_length(result->'options')<>1 or result#>>'{options,0,siteId}'<>'78000000-0000-4000-8000-000000000030' then raise exception 'project site filter wrong'; end if;
  result := public.search_project_options(org,'9999',null,false,0);
  if jsonb_array_length(result->'options')<>0 then raise exception 'project search leaked a foreign project'; end if;

  -- Clock jobs: the worker sees the assigned jobs, today's own visit first.
  result := public.search_clock_job_options(org,worker,false,'2026-10-09','2026-10-08T22:00:00Z','2026-10-09T22:00:00Z','',50,null);
  if jsonb_array_length(result->'options')<>2 or result#>>'{options,0,jobNumber}'<>'AUF-2026-2'
    or not (result#>>'{options,0,plannedToday}')::boolean or (result#>>'{options,1,plannedToday}')::boolean then
    raise exception 'worker clock jobs wrong: %',result->'options';
  end if;
  -- A manager sees every open job; own all-day and timed visits rank first, another worker's visit and another day do not.
  result := public.search_clock_job_options(org,worker,true,'2026-10-09','2026-10-08T22:00:00Z','2026-10-09T22:00:00Z','',50,null);
  if result#>>'{options,0,jobNumber}'<>'AUF-2026-2' or result#>>'{options,1,jobNumber}'<>'AUF-2026-5'
    or (result#>>'{options,2,plannedToday}')::boolean or not (result->>'hasMore')::boolean then
    raise exception 'manager clock ranking wrong: %',result->'options'->0;
  end if;
  result := public.search_clock_job_options(org,worker,true,'2026-10-09','2026-10-08T22:00:00Z','2026-10-09T22:00:00Z','',1000,null);
  if jsonb_array_length(result->'options')<>1000 or not (result->>'hasMore')::boolean then raise exception 'clock limit wrong'; end if;
  result := public.search_clock_job_options(org,worker,true,'2026-10-09','2026-10-08T22:00:00Z','2026-10-09T22:00:00Z','AUF-2026-1051',50,md5('opt-job-1051')::uuid);
  if jsonb_array_length(result->'options')<>0 or result#>>'{selected,jobNumber}'<>'AUF-2026-1051' then
    raise exception 'finished job listed or selected job lost';
  end if;
  result := public.search_clock_job_options(org,worker,false,'2026-10-09','2026-10-08T22:00:00Z','2026-10-09T22:00:00Z','',50,md5('opt-job-9')::uuid);
  if result->'selected'<>'null'::jsonb then raise exception 'worker sees an unassigned selected job'; end if;
  result := public.search_clock_job_options(org,worker,true,'2026-10-09','2026-10-08T22:00:00Z','2026-10-09T22:00:00Z','fremdauftrag',50,null);
  if jsonb_array_length(result->'options')<>0 then raise exception 'clock search leaked a foreign job'; end if;

  -- Inventory: name order, inactive excluded, literal `%_`, barcode, more than 1,000 reachable.
  result := public.search_inventory_item_options(org,'',0);
  if jsonb_array_length(result->'options')<>50 or not (result->>'hasMore')::boolean or result#>>'{options,0,name}'<>'Artikel 0001' then
    raise exception 'inventory first page wrong';
  end if;
  result := public.search_inventory_item_options(org,'',1100);
  if jsonb_array_length(result->'options')<>7 or (result->>'hasMore')::boolean then
    raise exception 'inventory last page wrong: %',result->'options';
  end if;
  result := public.search_inventory_item_options(org,'50%_',0);
  if jsonb_array_length(result->'options')<>1 or result#>>'{options,0,unit}'<>'meter' or (result#>>'{options,0,isBillable}')::boolean
    or result#>>'{options,0,internalSku}'<>'SKU-81' then raise exception 'inventory literal search wrong'; end if;
  result := public.search_inventory_item_options(org,'4001234',0);
  if jsonb_array_length(result->'options')<>1 or result#>>'{options,0,name}'<>'Artikel 0007' then raise exception 'barcode search failed'; end if;
  result := public.search_inventory_item_options(org,'artikel',0);
  if exists(select 1 from jsonb_array_elements(result->'options') option where option->>'name' in ('Inaktiver Artikel','Fremdartikel')) then
    raise exception 'inactive or foreign item listed';
  end if;

  -- Service cases: natural number order across the page boundary.
  result := public.search_service_case_options(org,'',null,null,false,0);
  if jsonb_array_length(result->'options')<>50 or result#>>'{options,0,caseNumber}'<>'SRV-2026-1'
    or result#>>'{options,49,caseNumber}'<>'SRV-2026-50' then raise exception 'case first page wrong'; end if;
  for offset_value in 0..1050 by 50 loop
    result := public.search_service_case_options(org,'',null,null,false,offset_value);
    seen := seen + jsonb_array_length(result->'options');
  end loop;
  if seen<>1051 then raise exception 'cases unreachable: %',seen; end if;
  result := public.search_service_case_options(org,'',null,null,false,1000);
  if result#>>'{options,0,caseNumber}'<>'SRV-2026-1001' or result#>>'{options,49,caseNumber}'<>'SRV-2026-1050' or not (result->>'hasMore')::boolean then
    raise exception 'case natural order wrong at the boundary';
  end if;
  result := public.search_service_case_options(org,'','78000000-0000-4000-8000-000000000020','78000000-0000-4000-8000-000000000030',true,1000);
  if jsonb_array_length(result->'options')<>49 or result#>>'{options,48,caseNumber}'<>'SRV-2026-1049' then
    raise exception 'case customer, site or open filter wrong';
  end if;
  result := public.search_service_case_options(org,'störung 105',null,null,false,0);
  if jsonb_array_length(result->'options')<>3 then raise exception 'case search wrong'; end if;

  -- Coverages: customer and site filter, literal search, no foreign rows.
  result := public.search_coverage_options(org,'','78000000-0000-4000-8000-000000000021','78000000-0000-4000-8000-000000000031',0);
  if jsonb_array_length(result->'options')<>1 or result#>>'{options,0,coverageNumber}'<>'WDV-2026-1050' then
    raise exception 'coverage filter wrong';
  end if;
  result := public.search_coverage_options(org,'50%_',null,null,0);
  if jsonb_array_length(result->'options')<>1 or result#>>'{options,0,coverageNumber}'<>'WDV-2026-1049' then
    raise exception 'coverage literal search wrong';
  end if;
  result := public.search_coverage_options(org,'',null,null,1001);
  if jsonb_array_length(result->'options')<>50 or (result->>'hasMore')::boolean or result#>>'{options,49,coverageNumber}'<>'WDV-2026-1051' then
    raise exception 'coverage last page wrong';
  end if;
  result := public.search_coverage_options('78000000-0000-4000-8000-000000000011','',null,null,0);
  if jsonb_array_length(result->'options')<>1 then raise exception 'coverage tenant scope wrong'; end if;
end $$;

-- A browser role cannot call a reader at all.
set local role authenticated;
do $$ begin
  perform public.search_project_options('78000000-0000-4000-8000-000000000010');
  raise exception 'authenticated executed search_project_options';
exception when insufficient_privilege then null;
end $$;
reset role;
rollback;
