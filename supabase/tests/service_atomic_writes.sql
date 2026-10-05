-- Maintenance writes that span several tables apply completely or not at all.
-- A plan saved with its due work (migration
-- 20261004152000_save_maintenance_plans_with_due_work.sql) and a visit
-- scheduled with its due link (migration
-- 20261004152100_schedule_maintenance_visits_atomically.sql) leave nothing
-- behind when a later step refuses, refuse a foreign organization, replay
-- without duplicates, and only the service role executes them.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('26104000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'atomic-service-admin@example.test', '', now(), '{}',
 '{"first_name":"Atomic","last_name":"Admin"}', now(), now()),
('26104000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'atomic-service-outsider@example.test', '', now(), '{}',
 '{"first_name":"Atomic","last_name":"Outsider"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('26104000-0000-0000-0000-000000000010', 'Atomic service SQL', '26104000-0000-0000-0000-000000000001', 'ATOMSRVA'),
('26104000-0000-0000-0000-000000000011', 'Atomic outsider SQL', '26104000-0000-0000-0000-000000000002', 'ATOMSRVB');

insert into public.clients (id, organization_id, name) values
('26104000-0000-0000-0000-000000000020', '26104000-0000-0000-0000-000000000010', 'Atomic Kunde');
insert into public.client_sites (id, organization_id, client_id, name, is_primary, created_by) values
('26104000-0000-0000-0000-000000000021', '26104000-0000-0000-0000-000000000010',
 '26104000-0000-0000-0000-000000000020', 'Heizraum', true, '26104000-0000-0000-0000-000000000001');
insert into public.jobs (id, organization_id, created_by, client_id, site_id, job_number, title) values
('26104000-0000-0000-0000-000000000030', '26104000-0000-0000-0000-000000000010',
 '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000020',
 '26104000-0000-0000-0000-000000000021', 'AUF-ATOM-1', 'Wartungsbesuch'),
('26104000-0000-0000-0000-000000000031', '26104000-0000-0000-0000-000000000010',
 '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000020',
 '26104000-0000-0000-0000-000000000021', 'AUF-ATOM-2', 'Anderer Auftrag');

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

create function pg_temp.berlin_today() returns date language sql as $$
  select (timezone('Europe/Berlin', now()))::date;
$$;

create temporary table world (version_id uuid, equipment_one uuid, equipment_two uuid);

create function pg_temp.plan_payload(p_plan_id uuid, p_revision_id uuid, p_equipment_id uuid, p_status text)
returns jsonb language sql as $$
  select jsonb_build_object(
    'planId', p_plan_id, 'revisionId', p_revision_id,
    'clientId', '26104000-0000-0000-0000-000000000020',
    'siteId', '26104000-0000-0000-0000-000000000021',
    'maintenanceCoverageId', null, 'status', p_status,
    'templateVersionId', (select version_id from pg_temp.world),
    'effectiveFromDate', pg_temp.berlin_today(), 'firstDueDate', pg_temp.berlin_today() + 30,
    'intervalMonths', 6, 'dueWindowBeforeDays', 7, 'dueWindowAfterDays', 7,
    'plannedDurationMinutes', 90, 'nextDueBasis', 'planned_due_date',
    'operationalInstructions', null, 'overlapReason', null, 'reason', 'Wartungsplan angelegt',
    'equipmentIds', jsonb_build_array(p_equipment_id)
  );
$$;

create function pg_temp.visit_occurrence(p_job_id uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'jobId', p_job_id, 'entryKind', 'job_visit', 'internalType', null, 'title', null,
    'description', null, 'location', null, 'timeKind', 'timed',
    'originalStartLocal', to_char(pg_temp.berlin_today() + 7, 'YYYY-MM-DD') || 'T09:00',
    'startAt', ((pg_temp.berlin_today() + 7) + time '09:00') at time zone 'Europe/Berlin',
    'endAt', ((pg_temp.berlin_today() + 7) + time '10:30') at time zone 'Europe/Berlin',
    'startDate', null, 'endDateExclusive', null, 'dstResolution', 'exact'
  );
$$;

do $$
declare
  v_template_id uuid;
  v_version_id uuid;
  v_equipment public.installed_equipment%rowtype;
  v_second public.installed_equipment%rowtype;
begin
  v_template_id := public.create_work_template(
    '26104000-0000-0000-0000-000000000010', 'job', 'Wartung atomar', '26104000-0000-0000-0000-000000000001'
  );
  perform public.save_work_template_draft(
    p_organization_id => '26104000-0000-0000-0000-000000000010', p_template_id => v_template_id,
    p_actor_id => '26104000-0000-0000-0000-000000000001', p_name => 'Wartung atomar',
    p_items => jsonb_build_array(jsonb_build_object(
      'id', '26104000-0000-0000-0000-000000000040', 'item_kind', 'checklist', 'content', 'Anlage warten',
      'requirement_state', 'required', 'group_label', null, 'notes', null, 'sort_order', 0))
  );
  v_version_id := public.publish_work_template(
    '26104000-0000-0000-0000-000000000010', v_template_id, '26104000-0000-0000-0000-000000000001'
  );
  v_equipment := public.create_installed_equipment(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000041',
    jsonb_build_object('clientId', '26104000-0000-0000-0000-000000000020',
      'siteId', '26104000-0000-0000-0000-000000000021', 'name', 'Kessel atomar',
      'category', 'heat_generation', 'state', 'active', 'identifiers', '[]'::jsonb),
    '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000042'
  );
  v_second := public.create_installed_equipment(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000043',
    jsonb_build_object('clientId', '26104000-0000-0000-0000-000000000020',
      'siteId', '26104000-0000-0000-0000-000000000021', 'name', 'Speicher atomar',
      'category', 'heat_generation', 'state', 'active', 'identifiers', '[]'::jsonb),
    '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000044'
  );
  insert into pg_temp.world values (v_version_id, v_equipment.id, v_second.id);
end;
$$;

-- An active plan whose generation is refused leaves no plan, revision,
-- equipment link, history or due work.
select pg_temp.expect_refusal('create with a refused generation', format($sql$
  select public.create_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000050',
    '26104000-0000-0000-0000-000000000051',
    pg_temp.plan_payload('26104000-0000-0000-0000-000000000050', '26104000-0000-0000-0000-000000000051',
      %L, 'active'),
    '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000052',
    (pg_temp.berlin_today() + interval '24 months')::date)
$sql$, (select equipment_one from pg_temp.world)), 'maintenance_generation_horizon_invalid');

