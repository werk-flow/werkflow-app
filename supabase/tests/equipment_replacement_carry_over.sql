-- Replacing an Anlage carries its maintenance obligations and components to
-- the Nachfolger (migration
-- 20261205091100_carry_replaced_equipment_obligations_to_successor.sql):
-- an overdue open due item stays open with its due date on the successor's
-- new plan revision, completed due work stays on the old revision, a plan left
-- behind needs a reason, a stale or incomplete choice refuses the whole
-- replacement, a later generation recreates no past due work, the successor
-- reads the predecessor's history, a correction carries everything back, and
-- only the service role executes the functions.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('46600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'carry-over-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('46600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'carry-over-outsider@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('46600000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg SQL', '46600000-0000-4000-8000-000000000001', 'CARRYSUA'),
('46600000-0000-4000-8000-000000000011', 'Fremdbetrieb SQL', '46600000-0000-4000-8000-000000000002', 'CARRYSUB');
insert into public.clients (id, organization_id, name) values
('46600000-0000-4000-8000-000000000020', '46600000-0000-4000-8000-000000000010', 'Hausverwaltung Lindenhof GmbH');
insert into public.client_sites (id, organization_id, client_id, name, is_primary, created_by) values
('46600000-0000-4000-8000-000000000021', '46600000-0000-4000-8000-000000000010',
 '46600000-0000-4000-8000-000000000020', 'Heizraum', true, '46600000-0000-4000-8000-000000000001');

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

create temporary table world (
  version_id uuid, predecessor uuid, component uuid,
  overdue_due uuid, overdue_date date, completed_due uuid, completed_date date
);

-- The replacement of the predecessor 46600000-…-040 by 46600000-…-060.
create function pg_temp.replace(p_plans jsonb, p_components jsonb, p_key uuid)
returns public.installed_equipment language sql as $$
  select public.replace_installed_equipment(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000040',
    '46600000-0000-4000-8000-000000000060', 1,
    jsonb_build_object('name', 'Wärmepumpe neu', 'category', 'heat_generation', 'state', 'active',
      'identifiers', '[]'::jsonb),
    now(), 'Kessel defekt, Wärmepumpe eingebaut', '46600000-0000-4000-8000-000000000001', p_key,
    jsonb_build_object('plans', p_plans, 'components', p_components)
  );
$$;

create function pg_temp.plan_choice(p_plan_id uuid, p_carry boolean, p_reason text, p_version_offset integer default 0)
returns jsonb language sql as $$
  select jsonb_build_object(
    'planId', p_plan_id,
    'expectedVersion', (select plan.version + p_version_offset from public.maintenance_plans plan
      where plan.id = p_plan_id and plan.organization_id = '46600000-0000-4000-8000-000000000010'),
    'carry', p_carry, 'reason', p_reason
  );
$$;

do $$
declare
  v_template_id uuid;
  v_version_id uuid;
  v_first_due date := (pg_temp.berlin_today() - 30 - interval '12 months')::date;
begin
  v_template_id := public.create_work_template(
    '46600000-0000-4000-8000-000000000010', 'job', 'Heizungswartung', '46600000-0000-4000-8000-000000000001'
  );
  perform public.save_work_template_draft(
    p_organization_id => '46600000-0000-4000-8000-000000000010', p_template_id => v_template_id,
    p_actor_id => '46600000-0000-4000-8000-000000000001', p_name => 'Heizungswartung',
    p_items => jsonb_build_array(jsonb_build_object(
      'id', '46600000-0000-4000-8000-000000000030', 'item_kind', 'checklist', 'content', 'Anlage warten',
      'requirement_state', 'required', 'group_label', null, 'notes', null, 'sort_order', 0))
  );
  v_version_id := public.publish_work_template(
    '46600000-0000-4000-8000-000000000010', v_template_id, '46600000-0000-4000-8000-000000000001'
  );
  perform public.create_installed_equipment(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000040',
    jsonb_build_object('clientId', '46600000-0000-4000-8000-000000000020',
      'siteId', '46600000-0000-4000-8000-000000000021', 'name', 'Gaskessel alt',
      'category', 'heat_generation', 'state', 'active', 'identifiers', '[]'::jsonb),
    '46600000-0000-4000-8000-000000000001', '46600000-0000-4000-8000-000000000041'
  );
  perform public.create_installed_equipment(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000042',
    jsonb_build_object('clientId', '46600000-0000-4000-8000-000000000020',
      'siteId', '46600000-0000-4000-8000-000000000021', 'name', 'Umwälzpumpe',
      'category', 'system_component', 'parentEquipmentId', '46600000-0000-4000-8000-000000000040',
      'state', 'active', 'identifiers', '[]'::jsonb),
    '46600000-0000-4000-8000-000000000001', '46600000-0000-4000-8000-000000000043'
  );
  -- Two active yearly plans on the predecessor; the first started a year
  -- before its overdue item.
  perform public.create_maintenance_plan_with_due_work(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000050',
    '46600000-0000-4000-8000-000000000051',
    jsonb_build_object(
      'clientId', '46600000-0000-4000-8000-000000000020', 'siteId', '46600000-0000-4000-8000-000000000021',
      'maintenanceCoverageId', null, 'status', 'active', 'templateVersionId', v_version_id,
      'effectiveFromDate', v_first_due, 'firstDueDate', v_first_due, 'intervalMonths', 12,
      'dueWindowBeforeDays', 0, 'dueWindowAfterDays', 0, 'plannedDurationMinutes', 90,
      'nextDueBasis', 'planned_due_date', 'operationalInstructions', null, 'overlapReason', null,
      'reason', 'Wartungsplan angelegt',
      'equipmentIds', jsonb_build_array('46600000-0000-4000-8000-000000000040')),
    '46600000-0000-4000-8000-000000000001', '46600000-0000-4000-8000-000000000052',
    (pg_temp.berlin_today() + interval '6 months')::date
  );
  perform public.create_maintenance_plan_with_due_work(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000053',
    '46600000-0000-4000-8000-000000000054',
    jsonb_build_object(
      'clientId', '46600000-0000-4000-8000-000000000020', 'siteId', '46600000-0000-4000-8000-000000000021',
      'maintenanceCoverageId', null, 'status', 'active', 'templateVersionId', v_version_id,
      'effectiveFromDate', pg_temp.berlin_today(), 'firstDueDate', pg_temp.berlin_today() + 60,
      'intervalMonths', 12, 'dueWindowBeforeDays', 0, 'dueWindowAfterDays', 0,
      'plannedDurationMinutes', 60, 'nextDueBasis', 'planned_due_date', 'operationalInstructions', null,
      'overlapReason', 'Abgasmessung getrennt', 'reason', 'Abgasmessung angelegt',
      'equipmentIds', jsonb_build_array('46600000-0000-4000-8000-000000000040')),
    '46600000-0000-4000-8000-000000000001', '46600000-0000-4000-8000-000000000055',
    (pg_temp.berlin_today() + interval '6 months')::date
  );
  -- The first item was visited; the second is overdue and open.
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_due_work due_work set status = 'completed', scope_outcome = 'complete',
    completed_on = due_work.original_due_date
  where due_work.organization_id = '46600000-0000-4000-8000-000000000010'
    and due_work.maintenance_plan_id = '46600000-0000-4000-8000-000000000050'
    and due_work.original_due_date = v_first_due;
  perform set_config('app.maintenance_write', 'false', true);
  insert into pg_temp.world
  select v_version_id, '46600000-0000-4000-8000-000000000040', '46600000-0000-4000-8000-000000000042',
    open_due.id, open_due.due_date, done_due.id, done_due.due_date
  from public.maintenance_due_work open_due, public.maintenance_due_work done_due
  where open_due.organization_id = '46600000-0000-4000-8000-000000000010'
    and open_due.maintenance_plan_id = '46600000-0000-4000-8000-000000000050'
    and open_due.status = 'open' and open_due.due_date < pg_temp.berlin_today()
    and done_due.organization_id = '46600000-0000-4000-8000-000000000010'
    and done_due.maintenance_plan_id = '46600000-0000-4000-8000-000000000050'
    and done_due.status = 'completed';
  if (select count(*) from pg_temp.world) is distinct from 1::bigint then
    raise exception 'fixture: expected one overdue and one completed due item';
  end if;
end;
$$;

-- A plan left behind without a reason refuses the whole replacement.
select pg_temp.expect_refusal('plan left without a reason', $sql$
  select pg_temp.replace(
    jsonb_build_array(
      pg_temp.plan_choice('46600000-0000-4000-8000-000000000050', true, null),
      pg_temp.plan_choice('46600000-0000-4000-8000-000000000053', false, ' ')),
    jsonb_build_array(jsonb_build_object('equipmentId', '46600000-0000-4000-8000-000000000042', 'carry', true)),
    '46600000-0000-4000-8000-000000000070')
$sql$, 'installed_equipment_replacement_plan_reason_required');

-- A stale plan version refuses the whole replacement.
select pg_temp.expect_refusal('stale plan version', $sql$
  select pg_temp.replace(
    jsonb_build_array(
      pg_temp.plan_choice('46600000-0000-4000-8000-000000000050', true, null, -1),
      pg_temp.plan_choice('46600000-0000-4000-8000-000000000053', true, null)),
    jsonb_build_array(jsonb_build_object('equipmentId', '46600000-0000-4000-8000-000000000042', 'carry', true)),
    '46600000-0000-4000-8000-000000000071')
$sql$, 'installed_equipment_stale_version');

-- A choice set that misses a running plan or a component refuses too.
select pg_temp.expect_refusal('missing plan choice', $sql$
  select pg_temp.replace(
    jsonb_build_array(pg_temp.plan_choice('46600000-0000-4000-8000-000000000050', true, null)),
    jsonb_build_array(jsonb_build_object('equipmentId', '46600000-0000-4000-8000-000000000042', 'carry', true)),
    '46600000-0000-4000-8000-000000000072')
$sql$, 'installed_equipment_stale_version');
select pg_temp.expect_refusal('missing component choice', $sql$
  select pg_temp.replace(
    jsonb_build_array(
      pg_temp.plan_choice('46600000-0000-4000-8000-000000000050', true, null),
      pg_temp.plan_choice('46600000-0000-4000-8000-000000000053', true, null)),
    '[]'::jsonb, '46600000-0000-4000-8000-000000000073')
$sql$, 'installed_equipment_stale_version');

-- Another organization's id is refused before anything changes.
select pg_temp.expect_refusal('foreign organization', $sql$
  select public.replace_installed_equipment(
    '46600000-0000-4000-8000-000000000011', '46600000-0000-4000-8000-000000000040',
    '46600000-0000-4000-8000-000000000060', 1, '{}'::jsonb, now(), 'Fremder Tausch',
    '46600000-0000-4000-8000-000000000001', '46600000-0000-4000-8000-000000000074',
    '{"plans":[],"components":[]}'::jsonb)
$sql$, 'installed_equipment_not_authorized');

do $$ begin
  if exists (
    select 1 from public.installed_equipment equipment
    where equipment.organization_id = '46600000-0000-4000-8000-000000000010'
      and (equipment.id = '46600000-0000-4000-8000-000000000060'
        or (equipment.id = '46600000-0000-4000-8000-000000000040' and equipment.state is distinct from 'active'))
  ) or exists (
    select 1 from public.maintenance_due_work due_work
    where due_work.organization_id = '46600000-0000-4000-8000-000000000010'
      and due_work.id = (select overdue_due from pg_temp.world)
      and due_work.maintenance_plan_revision_id is distinct from '46600000-0000-4000-8000-000000000051'::uuid
  ) then
    raise exception 'a refused replacement changed the predecessor, its due work or left a successor';
  end if;
end $$;

-- The replacement carries the first plan and the component and leaves the
-- second plan with its reason.
select pg_temp.replace(
  jsonb_build_array(
    pg_temp.plan_choice('46600000-0000-4000-8000-000000000050', true, null),
    pg_temp.plan_choice('46600000-0000-4000-8000-000000000053', false, 'Abgasmessung entfällt beim Kessel')),
  jsonb_build_array(jsonb_build_object('equipmentId', '46600000-0000-4000-8000-000000000042', 'carry', true)),
  '46600000-0000-4000-8000-000000000075');

do $$
declare
  v_revision public.maintenance_plan_revisions%rowtype;
  v_overdue public.maintenance_due_work%rowtype;
begin
  select revision.* into v_revision
  from public.maintenance_plans plan
  join public.maintenance_plan_revisions revision on revision.id = plan.current_revision_id
  where plan.organization_id = '46600000-0000-4000-8000-000000000010'
    and plan.id = '46600000-0000-4000-8000-000000000050';
  if v_revision.id is not distinct from '46600000-0000-4000-8000-000000000051'::uuid
     or v_revision.revision_number is distinct from 2 then
    raise exception 'a carried plan did not get a new revision';
  end if;
  if (
    select array_agg(link.equipment_id) from public.maintenance_plan_revision_equipment link
    where link.organization_id = '46600000-0000-4000-8000-000000000010'
      and link.maintenance_plan_revision_id = v_revision.id
  ) is distinct from array['46600000-0000-4000-8000-000000000060'::uuid] then
    raise exception 'the carried plan revision is not bound to the successor alone';
  end if;
  select * into v_overdue from public.maintenance_due_work due_work
  where due_work.organization_id = '46600000-0000-4000-8000-000000000010'
    and due_work.id = (select overdue_due from pg_temp.world);
  if v_overdue.status is distinct from 'open'
     or v_overdue.due_date is distinct from (select overdue_date from pg_temp.world)
     or v_overdue.maintenance_plan_revision_id is distinct from v_revision.id then
    raise exception 'the overdue due item did not stay open with its due date on the new revision';
  end if;
  if v_revision.first_due_date is distinct from v_overdue.original_due_date
     or v_revision.effective_from_date is distinct from v_overdue.original_due_date then
    raise exception 'the carried revision does not start at the earliest moved due date';
  end if;
  if (
    select due_work.maintenance_plan_revision_id from public.maintenance_due_work due_work
    where due_work.organization_id = '46600000-0000-4000-8000-000000000010'
      and due_work.id = (select completed_due from pg_temp.world)
  ) is distinct from '46600000-0000-4000-8000-000000000051'::uuid then
    raise exception 'completed due work left the predecessor revision';
  end if;
  if not exists (
    select 1 from public.maintenance_due_work_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
      and event.maintenance_due_work_id = v_overdue.id
      and event.event_type = 'equipment_replaced'
  ) or not exists (
    select 1 from public.maintenance_plan_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
      and event.maintenance_plan_id = '46600000-0000-4000-8000-000000000050'
      and event.event_type = 'revised' and event.request_operation = 'equipment_replace'
  ) then
    raise exception 'the moved due item or the carried plan has no history entry';
  end if;
  if not exists (
    select 1 from public.maintenance_plans plan
    join public.maintenance_plan_revision_equipment link on link.maintenance_plan_revision_id = plan.current_revision_id
    where plan.organization_id = '46600000-0000-4000-8000-000000000010'
      and plan.id = '46600000-0000-4000-8000-000000000053'
      and plan.current_revision_id = '46600000-0000-4000-8000-000000000054'
      and link.equipment_id = '46600000-0000-4000-8000-000000000040'
  ) then
    raise exception 'the plan left behind moved';
  end if;
  if (
    select component.parent_equipment_id from public.installed_equipment component
    where component.organization_id = '46600000-0000-4000-8000-000000000010'
      and component.id = '46600000-0000-4000-8000-000000000042'
  ) is distinct from '46600000-0000-4000-8000-000000000060'::uuid then
    raise exception 'the carried component did not get the successor as parent';
  end if;
  if (
    select array_agg(event.event_type::text order by event.event_type::text)
    from public.installed_equipment_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
      and event.equipment_id = '46600000-0000-4000-8000-000000000040'
      and event.event_type in ('maintenance_plan_carried_over', 'maintenance_plan_left', 'replaced')
  ) is distinct from array['maintenance_plan_carried_over', 'maintenance_plan_left', 'replaced']
  or (
    select event.reason from public.installed_equipment_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
      and event.equipment_id = '46600000-0000-4000-8000-000000000040'
      and event.event_type = 'maintenance_plan_left'
  ) is distinct from 'Abgasmessung entfällt beim Kessel' then
    raise exception 'the predecessor history misses a plan decision';
  end if;
  if (
    select array_agg(event.event_type::text order by event.event_type::text)
    from public.installed_equipment_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
      and event.equipment_id = '46600000-0000-4000-8000-000000000060'
  ) is distinct from array['component_carried_over', 'maintenance_plan_carried_over', 'registered']
  or not exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
      and event.equipment_id = '46600000-0000-4000-8000-000000000042'
      and event.event_type = 'parent_replaced'
  ) then
    raise exception 'the successor or the component history misses the carry-over';
  end if;
end $$;

-- A replay with the same key returns the successor and writes nothing more.
do $$
declare v_events bigint;
begin
  select count(*) into v_events from public.installed_equipment_events event
  where event.organization_id = '46600000-0000-4000-8000-000000000010';
  if (
    select (pg_temp.replace('[]'::jsonb, '[]'::jsonb, '46600000-0000-4000-8000-000000000075')).id
  ) is distinct from '46600000-0000-4000-8000-000000000060'::uuid
  or (
    select count(*) from public.installed_equipment_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
  ) is distinct from v_events then
    raise exception 'a replayed replacement did not return the successor unchanged';
  end if;
end $$;

-- A later generation recreates no past due work on the carried revision.
do $$
declare v_plan public.maintenance_plans%rowtype;
begin
  select * into strict v_plan from public.maintenance_plans plan
  where plan.organization_id = '46600000-0000-4000-8000-000000000010'
    and plan.id = '46600000-0000-4000-8000-000000000050';
  perform public.generate_maintenance_due_work(
    '46600000-0000-4000-8000-000000000010', v_plan.id, v_plan.version,
    (pg_temp.berlin_today() + interval '18 months')::date,
    '46600000-0000-4000-8000-000000000001', '46600000-0000-4000-8000-000000000076'
  );
  if exists (
    select 1 from public.maintenance_due_work due_work
    where due_work.organization_id = '46600000-0000-4000-8000-000000000010'
      and due_work.maintenance_plan_id = v_plan.id
      and due_work.maintenance_plan_revision_id = v_plan.current_revision_id
      and due_work.original_due_date <= (select completed_date from pg_temp.world)
  ) then
    raise exception 'generation recreated visited due work on the carried revision';
  end if;
end $$;

-- The successor reads the predecessor's history, and only that.
do $$ begin
  if (
    select count(*) from public.list_installed_equipment_predecessor_events(
      '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000060', 0, 100)
  ) is distinct from (
    select count(*) from public.installed_equipment_events event
    where event.organization_id = '46600000-0000-4000-8000-000000000010'
      and event.equipment_id = '46600000-0000-4000-8000-000000000040'
  ) or exists (
    select 1 from public.list_installed_equipment_predecessor_events(
      '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000060', 0, 100) event
    where event.equipment_id is distinct from '46600000-0000-4000-8000-000000000040'::uuid
  ) or exists (
    select 1 from public.list_installed_equipment_predecessor_events(
      '46600000-0000-4000-8000-000000000011', '46600000-0000-4000-8000-000000000060', 0, 100)
  ) then
    raise exception 'the predecessor history read is wrong or crosses organizations';
  end if;
end $$;

-- Correcting the replacement carries the plan and the component back before
-- the successor is voided; the overdue item stays open with its date.
do $$
declare v_predecessor public.installed_equipment%rowtype;
begin
  select * into strict v_predecessor from public.installed_equipment equipment
  where equipment.organization_id = '46600000-0000-4000-8000-000000000010'
    and equipment.id = '46600000-0000-4000-8000-000000000040';
  perform public.correct_installed_equipment_terminal_action(
    '46600000-0000-4000-8000-000000000010', v_predecessor.id, v_predecessor.version,
    (select event.id from public.installed_equipment_events event
     where event.organization_id = '46600000-0000-4000-8000-000000000010'
       and event.equipment_id = v_predecessor.id and event.event_type = 'replaced'),
    now(), 'Tausch irrtümlich erfasst', '46600000-0000-4000-8000-000000000001',
    '46600000-0000-4000-8000-000000000077'
  );
  if not exists (
    select 1 from public.maintenance_plans plan
    join public.maintenance_plan_revision_equipment link on link.maintenance_plan_revision_id = plan.current_revision_id
    join public.maintenance_due_work due_work on due_work.maintenance_plan_revision_id = plan.current_revision_id
    where plan.organization_id = '46600000-0000-4000-8000-000000000010'
      and plan.id = '46600000-0000-4000-8000-000000000050'
      and link.equipment_id = '46600000-0000-4000-8000-000000000040'
      and due_work.id = (select overdue_due from pg_temp.world)
      and due_work.status = 'open'
      and due_work.due_date = (select overdue_date from pg_temp.world)
  ) or (
    select component.parent_equipment_id from public.installed_equipment component
    where component.organization_id = '46600000-0000-4000-8000-000000000010'
      and component.id = '46600000-0000-4000-8000-000000000042'
  ) is distinct from '46600000-0000-4000-8000-000000000040'::uuid then
    raise exception 'a corrected replacement left an obligation or a component on the voided successor';
  end if;
end $$;

-- Browser roles cannot execute the new functions.
reset role;
set local role authenticated;
select pg_temp.expect_refusal('authenticated replaces', $sql$
  select pg_temp.replace('[]'::jsonb, '[]'::jsonb, '46600000-0000-4000-8000-000000000078')
$sql$, 'permission denied');
select pg_temp.expect_refusal('authenticated reads replacement plans', $sql$
  select public.list_installed_equipment_replacement_plans(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000040')
$sql$, 'permission denied');
select pg_temp.expect_refusal('authenticated reads predecessor history', $sql$
  select public.list_installed_equipment_predecessor_events(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000060', 0, 20)
$sql$, 'permission denied');
reset role;
set local role anon;
select pg_temp.expect_refusal('anon reads predecessor history', $sql$
  select public.list_installed_equipment_predecessor_events(
    '46600000-0000-4000-8000-000000000010', '46600000-0000-4000-8000-000000000060', 0, 20)
$sql$, 'permission denied');
reset role;
rollback;
