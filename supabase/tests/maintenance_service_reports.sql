-- A completed maintenance visit gives a filed Servicebericht
-- (migration 20261219113104_file_a_service_report_for_a_completed_visit.sql):
-- * The report registers a filed PDF document of category report without a
--   retention class, linked to the visit job, the visit's Anlage and the
--   customer, with its audit event and report number 1.
-- * A retry of the same report id answers with it; a regenerated report is a
--   new document and report number 2 that names the first; a report that does
--   not name the latest one is stale. Reports of one job never share a name.
-- * An employee, another organization's admin, another organization's visit
--   and a visit that is not completed are refused; a storage key outside the
--   organization is invalid.
-- Only the service role executes the function; no role rewrites a report.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('47160000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','service-report-admin@example.test','',now(),'{}','{"first_name":"Erika","last_name":"Musterfrau"}',now(),now()),
('47160000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','service-report-employee@example.test','',now(),'{}','{"first_name":"Max","last_name":"Mustermann"}',now(),now()),
('47160000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','service-report-outsider@example.test','',now(),'{}','{"first_name":"Fremd","last_name":"Admin"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('47160000-0000-4000-8000-000000000010','Haustechnik Sonnenberg GmbH','47160000-0000-4000-8000-000000000001','REPORTSA'),
('47160000-0000-4000-8000-000000000011','Fremde Haustechnik','47160000-0000-4000-8000-000000000003','REPORTSB');
insert into public.organization_members(organization_id,user_id,role) values
('47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000002','employee');
insert into public.clients(id,organization_id,name) values
('47160000-0000-4000-8000-000000000020','47160000-0000-4000-8000-000000000010','Hausverwaltung Lindenhof GmbH'),
('47160000-0000-4000-8000-000000000021','47160000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('47160000-0000-4000-8000-000000000030','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000020','Heizzentrale Lindenhof',true,'47160000-0000-4000-8000-000000000001'),
('47160000-0000-4000-8000-000000000031','47160000-0000-4000-8000-000000000011','47160000-0000-4000-8000-000000000021','Fremdort',true,'47160000-0000-4000-8000-000000000003');
insert into public.jobs(id,organization_id,created_by,client_id,site_id,job_number,title) values
('47160000-0000-4000-8000-000000000040','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000001','47160000-0000-4000-8000-000000000020','47160000-0000-4000-8000-000000000030','AUF-REPORT-1','Wartungsbesuch'),
('47160000-0000-4000-8000-000000000049','47160000-0000-4000-8000-000000000011','47160000-0000-4000-8000-000000000003','47160000-0000-4000-8000-000000000021','47160000-0000-4000-8000-000000000031','AUF-REPORT-B','Fremdbesuch');

-- Maintenance rows are written only through their RPCs; the seed bypasses the
-- write guards and validation triggers, so every reference is set by hand.
set local session_replication_role = replica;
insert into public.installed_equipment(id,organization_id,client_id,site_id,equipment_number,name,category,state,created_by,updated_by) values
('47160000-0000-4000-8000-000000000035','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000020','47160000-0000-4000-8000-000000000030','AN-REPORT-1','Gas-Brennwertkessel','heat_generation','active','47160000-0000-4000-8000-000000000001','47160000-0000-4000-8000-000000000001');
insert into public.work_templates(id,organization_id,target_type) values
('47160000-0000-4000-8000-000000000050','47160000-0000-4000-8000-000000000010','job'),
('47160000-0000-4000-8000-000000000051','47160000-0000-4000-8000-000000000011','job');
insert into public.work_template_versions(id,organization_id,template_id,version_number,name) values
('47160000-0000-4000-8000-000000000052','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000050',1,'Heizungswartung'),
('47160000-0000-4000-8000-000000000053','47160000-0000-4000-8000-000000000011','47160000-0000-4000-8000-000000000051',1,'Fremdwartung');
insert into public.maintenance_plans(id,organization_id,plan_number,client_id,site_id,status,current_revision_id,created_by,updated_by) values
('47160000-0000-4000-8000-000000000060','47160000-0000-4000-8000-000000000010','WPL-REPORT','47160000-0000-4000-8000-000000000020','47160000-0000-4000-8000-000000000030','active','47160000-0000-4000-8000-000000000061','47160000-0000-4000-8000-000000000001','47160000-0000-4000-8000-000000000001'),
('47160000-0000-4000-8000-000000000062','47160000-0000-4000-8000-000000000011','WPL-FREMD','47160000-0000-4000-8000-000000000021','47160000-0000-4000-8000-000000000031','active','47160000-0000-4000-8000-000000000063','47160000-0000-4000-8000-000000000003','47160000-0000-4000-8000-000000000003');
insert into public.maintenance_plan_revisions(id,organization_id,maintenance_plan_id,revision_number,template_version_id,effective_from_date,first_due_date,interval_months,due_window_before_days,due_window_after_days,planned_duration_minutes,next_due_basis,reason,created_by) values
('47160000-0000-4000-8000-000000000061','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000060',1,'47160000-0000-4000-8000-000000000052','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Erstanlage','47160000-0000-4000-8000-000000000001'),
('47160000-0000-4000-8000-000000000063','47160000-0000-4000-8000-000000000011','47160000-0000-4000-8000-000000000062',1,'47160000-0000-4000-8000-000000000053','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Erstanlage','47160000-0000-4000-8000-000000000003');
insert into public.maintenance_plan_revision_equipment(organization_id,maintenance_plan_revision_id,equipment_id,created_by) values
('47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000061','47160000-0000-4000-8000-000000000035','47160000-0000-4000-8000-000000000001');
-- D1 and D3 are completed on one visit job, D2 still waits for its visit, DB belongs to the other organization.
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,scope_outcome,completed_on,job_id,version,created_by,updated_by) values
('47160000-0000-4000-8000-000000000071','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000060','47160000-0000-4000-8000-000000000061','2026-01-10','2026-01-10','2025-12-31','2026-01-20','completed','partial','2026-01-12','47160000-0000-4000-8000-000000000040',2,'47160000-0000-4000-8000-000000000001','47160000-0000-4000-8000-000000000001'),
('47160000-0000-4000-8000-000000000072','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000060','47160000-0000-4000-8000-000000000061','2026-03-10','2026-03-10','2026-02-28','2026-03-20','visit_created',null,null,'47160000-0000-4000-8000-000000000040',1,'47160000-0000-4000-8000-000000000001','47160000-0000-4000-8000-000000000001'),
('47160000-0000-4000-8000-000000000073','47160000-0000-4000-8000-000000000010','47160000-0000-4000-8000-000000000060','47160000-0000-4000-8000-000000000061','2026-02-10','2026-02-10','2026-01-31','2026-02-20','completed','complete','2026-01-12','47160000-0000-4000-8000-000000000040',2,'47160000-0000-4000-8000-000000000001','47160000-0000-4000-8000-000000000001'),
('47160000-0000-4000-8000-000000000079','47160000-0000-4000-8000-000000000011','47160000-0000-4000-8000-000000000062','47160000-0000-4000-8000-000000000063','2026-01-10','2026-01-10','2025-12-31','2026-01-20','completed','complete','2026-01-12','47160000-0000-4000-8000-000000000049',2,'47160000-0000-4000-8000-000000000003','47160000-0000-4000-8000-000000000003');
set local session_replication_role = origin;

do $$ declare
  v_function constant text := 'public.register_maintenance_service_report(uuid,uuid,uuid,uuid,uuid,uuid,text,text,bigint)';
  v_role text;
begin
  if has_function_privilege('anon', v_function, 'execute')
     or has_function_privilege('authenticated', v_function, 'execute')
     or not has_function_privilege('service_role', v_function, 'execute') then
    raise exception 'only the service role registers a service report';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(v_role, 'public.maintenance_service_reports', 'update')
       or has_table_privilege(v_role, 'public.maintenance_service_reports', 'delete') then
      raise exception 'service reports can be rewritten by %', v_role;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.maintenance_service_reports', 'select')
     or has_table_privilege('anon', 'public.maintenance_service_reports', 'select') then
    raise exception 'a client role reads service reports';
  end if;
end $$;

set local role service_role;

-- Runs one statement and expects it to fail with the named code.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_code text)
returns void language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if position(p_code in sqlerrm) = 0 then
      raise exception '%: expected %, got %', p_label, p_code, sqlerrm;
    end if;
    return;
  end;
  raise exception '%: expected %, but the statement passed', p_label, p_code;
