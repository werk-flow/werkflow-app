begin;

-- Planned job material has one database write (werk-flow/werkflow-planning#376):
-- plan_job_material plans an article on a job or a project, a repeated call
-- with the same source reference answers with the first line and changes
-- nothing, the call rolls back with a calling function's transaction, and
-- another organization's job, project, article or Lager is refused. An
-- article that a line references is archived, never deleted.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('39000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-plan-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Admin","last_name":"Sonnenberg"}'::jsonb, now(), now()),
('39000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-plan-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Monteur","last_name":"Sonnenberg"}'::jsonb, now(), now()),
('39000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-plan-foreign@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Nordrohr"}'::jsonb, now(), now()),
('39000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-plan-buero@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Büro","last_name":"Sonnenberg"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('39000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '39000000-0000-4000-8000-000000000001', 'MATPLAN1'),
('39000000-0000-4000-8000-000000000011', 'Fremdfirma Nordrohr',
 '39000000-0000-4000-8000-000000000003', 'MATPLAN2');

insert into public.organization_members (organization_id, user_id, role) values
('39000000-0000-4000-8000-000000000010', '39000000-0000-4000-8000-000000000002', 'employee'),
('39000000-0000-4000-8000-000000000010', '39000000-0000-4000-8000-000000000004', 'buero');

insert into public.inventory_items (id, organization_id, name, item_type, unit, is_billable) values
('39000000-0000-4000-8000-000000000020', '39000000-0000-4000-8000-000000000010',
 'Kupferrohr 15 mm', 'material', 'meter', true),
('39000000-0000-4000-8000-000000000021', '39000000-0000-4000-8000-000000000010',
 'Pressfitting 15 mm', 'material', 'piece', false),
('39000000-0000-4000-8000-000000000022', '39000000-0000-4000-8000-000000000011',
 'Kupferrohr 22 mm', 'material', 'meter', true);

insert into public.inventory_locations (id, organization_id, name, location_type) values
('39000000-0000-4000-8000-000000000030', '39000000-0000-4000-8000-000000000010', 'Hauptlager', 'storage'),
('39000000-0000-4000-8000-000000000031', '39000000-0000-4000-8000-000000000011', 'Lager Nordrohr', 'storage');

insert into public.projects (id, organization_id, name, created_by) values
('39000000-0000-4000-8000-000000000040', '39000000-0000-4000-8000-000000000010',
 'Bad Musterstraße', '39000000-0000-4000-8000-000000000001'),
('39000000-0000-4000-8000-000000000042', '39000000-0000-4000-8000-000000000010',
 'Heizung Lindenhof', '39000000-0000-4000-8000-000000000001'),
('39000000-0000-4000-8000-000000000041', '39000000-0000-4000-8000-000000000011',
 'Heizung Nordrohr', '39000000-0000-4000-8000-000000000003');

insert into public.jobs (id, organization_id, title, project_id, created_by) values
('39000000-0000-4000-8000-000000000050', '39000000-0000-4000-8000-000000000010',
 'Badsanierung Musterstraße', '39000000-0000-4000-8000-000000000040', '39000000-0000-4000-8000-000000000001'),
('39000000-0000-4000-8000-000000000051', '39000000-0000-4000-8000-000000000010',
 'Heizraum Sonnenberg', null, '39000000-0000-4000-8000-000000000001'),
('39000000-0000-4000-8000-000000000052', '39000000-0000-4000-8000-000000000011',
 'Kesseltausch Nordrohr', null, '39000000-0000-4000-8000-000000000003');

-- Client roles never call the write: the server and other database functions do.
do $$
begin
  if has_function_privilege('anon', 'public.plan_job_material(uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.plan_job_material(uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.plan_job_material(uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid)', 'EXECUTE')
  then
    raise exception 'plan_job_material must be executable by service_role only';
  end if;
  if exists (
    select 1 from pg_proc where oid = 'public.plan_job_material(uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid)'::regprocedure
      and prosecdef
  ) then
    raise exception 'plan_job_material runs with the rights of its caller';
  end if;
  -- A field worker reads an assigned job's lines; the source reference stays with the server.
  if has_column_privilege('authenticated', 'public.job_material_lines', 'source_kind', 'SELECT')
    or has_column_privilege('authenticated', 'public.job_material_lines', 'source_id', 'SELECT')
  then
    raise exception 'client roles must not read the source reference of a material line';
  end if;
end $$;

set local role service_role;

do $$
declare
  v_org constant uuid := '39000000-0000-4000-8000-000000000010';
  v_admin constant uuid := '39000000-0000-4000-8000-000000000001';
  v_employee constant uuid := '39000000-0000-4000-8000-000000000002';
  v_foreign_admin constant uuid := '39000000-0000-4000-8000-000000000003';
  v_buero constant uuid := '39000000-0000-4000-8000-000000000004';
  v_pipe constant uuid := '39000000-0000-4000-8000-000000000020';
  v_fitting constant uuid := '39000000-0000-4000-8000-000000000021';
  v_foreign_item constant uuid := '39000000-0000-4000-8000-000000000022';
  v_location constant uuid := '39000000-0000-4000-8000-000000000030';
  v_foreign_location constant uuid := '39000000-0000-4000-8000-000000000031';
  v_project constant uuid := '39000000-0000-4000-8000-000000000040';
  v_foreign_project constant uuid := '39000000-0000-4000-8000-000000000041';
  v_job constant uuid := '39000000-0000-4000-8000-000000000050';
  v_other_job constant uuid := '39000000-0000-4000-8000-000000000051';
  v_foreign_job constant uuid := '39000000-0000-4000-8000-000000000052';
  v_source constant uuid := '39000000-0000-4000-8000-000000000060';
  v_first uuid;
  v_repeat uuid;
  v_line public.job_material_lines%rowtype;
  v_count integer;
  v_refusal text;
  v_case record;
begin
  -- A job's line carries the job's project, the article's billability, the
  -- Lager and the note, and counts the quantity in the article's base unit.
  v_first := public.plan_job_material(
    v_org, v_buero, v_job, null, v_pipe, 2.5, v_location, '  Für den Badheizkörper  ', 'order_line', v_source
  );
  select * into v_line from public.job_material_lines where id = v_first;
  if v_line.job_id is distinct from v_job or v_line.project_id is distinct from v_project or v_line.item_id is distinct from v_pipe
    or v_line.planned_quantity is distinct from 2.5 or v_line.preferred_location_id is distinct from v_location
    or not v_line.is_billable or v_line.notes is distinct from 'Für den Badheizkörper' or v_line.created_by is distinct from v_buero
    or v_line.status is distinct from 'planned' or v_line.taken_quantity is distinct from 0 or v_line.is_unplanned
    or v_line.source_kind is distinct from 'order_line' or v_line.source_id is distinct from v_source
  then
    raise exception 'the planned line does not hold what the call named: %', row_to_json(v_line);
  end if;

  -- The same source reference again answers with the first line and changes nothing.
  v_repeat := public.plan_job_material(
    v_org, v_admin, v_job, null, v_fitting, 7, null, 'Zweiter Aufruf', 'order_line', v_source
  );
  if v_repeat is distinct from v_first then
    raise exception 'a repeated source must answer with the first line, got % instead of %', v_repeat, v_first;
  end if;
  select count(*) into v_count from public.job_material_lines
  where organization_id = v_org and source_id = v_source;
  if v_count is distinct from 1 then
    raise exception 'a repeated source must leave one line, found %', v_count;
  end if;
  if (select row_to_json(line)::text from public.job_material_lines line where id = v_first)
    is distinct from row_to_json(v_line)::text
  then
    raise exception 'a repeated source must change nothing on the first line';
  end if;

  -- The same id under another kind is another source.
  v_repeat := public.plan_job_material(v_org, v_admin, v_job, null, v_pipe, 1, null, null, 'work_order_line', v_source);
  if v_repeat = v_first then
    raise exception 'a source of another kind must plan its own line';
  end if;

  -- A repeated source that names another job or project is refused, never answered with a foreign target's line.
  for v_case in
    select * from (values (v_other_job, null::uuid), (null::uuid, v_project)) as target(job_id, project_id)
  loop
    begin
      perform public.plan_job_material(v_org, v_admin, v_case.job_id, v_case.project_id, v_pipe, 2.5, null, null, 'order_line', v_source);
      raise exception 'a source planned on another target must be refused';
    exception when raise_exception then
      if sqlerrm <> 'material_source_conflict' then raise; end if;
    end;
  end loop;

  -- Without a source, every call plans its own line; a project line carries no job.
  v_first := public.plan_job_material(v_org, v_admin, null, v_project, v_fitting, 3, null, null, null, null);
  v_repeat := public.plan_job_material(v_org, v_admin, null, v_project, v_fitting, 3, null, null, null, null);
  select * into v_line from public.job_material_lines where id = v_first;
  if v_first = v_repeat or v_line.job_id is not null or v_line.project_id is distinct from v_project
    or v_line.is_billable or v_line.source_kind is not null or v_line.source_id is not null
  then
    raise exception 'calls without a source must each plan a project line of their own';
  end if;

  -- Planning changes no stock and books no movement.
  if exists (select 1 from public.inventory_stock_levels where organization_id = v_org)
    or exists (select 1 from public.inventory_movements where organization_id = v_org)
  then
    raise exception 'planning material must not change stock';
  end if;

  -- Each refusal is a named exception and leaves no line behind.
  select count(*) into v_count from public.job_material_lines where organization_id = v_org;
  for v_case in
    select * from (values
      (v_employee, v_job, null::uuid, v_pipe, 1::numeric, null::uuid, null::text, null::uuid, 'not_authorized'),
      (v_foreign_admin, v_job, null, v_pipe, 1, null, null, null, 'not_authorized'),
      (v_admin, v_foreign_job, null, v_pipe, 1, null, null, null, 'job_not_found'),
      (v_admin, null, v_foreign_project, v_pipe, 1, null, null, null, 'project_not_found'),
      (v_admin, v_job, null, v_foreign_item, 1, null, null, null, 'item_not_found'),
      (v_admin, v_job, null, v_pipe, 1, v_foreign_location, null, null, 'location_not_found'),
      (v_admin, v_job, null, v_pipe, 0, null, null, null, 'quantity_required'),
      (v_admin, v_job, null, v_pipe, 0.0004, null, null, null, 'quantity_required'),
      (v_admin, v_job, null, v_pipe, null, null, null, null, 'quantity_required'),
      (v_admin, v_job, v_project, v_pipe, 1, null, null, null, 'invalid_input'),
      (v_admin, null, null, v_pipe, 1, null, null, null, 'invalid_input'),
      (v_admin, v_job, null, v_pipe, 1, null, 'order_line', null, 'invalid_input'),
      (v_admin, v_job, null, v_pipe, 1, null, null, v_source, 'invalid_input'),
      (v_admin, v_job, null, v_pipe, 1, null, 'Order Line', v_source, 'invalid_input')
    ) as refusal(actor, job_id, project_id, item_id, quantity, location_id, source_kind, source_id, expected)
  loop
    v_refusal := null;
    begin
      perform public.plan_job_material(v_org, v_case.actor, v_case.job_id, v_case.project_id, v_case.item_id,
        v_case.quantity, v_case.location_id, null, v_case.source_kind, v_case.source_id);
    exception when raise_exception then
      v_refusal := sqlerrm;
    end;
    if v_refusal is distinct from v_case.expected then
      raise exception 'expected % for %, got %', v_case.expected, row_to_json(v_case), coalesce(v_refusal, 'a planned line');
    end if;
  end loop;
  -- A source reference counts per organization: another organization's caller
  -- naming the same source plans its own line and never reaches this one.
  v_repeat := public.plan_job_material('39000000-0000-4000-8000-000000000011', v_foreign_admin, v_foreign_job, null,
    v_foreign_item, 1, null, null, 'order_line', v_source);
  if not exists (
    select 1 from public.job_material_lines
    where id = v_repeat and organization_id = '39000000-0000-4000-8000-000000000011' and job_id = v_foreign_job
  ) then
    raise exception 'another organization''s source must plan a line of its own organization';
  end if;
  if (select count(*) from public.job_material_lines where organization_id = v_org) is distinct from v_count then
    raise exception 'a refused or foreign call must leave this organization''s lines unchanged';
  end if;
end $$;

-- A calling function's transaction: E2a's conversion creates the job and plans
-- its material in one call. The planned line commits with the job, and a
-- refusal after the planning leaves neither behind.
reset role;
create function pg_temp.convert_with_material(p_job uuid, p_fail boolean)
returns uuid
language plpgsql
as $$
declare
  v_line uuid;
begin
  insert into public.jobs (id, organization_id, title, created_by)
  values (p_job, '39000000-0000-4000-8000-000000000010', 'Umbau aus Angebot', '39000000-0000-4000-8000-000000000001');
  v_line := public.plan_job_material('39000000-0000-4000-8000-000000000010', '39000000-0000-4000-8000-000000000001',
    p_job, null, '39000000-0000-4000-8000-000000000020', 4, null, null, 'order_line', p_job);
  if p_fail then
    raise exception 'conversion_refused';
  end if;
  return v_line;
end;
$$;
grant execute on function pg_temp.convert_with_material(uuid, boolean) to service_role;
set local role service_role;

do $$
declare
  v_line uuid;
begin
  v_line := pg_temp.convert_with_material('39000000-0000-4000-8000-000000000070', false);
  if not exists (
    select 1 from public.job_material_lines
    where id = v_line and job_id = '39000000-0000-4000-8000-000000000070' and planned_quantity = 4
  ) then
    raise exception 'material planned inside a calling function must land on the job that function created';
  end if;

  begin
    perform pg_temp.convert_with_material('39000000-0000-4000-8000-000000000071', true);
    raise exception 'the failing conversion must raise';
  exception when raise_exception then
    if sqlerrm <> 'conversion_refused' then raise; end if;
  end;
  if exists (select 1 from public.job_material_lines where source_id = '39000000-0000-4000-8000-000000000071')
    or exists (select 1 from public.jobs where id = '39000000-0000-4000-8000-000000000071')
  then
    raise exception 'a failed conversion must roll back its planned material with its job';
  end if;
end $$;

-- Moving a job to another project moves its material lines with it
-- (werk-flow/werkflow-planning#411). A take and a use booked before the move
-- keep the project they were booked with; a use after it books on the new one.
-- A project's own line stays where it is.
do $$
declare
  v_org constant uuid := '39000000-0000-4000-8000-000000000010';
  v_admin constant uuid := '39000000-0000-4000-8000-000000000001';
  v_pipe constant uuid := '39000000-0000-4000-8000-000000000020';
  v_location constant uuid := '39000000-0000-4000-8000-000000000030';
  v_project constant uuid := '39000000-0000-4000-8000-000000000040';
  v_next_project constant uuid := '39000000-0000-4000-8000-000000000042';
  v_job constant uuid := '39000000-0000-4000-8000-000000000050';
  v_line uuid;
  v_project_line uuid;
  v_take uuid;
begin
  v_line := public.plan_job_material(v_org, v_admin, v_job, null, v_pipe, 4, v_location, null, null, null);
  v_project_line := public.plan_job_material(v_org, v_admin, null, v_project, v_pipe, 1, null, null, null, null);
  perform public.record_inventory_movement(v_org, v_admin, v_pipe, v_location, 'initial_count', 10);
  select movement.movement_id into v_take
  from public.record_inventory_movement(
    v_org, v_admin, v_pipe, v_location, 'job_take', -3, v_job, v_project, v_line
  ) movement;
  perform public.record_job_material_use(v_org, v_admin, v_line, 1);

  perform public.update_job_with_assignments(
    v_org, v_job, v_admin, jsonb_build_object('project_id', v_next_project), false,
    null, null, null, null, null, null, null, null, null
  );

  if exists (
    select 1 from public.job_material_lines line
    where line.organization_id = v_org and line.job_id = v_job
      and line.project_id is distinct from v_next_project
  ) then
    raise exception 'every material line of a moved job must follow it to its new project';
  end if;
  if (select project_id from public.job_material_lines where id = v_project_line) is distinct from v_project then
    raise exception 'a project''s own material line must stay on its project when a job leaves it';
  end if;
  if (select project_id from public.inventory_movements where id = v_take) is distinct from v_project then
    raise exception 'a take must keep the project it was booked with';
  end if;
  if exists (
    select 1 from public.job_material_use_events event
    where event.job_material_line_id = v_line and event.project_id is distinct from v_project
  ) then
    raise exception 'a use recorded before the move must keep the project it was booked with';
  end if;

  perform public.record_job_material_use(v_org, v_admin, v_line, 1);
  if (
    select count(*) from public.job_material_use_events event
    where event.job_material_line_id = v_line and event.project_id = v_next_project
  ) <> 1 then
    raise exception 'a use recorded after the move must book on the job''s new project';
  end if;

  -- A job taken out of every project leaves its lines on no project.
  perform public.update_job_with_assignments(
    v_org, v_job, v_admin, jsonb_build_object('project_id', null), false,
    null, null, null, null, null, null, null, null, null
  );
  if exists (
    select 1 from public.job_material_lines line
    where line.organization_id = v_org and line.job_id = v_job and line.project_id is not null
  ) then
    raise exception 'the material lines of a job without a project must carry no project';
  end if;
end $$;

-- An article a material line references is archived, never deleted: the line's
-- foreign key refuses the delete for every writer, and archiving keeps the line.
do $$
declare
  v_refused boolean := false;
begin
  begin
    delete from public.inventory_items where id = '39000000-0000-4000-8000-000000000020';
  exception when foreign_key_violation then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'an article with material lines must not be deletable';
  end if;
  update public.inventory_items set is_active = false where id = '39000000-0000-4000-8000-000000000020';
  if not exists (
    select 1 from public.job_material_lines line
    join public.inventory_items item on item.id = line.item_id
    where item.id = '39000000-0000-4000-8000-000000000020' and not item.is_active
  ) then
    raise exception 'an archived article must keep its material lines';
  end if;
end $$;

rollback;
