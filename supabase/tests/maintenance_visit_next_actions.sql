-- A partial or unresolved maintenance visit names its Mängel, the next action
-- and its owner (migration 20261218091102_name_the_next_action_of_an_unfinished_visit.sql):
-- * Completing partial or unresolved without a next action or without a
--   Mangel is refused; the previous entry, kept for the deployed build,
--   still completes one without a finding, as that build expects; the owner
--   must be an Admin or Büro member of the organization; the target date lies
--   after the visit, a Rückkehr's before the regular next due date, any
--   other step's as late as the office decides.
-- * A Rückkehr opens a return due item on the same plan revision on the target
--   date, leaves the regular next due date unchanged and gives the owner a
--   follow-up on the visit job; completing the return item does not advance
--   the plan. Garantieprüfung gives a follow-up only; Keine records its reason.
-- * Employees and another organization are refused; a replay adds nothing.
-- Only the service role executes the entry; no role executes its body, and the
-- findings refuse every update and delete.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('47050000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','next-action-admin@example.test','',now(),'{}','{"first_name":"Erika","last_name":"Musterfrau"}',now(),now()),
('47050000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','next-action-employee@example.test','',now(),'{}','{"first_name":"Max","last_name":"Mustermann"}',now(),now()),
('47050000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','next-action-outsider@example.test','',now(),'{}','{"first_name":"Fremd","last_name":"Admin"}',now(),now()),
('47050000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','next-action-buero@example.test','',now(),'{}','{"first_name":"Petra","last_name":"Beispiel"}',now(),now());
insert into public.organizations(id,name,admin_id,unique_code) values
('47050000-0000-4000-8000-000000000010','Haustechnik Sonnenberg GmbH','47050000-0000-4000-8000-000000000001','NEXTACTA'),
('47050000-0000-4000-8000-000000000011','Fremde Haustechnik','47050000-0000-4000-8000-000000000003','NEXTACTB');
insert into public.organization_members(organization_id,user_id,role) values
('47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000002','employee'),
('47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000004','buero');
insert into public.clients(id,organization_id,name) values
('47050000-0000-4000-8000-000000000020','47050000-0000-4000-8000-000000000010','Hausverwaltung Lindenhof GmbH'),
('47050000-0000-4000-8000-000000000021','47050000-0000-4000-8000-000000000011','Fremdkunde');
insert into public.client_sites(id,organization_id,client_id,name,is_primary,created_by) values
('47050000-0000-4000-8000-000000000030','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000020','Heizzentrale Lindenhof',true,'47050000-0000-4000-8000-000000000001'),
('47050000-0000-4000-8000-000000000031','47050000-0000-4000-8000-000000000011','47050000-0000-4000-8000-000000000021','Fremdort',true,'47050000-0000-4000-8000-000000000003');
insert into public.jobs(id,organization_id,created_by,client_id,site_id,job_number,title) values
('47050000-0000-4000-8000-000000000040','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000001','47050000-0000-4000-8000-000000000020','47050000-0000-4000-8000-000000000030','AUF-NEXT-1','Wartungsbesuch'),
('47050000-0000-4000-8000-000000000049','47050000-0000-4000-8000-000000000011','47050000-0000-4000-8000-000000000003','47050000-0000-4000-8000-000000000021','47050000-0000-4000-8000-000000000031','AUF-NEXT-B','Fremdbesuch');

