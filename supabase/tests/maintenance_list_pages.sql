-- Service-only page reader of the maintenance workspace: each list (open due
-- work, plans, coverages) searches, counts and pages in the database, more
-- than 1,000 rows stay reachable, the totals are those of the whole
-- organization, a foreign organization neither counts nor matches, and
-- browser roles cannot execute the reader.
-- Runs inside one transaction against the local stack and rolls back.
begin;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('76000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','maintenance-lists-owner@example.test','',now(),'{}','{"first_name":"Wartung","last_name":"Listen"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('76000000-0000-4000-8000-000000000010','Maintenance list pages','76000000-0000-4000-8000-000000000001','MNTLISTA'),
('76000000-0000-4000-8000-000000000011','Other maintenance list pages','76000000-0000-4000-8000-000000000001','MNTLISTB');
insert into public.clients(id,organization_id,name) values
('76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000010','Hauptkunde'),
('76000000-0000-4000-8000-000000000021','76000000-0000-4000-8000-000000000010','Suchkunde Nord'),
('76000000-0000-4000-8000-000000000022','76000000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('76000000-0000-4000-8000-000000000030','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000020','Heizzentrale',true,'76000000-0000-4000-8000-000000000001'),
('76000000-0000-4000-8000-000000000031','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000021','Werkstatt Ost',true,'76000000-0000-4000-8000-000000000001'),
('76000000-0000-4000-8000-000000000032','76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000022','Fremdort',true,'76000000-0000-4000-8000-000000000001');

-- Maintenance rows are written only through their RPCs; the seed bypasses the
-- write guards and validation triggers, so every reference is set by hand.
set local session_replication_role = replica;
insert into public.work_templates(id,organization_id,target_type) values
('76000000-0000-4000-8000-000000000040','76000000-0000-4000-8000-000000000010','job'),
('76000000-0000-4000-8000-000000000041','76000000-0000-4000-8000-000000000011','job');
insert into public.work_template_versions(id,organization_id,template_id,version_number,name) values
('76000000-0000-4000-8000-000000000045','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000040',1,'Heizungswartung'),
('76000000-0000-4000-8000-000000000046','76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000041',1,'Fremdwartung');
insert into public.installed_equipment(id,organization_id,client_id,site_id,equipment_number,name,category,state,created_by,updated_by) values
('76000000-0000-4000-8000-000000000050','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','ANL-TAIL','Brennwertkessel','heat_generation','active','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
insert into public.jobs(id,organization_id,created_by,client_id,site_id,job_number,title) values
('76000000-0000-4000-8000-000000000060','76000000-0000-4000-8000-000000000010','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','AUF-2026-0777','Wartungsbesuch');

-- Plans: 1,051 rows, plan n changed n minutes after the base. Plan 1049 sits
-- at the second customer, plan 1050 has no current revision and is never
-- listed, and plan 1051 covers the equipment ANL-TAIL.
insert into public.maintenance_plans(id,organization_id,plan_number,client_id,site_id,status,current_revision_id,created_by,updated_by,updated_at)
select md5('mt-plan-'||number)::uuid,'76000000-0000-4000-8000-000000000010','WPL-'||lpad(number::text,4,'0'),
  case when number=1049 then '76000000-0000-4000-8000-000000000021' else '76000000-0000-4000-8000-000000000020' end::uuid,
  case when number=1049 then '76000000-0000-4000-8000-000000000031' else '76000000-0000-4000-8000-000000000030' end::uuid,
  'active',case when number<>1050 then md5('mt-revision-'||number)::uuid end,
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',
  '2026-01-01T00:00:00Z'::timestamptz + number * interval '1 minute'
from generate_series(1,1051) number;
insert into public.maintenance_plan_revisions(id,organization_id,maintenance_plan_id,revision_number,template_version_id,effective_from_date,first_due_date,interval_months,planned_duration_minutes,next_due_basis,reason,created_by)
select md5('mt-revision-'||number)::uuid,'76000000-0000-4000-8000-000000000010',md5('mt-plan-'||number)::uuid,1,
  '76000000-0000-4000-8000-000000000045','2026-01-01','2026-01-01',12,120,'planned_due_date','Erstanlage','76000000-0000-4000-8000-000000000001'
from generate_series(1,1051) number;
insert into public.maintenance_plan_revision_equipment(organization_id,maintenance_plan_revision_id,equipment_id,created_by) values
('76000000-0000-4000-8000-000000000010',md5('mt-revision-1051')::uuid,'76000000-0000-4000-8000-000000000050','76000000-0000-4000-8000-000000000001');

-- Due work: plan n is due n days after the base. Plan 7's item has a visit
-- job; plan 1 also has a completed item and an item past the horizon.
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,job_id,created_by,updated_by)
select md5('mt-due-'||number)::uuid,'76000000-0000-4000-8000-000000000010',md5('mt-plan-'||number)::uuid,md5('mt-revision-'||number)::uuid,
  date '2026-01-01' + number,date '2026-01-01' + number,date '2026-01-01' + number,date '2026-01-01' + number,
  (case when number=7 then 'visit_created' else 'open' end)::public.maintenance_due_status,
  case when number=7 then '76000000-0000-4000-8000-000000000060'::uuid end,
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001'
from generate_series(1,1051) number;
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,scope_outcome,completed_on,created_by,updated_by) values
('76000000-0000-4000-8000-000000000070','76000000-0000-4000-8000-000000000010',md5('mt-plan-1')::uuid,md5('mt-revision-1')::uuid,'2025-06-01','2025-06-01','2025-06-01','2025-06-01','completed','complete','2025-06-01','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,created_by,updated_by) values
('76000000-0000-4000-8000-000000000071','76000000-0000-4000-8000-000000000010',md5('mt-plan-1')::uuid,md5('mt-revision-1')::uuid,'2031-01-01','2031-01-01','2031-01-01','2031-01-01','open','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');

-- Coverages: 1,051 rows, coverage n changed n minutes after the base.
-- Coverage 1049 sits at the second customer, coverage 1051 has a literal
-- `50%_` reference.
insert into public.maintenance_coverages(id,organization_id,coverage_number,client_id,site_id,reference,created_by,updated_by,updated_at)
select md5('mt-coverage-'||number)::uuid,'76000000-0000-4000-8000-000000000010','WDV-'||lpad(number::text,4,'0'),
  case when number=1049 then '76000000-0000-4000-8000-000000000021' else '76000000-0000-4000-8000-000000000020' end::uuid,
  case when number=1049 then '76000000-0000-4000-8000-000000000031' else '76000000-0000-4000-8000-000000000030' end::uuid,
  case when number=1051 then 'Rahmenvertrag 50%_' end,
  '76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001',
  '2026-01-01T00:00:00Z'::timestamptz + number * interval '1 minute'
from generate_series(1,1051) number;

-- The foreign organization: one plan, one due item, one coverage.
insert into public.maintenance_plans(id,organization_id,plan_number,client_id,site_id,status,current_revision_id,created_by,updated_by) values
('76000000-0000-4000-8000-000000000080','76000000-0000-4000-8000-000000000011','WPL-FREMD','76000000-0000-4000-8000-000000000022','76000000-0000-4000-8000-000000000032','active','76000000-0000-4000-8000-000000000081','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
insert into public.maintenance_plan_revisions(id,organization_id,maintenance_plan_id,revision_number,template_version_id,effective_from_date,first_due_date,interval_months,planned_duration_minutes,next_due_basis,reason,created_by) values
('76000000-0000-4000-8000-000000000081','76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000080',1,'76000000-0000-4000-8000-000000000046','2026-01-01','2026-01-01',12,120,'planned_due_date','Erstanlage','76000000-0000-4000-8000-000000000001');
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,created_by,updated_by) values
('76000000-0000-4000-8000-000000000082','76000000-0000-4000-8000-000000000011','76000000-0000-4000-8000-000000000080','76000000-0000-4000-8000-000000000081','2026-02-01','2026-02-01','2026-02-01','2026-02-01','open','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
insert into public.maintenance_coverages(id,organization_id,coverage_number,client_id,site_id,created_by,updated_by) values
('76000000-0000-4000-8000-000000000083','76000000-0000-4000-8000-000000000011','WDV-FREMD','76000000-0000-4000-8000-000000000022','76000000-0000-4000-8000-000000000032','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001');
set local session_replication_role = origin;

set local role service_role;

do $$ declare
  org_id uuid := '76000000-0000-4000-8000-000000000010';
  through date := '2030-01-01';
  result jsonb; next_result jsonb;
  signature text := 'public.list_maintenance_workspace_page(uuid,date,text,integer,integer,integer,integer)';
begin
  if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute') or not has_function_privilege('service_role',signature,'execute') then raise exception 'maintenance page RPC grant mismatch'; end if;

  -- Totals are those of the organization, not of a page.
  result := public.list_maintenance_workspace_page(org_id,through);
  if (result#>>'{due,total}')::int<>1050 or jsonb_array_length(result#>'{due,ids}')<>50 or not (result#>>'{due,hasAny}')::boolean then raise exception 'due first page or total wrong: %',result#>>'{due,total}'; end if;
  if (result#>>'{plans,total}')::int<>1050 or jsonb_array_length(result#>'{plans,ids}')<>50 or not (result#>>'{plans,hasAny}')::boolean then raise exception 'plan first page or total wrong: %',result#>>'{plans,total}'; end if;
  if (result#>>'{coverages,total}')::int<>1051 or jsonb_array_length(result#>'{coverages,ids}')<>50 or not (result#>>'{coverages,hasAny}')::boolean then raise exception 'coverage first page or total wrong: %',result#>>'{coverages,total}'; end if;
  -- Due work: earliest first; plans and coverages: newest change first.
  if exists(select 1 from jsonb_array_elements_text(result#>'{due,ids}') with ordinality listed(id,position) where id<>md5('mt-due-'||position)::uuid::text) then raise exception 'due page is not earliest first'; end if;
  if exists(select 1 from jsonb_array_elements_text(result#>'{plans,ids}') with ordinality listed(id,position) where id<>md5('mt-plan-'||(case when position=1 then 1051 else 1051-position end))::uuid::text) then raise exception 'plan page is not newest first'; end if;
  if exists(select 1 from jsonb_array_elements_text(result#>'{coverages,ids}') with ordinality listed(id,position) where id<>md5('mt-coverage-'||(1052-position))::uuid::text) then raise exception 'coverage page is not newest first'; end if;
  -- Each list pages on its own, and consecutive pages do not overlap.
  next_result := public.list_maintenance_workspace_page(org_id,through,'',2,1,1);
  if exists(select 1 from jsonb_array_elements(result#>'{due,ids}') a join jsonb_array_elements(next_result#>'{due,ids}') b on a=b) then raise exception 'due pages overlap'; end if;
  if next_result->'plans'<>result->'plans' or next_result->'coverages'<>result->'coverages' then raise exception 'the due page moved another list'; end if;
  -- The tails beyond 1,000 rows stay reachable.
  result := public.list_maintenance_workspace_page(org_id,through,'',21,21,22);
  if jsonb_array_length(result#>'{due,ids}')<>50 or result#>>'{due,ids,49}'<>md5('mt-due-1051')::uuid::text then raise exception 'due tail beyond 1,000 rows unreachable'; end if;
  if jsonb_array_length(result#>'{plans,ids}')<>50 or result#>>'{plans,ids,49}'<>md5('mt-plan-1')::uuid::text then raise exception 'plan tail beyond 1,000 rows unreachable'; end if;
  if result#>'{coverages,ids}'<>jsonb_build_array(md5('mt-coverage-1')::uuid) then raise exception 'coverage tail beyond 1,000 rows unreachable'; end if;
  -- Completed work, work past the horizon and a plan without a revision never list.
  if (select count(*) from generate_series(1,21) page_number, jsonb_array_elements_text(public.list_maintenance_workspace_page(org_id,through,'',page_number)#>'{due,ids}') listed(id)
      where id in ('76000000-0000-4000-8000-000000000070','76000000-0000-4000-8000-000000000071',md5('mt-due-1050')::uuid::text))<>0 then raise exception 'unlisted due work is listed'; end if;
  if (public.list_maintenance_workspace_page(org_id,'2026-01-10')#>>'{due,total}')::int<>9 then raise exception 'the due horizon is not applied'; end if;
  if (public.list_maintenance_workspace_page(org_id,through,'wpl-1050')#>>'{plans,total}')::int<>0 then raise exception 'a plan without a current revision is listed'; end if;

  -- Search: customer and site match in every list; the template name matches
  -- plans only, the visit job number due work only, the equipment both.
  result := public.list_maintenance_workspace_page(org_id,through,'suchkunde nord');
  if result#>'{due,ids}'<>jsonb_build_array(md5('mt-due-1049')::uuid) or result#>'{plans,ids}'<>jsonb_build_array(md5('mt-plan-1049')::uuid) or result#>'{coverages,ids}'<>jsonb_build_array(md5('mt-coverage-1049')::uuid) then raise exception 'customer search wrong'; end if;
  result := public.list_maintenance_workspace_page(org_id,through,'werkstatt ost');
  if (result#>>'{due,total}')::int<>1 or (result#>>'{plans,total}')::int<>1 or (result#>>'{coverages,total}')::int<>1 then raise exception 'site search wrong'; end if;
  result := public.list_maintenance_workspace_page(org_id,through,'heizungswartung');
  if (result#>>'{plans,total}')::int<>1050 or (result#>>'{due,total}')::int<>0 or not (result#>>'{due,hasAny}')::boolean then raise exception 'template search wrong'; end if;
  result := public.list_maintenance_workspace_page(org_id,through,'AUF-2026-0777');
  if result#>'{due,ids}'<>jsonb_build_array(md5('mt-due-7')::uuid) or (result#>>'{plans,total}')::int<>0 then raise exception 'visit job search wrong'; end if;
  result := public.list_maintenance_workspace_page(org_id,through,'anl-tail');
  if result#>'{due,ids}'<>jsonb_build_array(md5('mt-due-1051')::uuid) or result#>'{plans,ids}'<>jsonb_build_array(md5('mt-plan-1051')::uuid) then raise exception 'equipment search wrong'; end if;
  result := public.list_maintenance_workspace_page(org_id,through,'50%_');
  if result#>'{coverages,ids}'<>jsonb_build_array(md5('mt-coverage-1051')::uuid) or (result#>>'{plans,total}')::int<>0 then raise exception 'literal coverage reference search wrong'; end if;

  -- Bounds: at most 100 rows, at least one row, never a page before the first, empty past the end.
  if jsonb_array_length(public.list_maintenance_workspace_page(org_id,through,'',1,1,1,100000)#>'{plans,ids}')<>100 then raise exception 'page size is not capped at 100'; end if;
  if jsonb_array_length(public.list_maintenance_workspace_page(org_id,through,'',1,1,1,0)#>'{coverages,ids}')<>1 then raise exception 'page size has no lower bound'; end if;
  if public.list_maintenance_workspace_page(org_id,through,'',-3)#>>'{due,ids,0}'<>md5('mt-due-1')::uuid::text then raise exception 'page number has no lower bound'; end if;
  result := public.list_maintenance_workspace_page(org_id,through,'',2147483647,2147483647,2147483647,100);
  if (result#>>'{due,total}')::int<>1050 or result#>'{due,ids}'<>'[]'::jsonb or result#>'{plans,ids}'<>'[]'::jsonb or result#>'{coverages,ids}'<>'[]'::jsonb then raise exception 'page past the end is not empty'; end if;

  -- Tenant isolation and an organization without maintenance.
  result := public.list_maintenance_workspace_page(org_id,through,'fremd');
  if (result#>>'{due,total}')::int<>0 or (result#>>'{plans,total}')::int<>0 or (result#>>'{coverages,total}')::int<>0 then raise exception 'maintenance tenant leaked'; end if;
  result := public.list_maintenance_workspace_page('76000000-0000-4000-8000-000000000011',through);
  if result#>'{due,ids}'<>jsonb_build_array('76000000-0000-4000-8000-000000000082'::uuid)
    or result#>'{plans,ids}'<>jsonb_build_array('76000000-0000-4000-8000-000000000080'::uuid)
    or result#>'{coverages,ids}'<>jsonb_build_array('76000000-0000-4000-8000-000000000083'::uuid) then raise exception 'foreign organization page wrong'; end if;
  result := public.list_maintenance_workspace_page('76000000-0000-4000-8000-000000000012',through);
  if (result#>>'{due,hasAny}')::boolean or (result#>>'{plans,hasAny}')::boolean or (result#>>'{coverages,hasAny}')::boolean or (result#>>'{plans,total}')::int<>0 then raise exception 'empty organization reports maintenance'; end if;
end $$;

-- Identical change timestamps keep a deterministic identity order across the page boundary.
reset role;
set local session_replication_role = replica;
insert into public.maintenance_coverages(id,organization_id,coverage_number,client_id,site_id,reference,created_by,updated_by,updated_at) values
('76000000-0000-4000-8000-000000000092','76000000-0000-4000-8000-000000000010','WDV-SAME-B','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','Gleichzeitig B','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','2027-01-01'),
('76000000-0000-4000-8000-000000000091','76000000-0000-4000-8000-000000000010','WDV-SAME-A','76000000-0000-4000-8000-000000000020','76000000-0000-4000-8000-000000000030','Gleichzeitig A','76000000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','2027-01-01');
set local session_replication_role = origin;
set local role service_role;
do $$ begin
  if public.list_maintenance_workspace_page('76000000-0000-4000-8000-000000000010','2030-01-01','gleichzeitig',1,1,1,1)#>'{coverages,ids}'<>jsonb_build_array('76000000-0000-4000-8000-000000000091'::uuid)
    or public.list_maintenance_workspace_page('76000000-0000-4000-8000-000000000010','2030-01-01','gleichzeitig',1,1,2,1)#>'{coverages,ids}'<>jsonb_build_array('76000000-0000-4000-8000-000000000092'::uuid) then
    raise exception 'identical change timestamps lost the id order';
  end if;
end $$;

-- A browser session cannot execute the reader, even for its own organization.
reset role;
set local role authenticated;
do $$ begin
  perform public.list_maintenance_workspace_page('76000000-0000-4000-8000-000000000010','2030-01-01');
  raise exception 'authenticated executed list_maintenance_workspace_page';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role anon;
do $$ begin
  perform public.list_maintenance_workspace_page('76000000-0000-4000-8000-000000000010','2030-01-01');
  raise exception 'anon executed list_maintenance_workspace_page';
exception when insufficient_privilege then null;
end $$;
reset role;
rollback;
