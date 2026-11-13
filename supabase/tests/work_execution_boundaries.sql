-- P1-14, P1-15 and P1-17 database rules behind the work execution journeys:
-- lifecycle mutations stay inside their own ledger, the assigned employee
-- neither cancels nor parks the job and never approves the own report, and lifecycle, evidence
-- and handover rows are invisible to another organization while the owning
-- managers read them.
-- An employee assigned to a job of a project reads the project's work state
-- and the project's own documents; an unassigned colleague and another
-- organization read neither.
-- The assigned employee ticks the checklist of open work only; finished or
-- cancelled work keeps its checklist, which Admin and Büro still change.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('14170000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-boundary-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Work"}', now(), now()),
('14170000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-boundary-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Work"}', now(), now()),
('14170000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-boundary-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Work"}', now(), now()),
('14170000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-boundary-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"Work"}', now(), now()),
('14170000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-boundary-buero@example.test', '', now(), '{}',
 '{"first_name":"Buero","last_name":"Work"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('14170000-0000-0000-0000-000000000010', 'Work boundaries SQL',
 '14170000-0000-0000-0000-000000000001', 'WORKSQL'),
('14170000-0000-0000-0000-000000000011', 'Work boundaries SQL Outsider',
 '14170000-0000-0000-0000-000000000004', 'WORKOUT');
insert into public.organization_members (organization_id, user_id, role) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000003', 'employee'),
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000005', 'employee'),
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000006', 'buero');

insert into public.jobs (id, organization_id, title, job_number, created_by) values
('14170000-0000-0000-0000-000000000020', '14170000-0000-0000-0000-000000000010',
 'Lebenszyklus', 'WORK-SQL-1', '14170000-0000-0000-0000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000020',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001');

-- A project whose job the employee works on; the colleague has no job in it.
insert into public.projects (id, organization_id, name, created_by) values
('14170000-0000-0000-0000-000000000050', '14170000-0000-0000-0000-000000000010',
 'Projektzugriff', '14170000-0000-0000-0000-000000000001');
insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
('14170000-0000-0000-0000-000000000051', '14170000-0000-0000-0000-000000000010',
 '14170000-0000-0000-0000-000000000050', 'Projektauftrag', 'WORK-SQL-2',
 '14170000-0000-0000-0000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000051',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001');
insert into public.documents (
  id, organization_id, display_name, original_file_name, size_bytes, storage_path, uploaded_by
) values (
  '14170000-0000-0000-0000-000000000060', '14170000-0000-0000-0000-000000000010',
  'Projektplan', 'projektplan.pdf', 1,
  '14170000-0000-0000-0000-000000000010/14170000-0000-0000-0000-000000000060/projektplan.pdf',
  '14170000-0000-0000-0000-000000000001'
);
insert into public.document_links (organization_id, document_id, project_id, created_by) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000060',
 '14170000-0000-0000-0000-000000000050', '14170000-0000-0000-0000-000000000001');

-- A document of the lifecycle job, the source of its handover release.
insert into public.documents (
  id, organization_id, display_name, original_file_name, size_bytes, storage_path, uploaded_by
) values (
  '14170000-0000-0000-0000-0000000000b1', '14170000-0000-0000-0000-000000000010',
  'Prüfprotokoll', 'pruefprotokoll.pdf', 1,
  '14170000-0000-0000-0000-000000000010/14170000-0000-0000-0000-0000000000b1/pruefprotokoll.pdf',
  '14170000-0000-0000-0000-000000000001'
);
insert into public.document_links (organization_id, document_id, job_id, created_by) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-0000000000b1',
 '14170000-0000-0000-0000-000000000020', '14170000-0000-0000-0000-000000000001');

-- Two jobs of the employee, each with a checklist, for the read-only checklist of finished work.
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('14170000-0000-0000-0000-000000000070', '14170000-0000-0000-0000-000000000010',
 'Checkliste fertig', 'WORK-SQL-3', '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000071', '14170000-0000-0000-0000-000000000010',
 'Checkliste storniert', 'WORK-SQL-4', '14170000-0000-0000-0000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000070',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000071',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001');
insert into public.job_instruction_items (id, organization_id, job_id, content, sort_order, created_by) values
('14170000-0000-0000-0000-000000000072', '14170000-0000-0000-0000-000000000010',
 '14170000-0000-0000-0000-000000000070', 'Ventil prüfen', 0, '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000073', '14170000-0000-0000-0000-000000000010',
 '14170000-0000-0000-0000-000000000070', 'Druck dokumentieren', 1, '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000074', '14170000-0000-0000-0000-000000000010',
 '14170000-0000-0000-0000-000000000071', 'Material abholen', 0, '14170000-0000-0000-0000-000000000001');

