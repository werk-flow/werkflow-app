-- Open Mängel of an Anlage stay open until a later completed visit closes
-- them (migration 20261219113103_close_open_mangel_with_a_later_visit.sql):
-- * A missed visit closes nothing; the next completed visit of the Anlage,
--   or of its Nachfolger, closes every earlier open finding in the same call
--   and records which visit closed it and who completed it. Its own finding
--   stays open; another Anlage's findings stay open; a finding that also names
--   an Anlage the later visit did not cover stays open; a visit completed on
--   an earlier day closes no later finding; a replay closes nothing again.
-- * Another organization reads none; no client role, so no unassigned
--   employee, reads a finding, a resolution or the reader; no role executes
--   the closing step, and nobody rewrites a resolution.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('48400000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','open-findings-admin@example.test','',now(),'{}','{"first_name":"Erika","last_name":"Musterfrau"}',now(),now()),
('48400000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','open-findings-employee@example.test','',now(),'{}','{"first_name":"Max","last_name":"Mustermann"}',now(),now()),
('48400000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','open-findings-outsider@example.test','',now(),'{}','{"first_name":"Fremd","last_name":"Admin"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('48400000-0000-4000-8000-000000000010','Haustechnik Sonnenberg GmbH','48400000-0000-4000-8000-000000000001','OPENFNDA'),
('48400000-0000-4000-8000-000000000011','Fremde Haustechnik','48400000-0000-4000-8000-000000000003','OPENFNDB');
insert into public.organization_members(organization_id,user_id,role) values
('48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000002','employee');
insert into public.clients(id,organization_id,name) values
('48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000010','Hausverwaltung Lindenhof GmbH'),
('48400000-0000-4000-8000-000000000021','48400000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('48400000-0000-4000-8000-000000000030','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000020','Heizzentrale Lindenhof',true,'48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000031','48400000-0000-4000-8000-000000000011','48400000-0000-4000-8000-000000000021','Fremdort',true,'48400000-0000-4000-8000-000000000003');
insert into public.jobs(id,organization_id,created_by,client_id,site_id,job_number,title) values
('48400000-0000-4000-8000-000000000040','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030','AUF-OFFEN-1','Wartungsbesuch'),
('48400000-0000-4000-8000-000000000049','48400000-0000-4000-8000-000000000011','48400000-0000-4000-8000-000000000003','48400000-0000-4000-8000-000000000021','48400000-0000-4000-8000-000000000031','AUF-OFFEN-B','Fremdbesuch');

-- Maintenance rows are written only through their RPCs; the seed bypasses the
-- write guards and validation triggers, so every reference is set by hand.
-- ANL-1 was replaced by ANL-2 (plan P moved from revision R0 to R1); ANL-3 has
-- its own plan Q; plan W covers ANL-3 and ANL-4 together; ANL-9 belongs to
-- the other organization.
set local session_replication_role = replica;
insert into public.installed_equipment(id,organization_id,client_id,site_id,predecessor_equipment_id,equipment_number,name,category,state,created_by,updated_by) values
('48400000-0000-4000-8000-000000000080','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030',null,'ANL-1','Gasbrennwertkessel alt','heat_generation','removed','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000081','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030','48400000-0000-4000-8000-000000000080','ANL-2','Gasbrennwertkessel neu','heat_generation','active','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000082','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030',null,'ANL-3','Warmwasserspeicher','storage_and_hot_water','active','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000083','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030',null,'ANL-4','Zirkulationspumpe','storage_and_hot_water','active','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000089','48400000-0000-4000-8000-000000000011','48400000-0000-4000-8000-000000000021','48400000-0000-4000-8000-000000000031',null,'ANL-9','Fremdkessel','heat_generation','active','48400000-0000-4000-8000-000000000003','48400000-0000-4000-8000-000000000003');
insert into public.work_artifacts(id,organization_id,job_id,kind,created_by,current_revision_id) values
('48400000-0000-4000-8000-000000000045','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000040','work_report','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000046');
insert into public.work_artifact_revisions(id,organization_id,artifact_id,kind,revision_number,title,visibility,captured_at,created_by) values
('48400000-0000-4000-8000-000000000046','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000045','work_report',1,'Wartungsbericht','customer_facing',now(),'48400000-0000-4000-8000-000000000001');
insert into public.work_templates(id,organization_id,target_type) values
('48400000-0000-4000-8000-000000000050','48400000-0000-4000-8000-000000000010','job');
insert into public.work_template_versions(id,organization_id,template_id,version_number,name) values
('48400000-0000-4000-8000-000000000052','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000050',1,'Heizungswartung');
insert into public.maintenance_plans(id,organization_id,plan_number,client_id,site_id,status,current_revision_id,created_by,updated_by) values
('48400000-0000-4000-8000-000000000060','48400000-0000-4000-8000-000000000010','WPL-P','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030','active','48400000-0000-4000-8000-000000000064','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000062','48400000-0000-4000-8000-000000000010','WPL-Q','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030','active','48400000-0000-4000-8000-000000000065','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000066','48400000-0000-4000-8000-000000000010','WPL-W','48400000-0000-4000-8000-000000000020','48400000-0000-4000-8000-000000000030','active','48400000-0000-4000-8000-000000000067','48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001');
insert into public.maintenance_plan_revisions(id,organization_id,maintenance_plan_id,revision_number,template_version_id,effective_from_date,first_due_date,interval_months,due_window_before_days,due_window_after_days,planned_duration_minutes,next_due_basis,reason,created_by) values
('48400000-0000-4000-8000-000000000061','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000060',1,'48400000-0000-4000-8000-000000000052','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Erstanlage','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000064','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000060',2,'48400000-0000-4000-8000-000000000052','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Austausch','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000065','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000062',1,'48400000-0000-4000-8000-000000000052','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Erstanlage','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000067','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000066',1,'48400000-0000-4000-8000-000000000052','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Erstanlage','48400000-0000-4000-8000-000000000001');
insert into public.maintenance_plan_revision_equipment(id,organization_id,maintenance_plan_revision_id,equipment_id,created_by) values
('48400000-0000-4000-8000-000000000091','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000061','48400000-0000-4000-8000-000000000080','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000092','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000064','48400000-0000-4000-8000-000000000081','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000093','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000065','48400000-0000-4000-8000-000000000082','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000094','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000067','48400000-0000-4000-8000-000000000082','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000095','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000067','48400000-0000-4000-8000-000000000083','48400000-0000-4000-8000-000000000001');
-- D1 on ANL-1 and DQ on ANL-3 leave Mängel; D2 on ANL-2 is missed; D3 leaves
-- new Mängel; D5 is completed for an earlier day; D6 completes the Anlage;
-- DW on ANL-3 and ANL-4 leaves a Mangel; DQ2 later completes ANL-3 alone.
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,job_id,version,created_by,updated_by) values
('48400000-0000-4000-8000-000000000071','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000060','48400000-0000-4000-8000-000000000061','2026-01-10','2026-01-10','2025-12-31','2026-01-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000072','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000062','48400000-0000-4000-8000-000000000065','2026-01-10','2026-01-10','2025-12-31','2026-01-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000073','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000060','48400000-0000-4000-8000-000000000064','2026-03-10','2026-03-10','2026-02-28','2026-03-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000074','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000060','48400000-0000-4000-8000-000000000064','2026-05-10','2026-05-10','2026-04-30','2026-05-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000075','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000060','48400000-0000-4000-8000-000000000064','2026-04-10','2026-04-10','2026-03-31','2026-04-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000076','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000060','48400000-0000-4000-8000-000000000064','2026-06-10','2026-06-10','2026-05-31','2026-06-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000077','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000066','48400000-0000-4000-8000-000000000067','2026-01-10','2026-01-10','2025-12-31','2026-01-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001'),
('48400000-0000-4000-8000-000000000078','48400000-0000-4000-8000-000000000010','48400000-0000-4000-8000-000000000062','48400000-0000-4000-8000-000000000065','2026-07-10','2026-07-10','2026-06-30','2026-07-20','visit_created','48400000-0000-4000-8000-000000000040',1,'48400000-0000-4000-8000-000000000001','48400000-0000-4000-8000-000000000001');
set local session_replication_role = origin;

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

-- Completes one visit of the organization as the Admin; Mängel only for an unfinished one.
create function pg_temp.complete_visit(
  p_due uuid, p_outcome public.maintenance_scope_outcome, p_completed_on date, p_defect text, p_key uuid
) returns void language sql as $$
  select public.complete_maintenance_visit('48400000-0000-4000-8000-000000000010', p_due, 1, p_outcome,
    p_completed_on, array['48400000-0000-4000-8000-000000000046']::uuid[], 'Wartung dokumentiert',
    case when p_defect is null then null else array[p_defect] end,
    case when p_defect is null then null else 'none'::public.maintenance_next_action end,
    null, null, case when p_defect is null then null else 'Kunde entscheidet später' end,
    '48400000-0000-4000-8000-000000000001', p_key);
$$;

-- The open Mängel the reader lists for one Anlage of the organization.
create function pg_temp.open_defects(p_org uuid, p_equipment uuid) returns text[] language sql as $$
  select coalesce(array_agg(defect order by defect), '{}')
  from public.list_open_maintenance_visit_findings(p_org, array[p_equipment]) open_finding,
    unnest(open_finding.defects) defect;
$$;

do $$ declare
  v_reader constant text := 'public.list_open_maintenance_visit_findings(uuid,uuid[])';
  v_step constant text := 'app_private.resolve_open_maintenance_visit_findings(uuid,uuid,uuid)';
  v_role text;
  v_function text;
begin
  foreach v_function in array array[v_reader, 'public.list_installed_equipment_lineage(uuid,uuid[])'] loop
    if has_function_privilege('anon', v_function, 'execute')
       or has_function_privilege('authenticated', v_function, 'execute')
       or not has_function_privilege('service_role', v_function, 'execute') then
      raise exception 'only the service role executes %', v_function;
    end if;
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, v_step, 'execute') then
      raise exception 'the closing step is executable by %', v_role;
    end if;
    if has_table_privilege(v_role, 'public.maintenance_visit_finding_resolutions', 'update')
       or has_table_privilege(v_role, 'public.maintenance_visit_finding_resolutions', 'delete') then
      raise exception 'resolutions can be rewritten by %', v_role;
    end if;
  end loop;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.maintenance_visit_finding_resolutions', 'select')
       or has_table_privilege(v_role, 'public.maintenance_visit_findings', 'select') then
      raise exception '% reads findings or their resolutions', v_role;
    end if;
  end loop;