-- Maintenance rows are written only through their RPCs; the seed bypasses the
-- write guards and validation triggers, so every reference is set by hand.
set local session_replication_role = replica;
insert into public.work_artifacts(id,organization_id,job_id,kind,created_by,current_revision_id) values
('47050000-0000-4000-8000-000000000045','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000040','work_report','47050000-0000-4000-8000-000000000001','47050000-0000-4000-8000-000000000046');
insert into public.work_artifact_revisions(id,organization_id,artifact_id,kind,revision_number,title,visibility,captured_at,created_by) values
('47050000-0000-4000-8000-000000000046','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000045','work_report',1,'Wartungsbericht','customer_facing',now(),'47050000-0000-4000-8000-000000000001');
insert into public.work_templates(id,organization_id,target_type) values
('47050000-0000-4000-8000-000000000050','47050000-0000-4000-8000-000000000010','job'),
('47050000-0000-4000-8000-000000000051','47050000-0000-4000-8000-000000000011','job');
insert into public.work_template_versions(id,organization_id,template_id,version_number,name) values
('47050000-0000-4000-8000-000000000052','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000050',1,'Heizungswartung'),
('47050000-0000-4000-8000-000000000053','47050000-0000-4000-8000-000000000011','47050000-0000-4000-8000-000000000051',1,'Fremdwartung');
insert into public.maintenance_plans(id,organization_id,plan_number,client_id,site_id,status,current_revision_id,created_by,updated_by) values
('47050000-0000-4000-8000-000000000060','47050000-0000-4000-8000-000000000010','WPL-NEXT','47050000-0000-4000-8000-000000000020','47050000-0000-4000-8000-000000000030','active','47050000-0000-4000-8000-000000000061','47050000-0000-4000-8000-000000000001','47050000-0000-4000-8000-000000000001'),
('47050000-0000-4000-8000-000000000062','47050000-0000-4000-8000-000000000011','WPL-FREMD','47050000-0000-4000-8000-000000000021','47050000-0000-4000-8000-000000000031','active','47050000-0000-4000-8000-000000000063','47050000-0000-4000-8000-000000000003','47050000-0000-4000-8000-000000000003');
insert into public.maintenance_plan_revisions(id,organization_id,maintenance_plan_id,revision_number,template_version_id,effective_from_date,first_due_date,interval_months,due_window_before_days,due_window_after_days,planned_duration_minutes,next_due_basis,reason,created_by) values
('47050000-0000-4000-8000-000000000061','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000060',1,'47050000-0000-4000-8000-000000000052','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Erstanlage','47050000-0000-4000-8000-000000000001'),
('47050000-0000-4000-8000-000000000063','47050000-0000-4000-8000-000000000011','47050000-0000-4000-8000-000000000062',1,'47050000-0000-4000-8000-000000000053','2026-01-01','2026-01-10',12,10,10,120,'planned_due_date','Erstanlage','47050000-0000-4000-8000-000000000003');
-- D1 gets a Rückkehr, D2 the refusals and then a Garantieprüfung, D3 Keine,
-- D4 completes through the previous entry, DB belongs to the other organization.
insert into public.maintenance_due_work(id,organization_id,maintenance_plan_id,maintenance_plan_revision_id,original_due_date,due_date,window_start_date,window_end_date,status,job_id,version,created_by,updated_by) values
('47050000-0000-4000-8000-000000000071','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000060','47050000-0000-4000-8000-000000000061','2026-01-10','2026-01-10','2025-12-31','2026-01-20','visit_created','47050000-0000-4000-8000-000000000040',1,'47050000-0000-4000-8000-000000000001','47050000-0000-4000-8000-000000000001'),
('47050000-0000-4000-8000-000000000072','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000060','47050000-0000-4000-8000-000000000061','2026-03-10','2026-03-10','2026-02-28','2026-03-20','visit_created','47050000-0000-4000-8000-000000000040',1,'47050000-0000-4000-8000-000000000001','47050000-0000-4000-8000-000000000001'),
('47050000-0000-4000-8000-000000000073','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000060','47050000-0000-4000-8000-000000000061','2026-04-10','2026-04-10','2026-03-31','2026-04-20','visit_created','47050000-0000-4000-8000-000000000040',1,'47050000-0000-4000-8000-000000000001','47050000-0000-4000-8000-000000000001'),
('47050000-0000-4000-8000-000000000074','47050000-0000-4000-8000-000000000010','47050000-0000-4000-8000-000000000060','47050000-0000-4000-8000-000000000061','2026-05-10','2026-05-10','2026-04-30','2026-05-20','visit_created','47050000-0000-4000-8000-000000000040',1,'47050000-0000-4000-8000-000000000001','47050000-0000-4000-8000-000000000001'),
('47050000-0000-4000-8000-000000000079','47050000-0000-4000-8000-000000000011','47050000-0000-4000-8000-000000000062','47050000-0000-4000-8000-000000000063','2026-01-10','2026-01-10','2025-12-31','2026-01-20','visit_created','47050000-0000-4000-8000-000000000049',1,'47050000-0000-4000-8000-000000000003','47050000-0000-4000-8000-000000000003');
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

