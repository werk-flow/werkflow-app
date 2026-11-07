-- A take could book against a material line whose item changed after the
-- caller read it.
--
-- takeJobMaterial and takeProjectMaterial read the line, then call
-- record_inventory_movement with the line's item. A manager may change the
-- item of a line without movements in between. The function then lowered the
-- stock of the item the caller read and raised the taken quantity of a line
-- that now carries another item.
--
-- record_inventory_movement now locks the line FOR NO KEY UPDATE for every
-- movement that names a line, takes or returns, and refuses with
-- 'material_line_item_changed' when the line's item is not the item the
-- caller passed. The caller already passes the item it read from the line,
-- so the comparison needs no new parameter. The stock row is still locked
-- first, so the lock order stays the one returns used. A line outside the
-- organization finds no row here; the movement's insert trigger refuses it
-- as before. The refusal rolls back the stock change before any movement or
-- line write.
--
-- The signature, the result and the grants stay as before.

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
    select line.item_id, line.taken_quantity, line.returned_quantity
      into line_item, line_taken, line_returned
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
      if line_returned + absolute_delta > line_taken then
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