do $$
begin
  if exists (select 1 from public.maintenance_plans where id = '26104000-0000-0000-0000-000000000050')
    or exists (select 1 from public.maintenance_plan_revisions where id = '26104000-0000-0000-0000-000000000051')
    or exists (select 1 from public.maintenance_plan_revision_equipment
               where maintenance_plan_revision_id = '26104000-0000-0000-0000-000000000051')
    or exists (select 1 from public.maintenance_plan_events where maintenance_plan_id = '26104000-0000-0000-0000-000000000050')
    or exists (select 1 from public.maintenance_due_work where maintenance_plan_id = '26104000-0000-0000-0000-000000000050')
  then raise exception 'a refused generation left part of the plan'; end if;
end;
$$;

-- A foreign actor and a foreign organization are refused.
select pg_temp.expect_refusal('create by a foreign actor', format($sql$
  select public.create_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000050',
    '26104000-0000-0000-0000-000000000051',
    pg_temp.plan_payload('26104000-0000-0000-0000-000000000050', '26104000-0000-0000-0000-000000000051',
      %L, 'active'),
    '26104000-0000-0000-0000-000000000002', '26104000-0000-0000-0000-000000000052',
    (pg_temp.berlin_today() + interval '12 months')::date)
$sql$, (select equipment_one from pg_temp.world)), 'maintenance_not_authorized');

-- The clean create applies the plan and its due work together; a replay adds nothing.
do $$
declare
  v_equipment uuid := (select equipment_one from pg_temp.world);
  v_plan public.maintenance_plans%rowtype;
  v_replay public.maintenance_plans%rowtype;
  v_due_count integer;
