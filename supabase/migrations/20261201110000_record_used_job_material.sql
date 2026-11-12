-- A worker records used material (`verbraucht`) apart from taken and returned
-- (werk-flow/werkflow-planning#370).
--
-- A job material line knew only taken and returned quantities, so nobody could
-- tell what was built in from what still lay in the van. Use is now a fact of
-- its own:
--
-- 1. job_material_lines.used_quantity holds the line's used quantity. A check
--    keeps used plus returned within taken, so neither a use nor a return can
--    overshoot the take, also not two concurrent bookings: each booking
--    updates the line row, and the check holds on the version that commits.
-- 2. job_material_use_events is the append-only history of every use. Each
--    event carries on its own row the job or project, the line, the article,
--    the quantity in the article's base unit, the unit cost snapshot, actor
--    and time. A wrong entry is corrected by a new event with a negative
--    quantity that names the event it corrects and keeps its unit and cost; the ledger guard refuses
--    UPDATE and DELETE outside an organization deletion. The cost snapshot is
--    the article's purchase price at that moment, per price quantity 1; an
--    article without a price leaves both cost columns empty, never 0. A
--    correction carries the cost of the event it corrects.
-- 3. record_job_material_use records one event and the line's used quantity in
--    one call and returns the line's new used quantity. It changes no stock:
--    the material left the Lager at the take. Like
--    take_unplanned_inventory_material it re-checks the caller's access under a
--    share lock: a manager, or an employee assigned to the line's job; a
--    project's own line is for managers only. A new use is refused while the
--    article's unit differs from the unit of the line's recorded uses, so one
--    used quantity never sums two units.
--    An insert trigger keeps every event's line, article, job, project and
--    corrected event inside the event's organization and line.
-- 5. A line with use events is never cancelled or deleted, also after its uses
--    were corrected back to 0, outside an organization deletion. A trigger on
--    the line enforces it: it runs after the cancelling update or the delete
--    holds the line's row lock, so a use that held the lock first has committed
--    its events, and the trigger's read sees them.
-- 4. record_inventory_movement refuses a return beyond taken minus used. Its
--    signature, result and grants stay as before.
--
-- The event table is server-only: the server reads it with the service role,
-- so no client role reads a cost snapshot through the Data API.

alter table public.job_material_lines
  add column used_quantity numeric(12,3) not null default 0 check (used_quantity >= 0);

-- @destructive: after release acce7e96d681d3b83ab86aa65c54bb3d8542f4be: that build never writes used_quantity, which stays 0 for its writes, and its returns already stay within the taken quantity (job_material_lines_returned_within_taken)
alter table public.job_material_lines
  add constraint job_material_lines_used_and_returned_within_taken
  check (used_quantity + returned_quantity <= taken_quantity);

-- A signed-in field worker reads the used quantity of an assigned job's line,
-- as the taken and returned quantities.
grant select (used_quantity) on table public.job_material_lines to authenticated;

create table public.job_material_use_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid references public.jobs (id),
  project_id uuid references public.projects (id),
  job_material_line_id uuid not null references public.job_material_lines (id),
  item_id uuid not null references public.inventory_items (id),
  unit text not null,
  quantity numeric(12,3) not null check (quantity <> 0),
  cost_amount_cents integer check (cost_amount_cents >= 0),
  cost_price_quantity integer check (cost_price_quantity in (1, 10, 100, 1000)),
  corrects_event_id uuid references public.job_material_use_events (id),
  note text,
  actor_id uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint job_material_use_events_has_target check (num_nonnulls(job_id, project_id) >= 1),
  constraint job_material_use_events_cost_complete
    check ((cost_amount_cents is null) = (cost_price_quantity is null)),
  constraint job_material_use_events_correction_sign
    check ((corrects_event_id is null) = (quantity > 0)),
  constraint job_material_use_events_correction_reason
    check (corrects_event_id is null or nullif(btrim(note), '') is not null)
);

create index job_material_use_events_line_idx
  on public.job_material_use_events (job_material_line_id, created_at, id);