-- Completes D2 as given; every argument after the outcome is literal SQL.
create function pg_temp.complete_statement(
  p_org text, p_due text, p_outcome text, p_defects text, p_action text, p_owner text,
  p_target text, p_note text, p_actor text
) returns text language sql as $$
  select format(
    'select public.complete_maintenance_visit(%s, %s, 1, %L, date %L, array[%L]::uuid[], %L, %s, %s, %s, %s, %s, %s, gen_random_uuid())',
    p_org, p_due, p_outcome, '2026-03-11', '47050000-0000-4000-8000-000000000046', 'Wartung dokumentiert',
    p_defects, p_action, p_owner, p_target, p_note, p_actor
  );
$$;

do $$ declare
  v_entry constant text := 'public.complete_maintenance_visit(uuid,uuid,bigint,public.maintenance_scope_outcome,date,uuid[],text,text[],public.maintenance_next_action,uuid,date,text,uuid,uuid)';
  v_body constant text := 'app_private.complete_maintenance_due_work_with_next_action(uuid,uuid,bigint,public.maintenance_scope_outcome,date,uuid[],text,text[],public.maintenance_next_action,uuid,date,text,uuid,uuid,boolean)';
  v_role text;
begin
  if has_function_privilege('anon', v_entry, 'execute')
     or has_function_privilege('authenticated', v_entry, 'execute')
     or not has_function_privilege('service_role', v_entry, 'execute') then
    raise exception 'only the service role executes the visit completion entry';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, v_body, 'execute') then
      raise exception 'the visit completion body is executable by %', v_role;
    end if;
    if has_table_privilege(v_role, 'public.maintenance_visit_findings', 'update')
       or has_table_privilege(v_role, 'public.maintenance_visit_findings', 'delete') then
      raise exception 'visit findings can be rewritten by %', v_role;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.maintenance_visit_findings', 'select')
     or has_table_privilege('anon', 'public.maintenance_visit_findings', 'select') then
    raise exception 'a client role reads visit findings';
  end if;
end $$;

-- Refusals on D2: no next action, no Mangel, an owner who is not a manager of
-- the organization, a target date outside its range, a next action on a
-- complete visit, Keine without a reason, an employee, another organization.
do $$ declare
  v_org constant text := quote_literal('47050000-0000-4000-8000-000000000010') || '::uuid';
  v_foreign_org constant text := quote_literal('47050000-0000-4000-8000-000000000011') || '::uuid';
  v_due constant text := quote_literal('47050000-0000-4000-8000-000000000072') || '::uuid';
  v_admin constant text := quote_literal('47050000-0000-4000-8000-000000000001') || '::uuid';
  v_employee constant text := quote_literal('47050000-0000-4000-8000-000000000002') || '::uuid';
  v_foreign_admin constant text := quote_literal('47050000-0000-4000-8000-000000000003') || '::uuid';
  v_defects constant text := 'array[''Brenner zündet verzögert'']';
  v_target constant text := 'date ''2026-04-01''';
