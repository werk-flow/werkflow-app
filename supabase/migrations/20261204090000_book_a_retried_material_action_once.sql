-- A retried take, use or return of job material books once
-- (werk-flow/werkflow-planning#406). A booking whose answer was lost left the
-- dialog open; the second press booked the take, use or return again.
--
-- 1. The caller names each booking with an operation id: the material dialog
--    creates one per position when it opens and sends it with every press,
--    and field sync v1 (decision record 0010) carries its operationId, so an
--    offline replay uses the same key. The id is stored on the row the
--    booking appends: the movement of a take or return, the event of a use.
--    It is unique per organization on both tables.
-- 2. A call under an id the organization already booked writes nothing and
--    answers with that booking. The same id with other content, from another
--    person or for another kind of booking is refused with
--    material_idempotency_conflict, before anything is written.
-- 3. Calls under one id run in turn on a transaction advisory lock, taken
--    before any stock or line row lock, so a concurrent retry finds the first
--    booking instead of booking again. The unique indexes are the backstop.
-- 4. The repeat check comes after the access checks and before the article,
--    Lager, stock and line checks: the first booking changed what those read.
--    A repeat of an unplanned take or a use still needs the caller's role or
--    job assignment, as decision record 0010 asks of every replay; a movement
--    checks membership, as before.
--    It compares what the caller sent: the project of a job's booking is the
--    server's reading of the job, which a move to another project changes, so
--    it compares the job alone. An unplanned take's note lives on its line;
--    a note the office changed since refuses the repeat, which books nothing.
-- 5. record_inventory_movement answers a repeat with the movement's own
--    result. take_unplanned_inventory_material checks the id before it
--    creates its line and answers with the stock after the first take.
--    record_job_material_use answers with the line's used quantity now: an
--    event keeps no running total.
--
-- Expand-only: each replaced function keeps every argument of the one it
-- replaces in place and defaults the new p_operation_id, keeps its result,
-- security mode and grants, so the previous build's calls and the SQL callers
-- resolve to it and behave as before.
--
-- Prevention: Tier 2, supabase/tests/job_material_retries.sql and
-- supabase/tests/job_material_retries_concurrency.sql.

alter table public.inventory_movements add column operation_id uuid;
alter table public.job_material_use_events add column operation_id uuid;

-- @destructive: after release 55088f06: that build never writes operation_id, and null ids never collide
create unique index inventory_movements_operation_key
  on public.inventory_movements (organization_id, operation_id) where operation_id is not null;
-- @destructive: after release 55088f06: that build never writes operation_id, and null ids never collide
create unique index job_material_use_events_operation_key
  on public.job_material_use_events (organization_id, operation_id) where operation_id is not null;

-- @destructive: after release 55088f06: the replacement below keeps every argument of this one in place and defaults the new p_operation_id, so that build's calls resolve to it
drop function public.record_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, uuid, uuid, uuid, uuid, text);

