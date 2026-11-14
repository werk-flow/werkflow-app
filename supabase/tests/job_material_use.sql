begin;

-- Used material on a job material line (werk-flow/werkflow-planning#370): a
-- use is a fact of its own beside taken and returned. Use and return together
-- never exceed the take, a use moves no stock, every use is an append-only
-- event with the article's cost snapshot, a correction names the event it
-- corrects, and no client role reads an event or its cost.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('37000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-use-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Admin","last_name":"Sonnenberg"}'::jsonb, now(), now()),
('37000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-use-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Monteur","last_name":"Sonnenberg"}'::jsonb, now(), now()),
('37000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-use-foreign@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Nordrohr"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('37000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '37000000-0000-4000-8000-000000000001', 'MATUSE01'),
('37000000-0000-4000-8000-000000000011', 'Fremdfirma Nordrohr',
 '37000000-0000-4000-8000-000000000003', 'MATUSE02');

insert into public.organization_members (organization_id, user_id, role) values
('37000000-0000-4000-8000-000000000010', '37000000-0000-4000-8000-000000000002', 'employee');

insert into public.inventory_items (id, organization_id, name, item_type, unit) values
('37000000-0000-4000-8000-000000000020', '37000000-0000-4000-8000-000000000010',
 'Kupferrohr 15 mm', 'material', 'meter'),
('37000000-0000-4000-8000-000000000021', '37000000-0000-4000-8000-000000000010',
 'Pressfitting 15 mm', 'material', 'piece');

-- The pipe's dated purchase price; the fitting has none. inventory_article_prices.sql
-- owns the choice of the price on a day and a price quantity above 1.
insert into public.inventory_item_prices (organization_id, item_id, kind, unit, amount_cents, price_quantity, valid_from, source) values
('37000000-0000-4000-8000-000000000010', '37000000-0000-4000-8000-000000000020',
 'purchase', 'meter', 412, 1, (now() at time zone 'Europe/Berlin')::date - 30, 'manual');

insert into public.inventory_locations (id, organization_id, name, location_type) values
('37000000-0000-4000-8000-000000000030', '37000000-0000-4000-8000-000000000010', 'Hauptlager', 'storage');

insert into public.projects (id, organization_id, name, created_by) values
('37000000-0000-4000-8000-000000000040', '37000000-0000-4000-8000-000000000010',
 'Bad Musterstraße', '37000000-0000-4000-8000-000000000001');

insert into public.job_material_lines (id, organization_id, project_id, item_id, planned_quantity) values
('37000000-0000-4000-8000-000000000050', '37000000-0000-4000-8000-000000000010',
 '37000000-0000-4000-8000-000000000040', '37000000-0000-4000-8000-000000000020', 5),
('37000000-0000-4000-8000-000000000051', '37000000-0000-4000-8000-000000000010',
 '37000000-0000-4000-8000-000000000040', '37000000-0000-4000-8000-000000000021', 2);

set local role service_role;

do $$
declare
  v_org constant uuid := '37000000-0000-4000-8000-000000000010';
  v_actor constant uuid := '37000000-0000-4000-8000-000000000001';
  v_pipe constant uuid := '37000000-0000-4000-8000-000000000020';
  v_fitting constant uuid := '37000000-0000-4000-8000-000000000021';
  v_location constant uuid := '37000000-0000-4000-8000-000000000030';
  v_project constant uuid := '37000000-0000-4000-8000-000000000040';
  v_line constant uuid := '37000000-0000-4000-8000-000000000050';
  v_fitting_line constant uuid := '37000000-0000-4000-8000-000000000051';
  v_used numeric;
  v_event_id uuid;
  v_event public.job_material_use_events%rowtype;
  v_refusal text;
  v_stock numeric;
  v_count integer;
  v_line_row public.job_material_lines%rowtype;
begin
  perform public.record_inventory_movement(v_org, v_actor, v_pipe, v_location, 'initial_count', 10);
  perform public.record_inventory_movement(v_org, v_actor, v_fitting, v_location, 'initial_count', 4);
  perform public.record_inventory_movement(v_org, v_actor, v_pipe, v_location, 'job_take', -5, null, v_project, v_line);
  perform public.record_inventory_movement(v_org, v_actor, v_fitting, v_location, 'job_take', -2, null, v_project, v_fitting_line);
  perform public.record_inventory_movement(v_org, v_actor, v_pipe, v_location, 'job_return', 2, null, v_project, v_line);

  -- Use books the event and the line's used quantity, and moves no stock.
  v_used := public.record_job_material_use(v_org, v_actor, v_line, 3, 'Bad verrohrt');
  select id into v_event_id from public.job_material_use_events where job_material_line_id = v_line;
  select * into v_line_row from public.job_material_lines where id = v_line;
  select * into v_event from public.job_material_use_events where id = v_event_id;
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_pipe and location_id = v_location;
  if v_used is distinct from 3 or v_line_row.used_quantity is distinct from 3 then
    raise exception 'a use must raise the line''s used quantity by its quantity';
  end if;
  if v_stock is distinct from 7 then
    raise exception 'a use must leave the stock level as the take left it';
  end if;
  if v_event.job_material_line_id is distinct from v_line or v_event.project_id is distinct from v_project or v_event.item_id is distinct from v_pipe
    or v_event.unit is distinct from 'meter' or v_event.quantity is distinct from 3 or v_event.actor_id is distinct from v_actor
    or v_event.organization_id is distinct from v_org or v_event.created_at is null
  then
    raise exception 'a use event must carry its project, line, article, base unit, quantity, actor and time';
  end if;
  if v_event.cost_amount_cents is distinct from 412 or v_event.cost_price_quantity is distinct from 1 then
    raise exception 'a use event must snapshot the article''s purchase price per price quantity 1';
  end if;

  -- An article without a price leaves the cost empty, never 0.
  v_used := public.record_job_material_use(v_org, v_actor, v_fitting_line, 1);
  select id into v_event_id from public.job_material_use_events where job_material_line_id = v_fitting_line;
  select * into v_event from public.job_material_use_events where id = v_event_id;
  if v_event.cost_amount_cents is not null or v_event.cost_price_quantity is not null then
    raise exception 'a use of an article without a purchase price must leave both cost columns empty';
  end if;

  -- Taken 5, returned 2, used 3: nothing is left to use or return.
  begin
    perform public.record_job_material_use(v_org, v_actor, v_line, 0.5);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'use_exceeds_taken' then
    raise exception 'a use beyond taken minus returned and used must be refused with use_exceeds_taken, got %', v_refusal;
  end if;

  begin
    perform public.record_inventory_movement(v_org, v_actor, v_pipe, v_location, 'job_return', 0.5, null, v_project, v_line);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'return_exceeds_taken' then
    raise exception 'a return beyond taken minus used and returned must be refused with return_exceeds_taken, got %', v_refusal;
  end if;

  select * into v_line_row from public.job_material_lines where id = v_line;
  select count(*) into v_count from public.job_material_use_events where job_material_line_id = v_line;
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_pipe and location_id = v_location;
  if v_line_row.used_quantity is distinct from 3 or v_line_row.returned_quantity is distinct from 2 or v_count is distinct from 1 or v_stock is distinct from 7 then
    raise exception 'a refused use or return must leave the line, the events and the stock unchanged';
  end if;

  -- The line itself refuses used plus returned beyond taken, whichever writer
  -- read the line before: two concurrent bookings cannot both pass.
  begin
    update public.job_material_lines set used_quantity = 4 where id = v_line;
    v_refusal := null;
  exception when check_violation then
    v_refusal := 'check_violation';
  end;
  if v_refusal is null then
    raise exception 'the line must refuse used plus returned above its taken quantity';
  end if;
end $$;

set local role service_role;

-- A correction is a new negative event that names the event it corrects.
do $$
declare
  v_org constant uuid := '37000000-0000-4000-8000-000000000010';
  v_actor constant uuid := '37000000-0000-4000-8000-000000000001';
  v_line constant uuid := '37000000-0000-4000-8000-000000000050';
  v_original uuid;
  v_used numeric;
  v_event_id uuid;
  v_event public.job_material_use_events%rowtype;
  v_refusal text;
begin
  select id into v_original from public.job_material_use_events
  where job_material_line_id = v_line and corrects_event_id is null;

  begin
    perform public.record_job_material_use(v_org, v_actor, v_line, -1, null, v_original);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'correction_reason_required' then
    raise exception 'a correction without a reason must be refused, got %', v_refusal;
  end if;

  begin
    perform public.record_job_material_use(v_org, v_actor, v_line, -1);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'quantity_required' then
    raise exception 'a negative use that names no event must be refused, got %', v_refusal;
  end if;

  -- The article's unit changed after the use, as it could before the database
  -- kept the unit of an article with history (migration 20261204100000); the
  -- seed bypasses that guard. The correction still counts in meters.
  reset role;
  set local session_replication_role = replica;
  update public.inventory_items set unit = 'piece' where id = '37000000-0000-4000-8000-000000000020';
  set local session_replication_role = origin;
  set local role service_role;
  v_used := public.record_job_material_use(v_org, v_actor, v_line, -2, 'Falsch gezählt', v_original);
  select id into v_event_id from public.job_material_use_events
  where job_material_line_id = v_line and corrects_event_id is not null;
  select * into v_event from public.job_material_use_events where id = v_event_id;
  if v_event.unit is distinct from 'meter' then
    raise exception 'a correction must keep the unit of the event it corrects, also after the article''s unit changed';
  end if;
  if v_used is distinct from 1 or v_event.corrects_event_id is distinct from v_original or v_event.quantity is distinct from -2
    or v_event.cost_amount_cents is distinct from 412 or v_event.cost_price_quantity is distinct from 1
  then
    raise exception 'a correction must lower the used quantity, name its event and carry that event''s cost';
  end if;

  begin
    perform public.record_job_material_use(v_org, v_actor, v_line, -1.5, 'Nochmal korrigiert', v_original);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'correction_exceeds_event' then
    raise exception 'corrections beyond the corrected event''s own quantity must be refused, got %', v_refusal;
  end if;

  begin
    perform public.record_job_material_use(v_org, v_actor, v_line, -0.5, 'Korrektur der Korrektur', v_event_id);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'use_event_not_found' then
    raise exception 'a correction of a correction must be refused, got %', v_refusal;
  end if;

  -- The article's unit changed after the line's uses were recorded in meters:
  -- a new use would add pieces to meters, so it is refused until the office checks the line.
  begin
    perform public.record_job_material_use(v_org, v_actor, v_line, 1);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'material_unit_changed' then
    raise exception 'a new use after the article''s unit changed must be refused with material_unit_changed, got %', v_refusal;
  end if;

  -- The function re-checks access: an employee never records use on a project's own line.
  begin
    perform public.record_job_material_use(v_org, '37000000-0000-4000-8000-000000000002', v_line, 1);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'not_authorized' then
    raise exception 'an employee''s use on a project line must be refused by the function, got %', v_refusal;
  end if;

  -- The event belongs to the line: a foreign organization finds no line.
  begin
    perform public.record_job_material_use('37000000-0000-4000-8000-000000000011', '37000000-0000-4000-8000-000000000003', v_line, 1);
    v_refusal := null;
  exception when others then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'material_line_not_found' then
    raise exception 'a use on another organization''s line must be refused, got %', v_refusal;
  end if;
end $$;

-- A line with use events is history: corrected back to 0, it still can be
-- neither cancelled nor deleted, whichever writer read the line before.
do $$
declare
  v_org constant uuid := '37000000-0000-4000-8000-000000000010';
  v_actor constant uuid := '37000000-0000-4000-8000-000000000001';
  v_fitting_line constant uuid := '37000000-0000-4000-8000-000000000051';
  v_event uuid;
  v_refusal text;
  v_line_row public.job_material_lines%rowtype;
begin
  select id into v_event from public.job_material_use_events where job_material_line_id = v_fitting_line;
  perform public.record_job_material_use(v_org, v_actor, v_fitting_line, -1, 'Doch nicht verbaut', v_event);
  begin
    update public.job_material_lines set status = 'cancelled' where id = v_fitting_line;
    v_refusal := null;
  exception when raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'material_use_recorded' then
    raise exception 'a line with use events corrected back to 0 must not be cancelled, got %', v_refusal;
  end if;
  begin
    delete from public.job_material_lines where id = v_fitting_line;
    v_refusal := null;
  exception when raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'material_use_recorded' then
    raise exception 'a line with use events must not be deleted, got %', v_refusal;
  end if;
  select * into v_line_row from public.job_material_lines where id = v_fitting_line;
  if v_line_row.used_quantity is distinct from 0 or v_line_row.status = 'cancelled' then
    raise exception 'a refused cancel or delete must leave the line as it was';
  end if;
end $$;

-- An event's references stay inside its organization and line, also for a
-- direct service-role insert that bypasses the function.
do $$
declare
  v_refusal text;
begin
  begin
    insert into public.job_material_use_events (
      organization_id, project_id, job_material_line_id, item_id, unit, quantity, actor_id
    ) values (
      '37000000-0000-4000-8000-000000000010', '37000000-0000-4000-8000-000000000040',
      '37000000-0000-4000-8000-000000000050', '37000000-0000-4000-8000-000000000021',
      'piece', 1, '37000000-0000-4000-8000-000000000001'
    );
    v_refusal := null;
  exception when raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'material use event must match a line of its organization' then
    raise exception 'an event naming another article than its line must be refused, got %', v_refusal;
  end if;
  begin
    insert into public.job_material_use_events (
      organization_id, project_id, job_material_line_id, item_id, unit, quantity, actor_id
    ) values (
      '37000000-0000-4000-8000-000000000011', '37000000-0000-4000-8000-000000000040',
      '37000000-0000-4000-8000-000000000050', '37000000-0000-4000-8000-000000000020',
      'meter', 1, '37000000-0000-4000-8000-000000000003'
    );
    v_refusal := null;
  exception when raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'material use event must match a line of its organization' then
    raise exception 'an event of another organization naming this line must be refused, got %', v_refusal;
  end if;
end $$;

-- The events are history: neither a client role nor the service role
-- rewrites or deletes one.
do $$
declare
  v_refusal text;
begin
  begin
    update public.job_material_use_events set quantity = 9;
    v_refusal := null;
  exception when insufficient_privilege or raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is null then raise exception 'a use event update was accepted'; end if;
  begin
    delete from public.job_material_use_events;
    v_refusal := null;
  exception when insufficient_privilege or raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is null then raise exception 'a use event delete was accepted'; end if;
end $$;

reset role;
do $$
declare
  v_refusal text;
begin
  begin
    update public.job_material_use_events set quantity = 9;
    v_refusal := null;
  exception when raise_exception then
    v_refusal := sqlerrm;
  end;
  if v_refusal is distinct from 'inventory_ledger_append_only' then
    raise exception 'the owner role rewrote a use event, got %', v_refusal;
  end if;
end $$;

-- No client role reads an event or its cost snapshot, so neither an employee
-- nor another organization reaches one through the Data API.
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.job_material_use_events'::regclass) then
    raise exception 'job_material_use_events must enable RLS';
  end if;
  if has_table_privilege('anon', 'public.job_material_use_events', 'select,insert,update,delete')
    or has_table_privilege('authenticated', 'public.job_material_use_events', 'select,insert,update,delete')
    or has_column_privilege('authenticated', 'public.job_material_use_events', 'cost_amount_cents', 'select')
    or has_column_privilege('authenticated', 'public.job_material_use_events', 'cost_price_quantity', 'select')
  then
    raise exception 'a client role can read or write material use events';
  end if;
  if has_function_privilege('authenticated', 'public.record_job_material_use(uuid, uuid, uuid, numeric, text, uuid, uuid)', 'execute')
    or has_function_privilege('anon', 'public.record_job_material_use(uuid, uuid, uuid, numeric, text, uuid, uuid)', 'execute')
  then
    raise exception 'a client role can record material use';
  end if;
  if not has_column_privilege('authenticated', 'public.job_material_lines', 'used_quantity', 'select') then
    raise exception 'an assigned field worker must read the line''s used quantity';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"37000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  begin
    perform 1 from public.job_material_use_events;
    raise exception 'an employee read material use events';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"37000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$
begin
  begin
    perform 1 from public.job_material_use_events;
    raise exception 'another organization read material use events';
  exception when insufficient_privilege then null;
  end;
end $$;

-- A job whose material was used cannot be deleted: the database refuses the
-- delete and keeps the line and its events.
reset role;
insert into public.jobs (id, organization_id, title, created_by) values
('37000000-0000-4000-8000-000000000060', '37000000-0000-4000-8000-000000000010',
 'Heizraum Sonnenberg', '37000000-0000-4000-8000-000000000001');
insert into public.job_material_lines (id, organization_id, job_id, item_id, planned_quantity) values
('37000000-0000-4000-8000-000000000061', '37000000-0000-4000-8000-000000000010',
 '37000000-0000-4000-8000-000000000060', '37000000-0000-4000-8000-000000000021', 1);
set local role service_role;
do $$
declare
  v_org constant uuid := '37000000-0000-4000-8000-000000000010';
  v_actor constant uuid := '37000000-0000-4000-8000-000000000001';
  v_job constant uuid := '37000000-0000-4000-8000-000000000060';
  v_line constant uuid := '37000000-0000-4000-8000-000000000061';
  v_refused boolean := false;
begin
  perform public.record_inventory_movement(v_org, v_actor, '37000000-0000-4000-8000-000000000021',
    '37000000-0000-4000-8000-000000000030', 'job_take', -1, v_job, null, v_line);
  begin
    perform public.record_job_material_use(v_org, '37000000-0000-4000-8000-000000000002', v_line, 1);
    raise exception 'an unassigned employee recorded use on a job line';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  perform public.record_job_material_use(v_org, v_actor, v_line, 1);
  begin
    delete from public.jobs where id = v_job;
  exception when foreign_key_violation or raise_exception then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'a job with recorded material use must not be deletable';
  end if;
  if not exists (select 1 from public.jobs where id = v_job)
    or not exists (select 1 from public.job_material_lines where id = v_line)
    or not exists (select 1 from public.job_material_use_events where job_material_line_id = v_line)
  then
    raise exception 'a refused job delete must keep the job, its line and its use events';
  end if;
end $$;

-- Deleting the organization still cascades through the events.
reset role;
delete from public.organizations where id = '37000000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.job_material_use_events where organization_id = '37000000-0000-4000-8000-000000000010') then
    raise exception 'organization cascade left material use events';
  end if;
end $$;

rollback;
