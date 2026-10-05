-- Creating work applies completely or not at all: a job with its assignments
-- and template (migration 20261004170000_create_work_atomically.sql), a
-- request conversion with its claim, document links and history row
-- (20261004170100_convert_requests_atomically.sql) and a maintenance visit
-- job with its due link (20261004170200_create_maintenance_visits_atomically.sql).
-- A refusal of a later step leaves no work behind, a foreign organization is
-- refused, and only the service role executes the functions.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26104170-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'work-create-admin@example.test', '', now(), '{}',
 '{"first_name":"Create","last_name":"Admin"}', now(), now()),
('26104170-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'work-create-employee@example.test', '', now(), '{}',
 '{"first_name":"Create","last_name":"Employee"}', now(), now()),
('26104170-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'work-create-foreign@example.test', '', now(), '{}',
 '{"first_name":"Create","last_name":"Foreign"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('26104170-0000-0000-0000-000000000010', 'Work creation SQL', '26104170-0000-0000-0000-000000000001', 'WCREATEA'),
('26104170-0000-0000-0000-000000000011', 'Foreign creation SQL', '26104170-0000-0000-0000-000000000003', 'WCREATEB');
insert into public.organization_members (organization_id, user_id, role) values
('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000002', 'employee');

insert into public.clients (id, organization_id, name) values
('26104170-0000-0000-0000-000000000020', '26104170-0000-0000-0000-000000000010', 'Kunde Anlage'),
('26104170-0000-0000-0000-000000000029', '26104170-0000-0000-0000-000000000011', 'Fremder Kunde');
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city, is_primary, created_by)
values
('26104170-0000-0000-0000-000000000021', '26104170-0000-0000-0000-000000000010',
 '26104170-0000-0000-0000-000000000020', 'Heizraum', 'Ringstraße 4', '80331', 'München', true,
 '26104170-0000-0000-0000-000000000001');
insert into public.client_contacts (id, organization_id, client_id, name) values
('26104170-0000-0000-0000-000000000022', '26104170-0000-0000-0000-000000000010',
 '26104170-0000-0000-0000-000000000020', 'Frau Anlage');
insert into public.projects (id, organization_id, client_id, site_id, contact_id, name, project_number, created_by)
values
('26104170-0000-0000-0000-000000000030', '26104170-0000-0000-0000-000000000010',
 '26104170-0000-0000-0000-000000000020', '26104170-0000-0000-0000-000000000021',
 '26104170-0000-0000-0000-000000000022', 'Badsanierung', 'WC-P-1', '26104170-0000-0000-0000-000000000001'),
('26104170-0000-0000-0000-000000000039', '26104170-0000-0000-0000-000000000011',
 null, null, null, 'Fremdes Projekt', 'WC-P-9', '26104170-0000-0000-0000-000000000003');
insert into public.jobs (id, organization_id, job_number, title, created_by) values
('26104170-0000-0000-0000-000000000040', '26104170-0000-0000-0000-000000000010', 'WC-J-1', 'Bestand',
 '26104170-0000-0000-0000-000000000001');

insert into public.client_requests (id, organization_id, summary, client_id, created_by) values
('26104170-0000-0000-0000-000000000050', '26104170-0000-0000-0000-000000000010', 'Heizung kalt',
 '26104170-0000-0000-0000-000000000020', '26104170-0000-0000-0000-000000000001'),
('26104170-0000-0000-0000-000000000051', '26104170-0000-0000-0000-000000000010', 'Bad neu',
 '26104170-0000-0000-0000-000000000020', '26104170-0000-0000-0000-000000000001'),
('26104170-0000-0000-0000-000000000059', '26104170-0000-0000-0000-000000000011', 'Fremde Anfrage',
 '26104170-0000-0000-0000-000000000029', '26104170-0000-0000-0000-000000000003');
insert into public.document_folders (id, organization_id, name, created_by) values
('26104170-0000-0000-0000-000000000060', '26104170-0000-0000-0000-000000000010', 'Anfragen',
 '26104170-0000-0000-0000-000000000001');
insert into public.documents (id, organization_id, folder_id, storage_path, original_file_name, display_name,
  size_bytes, uploaded_by) values