end $$;

-- D1 leaves a Mangel on ANL-1 and DQ one on ANL-3; the missed D2 on the
-- Nachfolger ANL-2 closes nothing.
do $$ declare
  v_org constant uuid := '48400000-0000-4000-8000-000000000010';
begin
  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000071', 'partial', '2026-01-12',
    'Abgasrohr undicht', gen_random_uuid());
  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000072', 'unresolved', '2026-01-12',
    'Ausdehnungsgefäß ohne Vordruck', gen_random_uuid());
  perform public.record_maintenance_visit_missed(v_org, '48400000-0000-4000-8000-000000000073', 1,
    'customer_absent', null, '48400000-0000-4000-8000-000000000001', gen_random_uuid());
  if pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000081') is distinct from array['Abgasrohr undicht']
     or pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000080') is distinct from array['Abgasrohr undicht'] then
    raise exception 'the Vorgänger''s open Mangel did not stay open across the missed visit: %',
      pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000081');
  end if;
  if exists (select 1 from public.maintenance_visit_finding_resolutions resolution
             where resolution.organization_id = v_org) then
    raise exception 'a missed visit closed a Mangel';
  end if;
end $$;

-- The next completed visit of ANL-2 closes the Vorgänger's Mangel with its
-- history; its own Mängel and ANL-3's stay open; a replay closes nothing again.
do $$ declare
  v_org constant uuid := '48400000-0000-4000-8000-000000000010';
  v_key constant uuid := '48400000-0000-4000-8000-0000000000a3';
  v_resolution public.maintenance_visit_finding_resolutions%rowtype;