-- A handed-over job, and an older job that carries only its legacy status.
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('14170000-0000-0000-0000-000000000075', '14170000-0000-0000-0000-000000000010',
 'Checkliste übergeben', 'WORK-SQL-5', '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000077', '14170000-0000-0000-0000-000000000010',
 'Checkliste Altauftrag', 'WORK-SQL-6', '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000079', '14170000-0000-0000-0000-000000000010',
 'Checkliste Altauftrag offen', 'WORK-SQL-7', '14170000-0000-0000-0000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000075',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000077',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000079',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001');
insert into public.job_instruction_items (id, organization_id, job_id, content, sort_order, created_by) values
('14170000-0000-0000-0000-000000000076', '14170000-0000-0000-0000-000000000010',
 '14170000-0000-0000-0000-000000000075', 'Abnahme vorbereiten', 0, '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000078', '14170000-0000-0000-0000-000000000010',
 '14170000-0000-0000-0000-000000000077', 'Altlast prüfen', 0, '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000080', '14170000-0000-0000-0000-000000000010',
 '14170000-0000-0000-0000-000000000079', 'Altlast offen', 0, '14170000-0000-0000-0000-000000000001');

-- A job both employees work on, for the internal-draft rule.
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('14170000-0000-0000-0000-000000000090', '14170000-0000-0000-0000-000000000010',
 'Gemeinsamer Auftrag', 'WORK-SQL-8', '14170000-0000-0000-0000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000090',
 '14170000-0000-0000-0000-000000000003', '14170000-0000-0000-0000-000000000001'),
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000090',
 '14170000-0000-0000-0000-000000000005', '14170000-0000-0000-0000-000000000001');

set local role service_role;

-- The field work pack shows the checklist read-only once work is finished or
-- cancelled (isFieldWorkPackReadOnly); the function refuses the assigned
-- employee there, and Admin and Büro still correct the list.
do $$
declare
  v_org constant uuid := '14170000-0000-0000-0000-000000000010';
  v_admin constant uuid := '14170000-0000-0000-0000-000000000001';
  v_employee constant uuid := '14170000-0000-0000-0000-000000000003';
  v_finished_job constant uuid := '14170000-0000-0000-0000-000000000070';
  v_cancelled_job constant uuid := '14170000-0000-0000-0000-000000000071';
  v_ticked constant uuid := '14170000-0000-0000-0000-000000000072';
  v_open constant uuid := '14170000-0000-0000-0000-000000000073';
  v_cancelled_item constant uuid := '14170000-0000-0000-0000-000000000074';
  v_events integer;
  v_attempt record;