begin
  v_plan := public.create_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000050',
    '26104000-0000-0000-0000-000000000051',
    pg_temp.plan_payload('26104000-0000-0000-0000-000000000050', '26104000-0000-0000-0000-000000000051',
      v_equipment, 'active'),
    '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000052',
    (pg_temp.berlin_today() + interval '12 months')::date
  );
  select count(*) into v_due_count from public.maintenance_due_work
  where maintenance_plan_id = v_plan.id and status = 'open';
  if v_plan.status <> 'active' or v_plan.generation_through_date is null or v_due_count < 2 then
    raise exception 'a clean create did not generate the due work (% items)', v_due_count;
  end if;
  if (select array_agg(event_type::text order by event_type::text) from public.maintenance_plan_events
      where maintenance_plan_id = v_plan.id) is distinct from array['created', 'horizon_extended'] then
    raise exception 'a clean create did not append created and horizon_extended';
  end if;
  if (select count(*) from public.maintenance_due_work_events event
      join public.maintenance_due_work due on due.id = event.maintenance_due_work_id
      where due.maintenance_plan_id = v_plan.id and event.event_type = 'generated') <> v_due_count then
    raise exception 'a generated due item lacks its generated event';
  end if;

  v_replay := public.create_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000050',
    '26104000-0000-0000-0000-000000000051',
    pg_temp.plan_payload('26104000-0000-0000-0000-000000000050', '26104000-0000-0000-0000-000000000051',
      v_equipment, 'active'),
    '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000052',
    (pg_temp.berlin_today() + interval '12 months')::date
  );
  if v_replay.version <> v_plan.version
    or (select count(*) from public.maintenance_due_work where maintenance_plan_id = v_plan.id) <> v_due_count
    or (select count(*) from public.maintenance_plan_events where maintenance_plan_id = v_plan.id) <> 2
  then raise exception 'a replayed create changed the plan'; end if;
end;
$$;

-- A revision whose regeneration is refused keeps the current revision and version.
select pg_temp.expect_refusal('revise with a refused generation', format($sql$
  select public.revise_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000050',
    '26104000-0000-0000-0000-000000000053',
    (select version from public.maintenance_plans where id = '26104000-0000-0000-0000-000000000050'),
    pg_temp.plan_payload('26104000-0000-0000-0000-000000000050', '26104000-0000-0000-0000-000000000053',
      %L, 'active') || '{"intervalMonths": 3}',
    'Intervall verkürzt', '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000054',
    (pg_temp.berlin_today() + interval '24 months')::date)
$sql$, (select equipment_one from pg_temp.world)), 'maintenance_generation_horizon_invalid');
select pg_temp.expect_refusal('revise in a foreign organization', format($sql$
  select public.revise_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000011', '26104000-0000-0000-0000-000000000050',
    '26104000-0000-0000-0000-000000000053', 2,
    pg_temp.plan_payload('26104000-0000-0000-0000-000000000050', '26104000-0000-0000-0000-000000000053',
      %L, 'active'),
    'Intervall verkürzt', '26104000-0000-0000-0000-000000000002', '26104000-0000-0000-0000-000000000054',
    (pg_temp.berlin_today() + interval '12 months')::date)
$sql$, (select equipment_one from pg_temp.world)), 'maintenance_plan_not_found');

do $$
declare
  v_plan public.maintenance_plans%rowtype;
  v_revised public.maintenance_plans%rowtype;
begin
  select * into v_plan from public.maintenance_plans where id = '26104000-0000-0000-0000-000000000050';
  if v_plan.current_revision_id <> '26104000-0000-0000-0000-000000000051'
    or exists (select 1 from public.maintenance_plan_revisions where id = '26104000-0000-0000-0000-000000000053')
    or (select count(*) from public.maintenance_plan_events where maintenance_plan_id = v_plan.id) <> 2
  then raise exception 'a refused regeneration left the new revision'; end if;

  v_revised := public.revise_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', v_plan.id, '26104000-0000-0000-0000-000000000053', v_plan.version,
    pg_temp.plan_payload(v_plan.id, '26104000-0000-0000-0000-000000000053',
      (select equipment_one from pg_temp.world), 'active') || '{"intervalMonths": 3}',
    'Intervall verkürzt', '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000054',
    (pg_temp.berlin_today() + interval '12 months')::date
  );
  if v_revised.current_revision_id <> '26104000-0000-0000-0000-000000000053'
    or v_revised.generation_through_date is null
    or not exists (select 1 from public.maintenance_due_work
                   where maintenance_plan_revision_id = '26104000-0000-0000-0000-000000000053')
  then raise exception 'a clean revision did not regenerate the due work'; end if;
end;
$$;

-- A draft has no due work; activating it is refused as a whole when the
-- generation is refused, and generates when it passes.
do $$
declare
  v_draft public.maintenance_plans%rowtype;
begin
  v_draft := public.create_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000060',
    '26104000-0000-0000-0000-000000000061',
    pg_temp.plan_payload('26104000-0000-0000-0000-000000000060', '26104000-0000-0000-0000-000000000061',
      (select equipment_two from pg_temp.world), 'draft'),
    '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000062',
    (pg_temp.berlin_today() + interval '12 months')::date
  );
  if v_draft.status <> 'draft'
    or exists (select 1 from public.maintenance_due_work where maintenance_plan_id = v_draft.id)
  then raise exception 'a draft plan received due work'; end if;