begin
  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000074', 'partial', '2026-05-11',
    'Brenner zündet verzögert', v_key);
  select resolution.* into strict v_resolution
  from public.maintenance_visit_finding_resolutions resolution
  join public.maintenance_visit_findings finding on finding.id = resolution.maintenance_visit_finding_id
  where resolution.organization_id = v_org
    and finding.maintenance_due_work_id = '48400000-0000-4000-8000-000000000071';
  if v_resolution.resolved_by_due_work_id is distinct from '48400000-0000-4000-8000-000000000074'::uuid
     or v_resolution.created_by is distinct from '48400000-0000-4000-8000-000000000001'::uuid then
    raise exception 'the closed Mangel does not name the visit and the person that closed it: %', to_jsonb(v_resolution);
  end if;
  if pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000081') is distinct from array['Brenner zündet verzögert']
     or pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000082') is distinct from array['Ausdehnungsgefäß ohne Vordruck'] then
    raise exception 'a completed visit closed its own or another Anlage''s Mangel: % / %',
      pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000081'),
      pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000082');
  end if;

  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000074', 'partial', '2026-05-11',
    'Brenner zündet verzögert', v_key);
  if (select count(*) from public.maintenance_visit_finding_resolutions resolution
      where resolution.organization_id = v_org) <> 1 then
    raise exception 'a replayed completion closed Mängel again';
  end if;