('26104170-0000-0000-0000-000000000061', '26104170-0000-0000-0000-000000000010',
 '26104170-0000-0000-0000-000000000060',
 '26104170-0000-0000-0000-000000000010/work-creation/foto.jpg', 'foto.jpg', 'Foto', 1,
 '26104170-0000-0000-0000-000000000001');
insert into public.document_links (organization_id, document_id, request_id, created_by) values
('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000061',
 '26104170-0000-0000-0000-000000000050', '26104170-0000-0000-0000-000000000001'),
('26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000061',
 '26104170-0000-0000-0000-000000000051', '26104170-0000-0000-0000-000000000001');

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

create function pg_temp.berlin_today() returns date language sql as $$
  select (timezone('Europe/Berlin', now()))::date;
$$;
grant execute on function pg_temp.berlin_today() to service_role;

-- Every row a creation or a conversion writes, counted for the organization.
create function pg_temp.work_rows() returns bigint language sql as $$
  select (select count(*) from public.jobs where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.projects where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.job_assignments where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.job_instruction_items
       where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.work_template_applications
       where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.document_links where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.document_audit_events
       where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.client_request_events
       where organization_id = '26104170-0000-0000-0000-000000000010')
    + (select count(*) from public.client_requests
       where organization_id = '26104170-0000-0000-0000-000000000010' and status = 'umgewandelt');
$$;
grant execute on function pg_temp.work_rows() to service_role;

create temporary table world (job_version uuid, project_version uuid, equipment uuid, rows_before bigint);
grant select, update on world to service_role;

do $$
declare
  v_job_template uuid;
  v_project_template uuid;
  v_equipment public.installed_equipment%rowtype;
begin
  v_job_template := public.create_work_template(
    '26104170-0000-0000-0000-000000000010', 'job', 'Wartung', '26104170-0000-0000-0000-000000000001'
  );
  perform public.save_work_template_draft(
    p_organization_id => '26104170-0000-0000-0000-000000000010', p_template_id => v_job_template,
    p_actor_id => '26104170-0000-0000-0000-000000000001', p_name => 'Wartung',
    p_items => jsonb_build_array(jsonb_build_object(
      'id', '26104170-0000-0000-0000-000000000070', 'item_kind', 'task', 'content', 'Anlage warten',
      'requirement_state', 'required', 'group_label', null, 'notes', null, 'sort_order', 0))
  );
  v_project_template := public.create_work_template(
    '26104170-0000-0000-0000-000000000010', 'project', 'Bad', '26104170-0000-0000-0000-000000000001'
  );
  perform public.save_work_template_draft(
    p_organization_id => '26104170-0000-0000-0000-000000000010', p_template_id => v_project_template,
    p_actor_id => '26104170-0000-0000-0000-000000000001', p_name => 'Bad',
    p_items => jsonb_build_array(jsonb_build_object(
      'id', '26104170-0000-0000-0000-000000000071', 'item_kind', 'task', 'content', 'Bad planen',
      'requirement_state', 'required', 'group_label', null, 'notes', null, 'sort_order', 0))
  );
  v_equipment := public.create_installed_equipment(
    '26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000080',
    jsonb_build_object('clientId', '26104170-0000-0000-0000-000000000020',
      'siteId', '26104170-0000-0000-0000-000000000021', 'name', 'Kessel',
      'category', 'heat_generation', 'state', 'active', 'identifiers', '[]'::jsonb),
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000081'
  );
  insert into pg_temp.world values (
    public.publish_work_template('26104170-0000-0000-0000-000000000010', v_job_template,
      '26104170-0000-0000-0000-000000000001'),
    public.publish_work_template('26104170-0000-0000-0000-000000000010', v_project_template,
      '26104170-0000-0000-0000-000000000001'),
    v_equipment.id, null
  );
  perform public.create_maintenance_plan_with_due_work(
    '26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000090',
    '26104170-0000-0000-0000-000000000091',
    jsonb_build_object(
      'planId', '26104170-0000-0000-0000-000000000090', 'revisionId', '26104170-0000-0000-0000-000000000091',
      'clientId', '26104170-0000-0000-0000-000000000020', 'siteId', '26104170-0000-0000-0000-000000000021',
      'maintenanceCoverageId', null, 'status', 'active',
      'templateVersionId', (select job_version from pg_temp.world),
      'effectiveFromDate', pg_temp.berlin_today(), 'firstDueDate', pg_temp.berlin_today() + 30,
      'intervalMonths', 6, 'dueWindowBeforeDays', 7, 'dueWindowAfterDays', 7,
      'plannedDurationMinutes', 90, 'nextDueBasis', 'planned_due_date',
      'operationalInstructions', null, 'overlapReason', null, 'reason', 'Wartungsplan angelegt',
      'equipmentIds', jsonb_build_array(v_equipment.id)
    ),
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000092',
    (pg_temp.berlin_today() + interval '12 months')::date
  );
  update pg_temp.world set rows_before = pg_temp.work_rows();