end;
$$;

select pg_temp.expect_refusal('activate with a refused generation', $sql$
  select public.transition_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000060',
    (select version from public.maintenance_plans where id = '26104000-0000-0000-0000-000000000060'),
    'active', 'Plan aktiviert', '26104000-0000-0000-0000-000000000001',
    '26104000-0000-0000-0000-000000000063', (pg_temp.berlin_today() + interval '24 months')::date)
$sql$, 'maintenance_generation_horizon_invalid');
select pg_temp.expect_refusal('activate in a foreign organization', $sql$
  select public.transition_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000011', '26104000-0000-0000-0000-000000000060', 1,
    'active', 'Plan aktiviert', '26104000-0000-0000-0000-000000000002',
    '26104000-0000-0000-0000-000000000063', (pg_temp.berlin_today() + interval '12 months')::date)
$sql$, 'maintenance_plan_not_found');

do $$
declare
  v_plan public.maintenance_plans%rowtype;
  v_active public.maintenance_plans%rowtype;
begin
  select * into v_plan from public.maintenance_plans where id = '26104000-0000-0000-0000-000000000060';
  if v_plan.status <> 'draft'
    or exists (select 1 from public.maintenance_due_work where maintenance_plan_id = v_plan.id)
    or exists (select 1 from public.maintenance_plan_events
               where maintenance_plan_id = v_plan.id and event_type::text = 'status_changed')
  then raise exception 'a refused activation changed the plan'; end if;

  v_active := public.transition_maintenance_plan_with_due_work(
    '26104000-0000-0000-0000-000000000010', v_plan.id, v_plan.version, 'active', 'Plan aktiviert',
    '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000063',
    (pg_temp.berlin_today() + interval '12 months')::date
  );
  if v_active.status <> 'active'
    or not exists (select 1 from public.maintenance_due_work where maintenance_plan_id = v_plan.id)
  then raise exception 'a clean activation did not generate the due work'; end if;
end;
$$;

-- Scheduling: link the first due item of the active plan to its visit job.
create temporary table schedule_world (linked_due uuid, open_due uuid);
do $$
declare
  v_linked uuid;
  v_open uuid;
begin
  select id into v_linked from public.maintenance_due_work
  where maintenance_plan_id = '26104000-0000-0000-0000-000000000050' and status = 'open'
  order by due_date, id limit 1;
  select id into v_open from public.maintenance_due_work
  where maintenance_plan_id = '26104000-0000-0000-0000-000000000060' and status = 'open'
  order by due_date, id limit 1;
  perform public.link_maintenance_due_visit(
    '26104000-0000-0000-0000-000000000010', array[v_linked], '26104000-0000-0000-0000-000000000030', null,
    array[(select version from public.maintenance_due_work where id = v_linked)],
    'Wartungsauftrag angelegt', '26104000-0000-0000-0000-000000000001', '26104000-0000-0000-0000-000000000070'
  );
  insert into pg_temp.schedule_world values (v_linked, v_open);
end;
$$;

