-- P1-14, P1-15 and P1-17 database rules behind the work execution journeys:
-- lifecycle mutations stay inside their own ledger, and lifecycle, evidence
-- and handover rows are invisible to another organization while the owning
-- managers read them.
-- An employee assigned to a job of a project reads the project's work state
-- and the project's own documents; an unassigned colleague and another
-- organization read neither.
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
 '{"first_name":"Colleague","last_name":"Work"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('14170000-0000-0000-0000-000000000010', 'Work boundaries SQL',
 '14170000-0000-0000-0000-000000000001', 'WORKSQL'),
('14170000-0000-0000-0000-000000000011', 'Work boundaries SQL Outsider',
 '14170000-0000-0000-0000-000000000004', 'WORKOUT');
insert into public.organization_members (organization_id, user_id, role) values
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000003', 'employee'),
('14170000-0000-0000-0000-000000000010', '14170000-0000-0000-0000-000000000005', 'employee');

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

set local role service_role;

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
begin
  select id into v_employee_record from public.employee_records
  where organization_id = v_org and user_id = v_employee;

  -- P1-14: a manual start and an own blocker write lifecycle facts only.
  select * into v_transition from public.transition_work_execution(
    p_organization_id => v_org, p_target_type => 'job', p_target_id => v_job,
    p_to_state => 'in_progress', p_expected_version => 0, p_actor_id => v_admin
  );
  if v_transition.execution_state <> 'in_progress' or v_transition.execution_version <> 1
  then raise exception 'the manual start did not move the job to version 1 in progress'; end if;

  select * into v_blocker from public.upsert_work_blocker(
    p_organization_id => v_org, p_blocker_id => null, p_expected_version => null,
    p_job_id => v_job, p_project_id => null, p_instruction_item_id => null,
    p_kind => 'blocker', p_reason => 'site_access', p_details => 'Schlüssel fehlt.',
    p_responsible_employee_record_id => v_employee_record,
    p_next_review_date => (now() at time zone 'Europe/Berlin')::date, p_actor_id => v_employee
  );
  if v_blocker.blocker_version <> 1 then raise exception 'the own blocker was not created at version 1'; end if;

  if exists (select 1 from public.inventory_movements where job_id = v_job)
    or exists (select 1 from public.time_entries where job_id = v_job)
    or exists (select 1 from public.time_segments where job_id = v_job)
    or exists (select 1 from public.planning_occurrences where job_id = v_job)
  then raise exception 'a lifecycle mutation wrote stock, time or schedule facts'; end if;
  if (select array_agg(to_state::text) from public.work_execution_events where job_id = v_job)
     <> array['in_progress']
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
    'work_blockers', 'work_blocker_events', 'work_execution_events',
    'work_artifacts', 'work_artifact_revisions', 'work_artifact_actions',
    'work_handover_packages', 'work_handover_events'
  ] loop
    execute format('select count(*) from public.%I where organization_id = $1', v_table)
      into v_count using '14170000-0000-0000-0000-000000000010'::uuid;
    if v_count <> 0 then raise exception 'another organization reads % rows', v_table; end if;
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
    'work_blockers', 'work_blocker_events', 'work_execution_events',
    'work_artifacts', 'work_artifact_revisions', 'work_artifact_actions',
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
  if v_snapshot ->> 'targetId' <> v_project::text then
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