begin
  -- Open work: the assigned employee ticks an item.
  if public.set_instruction_item_completion(v_org, v_employee, v_ticked, 0, true) is distinct from 1 then
    raise exception 'the assigned employee could not tick an item of open work';
  end if;

  perform public.transition_work_execution(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_finished_job,
    p_to_state => 'in_progress', p_expected_version => 0, p_actor_id => v_admin
  );
  perform public.transition_work_execution(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_finished_job,
    p_to_state => 'execution_complete', p_expected_version => 1, p_actor_id => v_admin,
    p_override_gates => true, p_reason => 'Restpunkt wird in der Übergabe ausgewiesen.'
  );
  perform public.transition_work_execution(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_cancelled_job,
    p_to_state => 'cancelled', p_expected_version => 0, p_actor_id => v_admin,
    p_reason => 'Kunde hat abgesagt.'
  );
  -- Fixture states: the lifecycle to handover needs a full Übergabe, and an
  -- older job predates execution_state. Both are written directly here.
  perform set_config('app.work_execution_write', 'true', true);
  update public.jobs set execution_state = 'handed_over'
  where id = '14170000-0000-0000-0000-000000000075';
  perform set_config('app.work_execution_write', 'true', true);
  update public.jobs set execution_state = null, status = 'fertig'
  where id = '14170000-0000-0000-0000-000000000077';
  perform set_config('app.work_execution_write', 'true', true);
  update public.jobs set execution_state = null, status = 'in_bearbeitung'
  where id = '14170000-0000-0000-0000-000000000079';
  -- An older job still in progress keeps its checklist open to the employee.
  if public.set_instruction_item_completion(
    v_org, v_employee, '14170000-0000-0000-0000-000000000080', 0, true
  ) is distinct from 1 then
    raise exception 'the assigned employee could not tick an item of an open legacy job';
  end if;

  select count(*) into v_events from public.job_instruction_item_events
  where organization_id = v_org;
  for v_attempt in
    select * from (values
      (v_ticked, 1::bigint, false, 'unticked an item of finished work'),
      (v_open, 0::bigint, true, 'ticked an item of finished work'),
      (v_cancelled_item, 0::bigint, true, 'ticked an item of cancelled work'),
      ('14170000-0000-0000-0000-000000000076'::uuid, 0::bigint, true, 'ticked an item of handed-over work'),
      ('14170000-0000-0000-0000-000000000078'::uuid, 0::bigint, true, 'ticked an item of a finished legacy job')
    ) attempt(item_id, expected_version, is_completed, label)
  loop
    begin
      perform public.set_instruction_item_completion(
        v_org, v_employee, v_attempt.item_id, v_attempt.expected_version, v_attempt.is_completed
      );
      raise exception 'the assigned employee %', v_attempt.label;
    exception when others then
      if sqlerrm <> 'instruction_item_not_authorized' then raise; end if;
    end;
  end loop;
  if (select count(*) from public.job_instruction_item_events where organization_id = v_org) is distinct from v_events
    or (select is_completed from public.job_instruction_items where id = v_ticked) is not true
    or (select is_completed from public.job_instruction_items where id = v_open) is not false
  then raise exception 'a refused checklist change on finished work left a trace'; end if;

  -- Admin and Büro keep correcting the checklist of finished work.
  if public.set_instruction_item_completion(v_org, v_admin, v_open, 0, true) is distinct from 1 then
    raise exception 'the admin could not tick an item of finished work';
  end if;
  if public.set_instruction_item_completion(
    v_org, '14170000-0000-0000-0000-000000000006', v_open, 1, false
  ) is distinct from 2 then
    raise exception 'Büro could not untick an item of finished work';
  end if;
end;
$$;

do $$
declare
  v_org constant uuid := '14170000-0000-0000-0000-000000000010';
  v_admin constant uuid := '14170000-0000-0000-0000-000000000001';
  v_employee constant uuid := '14170000-0000-0000-0000-000000000003';
  v_job constant uuid := '14170000-0000-0000-0000-000000000020';
  v_employee_record uuid;
  v_transition record;
  v_blocker record;
  v_result jsonb;
  v_actor uuid;
