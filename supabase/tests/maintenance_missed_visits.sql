-- A maintenance visit that did not happen never drops its due obligation
-- (migration 20261205091200_reopen_missed_maintenance_visits.sql):
-- * „Besuch hat nicht stattgefunden“ returns a due item with a visit job to
--   open with its due date, without the job, and its history names the job
--   and the reason; a replay adds nothing, a stale version, a completed item,
--   an employee and another organization are refused.
-- * Cancelling the visit job reopens its uncompleted items in the same call
--   and leaves a completed item completed.
-- * The workspace page reader counts and filters überfällig due work against
--   the given Berlin day, overdue first, and never counts another organization.
-- Only the service role executes the new functions.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('46700000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','missed-visit-admin@example.test','',now(),'{}','{"first_name":"Erika","last_name":"Musterfrau"}',now(),now()),
('46700000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','missed-visit-employee@example.test','',now(),'{}','{"first_name":"Max","last_name":"Mustermann"}',now(),now()),
('46700000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','missed-visit-outsider@example.test','',now(),'{}','{"first_name":"Fremd","last_name":"Admin"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('46700000-0000-4000-8000-000000000010','Haustechnik Sonnenberg GmbH','46700000-0000-4000-8000-000000000001','MISSEDA'),
('46700000-0000-4000-8000-000000000011','Fremde Haustechnik','46700000-0000-4000-8000-000000000003','MISSEDB');
insert into public.organization_members(organization_id,user_id,role) values
('46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000002','employee');
insert into public.clients(id,organization_id,name) values
('46700000-0000-4000-8000-000000000020','46700000-0000-4000-8000-000000000010','Hausverwaltung Lindenhof GmbH'),
('46700000-0000-4000-8000-000000000021','46700000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('46700000-0000-4000-8000-000000000030','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000020','Heizzentrale Lindenhof',true,'46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000031','46700000-0000-4000-8000-000000000011','46700000-0000-4000-8000-000000000021','Fremdort',true,'46700000-0000-4000-8000-000000000003');
-- Visit jobs: J1 is missed, J2 is cancelled, JB belongs to the other organization.
insert into public.jobs(id,organization_id,created_by,client_id,site_id,job_number,title) values
('46700000-0000-4000-8000-000000000040','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000020','46700000-0000-4000-8000-000000000030','AUF-MISS-1','Wartungsbesuch'),
('46700000-0000-4000-8000-000000000041','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000020','46700000-0000-4000-8000-000000000030','AUF-MISS-2','Wartungsbesuch'),
('46700000-0000-4000-8000-000000000042','46700000-0000-4000-8000-000000000011','46700000-0000-4000-8000-000000000003','46700000-0000-4000-8000-000000000021','46700000-0000-4000-8000-000000000031','AUF-MISS-B','Fremdbesuch');

-- Maintenance rows are written only through their RPCs; the seed bypasses the
-- write guards and validation triggers, so every reference is set by hand.
set local session_replication_role = replica;
insert into public.work_templates(id,organization_id,target_type) values
('46700000-0000-4000-8000-000000000050','46700000-0000-4000-8000-000000000010','job'),
('46700000-0000-4000-8000-000000000051','46700000-0000-4000-8000-000000000011','job');
insert into public.work_template_versions(id,organization_id,template_id,version_number,name) values
('46700000-0000-4000-8000-000000000052','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000050',1,'Heizungswartung'),
('46700000-0000-4000-8000-000000000053','46700000-0000-4000-8000-000000000011','46700000-0000-4000-8000-000000000051',1,'Fremdwartung');
insert into public.maintenance_plans(id,organization_id,plan_number,client_id,site_id,status,current_revision_id,created_by,updated_by) values
('46700000-0000-4000-8000-000000000060','46700000-0000-4000-8000-000000000010','WPL-MISS','46700000-0000-4000-8000-000000000020','46700000-0000-4000-8000-000000000030','active','46700000-0000-4000-8000-000000000061','46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000062','46700000-0000-4000-8000-000000000011','WPL-FREMD','46700000-0000-4000-8000-000000000021','46700000-0000-4000-8000-000000000031','active','46700000-0000-4000-8000-000000000063','46700000-0000-4000-8000-000000000003','46700000-0000-4000-8000-000000000003');
insert into public.maintenance_plan_revisions(id,organization_id,maintenance_plan_id,revision_number,template_version_id,effective_from_date,first_due_date,interval_months,planned_duration_minutes,next_due_basis,reason,created_by) values
('46700000-0000-4000-8000-000000000061','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000060',1,'46700000-0000-4000-8000-000000000052','2026-01-01','2026-01-10',1,120,'planned_due_date','Erstanlage','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000063','46700000-0000-4000-8000-000000000011','46700000-0000-4000-8000-000000000062',1,'46700000-0000-4000-8000-000000000053','2026-01-01','2026-01-10',1,120,'planned_due_date','Erstanlage','46700000-0000-4000-8000-000000000003');
-- D1 missed (J1), D2 stays with a visit job, D3 completed long ago, D4 and D5
-- on the cancelled J2 (D5 completed), D6 due on the reader's today, DB foreign.
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,job_id,scope_outcome,completed_on,version,created_by,updated_by) values
('46700000-0000-4000-8000-000000000071','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000060','46700000-0000-4000-8000-000000000061','2026-01-10','2026-01-10','2026-01-01','2026-01-20','visit_created','46700000-0000-4000-8000-000000000040',null,null,2,'46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000072','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000060','46700000-0000-4000-8000-000000000061','2037-12-01','2037-12-01','2037-11-20','2037-12-10','visit_created','46700000-0000-4000-8000-000000000040',null,null,1,'46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000073','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000060','46700000-0000-4000-8000-000000000061','2025-12-10','2025-12-10','2025-12-01','2025-12-20','completed','46700000-0000-4000-8000-000000000040','complete','2025-12-10',3,'46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000074','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000060','46700000-0000-4000-8000-000000000061','2026-02-10','2026-02-10','2026-02-01','2026-02-20','visit_created','46700000-0000-4000-8000-000000000041',null,null,2,'46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000075','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000060','46700000-0000-4000-8000-000000000061','2026-03-10','2026-03-10','2026-03-01','2026-03-20','completed','46700000-0000-4000-8000-000000000041','partial','2026-03-10',3,'46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000076','46700000-0000-4000-8000-000000000010','46700000-0000-4000-8000-000000000060','46700000-0000-4000-8000-000000000061','2026-06-01','2026-06-01','2026-05-20','2026-06-10','open',null,null,null,1,'46700000-0000-4000-8000-000000000001','46700000-0000-4000-8000-000000000001'),
('46700000-0000-4000-8000-000000000077','46700000-0000-4000-8000-000000000011','46700000-0000-4000-8000-000000000062','46700000-0000-4000-8000-000000000063','2026-01-10','2026-01-10','2026-01-01','2026-01-20','visit_created','46700000-0000-4000-8000-000000000042',null,null,1,'46700000-0000-4000-8000-000000000003','46700000-0000-4000-8000-000000000003');
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

do $$ declare
  signature text;
begin
  foreach signature in array array[
    'public.record_maintenance_visit_missed(uuid,uuid,bigint,public.maintenance_missed_visit_reason,text,uuid,uuid)',
    'public.read_maintenance_workspace_page(uuid,date,date,text,boolean,integer,integer,integer,integer)'
  ] loop
    if has_function_privilege('anon', signature, 'execute')
       or has_function_privilege('authenticated', signature, 'execute')
       or not has_function_privilege('service_role', signature, 'execute') then
      raise exception 'only the service role executes %', signature;
    end if;
  end loop;
end $$;

-- A missed visit returns its item to open with its due date and names the job in its history.
do $$ declare
  v_org constant uuid := '46700000-0000-4000-8000-000000000010';
  v_admin constant uuid := '46700000-0000-4000-8000-000000000001';
  v_due constant uuid := '46700000-0000-4000-8000-000000000071';
  v_key constant uuid := '46700000-0000-4000-8000-000000000090';
  v_after public.maintenance_due_work%rowtype;
  v_event public.maintenance_due_work_events%rowtype;
begin
  v_after := public.record_maintenance_visit_missed(v_org, v_due, 2, 'customer_absent', null, v_admin, v_key);
  if v_after.status is distinct from 'open' or v_after.job_id is not null or v_after.planning_occurrence_id is not null
     or v_after.due_date is distinct from date '2026-01-10' or v_after.version is distinct from 3::bigint then
    raise exception 'a missed visit did not return its item to open with its due date: %', to_jsonb(v_after);
  end if;
  select * into v_event from public.maintenance_due_work_events event
  where event.organization_id = v_org and event.maintenance_due_work_id = v_due and event.idempotency_key = v_key;
  if v_event.event_type is distinct from 'visit_missed'
     or v_event.missed_job_id is distinct from '46700000-0000-4000-8000-000000000040'::uuid
     or v_event.missed_reason is distinct from 'customer_absent'
     or v_event.actor_id is distinct from v_admin
     or (v_event.before_snapshot->>'job_id') is distinct from '46700000-0000-4000-8000-000000000040' then
    raise exception 'the missed visit history does not name the job and the reason: %', to_jsonb(v_event);
  end if;

  -- A replay returns the item and adds no history; another payload under the key is refused.
  v_after := public.record_maintenance_visit_missed(v_org, v_due, 2, 'customer_absent', null, v_admin, v_key);
  if v_after.version is distinct from 3::bigint
     or (select count(*) from public.maintenance_due_work_events event
         where event.organization_id = v_org and event.maintenance_due_work_id = v_due) <> 1 then
    raise exception 'a replayed missed visit changed the item or its history again';
  end if;
  perform pg_temp.expect_refusal('changed replay', format(
    'select public.record_maintenance_visit_missed(%L, %L, 2, %L, null, %L, %L)',
    v_org, v_due, 'postponed', v_admin, v_key), 'maintenance_idempotency_conflict');
end $$;

-- Refusals: a stale version, an item without a visit job, a completed item,
-- a missing note, the cancellation's own reason, an employee, another organization.
do $$ declare
  v_org constant uuid := '46700000-0000-4000-8000-000000000010';
  v_foreign_org constant uuid := '46700000-0000-4000-8000-000000000011';
  v_admin constant uuid := '46700000-0000-4000-8000-000000000001';
  v_foreign_admin constant uuid := '46700000-0000-4000-8000-000000000003';
  v_statement constant text := 'select public.record_maintenance_visit_missed(%L, %L, %s, %L, %L, %L, gen_random_uuid())';
begin
  perform pg_temp.expect_refusal('stale version', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000072', 5, 'customer_absent', null, v_admin), 'maintenance_stale_version');
  perform pg_temp.expect_refusal('already open', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000071', 3, 'customer_absent', null, v_admin), 'maintenance_due_visit_missed_not_allowed');
  perform pg_temp.expect_refusal('completed item', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000073', 3, 'customer_absent', null, v_admin), 'maintenance_due_visit_missed_not_allowed');
  perform pg_temp.expect_refusal('other without note', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000072', 1, 'other', '  ', v_admin), 'maintenance_reason_required');
  perform pg_temp.expect_refusal('cancellation reason by hand', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000072', 1, 'job_cancelled', null, v_admin), 'maintenance_missed_reason_invalid');
  perform pg_temp.expect_refusal('employee', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000072', 1, 'customer_absent', null, '46700000-0000-4000-8000-000000000002'), 'maintenance_not_authorized');
  perform pg_temp.expect_refusal('foreign item in own organization', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000077', 1, 'customer_absent', null, v_admin), 'maintenance_due_not_found');
  perform pg_temp.expect_refusal('foreign manager in this organization', format(v_statement,
    v_org, '46700000-0000-4000-8000-000000000072', 1, 'customer_absent', null, v_foreign_admin), 'maintenance_not_authorized');
  perform pg_temp.expect_refusal('own manager in the foreign organization', format(v_statement,
    v_foreign_org, '46700000-0000-4000-8000-000000000077', 1, 'customer_absent', null, v_admin), 'maintenance_not_authorized');
  if (select status from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000073') is distinct from 'completed'
     or (select status from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000077') is distinct from 'visit_created'
     or (select version from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000072') is distinct from 1::bigint then
    raise exception 'a refused missed visit changed an item';
  end if;
end $$;

-- Cancelling the visit job reopens its uncompleted item in the same call; the completed one stays.
do $$ declare
  v_org constant uuid := '46700000-0000-4000-8000-000000000010';
  v_admin constant uuid := '46700000-0000-4000-8000-000000000001';
  v_job constant uuid := '46700000-0000-4000-8000-000000000041';
  v_transition record;
  v_event public.maintenance_due_work_events%rowtype;
begin
  select * into v_transition from public.transition_work_execution(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
    p_to_state => 'cancelled', p_expected_version => 0, p_actor_id => v_admin,
    p_reason => 'Kunde hat abgesagt.'
  );
  if v_transition.execution_state is distinct from 'cancelled' or v_transition.event_id is null then
    raise exception 'the job cancellation did not return its state and event';
  end if;
  if (select status from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000074') is distinct from 'open'
     or (select job_id from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000074') is not null
     or (select due_date from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000074') is distinct from date '2026-02-10' then
    raise exception 'cancelling the visit job did not reopen its uncompleted item';
  end if;
  select * into v_event from public.maintenance_due_work_events event
  where event.organization_id = v_org and event.maintenance_due_work_id = '46700000-0000-4000-8000-000000000074';
  if v_event.event_type is distinct from 'visit_missed' or v_event.missed_reason is distinct from 'job_cancelled'
     or v_event.missed_job_id is distinct from v_job or v_event.reason is distinct from 'Kunde hat abgesagt.'
     or v_event.idempotency_key is distinct from v_transition.event_id then
    raise exception 'the cancellation history does not name the job and its reason: %', to_jsonb(v_event);
  end if;
  if (select status from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000075') is distinct from 'completed'
     or (select job_id from public.maintenance_due_work where id = '46700000-0000-4000-8000-000000000075') is distinct from v_job
     or exists (select 1 from public.maintenance_due_work_events event
                where event.organization_id = v_org and event.maintenance_due_work_id = '46700000-0000-4000-8000-000000000075') then
    raise exception 'cancelling the visit job reopened or touched a completed item';
  end if;
end $$;

-- Überfällig: open or with a visit job, due before the given day; the day itself is not overdue.
do $$ declare
  v_org constant uuid := '46700000-0000-4000-8000-000000000010';
  v_page jsonb;
begin
  -- Open now: D1 (2026-01-10), D4 (2026-02-10), D6 (2026-06-01); with a visit job: D2 (2037-12-01).
  v_page := public.read_maintenance_workspace_page(v_org, '2026-06-01', '2040-01-01', '', false, 1, 1, 1, 50);
  if (v_page#>>'{due,total}')::int is distinct from 4 or (v_page#>>'{due,overdue}')::int is distinct from 2
     or v_page#>'{due,ids}' is distinct from jsonb_build_array(
       '46700000-0000-4000-8000-000000000071', '46700000-0000-4000-8000-000000000074',
       '46700000-0000-4000-8000-000000000076', '46700000-0000-4000-8000-000000000072') then
    raise exception 'the due list does not count überfällig work or sort it first: %', v_page->'due';
  end if;
  v_page := public.read_maintenance_workspace_page(v_org, '2026-06-01', '2040-01-01', '', true, 1, 1, 1, 50);
  if (v_page#>>'{due,total}')::int is distinct from 2 or (v_page#>>'{due,overdue}')::int is distinct from 2
     or v_page#>'{due,ids}' is distinct from jsonb_build_array(
       '46700000-0000-4000-8000-000000000071', '46700000-0000-4000-8000-000000000074') then
    raise exception 'the überfällig filter lists other work: %', v_page->'due';
  end if;
  -- A visit job due before today counts too.
  v_page := public.read_maintenance_workspace_page(v_org, '2037-12-02', '2040-01-01', '', true, 1, 1, 1, 50);
  if (v_page#>>'{due,total}')::int is distinct from 4 then
    raise exception 'überfällig work with a visit job is not counted: %', v_page->'due';
  end if;
  -- The search narrows the count; another organization never counts.
  v_page := public.read_maintenance_workspace_page(v_org, '2026-06-01', '2040-01-01', 'fremd', false, 1, 1, 1, 50);
  if (v_page#>>'{due,total}')::int is distinct from 0 or (v_page#>>'{due,overdue}')::int is distinct from 0 then
    raise exception 'the überfällig count ignores the search or the organization: %', v_page->'due';
  end if;
  -- The previous release's reader lists every due item the same way.
  if public.list_maintenance_workspace_page(v_org, '2040-01-01')#>'{due,ids}'
     is distinct from public.read_maintenance_workspace_page(v_org, '2026-06-01', '2040-01-01', '', false, 1, 1, 1, 50)#>'{due,ids}' then
    raise exception 'the previous page reader lists other due work';
  end if;
end $$;

rollback;