create index job_material_use_events_job_idx
  on public.job_material_use_events (organization_id, job_id) where job_id is not null;
create index job_material_use_events_project_idx
  on public.job_material_use_events (organization_id, project_id) where project_id is not null;
create index job_material_use_events_corrects_idx
  on public.job_material_use_events (corrects_event_id) where corrects_event_id is not null;
create index job_material_use_events_item_idx on public.job_material_use_events (item_id);
create index job_material_use_events_actor_idx on public.job_material_use_events (actor_id);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.job_material_use_events enable row level security;

revoke all on table public.job_material_use_events from public, anon, authenticated, service_role;
grant select, insert on table public.job_material_use_events to service_role;

-- The tenant boundary of an event's references (data-model.md, "Tenant
-- boundary"): its line belongs to its organization and carries its article,
-- job and project, and a corrected event belongs to the same line.
create function app_private.validate_job_material_use_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.job_material_lines line
    where line.id = new.job_material_line_id
      and line.organization_id = new.organization_id
      and line.item_id = new.item_id
      and line.job_id is not distinct from new.job_id
      and line.project_id is not distinct from new.project_id
  ) then
    raise exception 'material use event must match a line of its organization';
  end if;
  if new.corrects_event_id is not null and not exists (
    select 1 from public.job_material_use_events event
    where event.id = new.corrects_event_id
      and event.organization_id = new.organization_id
      and event.job_material_line_id = new.job_material_line_id
  ) then
    raise exception 'material use correction must name an event of its line';
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_job_material_use_event() from public, anon, authenticated;

create trigger validate_job_material_use_event
before insert on public.job_material_use_events
for each row execute function app_private.validate_job_material_use_event();

create function app_private.guard_job_material_line_with_use()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and old.organization_id::text = any(string_to_array(coalesce(
      current_setting('app.deleting_organization_ids', true), ''
    ), ','))
  then return old; end if;
  if exists (
    select 1 from public.job_material_use_events event
    where event.job_material_line_id = old.id
  ) then
    raise exception 'material_use_recorded';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app_private.guard_job_material_line_with_use() from public, anon, authenticated;

create trigger guard_job_material_line_cancel_with_use
before update of status on public.job_material_lines
for each row
when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
execute function app_private.guard_job_material_line_with_use();

create trigger guard_job_material_line_delete_with_use
before delete on public.job_material_lines
for each row execute function app_private.guard_job_material_line_with_use();

create trigger guard_job_material_use_events_append_only
before update or delete on public.job_material_use_events
for each row execute function app_private.guard_inventory_ledger_append_only();

create function public.record_job_material_use(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_material_line_id uuid,
  p_quantity numeric,
  p_note text default null,
  p_corrects_event_id uuid default null
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
  v_corrected public.job_material_use_events%rowtype;
  v_corrected_sum numeric(12,3);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cost_amount integer;
  v_cost_quantity integer;
  v_used numeric(12,3);
  v_role public.org_role;
  v_recorded_unit text;
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

  select item.unit, item.purchase_price_cents into v_unit, v_price
  from public.inventory_items item
  where item.id = v_line.item_id
    and item.organization_id = p_organization_id;

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
    v_cost_quantity := case when v_price is null then null else 1 end;
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
    cost_amount_cents, cost_price_quantity, corrects_event_id, note, actor_id
  ) values (
    p_organization_id, v_line.job_id, v_line.project_id, v_line.id, v_line.item_id, v_unit, p_quantity,
    v_cost_amount, v_cost_quantity, p_corrects_event_id, v_note, p_actor_id
  );

  update public.job_material_lines line
  set used_quantity = line.used_quantity + p_quantity
  where line.id = v_line.id
  returning line.used_quantity into v_used;

  return v_used;
end;
$$;

revoke all on function public.record_job_material_use(uuid, uuid, uuid, numeric, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_job_material_use(uuid, uuid, uuid, numeric, text, uuid)
  to service_role;

create or replace function public.record_inventory_movement(
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
  p_reason text default null
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
    reason
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
    nullif(btrim(coalesce(p_reason, '')), '')
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