begin
  select id into v_employee_record from public.employee_records
  where organization_id = v_org and user_id = v_employee;

  -- P1-14: a manual start and an own blocker write lifecycle facts only.
  select * into v_transition from public.transition_work_execution(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
    p_to_state => 'in_progress', p_expected_version => 0, p_actor_id => v_admin
  );
  if v_transition.execution_state is distinct from 'in_progress' or v_transition.execution_version is distinct from 1
  then raise exception 'the manual start did not move the job to version 1 in progress'; end if;

  -- The client offers only getAllowedWorkTransitions (lib/ui/action-prechecks.ts):
  -- a step outside the matrix and a manager-only step for an employee are refused.
  begin
    perform public.transition_work_execution(
      p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
      p_to_state => 'not_started', p_expected_version => 1, p_actor_id => v_admin
    );
    raise exception 'a step outside the transition matrix was accepted';
  exception when others then
    if sqlerrm not like '%work_transition_not_allowed%' then raise; end if;
  end;
  begin
    perform public.transition_work_execution(
      p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
      p_to_state => 'cancelled', p_expected_version => 1, p_actor_id => v_employee,
      p_reason => 'Kunde hat abgesagt.'
    );
    raise exception 'an employee cancelled the job';
  exception when others then
    if sqlerrm not like '%work_transition_not_authorized%' then raise; end if;
  end;
  -- The lifecycle card offers parking to managers only; the function refuses the assigned employee.
  begin
    perform public.park_work_target(
      v_org, v_employee, 'job', v_job, 1, 'material', null, v_employee_record,
      (now() at time zone 'Europe/Berlin')::date
    );
    raise exception 'an employee parked the job';
  exception when others then
    if sqlerrm not like '%work_parking_not_authorized%' then raise; end if;
  end;

  select * into v_blocker from public.upsert_work_blocker(
    p_organization_id => v_org, p_blocker_id => null, p_expected_version => null,
    p_job_id => v_job, p_project_id => null, p_instruction_item_id => null,
    p_kind => 'blocker', p_reason => 'site_access', p_details => 'Schlüssel fehlt.',
    p_responsible_employee_record_id => v_employee_record,
    p_next_review_date => (now() at time zone 'Europe/Berlin')::date, p_actor_id => v_employee
  );
  if v_blocker.blocker_version is distinct from 1 then raise exception 'the own blocker was not created at version 1'; end if;

  if exists (select 1 from public.inventory_movements where job_id = v_job)
    or exists (select 1 from public.time_entries where job_id = v_job)
    or exists (select 1 from public.time_segments where job_id = v_job)
    or exists (select 1 from public.planning_occurrences where job_id = v_job)
  then raise exception 'a lifecycle mutation wrote stock, time or schedule facts'; end if;
  if (select array_agg(to_state::text) from public.work_execution_events where job_id = v_job)
     is distinct from array['in_progress']
  then raise exception 'the lifecycle ledger does not hold exactly the start event'; end if;

  -- P1-15: the assigned employee submits a work report for review.
  v_result := public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => '14170000-0000-0000-0000-000000000030',
    p_revision_id => '14170000-0000-0000-0000-000000000031', p_job_id => v_job, p_project_id => null,
    p_kind => 'work_report', p_visibility => 'internal_only', p_title => 'Arbeitsbericht',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => true,
    p_submit_action_id => '14170000-0000-0000-0000-000000000032', p_actor_id => v_employee
  );
  if not exists (select 1 from public.work_artifacts
      where id = '14170000-0000-0000-0000-000000000030' and status = 'submitted' and created_by = v_employee)
  then raise exception 'the submitted work report was not recorded'; end if;

  -- A replayed revision or action id answers the assigned author and refuses
  -- the unassigned colleague, who learns nothing about the artifact.
  foreach v_actor in array array[v_employee, '14170000-0000-0000-0000-000000000005']::uuid[] loop
    begin
      v_result := public.create_work_artifact_revision(
        p_organization_id => v_org, p_artifact_id => '14170000-0000-0000-0000-000000000030',
        p_revision_id => '14170000-0000-0000-0000-000000000031', p_job_id => v_job, p_project_id => null,
        p_kind => 'work_report', p_visibility => 'internal_only', p_title => 'Arbeitsbericht',
        p_content => '{}'::jsonb, p_captured_at => now(), p_correction_reason => null,
        p_corrects_revision_id => null, p_expected_version => null, p_submit => true,
        p_submit_action_id => '14170000-0000-0000-0000-000000000032', p_actor_id => v_actor
      );
      if v_actor is distinct from v_employee then raise exception 'an unassigned colleague replayed the revision'; end if;
      if not (v_result ->> 'duplicate')::boolean then raise exception 'the author''s retry was no replay'; end if;
    exception when others then
      if v_actor = v_employee or sqlerrm <> 'work_artifact_not_authorized' then raise; end if;
    end;
    begin
      v_result := public.record_work_artifact_action(
        p_organization_id => v_org, p_actor_id => v_actor,
        p_artifact_id => '14170000-0000-0000-0000-000000000030',
        p_revision_id => '14170000-0000-0000-0000-000000000031',
        p_action_id => '14170000-0000-0000-0000-000000000032', p_expected_version => 1,
        p_action_type => 'review_requested', p_reason => null, p_comment => null,
        p_responsibility_snapshot => null, p_customer_context => null, p_signature_document_id => null
      );
      if v_actor is distinct from v_employee then raise exception 'an unassigned colleague replayed the action'; end if;
      if not (v_result ->> 'duplicate')::boolean then raise exception 'the author''s retry was no replay'; end if;
    exception when others then
      if v_actor = v_employee or sqlerrm <> 'work_artifact_not_authorized' then raise; end if;
    end;
  end loop;

  -- Four eyes: the author never approves the own report, so a second person must.
  begin
    perform public.record_work_artifact_action(
      p_organization_id => v_org, p_actor_id => v_employee,
      p_artifact_id => '14170000-0000-0000-0000-000000000030',
      p_revision_id => '14170000-0000-0000-0000-000000000031',
      p_action_id => '14170000-0000-0000-0000-000000000033', p_expected_version => 1,
      p_action_type => 'internal_approved', p_reason => null, p_comment => null,
      p_responsibility_snapshot => null, p_customer_context => null, p_signature_document_id => null
    );
    raise exception 'the author approved the own work report';
  exception when others then
    if sqlerrm <> 'work_artifact_self_approval_not_allowed' then raise; end if;
  end;

  -- P1-17: completed work (with a reasoned manager exception for the open blocker)
  -- receives a handover draft.
  perform public.transition_work_execution(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
    p_to_state => 'execution_complete', p_expected_version => 1, p_actor_id => v_admin,
    p_override_gates => true, p_reason => 'Offener Blocker wird in der Übergabe ausgewiesen.'
  );
  v_result := public.save_work_handover_draft(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
    p_package_id => '14170000-0000-0000-0000-000000000041',
    p_expected_version => null, p_request_id => '14170000-0000-0000-0000-000000000040',
    p_items => '[]'::jsonb, p_actor_id => v_admin
  );
  if not exists (select 1 from public.work_handover_packages where job_id = v_job)
  then raise exception 'the handover draft was not recorded'; end if;
