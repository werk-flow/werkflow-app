-- Editing a project, editing a job and changing an instruction list apply
-- completely or not at all (migration 20261004150000_apply_work_edits_atomically.sql).
-- A changed number is checked under the organization's number lock that the
-- creations take (migration 20261005100000_lock_work_number_edits.sql).
-- A refusal of the later step leaves the earlier step unwritten, a reference
-- of another organization is refused, and only the service role executes the
-- functions.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26104150-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-atomic-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Atomic"}', now(), now()),
('26104150-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-atomic-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Atomic"}', now(), now()),
('26104150-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'work-atomic-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"Atomic"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('26104150-0000-0000-0000-000000000010', 'Atomic work SQL',
  '26104150-0000-0000-0000-000000000001', 'ATOMWORK'),
('26104150-0000-0000-0000-000000000011', 'Foreign work SQL',
  '26104150-0000-0000-0000-000000000003', 'FOREWORK');
insert into public.organization_members (organization_id, user_id, role) values
('26104150-0000-0000-0000-000000000010', '26104150-0000-0000-0000-000000000002', 'employee');

insert into public.clients (id, organization_id, name) values
('26104150-0000-0000-0000-000000000020', '26104150-0000-0000-0000-000000000010', 'Bestandskunde'),
('26104150-0000-0000-0000-000000000021', '26104150-0000-0000-0000-000000000010', 'Neukunde'),
('26104150-0000-0000-0000-000000000029', '26104150-0000-0000-0000-000000000011', 'Fremder Kunde');
insert into public.client_sites (id, organization_id, client_id, name) values
('26104150-0000-0000-0000-000000000030', '26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000020', 'Haus'),
('26104150-0000-0000-0000-000000000039', '26104150-0000-0000-0000-000000000011',
  '26104150-0000-0000-0000-000000000029', 'Fremdes Haus');
insert into public.client_contacts (id, organization_id, client_id, name) values
('26104150-0000-0000-0000-000000000031', '26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000020', 'Frau Bestand');

insert into public.projects (id, organization_id, client_id, site_id, contact_id, name, project_number, created_by)
values
('26104150-0000-0000-0000-000000000040', '26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000020', '26104150-0000-0000-0000-000000000030',
  '26104150-0000-0000-0000-000000000031', 'Badsanierung', 'ATOM-P-1',
  '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000041', '26104150-0000-0000-0000-000000000010',
  null, null, null, 'Heizung', 'ATOM-P-2', '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000049', '26104150-0000-0000-0000-000000000011',
  null, null, null, 'Fremdes Projekt', 'ATOM-P-9', '26104150-0000-0000-0000-000000000003');

insert into public.jobs (id, organization_id, project_id, client_id, site_id, job_number, title, created_by)
values
('26104150-0000-0000-0000-000000000050', '26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000040', '26104150-0000-0000-0000-000000000020',
  '26104150-0000-0000-0000-000000000030', 'ATOM-J-1', 'Rohinstallation',
  '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000010',
  null, null, null, 'ATOM-J-2', 'Wartung', '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000059', '26104150-0000-0000-0000-000000000011',
  null, null, null, 'ATOM-J-9', 'Fremder Auftrag', '26104150-0000-0000-0000-000000000003');

insert into public.job_instruction_items (id, organization_id, job_id, project_id, content, sort_order, created_by)
values
('26104150-0000-0000-0000-000000000060', '26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000051', null, 'Erster Schritt', 0, '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000061', '26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000051', null, 'Zweiter Schritt', 1, '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000062', '26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000051', null, 'Dritter Schritt', 2, '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000063', '26104150-0000-0000-0000-000000000010',
  null, '26104150-0000-0000-0000-000000000040', 'Projektschritt A', 0, '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000064', '26104150-0000-0000-0000-000000000010',
  null, '26104150-0000-0000-0000-000000000040', 'Projektschritt B', 1, '26104150-0000-0000-0000-000000000001'),
('26104150-0000-0000-0000-000000000069', '26104150-0000-0000-0000-000000000011',
  '26104150-0000-0000-0000-000000000059', null, 'Fremder Schritt', 0, '26104150-0000-0000-0000-000000000003');

-- A later step that the database refuses: while wf_test.refuse names a table,
-- every update of that table fails, as a constraint or a trigger would.
create function public.wf_test_refuse_write() returns trigger
language plpgsql as $$
begin
  if current_setting('wf_test.refuse', true) = tg_table_name then
    raise exception 'wf_test_refused';
  end if;
  return new;
end;
$$;
create trigger wf_test_refuse_write before update on public.jobs
  for each row execute function public.wf_test_refuse_write();
create trigger wf_test_refuse_write before update on public.job_instruction_items
  for each row execute function public.wf_test_refuse_write();

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

-- The rows the refusals must leave untouched.
create temporary table work_before on commit drop as
select 'project' as kind, to_jsonb(project) - 'updated_at' as row_data from public.projects project
where project.organization_id = '26104150-0000-0000-0000-000000000010'
union all
select 'job', to_jsonb(job) - 'updated_at' from public.jobs job
where job.organization_id = '26104150-0000-0000-0000-000000000010'
union all
select 'item', to_jsonb(item) - 'updated_at' from public.job_instruction_items item
where item.organization_id = '26104150-0000-0000-0000-000000000010'
union all
select 'assignment', to_jsonb(assignment) - 'assigned_at' from public.job_assignments assignment
where assignment.organization_id = '26104150-0000-0000-0000-000000000010';
grant select on work_before to service_role;

create function pg_temp.assert_work_unchanged(p_label text) returns void
language plpgsql as $$
begin
  if exists (
    (select kind, row_data from work_before)
    except
    (select 'project', to_jsonb(project) - 'updated_at' from public.projects project
     where project.organization_id = '26104150-0000-0000-0000-000000000010'
     union all
     select 'job', to_jsonb(job) - 'updated_at' from public.jobs job
     where job.organization_id = '26104150-0000-0000-0000-000000000010'
     union all
     select 'item', to_jsonb(item) - 'updated_at' from public.job_instruction_items item
     where item.organization_id = '26104150-0000-0000-0000-000000000010'
     union all
     select 'assignment', to_jsonb(assignment) - 'assigned_at' from public.job_assignments assignment
     where assignment.organization_id = '26104150-0000-0000-0000-000000000010')
  ) or (select count(*) from work_before) <> (
    (select count(*) from public.projects where organization_id = '26104150-0000-0000-0000-000000000010')
    + (select count(*) from public.jobs where organization_id = '26104150-0000-0000-0000-000000000010')
    + (select count(*) from public.job_instruction_items
       where organization_id = '26104150-0000-0000-0000-000000000010')
    + (select count(*) from public.job_assignments
       where organization_id = '26104150-0000-0000-0000-000000000010')
  ) then
    raise exception '% changed the work rows', p_label;
  end if;
end;
$$;
grant execute on function pg_temp.assert_work_unchanged(text) to service_role;

set local role service_role;

-- A project customer change whose job step is refused leaves the project unchanged.
set local wf_test.refuse = 'jobs';
select pg_temp.expect_refusal('project customer change with a refused job step', $sql$
  select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000040',
    '{"client_id": "26104150-0000-0000-0000-000000000021", "site_id": null, "contact_id": null}')
$sql$, 'wf_test_refused');
select pg_temp.assert_work_unchanged('the refused project edit');