end $$;

-- A visit completed for an earlier day closes no later Mangel; the next one does.
do $$ declare
  v_org constant uuid := '48400000-0000-4000-8000-000000000010';
begin
  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000075', 'complete', '2026-04-15', null,
    gen_random_uuid());
  if pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000081') is distinct from array['Brenner zündet verzögert'] then
    raise exception 'a visit of an earlier day closed a later Mangel';
  end if;
  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000076', 'complete', '2026-06-11', null,
    gen_random_uuid());
  if pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000081') is distinct from '{}'::text[]
     or pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000082') is distinct from array['Ausdehnungsgefäß ohne Vordruck'] then
    raise exception 'the completed visit did not close exactly its Anlage''s Mängel';
  end if;
end $$;

-- A Mangel of a visit on ANL-3 and ANL-4 stays open when a later visit
-- completes ANL-3 alone; ANL-3's own earlier Mangel closes.
do $$ declare
  v_org constant uuid := '48400000-0000-4000-8000-000000000010';
begin
  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000077', 'partial', '2026-01-12', 'Zirkulationspumpe laut', gen_random_uuid());
  perform pg_temp.complete_visit('48400000-0000-4000-8000-000000000078', 'complete', '2026-07-11', null, gen_random_uuid());
  if pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000082') is distinct from array['Zirkulationspumpe laut']
     or pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000083') is distinct from array['Zirkulationspumpe laut'] then
    raise exception 'a visit of one Anlage closed a Mangel it did not cover, or kept its own: % / %',
      pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000082'), pg_temp.open_defects(v_org, '48400000-0000-4000-8000-000000000083');
  end if;
end $$;

-- Another organization reads none of them, nor the organization another's Anlage.
do $$ begin
  if pg_temp.open_defects('48400000-0000-4000-8000-000000000011', '48400000-0000-4000-8000-000000000082') is distinct from '{}'::text[]
     or pg_temp.open_defects('48400000-0000-4000-8000-000000000010', '48400000-0000-4000-8000-000000000089') is distinct from '{}'::text[] then
    raise exception 'open Mängel crossed the organization boundary';
  end if;
end $$;

-- An employee of the organization, assigned to nothing, reads no finding,
-- resolution or reader result through the client.
reset role;
select set_config('request.jwt.claims',
  '{"sub":"48400000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$ begin
  perform pg_temp.expect_refusal('an employee reads findings',
    'select count(*) from public.maintenance_visit_findings', 'permission denied');
  perform pg_temp.expect_refusal('an employee reads resolutions',
    'select count(*) from public.maintenance_visit_finding_resolutions', 'permission denied');
  perform pg_temp.expect_refusal('an employee calls the reader',
    format('select * from public.list_open_maintenance_visit_findings(%L, array[%L]::uuid[])',
      '48400000-0000-4000-8000-000000000010', '48400000-0000-4000-8000-000000000082'),
    'permission denied');
end $$;

-- Even the table owner cannot rewrite or delete a resolution.
reset role;
do $$ begin
  perform pg_temp.expect_refusal('a resolution update', format(
    'update public.maintenance_visit_finding_resolutions set created_by = %L where organization_id = %L',
    '48400000-0000-4000-8000-000000000002', '48400000-0000-4000-8000-000000000010'), 'maintenance_history_is_immutable');
  perform pg_temp.expect_refusal('a resolution delete', format(
    'delete from public.maintenance_visit_finding_resolutions where organization_id = %L',
    '48400000-0000-4000-8000-000000000010'), 'maintenance_history_is_immutable');
end $$;

rollback;