end;
$$;

-- Registers report p_report (document p_document) of a visit; ids are literal uuids.
create function pg_temp.register(
  p_org text, p_actor text, p_report text, p_due text, p_replaces text, p_document text, p_path_org text
) returns text language sql as $$
  select format(
    'select public.register_maintenance_service_report(%L, %L, %L, %L, %s, %L, %L, %L, 2048)',
    p_org, p_actor, p_report, p_due,
    coalesce(quote_literal(p_replaces) || '::uuid', 'null'), p_document,
    p_path_org || '/service-reports/' || p_due || '/' || p_report || '.pdf',
    'Servicebericht AUF-REPORT-1.pdf'
  );
$$;

do $$ declare
  v_org constant text := '47160000-0000-4000-8000-000000000010';
  v_foreign_org constant text := '47160000-0000-4000-8000-000000000011';
  v_admin constant text := '47160000-0000-4000-8000-000000000001';
  v_employee constant text := '47160000-0000-4000-8000-000000000002';
  v_foreign_admin constant text := '47160000-0000-4000-8000-000000000003';
  v_completed constant text := '47160000-0000-4000-8000-000000000071';
  v_open constant text := '47160000-0000-4000-8000-000000000072';
  v_foreign_due constant text := '47160000-0000-4000-8000-000000000079';
  v_report constant text := '47160000-0000-4000-8000-000000000081';
  v_document constant text := '47160000-0000-4000-8000-000000000091';