-- Books one stock movement as in 20261201110000. Under a booked p_operation_id
-- it returns that movement's result and writes nothing.
create function public.record_inventory_movement(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_movement_type text,
  p_quantity_delta numeric,
  p_job_id uuid default null,
  p_project_id uuid default null,
  p_job_material_line_id uuid default null,
  p_import_batch_id uuid default null,
  p_reason text default null,
  p_operation_id uuid default null
)
returns table (movement_id uuid, quantity_before numeric, quantity_after numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_quantity numeric(12,3);
  after_quantity numeric(12,3);
  new_movement_id uuid;
  absolute_delta numeric(12,3);
  line_item uuid;
  line_taken numeric(12,3);
  line_returned numeric(12,3);
  line_used numeric(12,3);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_booked public.inventory_movements%rowtype;
begin
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'quantity delta must be non-zero';
  end if;

  if p_movement_type not in ('initial_count', 'stock_in', 'stock_out', 'job_take', 'job_return', 'correction', 'transfer_in', 'transfer_out') then
    raise exception 'invalid movement type';
  end if;

  if not exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id
      and om.user_id = p_actor_id
  ) then
    raise exception 'actor is not a member of organization';
  end if;

  if p_operation_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':material_operation:' || p_operation_id::text, 0
    ));
    select * into v_booked from public.inventory_movements movement
    where movement.organization_id = p_organization_id and movement.operation_id = p_operation_id;
    if found then
      if v_booked.actor_id = p_actor_id
        and v_booked.item_id = p_item_id
        and v_booked.location_id = p_location_id
        and v_booked.movement_type = p_movement_type
        and v_booked.quantity_delta = p_quantity_delta::numeric(12,3)
        and v_booked.job_id is not distinct from p_job_id
        -- A job's project is the server's reading of the job, which a move since may have changed.
        and (p_job_id is not null or v_booked.project_id is not distinct from p_project_id)
        and v_booked.job_material_line_id is not distinct from p_job_material_line_id
        and v_booked.import_batch_id is not distinct from p_import_batch_id
        and v_booked.reason is not distinct from v_reason
      then
        movement_id := v_booked.id;
        quantity_before := v_booked.quantity_before;
        quantity_after := v_booked.quantity_after;
        return next;
        return;
      end if;
      raise exception 'material_idempotency_conflict';
    end if;
    if exists (
      select 1 from public.job_material_use_events event
      where event.organization_id = p_organization_id and event.operation_id = p_operation_id
    ) then
      raise exception 'material_idempotency_conflict';
    end if;
  end if;

  if not exists (
    select 1 from public.inventory_items item
    where item.id = p_item_id
      and item.organization_id = p_organization_id
      and item.is_active = true
      and item.track_quantity = true
  ) then
    raise exception 'inventory item is not available for stock movement';
  end if;

  if not exists (
    select 1 from public.inventory_locations location
    where location.id = p_location_id
      and location.organization_id = p_organization_id
      and location.is_active = true
  ) then
    raise exception 'inventory location is not available for stock movement';
  end if;

  insert into public.inventory_stock_levels (organization_id, item_id, location_id, quantity_on_hand)
  values (p_organization_id, p_item_id, p_location_id, 0)
  on conflict (organization_id, item_id, location_id) do nothing;

  select stock.quantity_on_hand
    into before_quantity
  from public.inventory_stock_levels stock
  where stock.organization_id = p_organization_id
    and stock.item_id = p_item_id
    and stock.location_id = p_location_id
  for update;

  if p_job_material_line_id is not null then
    select line.item_id, line.taken_quantity, line.returned_quantity, line.used_quantity
      into line_item, line_taken, line_returned, line_used
    from public.job_material_lines line
    where line.id = p_job_material_line_id
      and line.organization_id = p_organization_id
    for no key update;

    if found and line_item <> p_item_id then
      raise exception 'material_line_item_changed';
    end if;
  end if;

  after_quantity := before_quantity + p_quantity_delta;

  if after_quantity < 0 then
    raise exception 'inventory stock cannot go below zero';
  end if;

  update public.inventory_stock_levels stock
  set quantity_on_hand = after_quantity,
      updated_at = now()
  where stock.organization_id = p_organization_id
    and stock.item_id = p_item_id
    and stock.location_id = p_location_id;

  insert into public.inventory_movements (
    organization_id,
    item_id,
    location_id,
    movement_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    job_id,
    project_id,
    job_material_line_id,
    import_batch_id,
    actor_id,
    reason,
    operation_id
  ) values (
    p_organization_id,
    p_item_id,
    p_location_id,
    p_movement_type,
    p_quantity_delta,
    before_quantity,
    after_quantity,
    p_job_id,
    p_project_id,
    p_job_material_line_id,
    p_import_batch_id,
    p_actor_id,
    v_reason,
    p_operation_id
  )
  returning id into new_movement_id;

  if p_job_material_line_id is not null then
    absolute_delta := abs(p_quantity_delta);

    if p_movement_type = 'job_take' then
      update public.job_material_lines line
      set taken_quantity = line.taken_quantity + absolute_delta,
          billable_quantity = case
            when line.is_billable then greatest(line.billable_quantity, line.taken_quantity + absolute_delta - line.returned_quantity)
            else line.billable_quantity
          end,
          status = case
            when line.planned_quantity > 0 and line.taken_quantity + absolute_delta >= line.planned_quantity then 'taken'
            else 'partially_taken'
          end
      where line.id = p_job_material_line_id
        and line.organization_id = p_organization_id;
    elsif p_movement_type = 'job_return' then
      -- Used material is built in: only what is neither used nor returned comes back.
      if line_returned + line_used + absolute_delta > line_taken then
        raise exception 'return_exceeds_taken';
      end if;

      update public.job_material_lines line
      set returned_quantity = line.returned_quantity + absolute_delta,
          billable_quantity = case
            when line.is_billable then greatest(0, line.billable_quantity - absolute_delta)
            else line.billable_quantity
          end,
          status = case
            when line.taken_quantity <= line.returned_quantity + absolute_delta then 'returned'
            else 'partially_taken'
          end
      where line.id = p_job_material_line_id
        and line.organization_id = p_organization_id;
    end if;
  end if;

  movement_id := new_movement_id;
  quantity_before := before_quantity;
  quantity_after := after_quantity;
  return next;