end;
$$;

-- A job creation call with the given job columns, assignees and template.
create function pg_temp.create_job(p_job jsonb, p_user_ids uuid[], p_template uuid)
returns public.jobs language sql as $$
  select * from public.create_job_with_assignments(
    '26104170-0000-0000-0000-000000000010', '26104170-0000-0000-0000-000000000001', p_job,
    p_user_ids, pg_temp.berlin_today(), '{}', '[]', '{}', 'fingerprint', null, null, false, p_template, false
  );
$$;
grant execute on function pg_temp.create_job(jsonb, uuid[], uuid) to service_role;

create function pg_temp.assert_no_new_rows(p_label text) returns void language plpgsql as $$
begin
  if pg_temp.work_rows() <> (select rows_before from pg_temp.world) then
    raise exception '% left rows behind', p_label;
  end if;
end;
$$;
grant execute on function pg_temp.assert_no_new_rows(text) to service_role;

set local role service_role;

-- Refused later steps leave no job: a foreign assignee after the insert, an
-- unavailable template after the assignments.
select pg_temp.expect_refusal('job with a foreign assignee', $sql$
  select pg_temp.create_job('{"title": "Neu", "job_number": "WC-J-2"}',
    array['26104170-0000-0000-0000-000000000003'::uuid], null)
$sql$, 'assign_failed');
select pg_temp.expect_refusal('job with an unavailable template', $sql$
  select pg_temp.create_job('{"title": "Neu", "job_number": "WC-J-2"}',
    array['26104170-0000-0000-0000-000000000002'::uuid], '26104170-0000-0000-0000-0000000000ff')
$sql$, 'work_template_version_unavailable');
select pg_temp.expect_refusal('job with a taken number', $sql$
  select pg_temp.create_job('{"title": "Neu", "job_number": "WC-J-1"}', '{}', null)
$sql$, 'job_number_taken');
select pg_temp.expect_refusal('job of a foreign project', $sql$
  select pg_temp.create_job(
    '{"title": "Neu", "job_number": "WC-J-2", "project_id": "26104170-0000-0000-0000-000000000039"}', '{}', null)
$sql$, 'project_not_found');
select pg_temp.expect_refusal('job of a foreign customer', $sql$
  select pg_temp.create_job(
    '{"title": "Neu", "job_number": "WC-J-2", "client_id": "26104170-0000-0000-0000-000000000029"}', '{}', null)
$sql$, 'client_not_found');
select pg_temp.expect_refusal('job with an unknown column', $sql$
  select pg_temp.create_job('{"title": "Neu", "job_number": "WC-J-2", "status": "fertig"}', '{}', null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('project with an unavailable template', $sql$
  select public.create_project_with_template('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '{"name": "Neu", "project_number": "WC-P-2"}',
    '26104170-0000-0000-0000-0000000000ff')
$sql$, 'work_template_version_unavailable');
select pg_temp.expect_refusal('project with a taken number', $sql$
  select public.create_project_with_template('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '{"name": "Neu", "project_number": "WC-P-1"}', null)
$sql$, 'project_number_taken');
select pg_temp.assert_no_new_rows('the refused creations');

-- A refused conversion step leaves the request open, without links or history.
select pg_temp.expect_refusal('conversion with a taken number', $sql$
  select public.convert_client_request_to_job('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000050',
    '{"title": "Heizung", "job_number": "WC-J-1", "client_id": "26104170-0000-0000-0000-000000000020"}',
    '{}', pg_temp.berlin_today(), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false)
$sql$, 'job_number_taken');
select pg_temp.expect_refusal('conversion of a foreign request', $sql$
  select public.convert_client_request_to_job('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000059',
    '{"title": "Fremd", "job_number": "WC-J-3", "client_id": "26104170-0000-0000-0000-000000000020"}',
    '{}', pg_temp.berlin_today(), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false)
$sql$, 'request_not_found');
select pg_temp.expect_refusal('project conversion with an unavailable template', $sql$
  select public.convert_client_request_to_project('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000051',
    '{"name": "Bad", "project_number": "WC-P-3", "client_id": "26104170-0000-0000-0000-000000000020"}',
    '26104170-0000-0000-0000-0000000000ff')
$sql$, 'work_template_version_unavailable');
select pg_temp.assert_no_new_rows('the refused conversions');

-- A refused due link leaves no visit job, so the next number stays free.
do $$
declare
  v_next_number text := public.generate_job_number('26104170-0000-0000-0000-000000000010');
  v_due public.maintenance_due_work;
begin
  select * into v_due from public.maintenance_due_work
  where maintenance_plan_id = '26104170-0000-0000-0000-000000000090' and status = 'open'
  order by due_date limit 1;
  perform pg_temp.expect_refusal('visit with a stale due version', format($sql$
    select public.create_maintenance_visit_job('26104170-0000-0000-0000-000000000010',
      '26104170-0000-0000-0000-000000000001', array[%L::uuid], array[%s::bigint], 'Besuch',
      '26104170-0000-0000-0000-0000000000a1', '{"title": "Wartung", "client_id": "26104170-0000-0000-0000-000000000020"}',
      '{}', pg_temp.berlin_today(), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false)
  $sql$, v_due.id, v_due.version + 1), 'maintenance_stale_version');
  perform pg_temp.assert_no_new_rows('the refused visit');
  if public.generate_job_number('26104170-0000-0000-0000-000000000010') <> v_next_number then
    raise exception 'the refused visit consumed the job number';
  end if;
end;
$$;

-- The clean calls write the work with every part.
do $$
declare
  v_job public.jobs;
  v_project public.projects;
  v_converted public.jobs;
  v_converted_project public.projects;
  v_visit public.jobs;
  v_due public.maintenance_due_work;
begin
  v_job := pg_temp.create_job(
    '{"title": "Wartung Bad", "job_number": "WC-J-2", "project_id": "26104170-0000-0000-0000-000000000030", "client_id": "26104170-0000-0000-0000-000000000029"}',
    array['26104170-0000-0000-0000-000000000002'::uuid], (select job_version from pg_temp.world));
  if v_job.client_id is distinct from '26104170-0000-0000-0000-000000000020'::uuid
    or v_job.site_id is distinct from '26104170-0000-0000-0000-000000000021'::uuid
    or v_job.contact_id is distinct from '26104170-0000-0000-0000-000000000022'::uuid
    or v_job.status <> 'nicht_bearbeitet' or v_job.priority <> 'mittel'
    or not exists (select 1 from public.job_assignments where job_id = v_job.id
                   and user_id = '26104170-0000-0000-0000-000000000002')
    or not exists (select 1 from public.job_instruction_items where job_id = v_job.id and content = 'Anlage warten')
    or not exists (select 1 from public.work_template_applications where job_id = v_job.id
                   and idempotency_key = format('create-job-%s-%s', v_job.id, (select job_version from pg_temp.world)))
  then
    raise exception 'the project job was not created with its customer, assignee and template';
  end if;

  v_project := public.create_project_with_template('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '{"name": "Neubau", "project_number": "WC-P-2"}',
    (select project_version from pg_temp.world));
  if not exists (select 1 from public.job_instruction_items where project_id = v_project.id and content = 'Bad planen')
  then
    raise exception 'the project was not created with its template';
  end if;

  v_converted := public.convert_client_request_to_job('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000050',
    '{"title": "Heizung kalt", "job_number": "WC-J-3", "client_id": "26104170-0000-0000-0000-000000000020", "site_id": "26104170-0000-0000-0000-000000000021", "location": ""}',
    '{}', pg_temp.berlin_today(), '{}', '[]', '{}', 'fingerprint', null, null, false, null, false);
  if v_converted.location is distinct from 'Ringstraße 4, 80331 München'
    or not exists (select 1 from public.client_requests where id = '26104170-0000-0000-0000-000000000050'
                   and status = 'umgewandelt' and converted_job_id = v_converted.id
                   and converted_by = '26104170-0000-0000-0000-000000000001')
    or not exists (select 1 from public.document_links where job_id = v_converted.id
                   and document_id = '26104170-0000-0000-0000-000000000061')
    or not exists (select 1 from public.document_audit_events where event_type = 'linked'
                   and event_payload ->> 'jobId' = v_converted.id::text
                   and event_payload ->> 'via' = 'request_conversion')
    or not exists (select 1 from public.client_request_events
                   where request_id = '26104170-0000-0000-0000-000000000050' and event_type = 'converted'
                   and event_payload ->> 'jobNumber' = 'WC-J-3')
  then
    raise exception 'the conversion to a job missed a part';
  end if;

  v_converted_project := public.convert_client_request_to_project('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000051',
    '{"name": "Bad neu", "project_number": "WC-P-3", "client_id": "26104170-0000-0000-0000-000000000020"}', null);
  if not exists (select 1 from public.client_requests where id = '26104170-0000-0000-0000-000000000051'
                 and converted_project_id = v_converted_project.id)
    or not exists (select 1 from public.document_links where project_id = v_converted_project.id)
    or not exists (select 1 from public.client_request_events
                   where request_id = '26104170-0000-0000-0000-000000000051' and event_type = 'converted'
                   and event_payload ->> 'projectNumber' = 'WC-P-3')
  then
    raise exception 'the conversion to a project missed a part';
  end if;

  select * into v_due from public.maintenance_due_work
  where maintenance_plan_id = '26104170-0000-0000-0000-000000000090' and status = 'open'
  order by due_date limit 1;
  v_visit := public.create_maintenance_visit_job('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', array[v_due.id], array[v_due.version], 'Besuch',
    '26104170-0000-0000-0000-0000000000a2',
    '{"title": "Wartung", "client_id": "26104170-0000-0000-0000-000000000020", "site_id": "26104170-0000-0000-0000-000000000021"}',
    '{}', pg_temp.berlin_today(), '{}', '[]', '{}', 'fingerprint', null, null, false,
    (select job_version from pg_temp.world), false);
  if v_visit.job_number !~ '^AUF-[0-9]{4}-[0-9]{3,}$'
    or not exists (select 1 from public.maintenance_due_work where id = v_due.id and job_id = v_visit.id)
    or not exists (select 1 from public.job_instruction_items where job_id = v_visit.id)
  then
    raise exception 'the visit job was not created with its number, template and due link';
  end if;
end;
$$;

-- A converted request refuses a second conversion and adds nothing.
select pg_temp.expect_refusal('second conversion', $sql$
  select public.convert_client_request_to_project('26104170-0000-0000-0000-000000000010',
    '26104170-0000-0000-0000-000000000001', '26104170-0000-0000-0000-000000000050',
    '{"name": "Doppelt", "project_number": "WC-P-4", "client_id": "26104170-0000-0000-0000-000000000020"}', null)
$sql$, 'already_converted');

reset role;

-- Only the service role executes the functions; nobody executes the steps.
do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.create_job_with_assignments(uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean)',
    'public.create_project_with_template(uuid, uuid, jsonb, uuid)',
    'public.convert_client_request_to_job(uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean)',
    'public.convert_client_request_to_project(uuid, uuid, uuid, jsonb, uuid)',
    'public.create_maintenance_visit_job(uuid, uuid, uuid[], bigint[], text, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '% lost its service_role grant', v_function;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
  foreach v_function in array array[
    'app_private.create_job_record(uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean)',
    'app_private.apply_template_to_new_work(uuid, uuid, uuid, uuid, uuid, boolean, date, uuid[], uuid[], jsonb, jsonb, text, text, uuid)',
    'app_private.create_project_record(uuid, uuid, jsonb, uuid)',
    'app_private.link_request_documents_to_work(uuid, uuid, uuid, uuid, uuid)',
    'app_private.lock_request_for_conversion(uuid, uuid)'
  ] loop
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
end;
$$;

rollback;