begin
  perform pg_temp.expect_refusal('an employee',
    pg_temp.register(v_org, v_employee, v_report, v_completed, null, v_document, v_org), 'not_authorized');
  perform pg_temp.expect_refusal('another organization''s admin',
    pg_temp.register(v_org, v_foreign_admin, v_report, v_completed, null, v_document, v_org), 'not_authorized');
  perform pg_temp.expect_refusal('another organization''s visit',
    pg_temp.register(v_org, v_admin, v_report, v_foreign_due, null, v_document, v_org), 'maintenance_due_not_found');
  perform pg_temp.expect_refusal('a visit not completed',
    pg_temp.register(v_org, v_admin, v_report, v_open, null, v_document, v_org), 'service_report_visit_not_completed');
  perform pg_temp.expect_refusal('a key outside the organization',
    pg_temp.register(v_org, v_admin, v_report, v_completed, null, v_document, v_foreign_org), 'invalid_input');
  if exists (select 1 from public.maintenance_service_reports
             where organization_id = '47160000-0000-4000-8000-000000000010')
     or exists (select 1 from public.documents where id = v_document::uuid) then
    raise exception 'a refused registration wrote rows';
  end if;
end $$;

-- The first report: one PDF document linked to job, Anlage and customer.
select public.register_maintenance_service_report(
  '47160000-0000-4000-8000-000000000010', '47160000-0000-4000-8000-000000000001',
  '47160000-0000-4000-8000-000000000081', '47160000-0000-4000-8000-000000000071', null,
  '47160000-0000-4000-8000-000000000091',
  '47160000-0000-4000-8000-000000000010/service-reports/47160000-0000-4000-8000-000000000071/r1.pdf',
  'Servicebericht AUF-REPORT-1.pdf', 2048
);
do $$ declare
  v_document public.documents%rowtype;
  v_replay jsonb;