end;
$$;

-- P1-17: a release registers its package under the storage key of its own
-- attempt, `<release folder>/<attempt id>-<renderer>-<content hash>.html`, so
-- two attempts never share a key. A key outside that form is refused before
-- anything is written. The previous release's shared key still passes the
-- check. A replay with another attempt's key answers with the registered
-- package and registers nothing.
do $$
declare
  v_org constant uuid := '14170000-0000-0000-0000-000000000010';
  v_admin constant uuid := '14170000-0000-0000-0000-000000000001';
  v_job constant uuid := '14170000-0000-0000-0000-000000000020';
  v_package constant uuid := '14170000-0000-0000-0000-000000000041';
  v_release constant uuid := '14170000-0000-0000-0000-0000000000b3';
  v_request constant uuid := '14170000-0000-0000-0000-0000000000b4';
  v_document constant uuid := '14170000-0000-0000-0000-0000000000b5';
  v_name constant text := 'sql-test-v1-' || repeat('b', 64) || '.html';
  v_folder constant text := v_org::text || '/work-handover-packages/' || v_release::text || '/';
  v_attempt_path constant text := v_folder || '0f8fad5b-d9cb-469f-a165-70867728950e-' || v_name;
  v_replay_path constant text := v_folder || '7c9e6679-7425-40de-944b-e07fc1f90ae7-' || v_name;
  v_gate jsonb;
  v_package_version bigint;
  v_execution_version bigint;
  v_case text[];
  v_path text;
  v_result jsonb;