end;
$$;

revoke all on function public.record_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, uuid, uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_inventory_movement(uuid, uuid, uuid, uuid, text, numeric, uuid, uuid, uuid, uuid, text, uuid)
  to service_role;

-- @destructive: after release 55088f06: the replacement below keeps every argument of this one in place and defaults the new p_operation_id, so that build's calls resolve to it
drop function public.take_unplanned_inventory_material(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text);

-- Creates the unplanned line and books its take as in 20261004151100. Under a
-- booked p_operation_id it returns the stock after that take and writes
-- nothing. Refusals: invalid_input, not_authorized, job_not_found,
-- project_not_found, item_not_found, location_not_found,
-- material_idempotency_conflict; record_inventory_movement raises its own
-- stock errors. Returns the stock of the Lager after the take.
create function public.take_unplanned_inventory_material(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_reason text,
  p_notes text,
  p_operation_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role public.org_role;
  v_project_id uuid := p_project_id;
  v_is_billable boolean;
  v_line_id uuid;
  v_quantity_after numeric;
  v_booked public.inventory_movements%rowtype;
begin
  if p_quantity is null or p_quantity <= 0 or (p_job_id is null and p_project_id is null) then
    raise exception 'invalid_input';
  end if;

  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
  for share;
  if v_role is null then
    raise exception 'not_authorized';
  end if;

  if p_job_id is not null then
    select job.project_id into v_project_id from public.jobs job
    where job.id = p_job_id and job.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'job_not_found';
    end if;
    if v_role not in ('admin', 'buero') then
      perform 1 from public.job_assignments assignment
      where assignment.organization_id = p_organization_id and assignment.job_id = p_job_id
        and assignment.user_id = p_actor_id
      for share;
      if not found then
        raise exception 'not_authorized';
      end if;
    end if;
  else
    perform 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'project_not_found';
    end if;
    if v_role not in ('admin', 'buero') then
      raise exception 'not_authorized';
    end if;
  end if;

  -- A repeat finds the take before a second line is created, after the access checks.
  if p_operation_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':material_operation:' || p_operation_id::text, 0
    ));
    select * into v_booked from public.inventory_movements movement
    where movement.organization_id = p_organization_id and movement.operation_id = p_operation_id;
    if found then
      if v_booked.actor_id = p_actor_id
        and v_booked.movement_type = 'job_take'
        and v_booked.item_id = p_item_id
        and v_booked.location_id = p_location_id
        and v_booked.quantity_delta = (-p_quantity)::numeric(12,3)
        and v_booked.job_id is not distinct from p_job_id
        and (p_job_id is not null or v_booked.project_id is not distinct from p_project_id)
        and v_booked.reason is not distinct from nullif(btrim(coalesce(p_reason, '')), '')
        and exists (
          select 1 from public.job_material_lines line
          where line.id = v_booked.job_material_line_id and line.is_unplanned
            and line.notes is not distinct from nullif(btrim(coalesce(p_notes, '')), '')
        )
      then
        return v_booked.quantity_after;
      end if;
      raise exception 'material_idempotency_conflict';
    end if;
    if exists (
      select 1 from public.job_material_use_events event
      where event.organization_id = p_organization_id and event.operation_id = p_operation_id
    ) then
      raise exception 'material_idempotency_conflict';
    end if;
  end if;

  select item.is_billable into v_is_billable from public.inventory_items item
  where item.id = p_item_id and item.organization_id = p_organization_id;
  if v_is_billable is null then
    raise exception 'item_not_found';
  end if;
  perform 1 from public.inventory_locations location
  where location.id = p_location_id and location.organization_id = p_organization_id
  for share;
  if not found then
    raise exception 'location_not_found';
  end if;

  insert into public.job_material_lines (
    organization_id, job_id, project_id, item_id, preferred_location_id, planned_quantity,
    is_billable, is_unplanned, notes, created_by
  ) values (
    p_organization_id, p_job_id, v_project_id, p_item_id, p_location_id, 0,
    v_is_billable, true, nullif(btrim(coalesce(p_notes, '')), ''), p_actor_id
  )
  returning id into v_line_id;

  select movement.quantity_after into v_quantity_after
  from public.record_inventory_movement(
    p_organization_id, p_actor_id, p_item_id, p_location_id, 'job_take', -p_quantity,
    p_job_id, v_project_id, v_line_id, null, p_reason, p_operation_id
  ) movement;
  return v_quantity_after;