begin
  select * into strict v_document from public.documents where id = '47160000-0000-4000-8000-000000000091';
  if v_document.category is distinct from 'report'
     or v_document.mime_type is distinct from 'application/pdf'
     or v_document.retention_class is not null or v_document.filed_at is null
     or v_document.filed_by is distinct from '47160000-0000-4000-8000-000000000001' then
    raise exception 'the report is not a filed PDF report without a retention class: %', row_to_json(v_document);
  end if;
  if (select count(*) from public.document_links link
      where link.document_id = v_document.id
        and (link.job_id = '47160000-0000-4000-8000-000000000040'
          or link.equipment_id = '47160000-0000-4000-8000-000000000035'
          or link.client_id = '47160000-0000-4000-8000-000000000020')) <> 3
     or (select count(*) from public.document_links link where link.document_id = v_document.id) <> 3 then
    raise exception 'the report is not linked to exactly its job, Anlage and customer';
  end if;
  if not exists (
    select 1 from public.document_audit_events event
    where event.document_id = v_document.id and event.event_type = 'uploaded'
      and event.event_payload ->> 'source' = 'maintenance_service_report'
  ) or not exists (
    select 1 from public.document_audit_events event
    where event.document_id = v_document.id and event.event_type = 'filed'
  ) then
    raise exception 'the report lacks its upload or filing audit event';
  end if;
  if (select report_number from public.maintenance_service_reports
      where id = '47160000-0000-4000-8000-000000000081') is distinct from 1 then
    raise exception 'the first report is not number 1';
  end if;

  -- A retry answers with the committed report and adds nothing.
  v_replay := public.register_maintenance_service_report(
    '47160000-0000-4000-8000-000000000010', '47160000-0000-4000-8000-000000000001',
    '47160000-0000-4000-8000-000000000081', '47160000-0000-4000-8000-000000000071', null,
    '47160000-0000-4000-8000-000000000092',
    '47160000-0000-4000-8000-000000000010/service-reports/47160000-0000-4000-8000-000000000071/r1b.pdf',
    'Servicebericht AUF-REPORT-1.pdf', 2048
  );
  if v_replay ->> 'documentId' is distinct from '47160000-0000-4000-8000-000000000091'
     or (v_replay ->> 'duplicate')::boolean is not true
     or exists (select 1 from public.documents where id = '47160000-0000-4000-8000-000000000092') then
    raise exception 'a retry did not answer with the committed report: %', v_replay;
  end if;

  -- A second first report is stale; the regenerated report names the first.
  perform pg_temp.expect_refusal('a report that does not name the latest',
    pg_temp.register('47160000-0000-4000-8000-000000000010', '47160000-0000-4000-8000-000000000001',
      '47160000-0000-4000-8000-000000000082', '47160000-0000-4000-8000-000000000071', null,
      '47160000-0000-4000-8000-000000000093', '47160000-0000-4000-8000-000000000010'),
    'service_report_stale');
  perform public.register_maintenance_service_report(
    '47160000-0000-4000-8000-000000000010', '47160000-0000-4000-8000-000000000001',
    '47160000-0000-4000-8000-000000000083', '47160000-0000-4000-8000-000000000071',
    '47160000-0000-4000-8000-000000000081', '47160000-0000-4000-8000-000000000094',
    '47160000-0000-4000-8000-000000000010/service-reports/47160000-0000-4000-8000-000000000071/r2.pdf',
    'Servicebericht AUF-REPORT-1.pdf', 4096
  );
  if not exists (
    select 1 from public.maintenance_service_reports
    where id = '47160000-0000-4000-8000-000000000083' and report_number = 2
      and replaces_report_id = '47160000-0000-4000-8000-000000000081'
      and document_id = '47160000-0000-4000-8000-000000000094'
  ) or (select display_name from public.documents where id = '47160000-0000-4000-8000-000000000094')
       is distinct from 'Servicebericht AUF-REPORT-1 (1).pdf'
    or (select count(*) from public.maintenance_service_reports
        where organization_id = '47160000-0000-4000-8000-000000000010') <> 2 then
    raise exception 'the regenerated report is not number 2 beside the first';
  end if;
end $$;

-- A second visit item of the same job files its report under the next free name.
select public.register_maintenance_service_report(
  '47160000-0000-4000-8000-000000000010', '47160000-0000-4000-8000-000000000001',
  '47160000-0000-4000-8000-000000000084', '47160000-0000-4000-8000-000000000073', null,
  '47160000-0000-4000-8000-000000000095',
  '47160000-0000-4000-8000-000000000010/service-reports/47160000-0000-4000-8000-000000000073/r1.pdf',
  'Servicebericht AUF-REPORT-1.pdf', 2048
);
do $$ begin
  if (select display_name from public.documents where id = '47160000-0000-4000-8000-000000000095')
     is distinct from 'Servicebericht AUF-REPORT-1 (2).pdf' then
    raise exception 'a report of the same job did not take the next free name';
  end if;
end $$;

reset role;
do $$ begin
  begin
    update public.maintenance_service_reports set report_number = 3
    where id = '47160000-0000-4000-8000-000000000083';
  exception when others then
    if position('maintenance_history_is_immutable' in sqlerrm) = 0 then raise; end if;
    return;
  end;
  raise exception 'a service report was rewritten';
end $$;

rollback;