begin
  select version into v_package_version from public.work_handover_packages where id = v_package;
  v_result := public.save_work_handover_draft(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
    p_package_id => v_package, p_expected_version => v_package_version,
    p_request_id => '14170000-0000-0000-0000-0000000000b6',
    p_items => jsonb_build_array(jsonb_build_object(
      'id', 'a3bb189e-8bf9-4888-9912-ace4e6543002', 'source_kind', 'document_version',
      'document_id', '14170000-0000-0000-0000-0000000000b1', 'document_version_number', 1,
      'document_storage_path',
      '14170000-0000-0000-0000-000000000010/14170000-0000-0000-0000-0000000000b1/pruefprotokoll.pdf',
      'customer_label', 'Prüfprotokoll', 'sort_order', 0
    )),
    p_actor_id => v_admin
  );
  select version into v_package_version from public.work_handover_packages where id = v_package;
  select execution_version into v_execution_version from public.jobs where id = v_job;
  v_gate := public.get_work_handover_gate_snapshot(v_org, v_admin, 'job', v_job);

  -- The path check comes before the package version check: a refused key
  -- reads as invalid input, an accepted key on a stale version as stale.
  foreach v_case slice 1 in array array[
    [v_folder || v_name, 'work_handover_stale_version'],
    [v_attempt_path, 'work_handover_stale_version'],
    [v_org::text || '/work-handover-packages/14170000-0000-0000-0000-0000000000b7/'
      || '0f8fad5b-d9cb-469f-a165-70867728950e-' || v_name, 'work_handover_invalid_input'],
    ['14170000-0000-0000-0000-000000000011/work-handover-packages/' || v_release::text
      || '/0f8fad5b-d9cb-469f-a165-70867728950e-' || v_name, 'work_handover_invalid_input'],
    [v_folder || 'anlage/0f8fad5b-d9cb-469f-a165-70867728950e-' || v_name, 'work_handover_invalid_input'],
    [v_folder || '0f8fad5b-d9cb-469f-a165-70867728950e/' || v_name, 'work_handover_invalid_input'],
    [v_folder || '0f8fad5b-d9cb-469f-a165-70867728950e-sql-test-v1-' || repeat('c', 64) || '.html',
      'work_handover_invalid_input']
  ] loop
    v_path := v_case[1];
    begin
      perform public.release_work_handover(
        p_organization_id => v_org, p_actor_id => v_admin, p_package_id => v_package,
        p_release_id => v_release, p_request_id => gen_random_uuid(),
        p_expected_package_version => v_package_version + 1,
        p_expected_execution_version => v_execution_version,
        p_expected_gate_fingerprint => v_gate ->> 'fingerprint',
        p_handover_reason => 'Übergabe an Kunden', p_override_gates => true,
        p_override_reason => 'Offener Blocker ist ausgewiesen.',
        p_target_snapshot => '{}'::jsonb, p_time_summary => '{}'::jsonb,
        p_material_summary => '{}'::jsonb, p_responsibility_snapshot => '{}'::jsonb,
        p_unassessed_facts => '[]'::jsonb,
        p_item_payloads => jsonb_build_array(jsonb_build_object(
          'draft_item_id', 'a3bb189e-8bf9-4888-9912-ace4e6543002', 'customer_payload', '{}'::jsonb)),
        p_document_id => gen_random_uuid(), p_document_link_id => gen_random_uuid(),
        p_storage_path => v_path, p_file_name => 'uebergabe.html', p_size_bytes => 1,
        p_renderer_version => 'sql-test-v1', p_content_hash => repeat('b', 64)
      );
      raise exception 'a release on a stale version was recorded';
    exception when others then
      if sqlerrm is distinct from v_case[2] then
        raise exception 'release key %: expected %, got %', v_path, v_case[2], sqlerrm;
      end if;
    end;
  end loop;

  -- The attempt's own key is registered; a replay with another attempt's key
  -- answers with that package.
  foreach v_path in array array[v_attempt_path, v_replay_path] loop
    v_result := public.release_work_handover(
      p_organization_id => v_org, p_actor_id => v_admin, p_package_id => v_package,
      p_release_id => v_release, p_request_id => v_request,
      p_expected_package_version => v_package_version,
      p_expected_execution_version => v_execution_version,
      p_expected_gate_fingerprint => v_gate ->> 'fingerprint',
      p_handover_reason => 'Übergabe an Kunden', p_override_gates => true,
      p_override_reason => 'Offener Blocker ist ausgewiesen.',
      p_target_snapshot => '{}'::jsonb, p_time_summary => '{}'::jsonb,
      p_material_summary => '{}'::jsonb, p_responsibility_snapshot => '{}'::jsonb,
      p_unassessed_facts => '[]'::jsonb,
      p_item_payloads => jsonb_build_array(jsonb_build_object(
        'draft_item_id', 'a3bb189e-8bf9-4888-9912-ace4e6543002', 'customer_payload', '{}'::jsonb)),
      p_document_id => case when v_path = v_attempt_path then v_document else gen_random_uuid() end,
      p_document_link_id => gen_random_uuid(),
      p_storage_path => v_path, p_file_name => 'uebergabe.html', p_size_bytes => 1,
      p_renderer_version => 'sql-test-v1', p_content_hash => repeat('b', 64)
    );
    if (v_result ->> 'documentId')::uuid is distinct from v_document
      or (v_result ->> 'duplicate')::boolean is distinct from (v_path = v_replay_path)
    then raise exception 'release with key % answered %', v_path, v_result; end if;
  end loop;
  if (select array_agg(storage_path) from public.documents
      where organization_id = v_org and storage_path like v_folder || '%') is distinct from array[v_attempt_path]
  then raise exception 'the release did not register exactly its own attempt''s key'; end if;
end;
$$;

-- A field worker's internal draft stays private: an assigned coworker cannot
-- send it to review, and the refusal changes nothing. Its author and a manager
-- can, and another organization's id is refused.
do $$
declare
  v_org constant uuid := '14170000-0000-0000-0000-000000000010';
  v_foreign_org constant uuid := '14170000-0000-0000-0000-000000000011';
  v_admin constant uuid := '14170000-0000-0000-0000-000000000001';
  v_author constant uuid := '14170000-0000-0000-0000-000000000003';
  v_coworker constant uuid := '14170000-0000-0000-0000-000000000005';
  v_outsider constant uuid := '14170000-0000-0000-0000-000000000004';
  v_job constant uuid := '14170000-0000-0000-0000-000000000090';
  v_draft constant uuid := '14170000-0000-0000-0000-000000000091';
  v_draft_revision constant uuid := '14170000-0000-0000-0000-000000000092';
  v_second_draft constant uuid := '14170000-0000-0000-0000-000000000093';
  v_second_revision constant uuid := '14170000-0000-0000-0000-000000000094';
  v_buero constant uuid := '14170000-0000-0000-0000-000000000006';
  v_third_draft constant uuid := '14170000-0000-0000-0000-0000000000a1';
  v_third_revision constant uuid := '14170000-0000-0000-0000-0000000000a2';
  v_fourth_draft constant uuid := '14170000-0000-0000-0000-0000000000a3';
  v_fourth_revision constant uuid := '14170000-0000-0000-0000-0000000000a4';
  v_result jsonb;