end;
$$;

revoke all on function public.take_unplanned_inventory_material(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.take_unplanned_inventory_material(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text, uuid)
  to service_role;

-- @destructive: after release 55088f06: the replacement below keeps every argument of this one in place and defaults the new p_operation_id, so that build's calls resolve to it
drop function public.record_job_material_use(uuid, uuid, uuid, numeric, text, uuid);

-- Records a use of job material as in 20261203150000. Under a booked
-- p_operation_id it returns the line's used quantity and writes nothing.
create function public.record_job_material_use(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_material_line_id uuid,
  p_quantity numeric,
  p_note text default null,
  p_corrects_event_id uuid default null,
  p_operation_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line public.job_material_lines%rowtype;
  v_unit text;
  v_price integer;
  v_price_quantity integer;
  v_corrected public.job_material_use_events%rowtype;
  v_corrected_sum numeric(12,3);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cost_amount integer;
  v_cost_quantity integer;
  v_used numeric(12,3);
  v_role public.org_role;
  v_recorded_unit text;
  v_booked public.job_material_use_events%rowtype;
begin
  if p_quantity is null or p_quantity = 0 then
    raise exception 'quantity_required';
  end if;

  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
  for share;
  if v_role is null then
    raise exception 'not_authorized';
  end if;

  if p_operation_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_organization_id::text || ':material_operation:' || p_operation_id::text, 0
    ));
    select * into v_booked from public.job_material_use_events event
    where event.organization_id = p_organization_id and event.operation_id = p_operation_id;
    if found then
      if v_booked.actor_id = p_actor_id
        and v_booked.job_material_line_id = p_job_material_line_id
        and v_booked.quantity = p_quantity::numeric(12,3)
        and v_booked.corrects_event_id is not distinct from p_corrects_event_id
        and v_booked.note is not distinct from v_note
      then
        -- A repeat rechecks access as a new use does: an employee needs the line's job assignment.
        select line.* into v_line from public.job_material_lines line
        where line.id = v_booked.job_material_line_id;
        if v_role not in ('admin', 'buero') and not exists (
          select 1 from public.job_assignments assignment
          where assignment.organization_id = p_organization_id
            and assignment.job_id = v_line.job_id
            and assignment.user_id = p_actor_id
        ) then
          raise exception 'not_authorized';
        end if;
        return v_line.used_quantity;
      end if;
      raise exception 'material_idempotency_conflict';
    end if;
    if exists (
      select 1 from public.inventory_movements movement
      where movement.organization_id = p_organization_id and movement.operation_id = p_operation_id
    ) then
      raise exception 'material_idempotency_conflict';
    end if;
  end if;

  -- The lock serializes every use, take and return of the line.
  select * into v_line
  from public.job_material_lines line
  where line.id = p_job_material_line_id
    and line.organization_id = p_organization_id
  for no key update;

  if not found or v_line.status = 'cancelled' then
    raise exception 'material_line_not_found';
  end if;

  -- The action checked the same access; a removed assignment or role since then refuses here.
  if v_role not in ('admin', 'buero') then
    if v_line.job_id is null then
      raise exception 'not_authorized';
    end if;
    perform 1 from public.job_assignments assignment
    where assignment.organization_id = p_organization_id
      and assignment.job_id = v_line.job_id
      and assignment.user_id = p_actor_id
    for share;
    if not found then
      raise exception 'not_authorized';
    end if;
  end if;

  select current_price.unit, current_price.purchase_amount_cents, current_price.purchase_price_quantity
    into v_unit, v_price, v_price_quantity
  from public.read_inventory_item_prices_on_day(
    p_organization_id, array[v_line.item_id], (now() at time zone 'Europe/Berlin')::date
  ) current_price;

  if p_corrects_event_id is null then
    if p_quantity < 0 then
      raise exception 'quantity_required';
    end if;
    if v_line.used_quantity + v_line.returned_quantity + p_quantity > v_line.taken_quantity then
      raise exception 'use_exceeds_taken';
    end if;
    -- Every event of a line carries one unit; a changed article unit waits for the office.
    select event.unit into v_recorded_unit
    from public.job_material_use_events event
    where event.job_material_line_id = v_line.id
    limit 1;
    if v_recorded_unit is not null and v_recorded_unit <> v_unit then
      raise exception 'material_unit_changed';
    end if;
    v_cost_amount := v_price;
    v_cost_quantity := v_price_quantity;
  else
    if p_quantity > 0 then
      raise exception 'correction_must_reduce';
    end if;
    if v_note is null then
      raise exception 'correction_reason_required';
    end if;

    select * into v_corrected
    from public.job_material_use_events event
    where event.id = p_corrects_event_id
      and event.organization_id = p_organization_id
      and event.job_material_line_id = v_line.id;

    if not found or v_corrected.corrects_event_id is not null then
      raise exception 'use_event_not_found';
    end if;

    select coalesce(sum(event.quantity), 0) into v_corrected_sum
    from public.job_material_use_events event
    where event.corrects_event_id = v_corrected.id;

    if v_corrected.quantity + v_corrected_sum + p_quantity < 0 then
      raise exception 'correction_exceeds_event';
    end if;
    v_cost_amount := v_corrected.cost_amount_cents;
    v_cost_quantity := v_corrected.cost_price_quantity;
    -- The article's unit may have changed since; the correction counts in the event's unit.
    v_unit := v_corrected.unit;
  end if;

  insert into public.job_material_use_events (
    organization_id, job_id, project_id, job_material_line_id, item_id, unit, quantity,
    cost_amount_cents, cost_price_quantity, corrects_event_id, note, actor_id, operation_id
  ) values (
    p_organization_id, v_line.job_id, v_line.project_id, v_line.id, v_line.item_id, v_unit, p_quantity,
    v_cost_amount, v_cost_quantity, p_corrects_event_id, v_note, p_actor_id, p_operation_id
  );

  update public.job_material_lines line
  set used_quantity = line.used_quantity + p_quantity
  where line.id = v_line.id
  returning line.used_quantity into v_used;

  return v_used;
end;
$$;

revoke all on function public.record_job_material_use(uuid, uuid, uuid, numeric, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.record_job_material_use(uuid, uuid, uuid, numeric, text, uuid, uuid)
  to service_role;
