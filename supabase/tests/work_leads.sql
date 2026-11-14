-- A project lead per project or job (20261201150000_name_a_project_lead_per_work.sql
-- and 20261204110000_name_and_end_a_project_lead.sql, werk-flow/werkflow-planning#381).
-- Admin and Büro name and end a lead in one call each, against the holding
-- they saw. A holding names a member of the work's own
-- organization, one open holding per work, and stays as history. The lead of
-- a project reviews the Regie- und Änderungsnachweise of the project and of
-- its jobs, unless a job names its own lead; a lead of another project, an
-- employee who is not the lead, an ended lead, a member who left and a
-- removed member are refused, and the four-eyes rule holds. Only the service
-- role reads the rule. No delete removes a holding, and no project, job or
-- personnel record with one is deleted, except with its organization. One
-- rolled-back transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select person.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  person.email, '', now(), '{}', jsonb_build_object('first_name', person.first_name, 'last_name', 'Leitung'),
  now(), now()
from (values
  ('4f200000-0000-4000-8000-000000000001'::uuid, 'work-lead-admin@example.test', 'Admin'),
  ('4f200000-0000-4000-8000-000000000002'::uuid, 'work-lead-lead@example.test', 'Erika'),
  ('4f200000-0000-4000-8000-000000000003'::uuid, 'work-lead-author@example.test', 'Max'),
  ('4f200000-0000-4000-8000-000000000004'::uuid, 'work-lead-other@example.test', 'Lena'),
  ('4f200000-0000-4000-8000-000000000005'::uuid, 'work-lead-second@example.test', 'Jonas'),
  ('4f200000-0000-4000-8000-000000000006'::uuid, 'work-lead-foreign-admin@example.test', 'Fremd'),
  ('4f200000-0000-4000-8000-000000000007'::uuid, 'work-lead-foreign@example.test', 'Fremda'),
  ('4f200000-0000-4000-8000-000000000008'::uuid, 'work-lead-teardown@example.test', 'Ende')
) as person(id, email, first_name);

insert into public.organizations (id, name, admin_id, unique_code) values
  ('4f200000-0000-4000-8000-0000000000a0', 'Haustechnik Sonnenberg GmbH',
   '4f200000-0000-4000-8000-000000000001', 'LEADORGA'),
  ('4f200000-0000-4000-8000-0000000000b0', 'Hausverwaltung Lindenhof GmbH',
   '4f200000-0000-4000-8000-000000000006', 'LEADORGB'),
  ('4f200000-0000-4000-8000-0000000000c0', 'Haustechnik Abwicklung GmbH',
   '4f200000-0000-4000-8000-000000000008', 'LEADORGC');
insert into public.organization_members (organization_id, user_id, role) values
  ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000002', 'employee'),
  ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000003', 'employee'),
  ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000004', 'employee'),
  ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000005', 'employee'),
  ('4f200000-0000-4000-8000-0000000000b0', '4f200000-0000-4000-8000-000000000007', 'employee');

-- Project A with jobs A1 and A2 (A2 names its own lead), project B, a
-- standalone job S, and a project of organization B.
insert into public.projects (id, organization_id, name, project_number, created_by) values
  ('4f200000-0000-4000-8000-000000000010', '4f200000-0000-4000-8000-0000000000a0', 'Neubau Lindenstraße',
   'LEAD-P-1', '4f200000-0000-4000-8000-000000000001'),
  ('4f200000-0000-4000-8000-000000000011', '4f200000-0000-4000-8000-0000000000a0', 'Sanierung Ahornweg',
   'LEAD-P-2', '4f200000-0000-4000-8000-000000000001'),
  ('4f200000-0000-4000-8000-000000000012', '4f200000-0000-4000-8000-0000000000b0', 'Fremdes Projekt',
   'LEAD-P-3', '4f200000-0000-4000-8000-000000000006');
insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
  ('4f200000-0000-4000-8000-000000000020', '4f200000-0000-4000-8000-0000000000a0',
   '4f200000-0000-4000-8000-000000000010', 'Heizung', 'LEAD-1', '4f200000-0000-4000-8000-000000000001'),
  ('4f200000-0000-4000-8000-000000000021', '4f200000-0000-4000-8000-0000000000a0',
   '4f200000-0000-4000-8000-000000000010', 'Sanitär', 'LEAD-2', '4f200000-0000-4000-8000-000000000001'),
  ('4f200000-0000-4000-8000-000000000022', '4f200000-0000-4000-8000-0000000000a0',
   '4f200000-0000-4000-8000-000000000011', 'Lüftung', 'LEAD-3', '4f200000-0000-4000-8000-000000000001'),
  ('4f200000-0000-4000-8000-000000000023', '4f200000-0000-4000-8000-0000000000a0',
   null, 'Wartung', 'LEAD-4', '4f200000-0000-4000-8000-000000000001'),
  -- A job whose only history is its lead holding.
  ('4f200000-0000-4000-8000-000000000024', '4f200000-0000-4000-8000-0000000000a0',
   null, 'Inspektion', 'LEAD-5', '4f200000-0000-4000-8000-000000000001');
-- The author works on A1 and A2; the lead only on the standalone job.
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
  ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000020',
   '4f200000-0000-4000-8000-000000000003', '4f200000-0000-4000-8000-000000000001'),
  ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000021',
   '4f200000-0000-4000-8000-000000000003', '4f200000-0000-4000-8000-000000000001'),
  ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000023',
   '4f200000-0000-4000-8000-000000000002', '4f200000-0000-4000-8000-000000000001');