begin
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => v_draft, p_revision_id => v_draft_revision,
    p_job_id => v_job, p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only',
    p_title => 'Privater Entwurf',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_author
  );
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => v_second_draft, p_revision_id => v_second_revision,
    p_job_id => v_job, p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only',
    p_title => 'Zweiter privater Entwurf',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_author
  );
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => v_third_draft, p_revision_id => v_third_revision,
    p_job_id => v_job, p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only',
    p_title => 'Dritter privater Entwurf',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_author
  );
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => v_fourth_draft, p_revision_id => v_fourth_revision,
    p_job_id => v_job, p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only',
    p_title => 'Vierter privater Entwurf',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_author
  );

  -- Nor can the coworker write a revision over it and so take it over, even unsubmitted.
  begin
    perform public.create_work_artifact_revision(
      p_organization_id => v_org, p_artifact_id => v_draft,
      p_revision_id => '14170000-0000-0000-0000-0000000000a5',
      p_job_id => v_job, p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only',
      p_title => 'Übernommen',
      p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
      p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
      p_expected_version => 1, p_submit => false, p_submit_action_id => null, p_actor_id => v_coworker
    );
    raise exception 'an assigned coworker wrote a revision over another person''s internal draft';
  exception when others then
    if sqlerrm <> 'work_artifact_not_authorized' then raise; end if;
  end;
  if not exists (select 1 from public.work_artifacts
      where id = v_draft and version = 1 and current_revision_id = v_draft_revision)
  then raise exception 'a refused revision changed the internal draft'; end if;

  -- The assigned coworker reads the ids and version, but the review request is refused.
  begin
    perform public.record_work_artifact_action(
      p_organization_id => v_org, p_actor_id => v_coworker, p_artifact_id => v_draft,
      p_revision_id => v_draft_revision, p_action_id => '14170000-0000-0000-0000-000000000095',
      p_expected_version => 1, p_action_type => 'review_requested', p_reason => null, p_comment => null,
      p_responsibility_snapshot => null, p_customer_context => null, p_signature_document_id => null
    );
    raise exception 'an assigned coworker sent another person''s internal draft to review';
  exception when others then
    if sqlerrm <> 'work_artifact_not_authorized' then raise; end if;
  end;
  if not exists (select 1 from public.work_artifacts
      where id = v_draft and status = 'draft' and version = 1)
    or exists (select 1 from public.work_artifact_actions where artifact_id = v_draft)
  then raise exception 'a refused review request changed the internal draft'; end if;

  -- Another organization's admin names the draft inside the own organization and learns nothing.
  begin
    perform public.record_work_artifact_action(
      p_organization_id => v_foreign_org, p_actor_id => v_outsider, p_artifact_id => v_draft,
      p_revision_id => v_draft_revision, p_action_id => '14170000-0000-0000-0000-000000000096',
      p_expected_version => 1, p_action_type => 'review_requested', p_reason => null, p_comment => null,
      p_responsibility_snapshot => null, p_customer_context => null, p_signature_document_id => null
    );
    raise exception 'another organization sent the internal draft to review';
  exception when others then
    if sqlerrm <> 'work_artifact_not_found' then raise; end if;
  end;

  -- The author sends the own draft, and a manager sends the author's other draft.
  v_result := public.record_work_artifact_action(
    p_organization_id => v_org, p_actor_id => v_author, p_artifact_id => v_draft,
    p_revision_id => v_draft_revision, p_action_id => '14170000-0000-0000-0000-000000000097',
    p_expected_version => 1, p_action_type => 'review_requested', p_reason => null, p_comment => null,
    p_responsibility_snapshot => null, p_customer_context => null, p_signature_document_id => null
  );
  if v_result ->> 'status' is distinct from 'submitted' then
    raise exception 'the author could not send the own internal draft to review';
  end if;
  v_result := public.record_work_artifact_action(
    p_organization_id => v_org, p_actor_id => v_admin, p_artifact_id => v_second_draft,
    p_revision_id => v_second_revision, p_action_id => '14170000-0000-0000-0000-000000000098',
    p_expected_version => 1, p_action_type => 'review_requested', p_reason => null, p_comment => null,
    p_responsibility_snapshot => null, p_customer_context => null, p_signature_document_id => null
  );
  if v_result ->> 'status' is distinct from 'submitted' then
    raise exception 'a manager could not send a field worker''s internal draft to review';
  end if;
  -- Büro is a manager too.
  v_result := public.record_work_artifact_action(
    p_organization_id => v_org, p_actor_id => v_buero, p_artifact_id => v_third_draft,
    p_revision_id => v_third_revision, p_action_id => '14170000-0000-0000-0000-0000000000a6',
    p_expected_version => 1, p_action_type => 'review_requested', p_reason => null, p_comment => null,
    p_responsibility_snapshot => null, p_customer_context => null, p_signature_document_id => null
  );
  if v_result ->> 'status' is distinct from 'submitted' then
    raise exception 'Büro could not send a field worker''s internal draft to review';
  end if;
  -- A manager may write the next revision of a field worker's internal draft.
  v_result := public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => v_fourth_draft,
    p_revision_id => '14170000-0000-0000-0000-0000000000a7',
    p_job_id => v_job, p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only',
    p_title => 'Vom Büro ergänzt',
    p_content => '{"summary":"Anlage geprüft","performedWork":"Filter gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}'::jsonb,
    p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => 1, p_submit => false, p_submit_action_id => null, p_actor_id => v_admin
  );
  if (v_result ->> 'version')::bigint is distinct from 2 then
    raise exception 'a manager could not write a revision over a field worker''s internal draft';
  end if;