-- Each refusal after the occurrence would exist leaves no occurrence, event or link.
select pg_temp.expect_refusal('schedule with a stale version', $sql$
  select public.schedule_maintenance_visit(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000001',
    (select linked_due from pg_temp.schedule_world),
    (select version - 1 from public.maintenance_due_work where id = (select linked_due from pg_temp.schedule_world)),
    pg_temp.visit_occurrence('26104000-0000-0000-0000-000000000030'), '[]'::jsonb,
    '26104000-0000-0000-0000-000000000071', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification')
$sql$, 'maintenance_stale_version');
select pg_temp.expect_refusal('schedule a due item without its visit job', $sql$
  select public.schedule_maintenance_visit(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000001',
    (select open_due from pg_temp.schedule_world),
    (select version from public.maintenance_due_work where id = (select open_due from pg_temp.schedule_world)),
    pg_temp.visit_occurrence('26104000-0000-0000-0000-000000000030'), '[]'::jsonb,
    '26104000-0000-0000-0000-000000000071', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification')
$sql$, 'maintenance_due_schedule_not_allowed');
select pg_temp.expect_refusal('schedule another job for the due item', $sql$
  select public.schedule_maintenance_visit(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000001',
    (select linked_due from pg_temp.schedule_world),
    (select version from public.maintenance_due_work where id = (select linked_due from pg_temp.schedule_world)),
    pg_temp.visit_occurrence('26104000-0000-0000-0000-000000000031'), '[]'::jsonb,
    '26104000-0000-0000-0000-000000000071', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification')
$sql$, 'maintenance_due_job_mismatch');
select pg_temp.expect_refusal('schedule by a foreign actor', $sql$
  select public.schedule_maintenance_visit(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000002',
    (select linked_due from pg_temp.schedule_world),
    (select version from public.maintenance_due_work where id = (select linked_due from pg_temp.schedule_world)),
    pg_temp.visit_occurrence('26104000-0000-0000-0000-000000000030'), '[]'::jsonb,
    '26104000-0000-0000-0000-000000000071', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification')
$sql$, 'maintenance_not_authorized');
select pg_temp.expect_refusal('schedule a due item of a foreign organization', $sql$
  select public.schedule_maintenance_visit(
    '26104000-0000-0000-0000-000000000011', '26104000-0000-0000-0000-000000000002',
    (select linked_due from pg_temp.schedule_world), 1,
    pg_temp.visit_occurrence('26104000-0000-0000-0000-000000000030'), '[]'::jsonb,
    '26104000-0000-0000-0000-000000000071', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification')
$sql$, 'maintenance_due_not_found');

do $$
declare
  v_linked uuid := (select linked_due from pg_temp.schedule_world);
  v_open uuid := (select open_due from pg_temp.schedule_world);
  v_version bigint := (select version from public.maintenance_due_work where id = v_linked);
  v_occurrence_id uuid;
  v_replay_id uuid;
begin
  if exists (select 1 from public.planning_occurrences
             where creation_request_id = '26104000-0000-0000-0000-000000000071')
    or exists (select 1 from public.planning_events event
               join public.planning_occurrences occurrence on occurrence.id = event.occurrence_id
               where occurrence.organization_id = '26104000-0000-0000-0000-000000000010')
    or exists (select 1 from public.maintenance_due_work
               where id in (v_linked, v_open) and planning_occurrence_id is not null)
    or exists (select 1 from public.maintenance_due_work_events
               where maintenance_due_work_id in (v_linked, v_open) and event_type::text = 'visit_rescheduled')
  then raise exception 'a refused schedule left an occurrence, an event or a link'; end if;

  v_occurrence_id := public.schedule_maintenance_visit(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000001', v_linked, v_version,
    pg_temp.visit_occurrence('26104000-0000-0000-0000-000000000030'), '[]'::jsonb,
    '26104000-0000-0000-0000-000000000071', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  if (select planning_occurrence_id from public.maintenance_due_work where id = v_linked) <> v_occurrence_id
    or (select job_id from public.planning_occurrences where id = v_occurrence_id)
       <> '26104000-0000-0000-0000-000000000030'
    or not exists (select 1 from public.planning_events where occurrence_id = v_occurrence_id
                   and event_type::text = 'created')
    or not exists (select 1 from public.maintenance_due_work_events where maintenance_due_work_id = v_linked
                   and event_type::text = 'visit_rescheduled')
  then raise exception 'a clean schedule did not create and link the occurrence'; end if;

  v_replay_id := public.schedule_maintenance_visit(
    '26104000-0000-0000-0000-000000000010', '26104000-0000-0000-0000-000000000001', v_linked, v_version,
    pg_temp.visit_occurrence('26104000-0000-0000-0000-000000000030'), '[]'::jsonb,
    '26104000-0000-0000-0000-000000000071', '{}'::jsonb, 'capacity', '{}'::jsonb, 'qualification'
  );
  if v_replay_id <> v_occurrence_id
    or (select count(*) from public.planning_occurrences
        where creation_request_id = '26104000-0000-0000-0000-000000000071') <> 1
    or (select version from public.maintenance_due_work where id = v_linked) <> v_version + 1
  then raise exception 'a replayed schedule changed the visit'; end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.create_maintenance_plan_with_due_work(uuid, uuid, uuid, jsonb, uuid, uuid, date)',
    'public.revise_maintenance_plan_with_due_work(uuid, uuid, uuid, bigint, jsonb, text, uuid, uuid, date)',
    'public.transition_maintenance_plan_with_due_work(uuid, uuid, bigint, public.maintenance_plan_status, text, uuid, uuid, date)',
    'public.schedule_maintenance_visit(uuid, uuid, uuid, bigint, jsonb, jsonb, uuid, jsonb, text, jsonb, text)'
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
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role,
      'app_private.generate_due_work_for_active_plan(public.maintenance_plans, date, uuid, uuid)', 'execute')
    then raise exception 'the due work step is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