create function pg_temp.record_of(p_user_id uuid) returns uuid language sql as $$
  select id from public.employee_records where user_id = p_user_id;
$$;

-- Runs one call and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;

-- The scope of a member who leads nothing.
create function pg_temp.no_scope() returns jsonb language sql immutable as $$
  select '{"projectIds": [], "jobIds": []}'::jsonb;
$$;

-- Runs one statement and requires the SQLSTATE it fails with.
create function pg_temp.expect_state(p_label text, p_statement text, p_state text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlstate is distinct from p_state then
      raise exception '% failed with % (%) instead of %', p_label, sqlstate, sqlerrm, p_state;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;

-- The open holding of the work, as the office's screen shows it.
create function pg_temp.open_lead(p_project_id uuid, p_job_id uuid) returns uuid language sql as $$
  select id from public.work_leads
  where ended_at is null and (project_id = p_project_id or job_id = p_job_id);
$$;

-- Names the member the lead of the work through the office's naming, which
-- ends the open holding in the same call.
create function pg_temp.name_lead(p_project_id uuid, p_job_id uuid, p_user_id uuid) returns jsonb
language sql as $$
  select public.name_work_lead('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000001',
    p_project_id, p_job_id, p_user_id, pg_temp.open_lead(p_project_id, p_job_id));
$$;

-- A submitted Arbeitsnachweis of the given kind on a job or the project.
create function pg_temp.submit(
  p_artifact_id uuid, p_author uuid, p_kind public.work_artifact_kind, p_job_id uuid, p_project_id uuid
) returns void language sql as $$
  select public.create_work_artifact_revision(
    p_organization_id => '4f200000-0000-4000-8000-0000000000a0', p_actor_id => p_author,
    p_artifact_id => p_artifact_id, p_revision_id => p_artifact_id, p_expected_version => null,
    p_job_id => p_job_id, p_project_id => p_project_id, p_kind => p_kind, p_visibility => 'internal_only',
    p_captured_at => now(), p_title => 'Nachweis',
    p_content => jsonb_build_object('changeDescription', 'Zusätzlicher Heizkörper',
      'changeReason', 'Wunsch der Kundin', 'requestedByContext', 'Erika Musterfrau vor Ort',
      'progress', 'Rohbau fertig', 'workDate', (now() at time zone 'Europe/Berlin')::date),
    p_corrects_revision_id => null, p_correction_reason => null, p_submit => true,
    p_submit_action_id => gen_random_uuid(), p_draft_changed_at => null);
$$;

-- One review step on the artifact's current revision and version.
create function pg_temp.review(
  p_actor uuid, p_artifact_id uuid, p_action public.work_artifact_action_type
) returns jsonb language sql as $$
  select public.record_work_artifact_action(
    '4f200000-0000-4000-8000-0000000000a0', p_actor, p_artifact_id, p_artifact_id, gen_random_uuid(),
    (select version from public.work_artifacts where id = p_artifact_id), p_action,
    case when p_action = 'internal_approved' then null else 'Bitte Menge ergänzen' end,
    null, '{"responsibility":"work_lead"}', null, null);
$$;

do $$
declare
  v_org constant uuid := '4f200000-0000-4000-8000-0000000000a0';
  v_admin constant uuid := '4f200000-0000-4000-8000-000000000001';
  v_lead constant uuid := '4f200000-0000-4000-8000-000000000002';
  v_author constant uuid := '4f200000-0000-4000-8000-000000000003';
  v_other constant uuid := '4f200000-0000-4000-8000-000000000004';
  v_second constant uuid := '4f200000-0000-4000-8000-000000000005';
  v_project_a constant uuid := '4f200000-0000-4000-8000-000000000010';
  v_project_b constant uuid := '4f200000-0000-4000-8000-000000000011';
  v_job_a1 constant uuid := '4f200000-0000-4000-8000-000000000020';
  v_job_a2 constant uuid := '4f200000-0000-4000-8000-000000000021';
  v_job_s constant uuid := '4f200000-0000-4000-8000-000000000023';
  v_result jsonb;
begin
  -- A holding names a member of the work's organization, exactly one work,
  -- and one open holding per work.
  perform pg_temp.expect_state('a foreign organization''s member is named', format(
    'insert into public.work_leads (organization_id, project_id, employee_record_id) values (%L, %L, %L)',
    v_org, v_project_a, pg_temp.record_of('4f200000-0000-4000-8000-000000000007')), '23503');
  perform pg_temp.expect_state('a holding names a foreign organization''s project', format(
    'insert into public.work_leads (organization_id, project_id, employee_record_id) values (%L, %L, %L)',
    v_org, '4f200000-0000-4000-8000-000000000012', pg_temp.record_of(v_lead)), '23503');
  perform pg_temp.expect_state('a holding names both a project and a job', format(
    'insert into public.work_leads (organization_id, project_id, job_id, employee_record_id) values (%L, %L, %L, %L)',
    v_org, v_project_a, v_job_a1, pg_temp.record_of(v_lead)), '23514');

  -- Project A: first the other employee, then the lead, who replaces them.
  perform pg_temp.name_lead(v_project_a, null, v_other);
  perform pg_temp.name_lead(v_project_a, null, v_lead);
  perform pg_temp.expect_state('a second open holding on one project', format(
    'insert into public.work_leads (organization_id, project_id, employee_record_id) values (%L, %L, %L)',
    v_org, v_project_a, pg_temp.record_of(v_second)), '23505');
  if (select count(*) from public.work_leads where project_id = v_project_a) <> 2
    or (select count(*) from public.work_leads where project_id = v_project_a and ended_at is null) <> 1
  then raise exception 'the replaced lead is not kept as ended history'; end if;
  -- Job A2 names its own lead; project B and the standalone job get theirs.
  perform pg_temp.name_lead(null, v_job_a2, v_second);
  perform pg_temp.name_lead(v_project_b, null, v_second);
  perform pg_temp.name_lead(null, v_job_s, v_lead);

  -- The lead's scope: project A, its job A1 (not A2), and the standalone job.
  if (select array_agg(id::uuid order by id) from jsonb_array_elements_text(
        public.read_work_lead_scope(v_org, v_lead)->'projectIds') id) is distinct from array[v_project_a]
    or (select array_agg(id::uuid order by id) from jsonb_array_elements_text(
        public.read_work_lead_scope(v_org, v_lead)->'jobIds') id) is distinct from array[v_job_a1, v_job_s]
  then raise exception 'the lead''s scope is wrong'; end if;
  if public.read_work_lead_scope(v_org, v_other) is distinct from pg_temp.no_scope() then
    raise exception 'an ended lead keeps a scope';
  end if;

  -- Submitted Nachweise: a Regienachweis on A1, a Bautagebuch on A1, a
  -- Regienachweis on project A, one on A2, and one the lead wrote on the
  -- standalone job.
  perform pg_temp.submit('4f200000-0000-4000-8000-000000000030', v_author, 'change_work', v_job_a1, null);
  perform pg_temp.submit('4f200000-0000-4000-8000-000000000031', v_author, 'site_diary', v_job_a1, null);
  perform pg_temp.submit('4f200000-0000-4000-8000-000000000032', v_author, 'change_work', null, v_project_a);
  perform pg_temp.submit('4f200000-0000-4000-8000-000000000033', v_author, 'change_work', v_job_a2, null);
  perform pg_temp.submit('4f200000-0000-4000-8000-000000000034', v_lead, 'change_work', v_job_s, null);
  perform pg_temp.submit('4f200000-0000-4000-8000-000000000035', v_author, 'change_work', v_job_a1, null);

  -- Refused: an employee who is not the lead, the lead of another project, the
  -- lead on another kind, the project lead on a job with its own lead, and the
  -- lead on their own Nachweis.
  perform pg_temp.expect_refusal('an employee who is not the lead approves', format(
    'select pg_temp.review(%L, %L, %L)', v_other, '4f200000-0000-4000-8000-000000000030', 'internal_approved'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('the lead of project B approves in project A', format(
    'select pg_temp.review(%L, %L, %L)', v_second, '4f200000-0000-4000-8000-000000000030', 'internal_approved'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('the lead approves a Bautagebuch', format(
    'select pg_temp.review(%L, %L, %L)', v_lead, '4f200000-0000-4000-8000-000000000031', 'internal_approved'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('the project lead approves on a job with its own lead', format(
    'select pg_temp.review(%L, %L, %L)', v_lead, '4f200000-0000-4000-8000-000000000033', 'internal_approved'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('the lead approves their own Nachweis', format(
    'select pg_temp.review(%L, %L, %L)', v_lead, '4f200000-0000-4000-8000-000000000034', 'internal_approved'),
    'work_artifact_self_approval_not_allowed');
  perform pg_temp.expect_refusal('the lead voids a Nachweis', format(
    'select public.void_work_artifact(%L, %L, %L, gen_random_uuid(), (select version from public.work_artifacts where id = %L), %L)',
    v_org, v_lead, '4f200000-0000-4000-8000-000000000030', '4f200000-0000-4000-8000-000000000030', 'Falsch'),
    'work_artifact_not_authorized');

  -- Allowed: the lead approves on A1, sends the project's back, and the job
  -- lead of A2 rejects there.
  v_result := pg_temp.review(v_lead, '4f200000-0000-4000-8000-000000000030', 'internal_approved');
  if v_result->>'status' is distinct from 'approved' then raise exception 'the lead''s approval did not apply'; end if;
  v_result := pg_temp.review(v_lead, '4f200000-0000-4000-8000-000000000032', 'correction_requested');
  if v_result->>'status' is distinct from 'correction_requested' then raise exception 'the lead''s correction request did not apply'; end if;
  v_result := pg_temp.review(v_second, '4f200000-0000-4000-8000-000000000033', 'internal_rejected');
  if v_result->>'status' is distinct from 'rejected' then raise exception 'the job lead''s rejection did not apply'; end if;

  -- Ending: the ended lead is refused at once.
  v_result := public.end_work_lead(v_org, v_admin, v_project_a, null, pg_temp.open_lead(v_project_a, null));
  if v_result->>'changed' is distinct from 'true' then raise exception 'the lead was not ended'; end if;
  perform pg_temp.expect_refusal('an ended lead approves', format(
    'select pg_temp.review(%L, %L, %L)', v_lead, '4f200000-0000-4000-8000-000000000035', 'internal_approved'),
    'work_artifact_not_authorized');
  -- The Admin, as the approval responsibility's default holder, still reviews.
  v_result := pg_temp.review(v_admin, '4f200000-0000-4000-8000-000000000035', 'internal_approved');
  if v_result->>'status' is distinct from 'approved' then raise exception 'the open review did not fall back to the holder'; end if;

  -- Removing the member ends the access at once.
  delete from public.organization_members where organization_id = v_org and user_id = v_second;
  if public.read_work_lead_scope(v_org, v_second) is distinct from pg_temp.no_scope() then
    raise exception 'a removed member keeps a lead scope';
  end if;

  -- A member who left leads nothing, even with an open holding.
  update public.employee_records set entry_date = (now() at time zone 'Europe/Berlin')::date - 30,
    exit_date = (now() at time zone 'Europe/Berlin')::date - 1
  where id = pg_temp.record_of(v_lead);
  if public.read_work_lead_scope(v_org, v_lead) is distinct from pg_temp.no_scope() then
    raise exception 'a member who left keeps a lead scope';
  end if;
  update public.employee_records set exit_date = null where id = pg_temp.record_of(v_lead);

  -- No delete removes a holding: neither a direct one nor the cascade of its
  -- project, job or person. Work with a holding refuses its deletion with the
  -- reason the office sees for work with history.
  perform pg_temp.name_lead(null, '4f200000-0000-4000-8000-000000000024', v_other);
  perform pg_temp.expect_refusal('a holding is deleted', format(
    'delete from public.work_leads where job_id = %L', v_job_s), 'work_lead_history_immutable');
  perform pg_temp.expect_refusal('a project with a holding is deleted', format(
    'delete from public.projects where id = %L', v_project_b), 'work_with_history_cannot_be_deleted');
  perform pg_temp.expect_refusal('a job with a holding is deleted', format(
    'delete from public.jobs where id = %L', '4f200000-0000-4000-8000-000000000024'),
    'work_with_history_cannot_be_deleted');
  perform pg_temp.expect_refusal('a person with a holding is deleted', format(
    'delete from public.employee_records where id = %L', pg_temp.record_of(v_other)),
    'work_lead_history_immutable');

  -- A holding is history.
  perform pg_temp.expect_refusal('a holding changes its person', format(
    'update public.work_leads set employee_record_id = %L where job_id = %L',
    pg_temp.record_of(v_author), v_job_s), 'work_lead_history_immutable');
  perform pg_temp.expect_refusal('an end is moved', format(
    'update public.work_leads set ended_at = now() + interval ''1 day'' where project_id = %L and ended_at is not null',
    v_project_a), 'work_lead_history_immutable');
end;
$$;

-- The office's naming and ending (20261204110000_name_and_end_a_project_lead.sql),
-- called as the server calls them, as service_role: only a manager of the
-- organization, only its own work and members, and a call whose holding
-- changed meanwhile is refused; a repeat changes nothing.
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;
grant execute on function pg_temp.open_lead(uuid, uuid) to service_role;
grant execute on function pg_temp.record_of(uuid) to service_role;
set local role service_role;
do $$
declare
  v_org constant uuid := '4f200000-0000-4000-8000-0000000000a0';
  v_admin constant uuid := '4f200000-0000-4000-8000-000000000001';
  v_lead constant uuid := '4f200000-0000-4000-8000-000000000002';
  v_author constant uuid := '4f200000-0000-4000-8000-000000000003';
  v_other constant uuid := '4f200000-0000-4000-8000-000000000004';
  v_second constant uuid := '4f200000-0000-4000-8000-000000000005';
  v_project_b constant uuid := '4f200000-0000-4000-8000-000000000011';
  v_stale uuid := pg_temp.open_lead('4f200000-0000-4000-8000-000000000011', null);
  v_result jsonb;
begin
  perform pg_temp.expect_refusal('an employee names a lead', format(
    'select public.name_work_lead(%L, %L, %L, null, %L, %L)', v_org, v_lead, v_project_b, v_other, v_stale),
    'work_lead_not_authorized');
  perform pg_temp.expect_refusal('a foreign organization''s Admin names a lead', format(
    'select public.name_work_lead(%L, %L, %L, null, %L, %L)',
    v_org, '4f200000-0000-4000-8000-000000000006', v_project_b, v_other, v_stale),
    'work_lead_not_authorized');
  perform pg_temp.expect_refusal('a foreign organization''s member is named', format(
    'select public.name_work_lead(%L, %L, %L, null, %L, %L)',
    v_org, v_admin, v_project_b, '4f200000-0000-4000-8000-000000000007', v_stale),
    'work_lead_member_not_eligible');
  perform pg_temp.expect_refusal('a removed member is named', format(
    'select public.name_work_lead(%L, %L, %L, null, %L, %L)', v_org, v_admin, v_project_b, v_second, v_stale),
    'work_lead_member_not_eligible');
  perform pg_temp.expect_refusal('a lead is named on a foreign organization''s project', format(
    'select public.name_work_lead(%L, %L, %L, null, %L, null)',
    v_org, v_admin, '4f200000-0000-4000-8000-000000000012', v_other), 'work_lead_target_not_found');
  perform pg_temp.expect_refusal('a lead is named on a project and a job at once', format(
    'select public.name_work_lead(%L, %L, %L, %L, %L, null)',
    v_org, v_admin, v_project_b, '4f200000-0000-4000-8000-000000000022', v_other), 'work_lead_target_invalid');
  perform pg_temp.expect_refusal('a naming that saw no lead replaces the open one', format(
    'select public.name_work_lead(%L, %L, %L, null, %L, null)', v_org, v_admin, v_project_b, v_other),
    'work_lead_changed');
  if pg_temp.open_lead(v_project_b, null) is distinct from v_stale then
    raise exception 'a refused naming changed the holding';
  end if;

  v_result := public.name_work_lead(v_org, v_admin, v_project_b, null, v_other, v_stale);
  if v_result->>'changed' is distinct from 'true'
    or (v_result->>'leadId')::uuid is distinct from pg_temp.open_lead(v_project_b, null)
    or (select ended_by from public.work_leads where id = v_stale) is distinct from v_admin
  then raise exception 'the naming did not end the old holding and open the new one'; end if;
  -- The retry of the applied call changes nothing.
  v_result := public.name_work_lead(v_org, v_admin, v_project_b, null, v_other, v_stale);
  if v_result->>'changed' is distinct from 'false'
    or (select count(*) from public.work_leads where project_id = v_project_b) <> 2
  then raise exception 'a repeated naming changed the history'; end if;

  perform pg_temp.expect_refusal('an end that saw an older lead', format(
    'select public.end_work_lead(%L, %L, %L, null, %L)', v_org, v_admin, v_project_b, v_stale),
    'work_lead_changed');
  perform pg_temp.expect_refusal('an employee ends a lead', format(
    'select public.end_work_lead(%L, %L, %L, null, %L)',
    v_org, v_author, v_project_b, pg_temp.open_lead(v_project_b, null)), 'work_lead_not_authorized');
  v_stale := pg_temp.open_lead(v_project_b, null);
  v_result := public.end_work_lead(v_org, v_admin, v_project_b, null, v_stale);
  if v_result->>'changed' is distinct from 'true' or pg_temp.open_lead(v_project_b, null) is not null then
    raise exception 'the end did not apply';
  end if;
  v_result := public.end_work_lead(v_org, v_admin, v_project_b, null, v_stale);
  if v_result->>'changed' is distinct from 'false' then raise exception 'a repeated end changed something'; end if;

  -- A member who left cannot be named.
  update public.employee_records set entry_date = (now() at time zone 'Europe/Berlin')::date - 30,
    exit_date = (now() at time zone 'Europe/Berlin')::date - 1
  where id = pg_temp.record_of(v_author);
  perform pg_temp.expect_refusal('a member who left is named', format(
    'select public.name_work_lead(%L, %L, %L, null, %L, null)', v_org, v_admin, v_project_b, v_author),
    'work_lead_member_not_eligible');
  update public.employee_records set exit_date = null where id = pg_temp.record_of(v_author);
end;
$$;

reset role;

-- A change of a job or an instruction in a led project touches the open
-- holding, so the lead, who reads no row of a job they are not on, hears of it
-- through the holding's Realtime event. Work of another project does not.
do $$
declare
  v_holding uuid;
  v_before tid;
begin
  perform pg_temp.name_lead('4f200000-0000-4000-8000-000000000011', null, '4f200000-0000-4000-8000-000000000004');
  v_holding := pg_temp.open_lead('4f200000-0000-4000-8000-000000000011', null);
  v_before := (select ctid from public.work_leads where id = v_holding);
  update public.jobs set title = 'Lüftung Dachgeschoss' where id = '4f200000-0000-4000-8000-000000000022';
  if (select ctid from public.work_leads where id = v_holding) is not distinct from v_before then
    raise exception 'a changed job of a led project did not touch its holding';
  end if;
  v_before := (select ctid from public.work_leads where id = v_holding);
  insert into public.job_instruction_items (organization_id, job_id, content, created_by)
  values ('4f200000-0000-4000-8000-0000000000a0', '4f200000-0000-4000-8000-000000000022',
    'Filter tauschen', '4f200000-0000-4000-8000-000000000001');
  if (select ctid from public.work_leads where id = v_holding) is not distinct from v_before then
    raise exception 'a new instruction in a led project did not touch its holding';
  end if;
  v_before := (select ctid from public.work_leads where id = v_holding);
  update public.jobs set title = 'Heizung Erdgeschoss' where id = '4f200000-0000-4000-8000-000000000020';
  if (select ctid from public.work_leads where id = v_holding) is distinct from v_before then
    raise exception 'a job of another project touched the holding';
  end if;
end;
$$;

-- The organization's deletion removes its holdings with the rest.
insert into public.projects (id, organization_id, name, project_number, created_by) values
  ('4f200000-0000-4000-8000-000000000013', '4f200000-0000-4000-8000-0000000000c0', 'Altbau',
   'LEAD-P-4', '4f200000-0000-4000-8000-000000000008');
insert into public.jobs (id, organization_id, project_id, title, job_number, created_by) values
  ('4f200000-0000-4000-8000-000000000025', '4f200000-0000-4000-8000-0000000000c0',
   '4f200000-0000-4000-8000-000000000013', 'Rückbau', 'LEAD-6', '4f200000-0000-4000-8000-000000000008');
insert into public.work_leads (organization_id, project_id, job_id, employee_record_id) values
  ('4f200000-0000-4000-8000-0000000000c0', '4f200000-0000-4000-8000-000000000013', null,
   pg_temp.record_of('4f200000-0000-4000-8000-000000000008')),
  ('4f200000-0000-4000-8000-0000000000c0', null, '4f200000-0000-4000-8000-000000000025',
   pg_temp.record_of('4f200000-0000-4000-8000-000000000008'));
delete from public.organizations where id = '4f200000-0000-4000-8000-0000000000c0';
do $$
begin
  if exists (select 1 from public.work_leads where organization_id = '4f200000-0000-4000-8000-0000000000c0')
  then raise exception 'the organization''s deletion left its holdings'; end if;
end;
$$;

-- Grants: no browser role writes or calls the functions, and anon reads nothing.
do $$
begin
  if has_table_privilege('anon', 'public.work_leads', 'select')
    or has_table_privilege('authenticated', 'public.work_leads', 'insert')
    or has_table_privilege('authenticated', 'public.work_leads', 'update')
    or has_table_privilege('authenticated', 'public.work_leads', 'delete')
    or has_function_privilege('authenticated', 'public.read_work_lead_scope(uuid, uuid)', 'execute')
    or has_function_privilege('anon', 'public.read_work_lead_scope(uuid, uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.name_work_lead(uuid, uuid, uuid, uuid, uuid, uuid)', 'execute')
    or has_function_privilege('anon', 'public.name_work_lead(uuid, uuid, uuid, uuid, uuid, uuid)', 'execute')
    or has_function_privilege('authenticated', 'public.end_work_lead(uuid, uuid, uuid, uuid, uuid)', 'execute')
    or has_function_privilege('anon', 'public.end_work_lead(uuid, uuid, uuid, uuid, uuid)', 'execute')
  then raise exception 'a browser role holds a privilege on the work leads'; end if;
end;
$$;

-- A session sees its own holdings and a manager's; another employee none.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4f200000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.work_leads) <> 2 then
    raise exception 'the lead does not see exactly their own holdings';
  end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"4f200000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.work_leads) then raise exception 'an employee who is not a lead sees holdings'; end if;
end;
$$;
select set_config('request.jwt.claims', '{"sub":"4f200000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.work_leads) <> 8 then raise exception 'the Admin does not see every holding'; end if;
end;
$$;
reset role;

rollback;