-- A job edit whose assignment step is refused leaves the job unchanged.
set local wf_test.refuse = '';
select pg_temp.expect_refusal('job edit with a foreign assignee', $sql$
  select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
    '{"title": "Wartung neu", "planned_date": "2026-11-02"}', true,
    array['26104150-0000-0000-0000-000000000003'::uuid], '2026-11-02', '{}', '[]', '{}', 'fingerprint',
    null, null, false)
$sql$, 'assignment user is not an organization member');
select pg_temp.assert_work_unchanged('the refused job edit');

-- A list change whose renumbering is refused leaves the list unchanged.
set local wf_test.refuse = 'job_instruction_items';
select pg_temp.expect_refusal('reorder with a refused update', $sql$
  select public.reorder_instruction_items('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', null, array[
      '26104150-0000-0000-0000-000000000062', '26104150-0000-0000-0000-000000000060',
      '26104150-0000-0000-0000-000000000061']::uuid[])
$sql$, 'wf_test_refused');
select pg_temp.expect_refusal('create with a refused renumbering', $sql$
  select public.create_job_instruction_item('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001', 'Neuer Schritt',
    '26104150-0000-0000-0000-000000000060')
$sql$, 'wf_test_refused');
select pg_temp.expect_refusal('delete with a refused renumbering', $sql$
  select public.delete_instruction_item('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000060')
$sql$, 'wf_test_refused');
select pg_temp.assert_work_unchanged('the refused list changes');
set local wf_test.refuse = '';

-- Precise refusals, each before anything is written.
select pg_temp.expect_refusal('project of another organization', $sql$
  select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000049', '{"name": "Übernommen"}')
$sql$, 'project_not_found');
select pg_temp.expect_refusal('customer of another organization', $sql$
  select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000041', '{"client_id": "26104150-0000-0000-0000-000000000029"}')
$sql$, 'client_not_found');
select pg_temp.expect_refusal('site of another customer', $sql$
  select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000041',
    '{"client_id": "26104150-0000-0000-0000-000000000021", "site_id": "26104150-0000-0000-0000-000000000030"}')
