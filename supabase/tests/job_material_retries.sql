begin;

-- A retried take, use or return of job material books once
-- (werk-flow/werkflow-planning#406). The same operation id twice books once
-- and answers with the first booking, also after that booking used up the
-- stock or the open quantity. The same id with another quantity, actor, line
-- or kind of booking is refused with material_idempotency_conflict and
-- changes nothing. Another organization's id is its own. A call without an id
-- books every time, as before.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('3b000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-retry-admin@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Admin","last_name":"Sonnenberg"}'::jsonb, now(), now()),
('3b000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-retry-employee@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Monteur","last_name":"Sonnenberg"}'::jsonb, now(), now()),
('3b000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'material-retry-foreign@example.test', '', now(),
 '{}'::jsonb, '{"first_name":"Fremd","last_name":"Nordrohr"}'::jsonb, now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('3b000000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
 '3b000000-0000-4000-8000-000000000001', 'MATRETR1'),
('3b000000-0000-4000-8000-000000000011', 'Fremdfirma Nordrohr',
 '3b000000-0000-4000-8000-000000000003', 'MATRETR2');

insert into public.organization_members (organization_id, user_id, role) values
('3b000000-0000-4000-8000-000000000010', '3b000000-0000-4000-8000-000000000002', 'employee');

insert into public.inventory_items (id, organization_id, name, item_type, unit) values
('3b000000-0000-4000-8000-000000000020', '3b000000-0000-4000-8000-000000000010',
 'Kupferrohr 15 mm', 'material', 'meter'),
('3b000000-0000-4000-8000-000000000022', '3b000000-0000-4000-8000-000000000011',
 'Kupferrohr 22 mm', 'material', 'meter');

insert into public.inventory_locations (id, organization_id, name, location_type) values
('3b000000-0000-4000-8000-000000000030', '3b000000-0000-4000-8000-000000000010', 'Hauptlager', 'storage'),
('3b000000-0000-4000-8000-000000000031', '3b000000-0000-4000-8000-000000000011', 'Lager Nordrohr', 'storage');

insert into public.projects (id, organization_id, name, created_by) values
('3b000000-0000-4000-8000-000000000040', '3b000000-0000-4000-8000-000000000010',
 'Bad Musterstraße', '3b000000-0000-4000-8000-000000000001');

insert into public.jobs (id, organization_id, title, project_id, created_by) values
('3b000000-0000-4000-8000-000000000050', '3b000000-0000-4000-8000-000000000010',
 'Badsanierung Musterstraße', '3b000000-0000-4000-8000-000000000040', '3b000000-0000-4000-8000-000000000001');

insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('3b000000-0000-4000-8000-000000000010', '3b000000-0000-4000-8000-000000000050',
 '3b000000-0000-4000-8000-000000000002', '3b000000-0000-4000-8000-000000000001');

insert into public.job_material_lines (id, organization_id, job_id, project_id, item_id, planned_quantity) values
('3b000000-0000-4000-8000-000000000060', '3b000000-0000-4000-8000-000000000010',
 '3b000000-0000-4000-8000-000000000050', '3b000000-0000-4000-8000-000000000040',
 '3b000000-0000-4000-8000-000000000020', 5);

-- The replaced movement function keeps its grants: the server calls it, no
-- client role. inventory_atomic_writes.sql and job_material_use.sql check the
-- other two.
do $$
declare
  v_signature constant text :=
    'public.record_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, uuid, uuid, uuid, uuid, text, uuid)';
begin
  if has_function_privilege('anon', v_signature, 'EXECUTE')
    or has_function_privilege('authenticated', v_signature, 'EXECUTE')
    or not has_function_privilege('service_role', v_signature, 'EXECUTE')
  then
    raise exception '% must be executable by service_role only', v_signature;
  end if;
end $$;

set local role service_role;

do $$
declare
  v_org constant uuid := '3b000000-0000-4000-8000-000000000010';
  v_foreign_org constant uuid := '3b000000-0000-4000-8000-000000000011';
  v_admin constant uuid := '3b000000-0000-4000-8000-000000000001';
  v_worker constant uuid := '3b000000-0000-4000-8000-000000000002';
  v_foreign_admin constant uuid := '3b000000-0000-4000-8000-000000000003';
  v_pipe constant uuid := '3b000000-0000-4000-8000-000000000020';
  v_foreign_pipe constant uuid := '3b000000-0000-4000-8000-000000000022';
  v_location constant uuid := '3b000000-0000-4000-8000-000000000030';
  v_foreign_location constant uuid := '3b000000-0000-4000-8000-000000000031';
  v_project constant uuid := '3b000000-0000-4000-8000-000000000040';
  v_job constant uuid := '3b000000-0000-4000-8000-000000000050';
  v_line constant uuid := '3b000000-0000-4000-8000-000000000060';
  v_take_key constant uuid := '3b000000-0000-4000-8000-0000000000a1';
  v_last_take_key constant uuid := '3b000000-0000-4000-8000-0000000000a2';
  v_return_key constant uuid := '3b000000-0000-4000-8000-0000000000a3';
  v_use_key constant uuid := '3b000000-0000-4000-8000-0000000000a4';
  v_unplanned_key constant uuid := '3b000000-0000-4000-8000-0000000000a5';
  v_last_unplanned_key constant uuid := '3b000000-0000-4000-8000-0000000000a6';
  v_first record;
  v_repeat record;
  v_quantity numeric;
  v_repeat_quantity numeric;
  v_refusal text;
  v_stock numeric;
  v_count integer;
  v_line_row public.job_material_lines%rowtype;
  v_unplanned_line uuid;
begin
  perform public.record_inventory_movement(v_org, v_admin, v_pipe, v_location, 'initial_count', 10);

  -- 1. A take on a planned line under one id twice: one movement, the stock
  --    and the line count it once, the repeat answers with the first result.
  select * into v_first from public.record_inventory_movement(
    v_org, v_worker, v_pipe, v_location, 'job_take', -3, v_job, v_project, v_line, null, 'Für Auftrag entnommen', v_take_key
  );
  select * into v_repeat from public.record_inventory_movement(
    v_org, v_worker, v_pipe, v_location, 'job_take', -3, v_job, v_project, v_line, null, 'Für Auftrag entnommen', v_take_key
  );
  select count(*) into v_count from public.inventory_movements where organization_id = v_org and operation_id = v_take_key;
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_pipe and location_id = v_location;
  select * into v_line_row from public.job_material_lines where id = v_line;
  if v_count is distinct from 1 or v_stock is distinct from 7 or v_line_row.taken_quantity is distinct from 3 then
    raise exception 'a repeated take must book once, got % movements, stock %, taken %', v_count, v_stock, v_line_row.taken_quantity;
  end if;
  if v_repeat.movement_id is distinct from v_first.movement_id
    or v_repeat.quantity_before is distinct from 10 or v_repeat.quantity_after is distinct from 7
  then
    raise exception 'a repeated take must answer with the first movement and its stock before and after';
  end if;

  -- 2. A repeat after the first take used up the stock still answers with it.
  perform public.record_inventory_movement(
    v_org, v_worker, v_pipe, v_location, 'job_take', -7, v_job, v_project, v_line, null, null, v_last_take_key
  );
  select * into v_repeat from public.record_inventory_movement(
    v_org, v_worker, v_pipe, v_location, 'job_take', -7, v_job, v_project, v_line, null, null, v_last_take_key
  );
  if v_repeat.quantity_after is distinct from 0 then
    raise exception 'a repeated take that emptied the Lager must answer with its stock after, not a stock refusal';
  end if;

  -- 3. A use of 6 and a return of the other 4 leave nothing open; their
  --    repeats answer with the first booking instead of an over-booking refusal.
  v_quantity := public.record_job_material_use(v_org, v_worker, v_line, 6, 'Bad verrohrt', null, v_use_key);
  perform public.record_inventory_movement(
    v_org, v_worker, v_pipe, v_location, 'job_return', 4, v_job, v_project, v_line, null, null, v_return_key
  );
  v_repeat_quantity := public.record_job_material_use(v_org, v_worker, v_line, 6, ' Bad verrohrt ', null, v_use_key);
  select * into v_repeat from public.record_inventory_movement(
    v_org, v_worker, v_pipe, v_location, 'job_return', 4, v_job, v_project, v_line, null, null, v_return_key
  );
  select * into v_line_row from public.job_material_lines where id = v_line;
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_pipe and location_id = v_location;
  select count(*) into v_count from public.job_material_use_events where job_material_line_id = v_line;
  if v_quantity is distinct from 6 or v_repeat_quantity is distinct from 6 then
    raise exception 'a repeated use must answer with the line''s used quantity, got % and %', v_quantity, v_repeat_quantity;
  end if;
  if v_repeat.quantity_before is distinct from 0 or v_repeat.quantity_after is distinct from 4 then
    raise exception 'a repeated return must answer with the first return''s stock before and after';
  end if;
  if v_line_row.used_quantity is distinct from 6 or v_line_row.returned_quantity is distinct from 4
    or v_count is distinct from 1 or v_stock is distinct from 4
  then
    raise exception 'a repeated use and return must book once, got used %, returned %, % events, stock %',
      v_line_row.used_quantity, v_line_row.returned_quantity, v_count, v_stock;
  end if;

  -- 4. An unplanned take under one id twice: one line, one movement, the
  --    repeat answers with the stock after the first take.
  v_quantity := public.take_unplanned_inventory_material(
    v_org, v_worker, v_job, null, v_pipe, v_location, 2, 'Nachgekauft', 'Nachgekauft', v_unplanned_key
  );
  v_repeat_quantity := public.take_unplanned_inventory_material(
    v_org, v_worker, v_job, null, v_pipe, v_location, 2, 'Nachgekauft', 'Nachgekauft', v_unplanned_key
  );
  select count(*) into v_count from public.job_material_lines where job_id = v_job and is_unplanned;
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_pipe and location_id = v_location;
  if v_quantity is distinct from 2 or v_repeat_quantity is distinct from 2 or v_count is distinct from 1 or v_stock is distinct from 2 then
    raise exception 'a repeated unplanned take must book one line and one take, got % lines, stock %, answers % and %',
      v_count, v_stock, v_quantity, v_repeat_quantity;
  end if;
  select id into v_unplanned_line from public.job_material_lines where job_id = v_job and is_unplanned;

  -- A repeat after the first unplanned take emptied the Lager answers with it.
  perform public.take_unplanned_inventory_material(
    v_org, v_worker, v_job, null, v_pipe, v_location, 2, null, null, v_last_unplanned_key
  );
  v_repeat_quantity := public.take_unplanned_inventory_material(
    v_org, v_worker, v_job, null, v_pipe, v_location, 2, null, null, v_last_unplanned_key
  );
  select count(*) into v_count from public.job_material_lines where job_id = v_job and is_unplanned;
  if v_repeat_quantity is distinct from 0 or v_count is distinct from 2 then
    raise exception 'a repeated unplanned take that emptied the Lager must answer with its stock after';
  end if;

  -- 5. An id reused with other content is refused and changes nothing: another
  --    quantity, another actor, another note, another line or another kind.
  for v_refusal in
    select refusal from (values
      ('take quantity'), ('take actor'), ('return quantity'), ('use quantity'), ('use note'),
      ('unplanned quantity'), ('unplanned for a planned take'), ('planned line for an unplanned take'),
      ('use under a take''s id'), ('take under a use''s id'), ('unplanned under a use''s id')
    ) as attempt(refusal)
  loop
    begin
      case v_refusal
        when 'take quantity' then
          perform public.record_inventory_movement(
            v_org, v_worker, v_pipe, v_location, 'job_take', -2, v_job, v_project, v_line, null, 'Für Auftrag entnommen', v_take_key);
        when 'take actor' then
          perform public.record_inventory_movement(
            v_org, v_admin, v_pipe, v_location, 'job_take', -3, v_job, v_project, v_line, null, 'Für Auftrag entnommen', v_take_key);
        when 'return quantity' then
          perform public.record_inventory_movement(
            v_org, v_worker, v_pipe, v_location, 'job_return', 3, v_job, v_project, v_line, null, null, v_return_key);
        when 'use quantity' then
          perform public.record_job_material_use(v_org, v_worker, v_line, 5, 'Bad verrohrt', null, v_use_key);
        when 'use note' then
          perform public.record_job_material_use(v_org, v_worker, v_line, 6, 'Küche verrohrt', null, v_use_key);
        when 'unplanned quantity' then
          perform public.take_unplanned_inventory_material(
            v_org, v_worker, v_job, null, v_pipe, v_location, 1, 'Nachgekauft', 'Nachgekauft', v_unplanned_key);
        when 'unplanned for a planned take' then
          perform public.take_unplanned_inventory_material(
            v_org, v_worker, v_job, null, v_pipe, v_location, 3, 'Für Auftrag entnommen', null, v_take_key);
        when 'planned line for an unplanned take' then
          perform public.record_inventory_movement(
            v_org, v_worker, v_pipe, v_location, 'job_take', -2, v_job, v_project, v_line, null, 'Nachgekauft', v_unplanned_key);
        when 'use under a take''s id' then
          perform public.record_job_material_use(v_org, v_worker, v_unplanned_line, 1, null, null, v_take_key);
        when 'take under a use''s id' then
          perform public.record_inventory_movement(
            v_org, v_worker, v_pipe, v_location, 'job_return', 1, v_job, v_project, v_unplanned_line, null, null, v_use_key);
        when 'unplanned under a use''s id' then
          perform public.take_unplanned_inventory_material(
            v_org, v_worker, v_job, null, v_pipe, v_location, 1, null, null, v_use_key);
      end case;
      raise exception 'no refusal';
    exception when others then
      if sqlerrm is distinct from 'material_idempotency_conflict' then
        raise exception 'a reused id (%) must be refused with material_idempotency_conflict, got %', v_refusal, sqlerrm;
      end if;
    end;
  end loop;

  select * into v_line_row from public.job_material_lines where id = v_line;
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_pipe and location_id = v_location;
  select count(*) into v_count from public.inventory_movements where organization_id = v_org;
  if v_count is distinct from 6 or v_stock is distinct from 0
    or v_line_row.taken_quantity is distinct from 10 or v_line_row.used_quantity is distinct from 6
    or v_line_row.returned_quantity is distinct from 4
    or (select count(*) from public.job_material_use_events where organization_id = v_org) is distinct from 1
    or (select count(*) from public.job_material_lines where job_id = v_job) is distinct from 3
  then
    raise exception 'a refused reused id must leave movements, stock, lines and events unchanged';
  end if;

  -- 6. Another organization's id is its own: the same id books there, and its
  --    caller learns nothing of the first booking.
  select * into v_repeat from public.record_inventory_movement(
    v_foreign_org, v_foreign_admin, v_foreign_pipe, v_foreign_location, 'initial_count', 5,
    null, null, null, null, null, v_take_key
  );
  if v_repeat.quantity_before is distinct from 0 or v_repeat.quantity_after is distinct from 5
    or v_repeat.movement_id = v_first.movement_id
  then
    raise exception 'the same id in another organization must book that organization''s own movement';
  end if;

  -- 7. Without an id every call books, as before.
  perform public.record_inventory_movement(v_org, v_admin, v_pipe, v_location, 'stock_in', 1);
  perform public.record_inventory_movement(v_org, v_admin, v_pipe, v_location, 'stock_in', 1);
  select quantity_on_hand into v_stock from public.inventory_stock_levels
  where organization_id = v_org and item_id = v_pipe and location_id = v_location;
  if v_stock is distinct from 2 then
    raise exception 'a booking without an operation id must book every call, got stock %', v_stock;
  end if;
end $$;

rollback;