end;
$$;

-- Another organization reads none of these rows; the owning admin reads each family.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14170000-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
declare
  v_table text;
  v_count integer;
begin
  foreach v_table in array array[
    'work_blockers', 'work_blocker_events', 'work_execution_events', 'work_artifacts',
    'work_handover_packages', 'work_handover_events'
  ] loop
    execute format('select count(*) from public.%I where organization_id = $1', v_table)
      into v_count using '14170000-0000-0000-0000-000000000010'::uuid;
    if v_count is distinct from 0 then raise exception 'another organization reads % rows', v_table; end if;
  end loop;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"14170000-0000-0000-0000-000000000001","role":"authenticated"}', true);
do $$
declare
  v_table text;
  v_count integer;
begin
  foreach v_table in array array[
    'work_blockers', 'work_blocker_events', 'work_execution_events', 'work_artifacts',
    'work_handover_packages', 'work_handover_events'
  ] loop
    execute format('select count(*) from public.%I where organization_id = $1', v_table)
      into v_count using '14170000-0000-0000-0000-000000000010'::uuid;
    if v_count = 0 then raise exception 'the organization admin cannot read % rows', v_table; end if;
  end loop;
end;
$$;

-- The project's work state: the assigned employee reads it, the unassigned
-- colleague and the other organization's admin are refused.
reset role;
set local role service_role;
do $$
declare
  v_org constant uuid := '14170000-0000-0000-0000-000000000010';
  v_project constant uuid := '14170000-0000-0000-0000-000000000050';
  v_snapshot jsonb;
  v_actor uuid;
begin
  v_snapshot := public.get_work_lifecycle_snapshot(
    v_org, '14170000-0000-0000-0000-000000000003', 'project', v_project
  );
  if v_snapshot ->> 'targetId' is distinct from v_project::text then
    raise exception 'the assigned employee did not read the project work state';
  end if;
  foreach v_actor in array array[
    '14170000-0000-0000-0000-000000000005', '14170000-0000-0000-0000-000000000004'
  ]::uuid[] loop
    begin
      perform public.get_work_lifecycle_snapshot(v_org, v_actor, 'project', v_project);
      raise exception 'caller % read the project work state without a job in it', v_actor;
    exception when others then
      if sqlerrm <> 'work_snapshot_not_authorized' then raise; end if;
    end;
  end loop;
end;
$$;

-- The project's own document reaches the assigned employee's session, which
-- is what Realtime delivers; the colleague and the other organization see none.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"14170000-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.documents where id = '14170000-0000-0000-0000-000000000060') <> 1 then
    raise exception 'the assigned employee cannot read the project document';
  end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"14170000-0000-0000-0000-000000000005","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.documents where id = '14170000-0000-0000-0000-000000000060') <> 0 then
    raise exception 'an employee without a job in the project reads the project document';
  end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"14170000-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.documents where id = '14170000-0000-0000-0000-000000000060') <> 0 then
    raise exception 'another organization reads the project document';
  end if;
end;
$$;

rollback;