$sql$, 'site_client_mismatch');
select pg_temp.expect_refusal('taken project number', $sql$
  select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000041', '{"project_number": "ATOM-P-1"}')
$sql$, 'project_number_taken');
select pg_temp.expect_refusal('blank project', $sql$
  select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000041', '{"name": " ", "description": null}')
$sql$, 'name_or_description_required');
select pg_temp.expect_refusal('project column outside the edit', $sql$
  select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000041', '{"organization_id": "26104150-0000-0000-0000-000000000011"}')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('job of another organization', $sql$
  select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000059', '26104150-0000-0000-0000-000000000001',
    '{"title": "Übernommen"}', false, null, null, null, null, null, null, null, null, null)
$sql$, 'job_not_found');
select pg_temp.expect_refusal('job into a project of another organization', $sql$
  select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
    '{"project_id": "26104150-0000-0000-0000-000000000049", "client_id": null}',
    false, null, null, null, null, null, null, null, null, null)
$sql$, 'project_not_found');
select pg_temp.expect_refusal('job site of another organization', $sql$
  select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
    '{"client_id": "26104150-0000-0000-0000-000000000020", "site_id": "26104150-0000-0000-0000-000000000039"}',
    false, null, null, null, null, null, null, null, null, null)
$sql$, 'site_not_found');
select pg_temp.expect_refusal('taken job number', $sql$
  select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
    '{"job_number": "ATOM-J-1"}', false, null, null, null, null, null, null, null, null, null)
$sql$, 'job_number_taken');
select pg_temp.expect_refusal('job status change outside unparking', $sql$
  select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
    '{"status": "abgeschlossen"}', false, null, null, null, null, null, null, null, null, null)
$sql$, 'invalid_input');
select pg_temp.expect_refusal('reorder with a missing item', $sql$
  select public.reorder_instruction_items('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', null, array[
      '26104150-0000-0000-0000-000000000060', '26104150-0000-0000-0000-000000000061']::uuid[])
$sql$, 'invalid_reorder');
select pg_temp.expect_refusal('reorder with a foreign item', $sql$
  select public.reorder_instruction_items('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', null, array[
      '26104150-0000-0000-0000-000000000060', '26104150-0000-0000-0000-000000000061',
      '26104150-0000-0000-0000-000000000069']::uuid[])
$sql$, 'invalid_reorder');
select pg_temp.expect_refusal('reorder of a foreign job', $sql$
  select public.reorder_instruction_items('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000059', null, array['26104150-0000-0000-0000-000000000069']::uuid[])
$sql$, 'job_not_found');
select pg_temp.expect_refusal('create after an item of another list', $sql$
  select public.create_job_instruction_item('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001', 'Neu',
    '26104150-0000-0000-0000-000000000063')
$sql$, 'item_not_found');
select pg_temp.expect_refusal('delete of a foreign item', $sql$
  select public.delete_instruction_item('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000069')
$sql$, 'item_not_found');
select pg_temp.assert_work_unchanged('the refused calls');

-- The success paths.
do $$
declare
  v_project public.projects;
  v_job public.jobs;
  v_item_id uuid;