begin
  perform pg_temp.expect_refusal('unresolved without a next action',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', v_defects, 'null', 'null', 'null', 'null', v_admin),
    'maintenance_next_action_required');
  perform pg_temp.expect_refusal('unresolved without a Mangel',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', 'array[''  '']', '''warranty_check''', v_admin, v_target, 'null', v_admin),
    'maintenance_defect_required');
  perform pg_temp.expect_refusal('an employee as owner',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', v_defects, '''warranty_check''', v_employee, v_target, 'null', v_admin),
    'maintenance_next_action_owner_invalid');
  perform pg_temp.expect_refusal('another organization''s admin as owner',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', v_defects, '''warranty_check''', v_foreign_admin, v_target, 'null', v_admin),
    'maintenance_next_action_owner_invalid');
  perform pg_temp.expect_refusal('no target date',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', v_defects, '''warranty_check''', v_admin, 'null', 'null', v_admin),
    'maintenance_next_action_date_invalid');
  perform pg_temp.expect_refusal('a target date on the visit day',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', v_defects, '''warranty_check''', v_admin, 'date ''2026-03-11''', 'null', v_admin),
    'maintenance_next_action_date_invalid');
  perform pg_temp.expect_refusal('a Rückkehr on the regular next due date',
    pg_temp.complete_statement(v_org, v_due, 'partial', v_defects, '''return_visit''', v_admin, 'date ''2027-03-10''', 'null', v_admin),
    'maintenance_next_action_date_invalid');
  perform pg_temp.expect_refusal('a next action on a complete visit',
    pg_temp.complete_statement(v_org, v_due, 'complete', v_defects, '''warranty_check''', v_admin, v_target, 'null', v_admin),
    'maintenance_next_action_not_allowed');
  perform pg_temp.expect_refusal('Keine without a reason',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', v_defects, '''none''', 'null', 'null', 'null', v_admin),
    'maintenance_reason_required');
  perform pg_temp.expect_refusal('an employee completes',
    pg_temp.complete_statement(v_org, v_due, 'unresolved', v_defects, '''warranty_check''', v_admin, v_target, 'null', v_employee),
    'maintenance_not_authorized');
  perform pg_temp.expect_refusal('another organization completes this item',
    pg_temp.complete_statement(v_foreign_org, v_due, 'unresolved', v_defects, '''warranty_check''', v_foreign_admin, v_target, 'null', v_foreign_admin),
    'maintenance_due_not_found');
  if (select due_work.status from public.maintenance_due_work due_work
      where due_work.id = '47050000-0000-4000-8000-000000000072') is distinct from 'visit_created'
     or exists (select 1 from public.maintenance_visit_findings finding
       where finding.organization_id = '47050000-0000-4000-8000-000000000010') then
    raise exception 'a refused completion changed the due item or wrote a finding';
  end if;
end $$;

-- A Rückkehr opens a return item on the same revision, keeps the regular next
-- due date and gives the owner a follow-up on the visit job.
do $$ declare
  v_org constant uuid := '47050000-0000-4000-8000-000000000010';
  v_admin constant uuid := '47050000-0000-4000-8000-000000000001';
  v_buero constant uuid := '47050000-0000-4000-8000-000000000004';
  v_due constant uuid := '47050000-0000-4000-8000-000000000071';
  v_key constant uuid := '47050000-0000-4000-8000-000000000090';
  v_defects constant text[] := array['Brenner zündet verzögert', ' Abgasklappe klemmt '];
  v_after public.maintenance_due_work%rowtype;
  v_return public.maintenance_due_work%rowtype;
  v_finding public.maintenance_visit_findings%rowtype;
  v_follow_up public.client_follow_ups%rowtype;
  v_items bigint;
begin
  v_after := public.complete_maintenance_visit(v_org, v_due, 1, 'partial', '2026-01-12',
    array['47050000-0000-4000-8000-000000000046']::uuid[], 'Teilweise erledigt', v_defects,
    'return_visit', v_buero, '2026-02-15', null, v_admin, v_key);
  if v_after.status is distinct from 'completed' or v_after.scope_outcome is distinct from 'partial'
     or v_after.next_due_date is distinct from date '2027-01-10' then
    raise exception 'a Rückkehr moved the regular next due date or did not complete the visit: %', to_jsonb(v_after);
  end if;
  select * into v_return from public.maintenance_due_work due_work
  where due_work.organization_id = v_org and due_work.return_for_due_work_id = v_due;
  if v_return.id is null or v_return.status is distinct from 'open'
     or v_return.maintenance_plan_revision_id is distinct from '47050000-0000-4000-8000-000000000061'::uuid
     or v_return.due_date is distinct from date '2026-02-15'
     or v_return.window_start_date is distinct from date '2026-01-12' then
    raise exception 'a Rückkehr did not open a return item on the same revision and target date: %', to_jsonb(v_return);
  end if;
  if not exists (select 1 from public.maintenance_due_work_events event
    where event.organization_id = v_org and event.maintenance_due_work_id = v_return.id
      and event.event_type = 'generated' and event.request_operation = 'due_return_opened'
      and event.request_payload->>'returnForDueWorkId' = v_due::text) then
    raise exception 'the return item has no history naming the visit it returns to';
  end if;
  if not exists (select 1 from public.maintenance_due_work_events event
    where event.organization_id = v_org and event.maintenance_due_work_id = v_due
      and event.event_type = 'completed' and event.request_payload->>'nextAction' = 'return_visit'
      and event.request_payload->>'ownerUserId' = v_buero::text) then
    raise exception 'the completion history does not name the next action and its owner';
  end if;
  select * into v_finding from public.maintenance_visit_findings finding
  where finding.organization_id = v_org and finding.maintenance_due_work_id = v_due;
  select * into v_follow_up from public.client_follow_ups follow_up
  where follow_up.organization_id = v_org and follow_up.id = v_finding.client_follow_up_id;
  if v_finding.defects is distinct from array['Brenner zündet verzögert', 'Abgasklappe klemmt']
     or v_finding.next_action is distinct from 'return_visit' or v_finding.owner_user_id is distinct from v_buero
     or v_finding.return_due_work_id is distinct from v_return.id then
    raise exception 'the finding does not name the Mängel, the action, the owner and the return item: %', to_jsonb(v_finding);
  end if;
  if v_follow_up.owner_user_id is distinct from v_buero or v_follow_up.status is distinct from 'open'
     or v_follow_up.source_type is distinct from 'job'
     or v_follow_up.source_id is distinct from '47050000-0000-4000-8000-000000000040'::uuid
     or v_follow_up.client_id is distinct from '47050000-0000-4000-8000-000000000020'::uuid
     or v_follow_up.title is distinct from 'Rückkehr einplanen · WPL-NEXT · AUF-NEXT-1'
     or v_follow_up.due_at is distinct from timestamptz '2026-02-15 08:00 Europe/Berlin' then
    raise exception 'the owner has no open follow-up on the visit job: %', to_jsonb(v_follow_up);
  end if;
  if (select count(*) from public.client_follow_up_events event
      where event.organization_id = v_org and event.follow_up_id = v_follow_up.id) is distinct from 1::bigint then
    raise exception 'the follow-up has no created history';
  end if;

  -- A replay returns the item and writes nothing again.
  select count(*) into v_items from public.maintenance_due_work due_work where due_work.organization_id = v_org;
  v_after := public.complete_maintenance_visit(v_org, v_due, 1, 'partial', '2026-01-12',
    array['47050000-0000-4000-8000-000000000046']::uuid[], 'Teilweise erledigt', v_defects,
    'return_visit', v_buero, '2026-02-15', null, v_admin, v_key);
  if v_after.version is distinct from 2::bigint
     or (select count(*) from public.maintenance_due_work due_work where due_work.organization_id = v_org) is distinct from v_items
     or (select count(*) from public.client_follow_ups follow_up where follow_up.organization_id = v_org) is distinct from 1::bigint then
    raise exception 'a replayed completion wrote again';
  end if;
  perform pg_temp.expect_refusal('changed replay', format(
    'select public.complete_maintenance_visit(%L, %L, 1, %L, %L, array[%L]::uuid[], %L, array[%L], %L, %L, %L, null, %L, %L)',
    v_org, v_due, 'partial', '2026-01-12', '47050000-0000-4000-8000-000000000046', 'Teilweise erledigt',
    'Brenner zündet verzögert', 'return_visit', v_buero, '2026-02-16', v_admin, v_key), 'maintenance_idempotency_conflict');

end $$;

-- A replay recognizes the recorded completion although its owner has since
-- lost the Büro role: the owner is checked for a new completion only.
reset role;
update public.organization_members set role = 'employee'
where organization_id = '47050000-0000-4000-8000-000000000010' and user_id = '47050000-0000-4000-8000-000000000004';
set local role service_role;
do $$ declare
  v_org constant uuid := '47050000-0000-4000-8000-000000000010';
  v_items bigint;
  v_after public.maintenance_due_work%rowtype;
begin
  select count(*) into v_items from public.maintenance_due_work due_work where due_work.organization_id = v_org;
  v_after := public.complete_maintenance_visit(v_org, '47050000-0000-4000-8000-000000000071', 1, 'partial', '2026-01-12',
    array['47050000-0000-4000-8000-000000000046']::uuid[], 'Teilweise erledigt',
    array['Brenner zündet verzögert', ' Abgasklappe klemmt '], 'return_visit', '47050000-0000-4000-8000-000000000004',
    '2026-02-15', null, '47050000-0000-4000-8000-000000000001', '47050000-0000-4000-8000-000000000090');
  if v_after.version is distinct from 2::bigint or v_after.status is distinct from 'completed'
     or (select count(*) from public.maintenance_due_work due_work where due_work.organization_id = v_org) is distinct from v_items then
    raise exception 'a replay after the owner lost the Büro role did not return the first result: %', to_jsonb(v_after);
  end if;
end $$;
reset role;
update public.organization_members set role = 'buero'
where organization_id = '47050000-0000-4000-8000-000000000010' and user_id = '47050000-0000-4000-8000-000000000004';
set local role service_role;

-- The return item gets its visit job by hand: the seed role bypasses the guards.
reset role;
set local session_replication_role = replica;
update public.maintenance_due_work due_work set status = 'visit_created',
  job_id = '47050000-0000-4000-8000-000000000040'
where due_work.organization_id = '47050000-0000-4000-8000-000000000010'
  and due_work.return_for_due_work_id = '47050000-0000-4000-8000-000000000071';
set local session_replication_role = origin;
set local role service_role;

-- Completing the return item neither sets a next due date nor adds a regular
-- item; a second Rückkehr from it returns to the regular item, in its row and
-- its history alike.
do $$ declare
  v_org constant uuid := '47050000-0000-4000-8000-000000000010';
  v_regular constant uuid := '47050000-0000-4000-8000-000000000071';
  v_return public.maintenance_due_work%rowtype;
  v_second public.maintenance_due_work%rowtype;
  v_after public.maintenance_due_work%rowtype;
  v_items bigint;
begin
  select * into v_return from public.maintenance_due_work due_work
  where due_work.organization_id = v_org and due_work.return_for_due_work_id = v_regular;
  select count(*) into v_items from public.maintenance_due_work due_work where due_work.organization_id = v_org;
  v_after := public.complete_maintenance_visit(v_org, v_return.id, v_return.version, 'partial', '2026-02-14',
    array['47050000-0000-4000-8000-000000000046']::uuid[], 'Rückkehr teilweise erledigt', array['Abgasklappe klemmt'],
    'return_visit', '47050000-0000-4000-8000-000000000001', '2026-06-15', null,
    '47050000-0000-4000-8000-000000000001', gen_random_uuid());
  if v_after.status is distinct from 'completed' or v_after.next_due_date is not null
     or (select count(*) from public.maintenance_due_work due_work where due_work.organization_id = v_org) is distinct from v_items + 1 then
    raise exception 'completing a return item advanced the plan: %', to_jsonb(v_after);
  end if;
  select * into v_second from public.maintenance_due_work due_work
  where due_work.organization_id = v_org and due_work.due_date = date '2026-06-15';
  if v_second.return_for_due_work_id is distinct from v_regular then
    raise exception 'a second Rückkehr does not return to the regular item: %', to_jsonb(v_second);
  end if;
  if not exists (select 1 from public.maintenance_due_work_events event
    where event.organization_id = v_org and event.maintenance_due_work_id = v_second.id
      and event.request_operation = 'due_return_opened'
      and event.request_payload->>'returnForDueWorkId' = v_regular::text) then
    raise exception 'the second Rückkehr''s history names another item than its row';
  end if;
end $$;

-- Garantieprüfung gives the owner a follow-up and opens no due item; Keine
-- records its reason without a follow-up; the previous entry still completes
-- an unfinished visit without a finding, as the deployed build expects.
do $$ declare
  v_org constant uuid := '47050000-0000-4000-8000-000000000010';
  v_admin constant uuid := '47050000-0000-4000-8000-000000000001';
  v_evidence constant uuid[] := array['47050000-0000-4000-8000-000000000046']::uuid[];
  v_items bigint;
  v_finding public.maintenance_visit_findings%rowtype;
  v_after public.maintenance_due_work%rowtype;
begin
  select count(*) into v_items from public.maintenance_due_work due_work where due_work.organization_id = v_org;
  perform public.complete_maintenance_visit(v_org, '47050000-0000-4000-8000-000000000072', 1, 'unresolved',
    '2026-03-11', v_evidence, 'Nicht behoben', array['Umwälzpumpe defekt'], 'warranty_check', v_admin,
    '2027-06-01', null, v_admin, gen_random_uuid());
  select * into v_finding from public.maintenance_visit_findings finding
  where finding.organization_id = v_org and finding.maintenance_due_work_id = '47050000-0000-4000-8000-000000000072';
  if v_finding.next_action is distinct from 'warranty_check' or v_finding.return_due_work_id is not null
     or not exists (select 1 from public.client_follow_ups follow_up
       where follow_up.organization_id = v_org and follow_up.id = v_finding.client_follow_up_id
         and follow_up.owner_user_id = v_admin and follow_up.title = 'Garantie prüfen · WPL-NEXT · AUF-NEXT-1')
     or (select count(*) from public.maintenance_due_work due_work where due_work.organization_id = v_org) is distinct from v_items then
    raise exception 'a Garantieprüfung did not give one follow-up without a due item: %', to_jsonb(v_finding);
  end if;

  perform public.complete_maintenance_visit(v_org, '47050000-0000-4000-8000-000000000073', 1, 'unresolved',
    '2026-04-11', v_evidence, 'Nicht behoben', array['Kunde lehnt Reparatur ab'], 'none', null,
    null, 'Kunde kümmert sich selbst', v_admin, gen_random_uuid());
  select * into v_finding from public.maintenance_visit_findings finding
  where finding.organization_id = v_org and finding.maintenance_due_work_id = '47050000-0000-4000-8000-000000000073';
  if v_finding.next_action is distinct from 'none' or v_finding.note is distinct from 'Kunde kümmert sich selbst'
     or v_finding.client_follow_up_id is not null then
    raise exception 'Keine did not record its reason alone: %', to_jsonb(v_finding);
  end if;

  v_after := public.complete_maintenance_due_work(v_org, '47050000-0000-4000-8000-000000000074', 1, 'partial',
    '2026-05-11', v_evidence, 'Wartung dokumentiert', v_admin, gen_random_uuid());
  if v_after.status is distinct from 'completed' or v_after.next_due_date is distinct from date '2027-05-10'
     or exists (select 1 from public.maintenance_visit_findings finding
       where finding.organization_id = v_org and finding.maintenance_due_work_id = v_after.id) then
    raise exception 'the previous entry no longer completes as the deployed build expects: %', to_jsonb(v_after);
  end if;
end $$;

-- Even the table owner cannot rewrite or delete a finding.
reset role;
do $$ begin
  perform pg_temp.expect_refusal('a finding update', format(
    'update public.maintenance_visit_findings set note = %L where organization_id = %L',
    'Geändert', '47050000-0000-4000-8000-000000000010'), 'maintenance_history_is_immutable');
  perform pg_temp.expect_refusal('a finding delete', format(
    'delete from public.maintenance_visit_findings where organization_id = %L',
    '47050000-0000-4000-8000-000000000010'), 'maintenance_history_is_immutable');
end $$;

rollback;