begin
  v_project := public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000040',
    '{"client_id": "26104150-0000-0000-0000-000000000021", "site_id": null, "contact_id": null}');
  if v_project.client_id <> '26104150-0000-0000-0000-000000000021' or v_project.site_id is not null then
    raise exception 'the project customer change did not apply';
  end if;
  if exists (
    select 1 from public.jobs job
    where job.project_id = '26104150-0000-0000-0000-000000000040'
      and (job.client_id <> '26104150-0000-0000-0000-000000000021' or job.site_id is not null)
  ) then
    raise exception 'the project jobs kept the previous customer';
  end if;

  v_job := public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
    '{"title": "Wartung neu", "planned_date": "2026-11-02"}', true,
    array['26104150-0000-0000-0000-000000000002'::uuid], '2026-11-02', '{}', '[]', '{}', 'fingerprint',
    null, null, true);
  if v_job.title <> 'Wartung neu' or v_job.planned_date <> '2026-11-02' then
    raise exception 'the job edit did not apply';
  end if;
  if not exists (
    select 1 from public.job_assignments assignment
    where assignment.job_id = '26104150-0000-0000-0000-000000000051'
      and assignment.user_id = '26104150-0000-0000-0000-000000000002'
  ) or not exists (
    select 1 from public.job_qualification_assessments assessment
    where assessment.job_id = '26104150-0000-0000-0000-000000000051'
  ) then
    raise exception 'the job edit did not replace the assignments with their assessment';
  end if;
  if not exists (
    select 1 from public.planning_occurrences occurrence
    where occurrence.legacy_source_job_id = '26104150-0000-0000-0000-000000000051'
  ) then
    raise exception 'the job edit did not reach the planning projection';
  end if;

  perform public.reorder_instruction_items('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', null, array[
      '26104150-0000-0000-0000-000000000062', '26104150-0000-0000-0000-000000000060',
      '26104150-0000-0000-0000-000000000061']::uuid[]);
  v_item_id := public.create_job_instruction_item('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001', 'Neuer Schritt',
    '26104150-0000-0000-0000-000000000062');
  perform public.delete_instruction_item('26104150-0000-0000-0000-000000000010',
    '26104150-0000-0000-0000-000000000060');
  if (
    select array_agg(item.id order by item.sort_order) from public.job_instruction_items item
    where item.job_id = '26104150-0000-0000-0000-000000000051'
  ) <> array['26104150-0000-0000-0000-000000000062'::uuid, v_item_id,
      '26104150-0000-0000-0000-000000000061'::uuid]
    or (
      select array_agg(item.sort_order order by item.sort_order) from public.job_instruction_items item
      where item.job_id = '26104150-0000-0000-0000-000000000051'
    ) <> array[0, 1, 2]
  then
    raise exception 'the list changes did not leave a numbered list in the expected order';
  end if;
  if not exists (
    select 1 from public.realtime_deletions deletion
    where deletion.row_id = '26104150-0000-0000-0000-000000000060'
  ) then
    raise exception 'the item deletion was not signalled';
  end if;

  perform public.reorder_instruction_items('26104150-0000-0000-0000-000000000010', null,
    '26104150-0000-0000-0000-000000000040', array[
      '26104150-0000-0000-0000-000000000064', '26104150-0000-0000-0000-000000000063']::uuid[]);
  if (
    select sort_order from public.job_instruction_items where id = '26104150-0000-0000-0000-000000000064'
  ) <> 0 then
    raise exception 'the project list was not reordered';
  end if;
  if (select sort_order from public.job_instruction_items where id = '26104150-0000-0000-0000-000000000069') <> 0
  then
    raise exception 'a list change reached another organization';
  end if;
end;
$$;

-- An edit that names a new number holds the organization's number lock, which
-- the creations take before their check; an unchanged number takes no lock.
create function pg_temp.holds_number_lock(p_kind text) returns boolean
language sql as $$
  select exists (
    select 1 from pg_catalog.pg_locks lock
    cross join lateral (
      select hashtextextended(p_kind || ':26104150-0000-0000-0000-000000000010', 0) as key
    ) number_lock
    where lock.locktype = 'advisory' and lock.pid = pg_backend_pid() and lock.objsubid = 1
      and lock.classid = ((number_lock.key >> 32) & 4294967295)::oid
      and lock.objid = (number_lock.key & 4294967295)::oid
  )
$$;
grant execute on function pg_temp.holds_number_lock(text) to service_role;

savepoint number_lock;
select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
  '{"job_number": "ATOM-J-2", "title": "Wartung gleich"}', false,
  null, null, null, null, null, null, null, null, null);
select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000041', '{"project_number": "ATOM-P-2", "name": "Heizung gleich"}');
do $$
begin
  if pg_temp.holds_number_lock('job_number') or pg_temp.holds_number_lock('project_number') then
    raise exception 'an edit with an unchanged number took the number lock';
  end if;
end;
$$;
select public.update_job_with_assignments('26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000051', '26104150-0000-0000-0000-000000000001',
  '{"job_number": "ATOM-J-3"}', false, null, null, null, null, null, null, null, null, null);
select public.update_project_with_jobs('26104150-0000-0000-0000-000000000010',
  '26104150-0000-0000-0000-000000000041', '{"project_number": "ATOM-P-3"}');
do $$
begin
  if not pg_temp.holds_number_lock('job_number') then
    raise exception 'a job number change did not take the job number lock';
  end if;
  if not pg_temp.holds_number_lock('project_number') then
    raise exception 'a project number change did not take the project number lock';
  end if;
end;
$$;
rollback to savepoint number_lock;

reset role;

-- Only the service role executes the functions; nobody executes the steps.
do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.update_project_with_jobs(uuid, uuid, jsonb)',
    'public.update_job_with_assignments(uuid, uuid, uuid, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean)',
    'public.reorder_instruction_items(uuid, uuid, uuid, uuid[])',
    'public.create_job_instruction_item(uuid, uuid, uuid, text, uuid)',
    'public.delete_instruction_item(uuid, uuid)'
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
    'app_private.assert_work_customer_references(uuid, uuid, uuid, uuid)',
    'app_private.work_edit_assignments(jsonb, text[])',
    'app_private.lock_instruction_list(uuid, uuid, uuid)',
    'app_private.write_instruction_order(uuid, uuid[])'
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
