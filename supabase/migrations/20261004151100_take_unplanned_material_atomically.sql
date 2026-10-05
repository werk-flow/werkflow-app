-- Taking material without a planned line creates the unplanned line and books
-- the take in one function call, and so one transaction. The server actions
-- takeJobMaterial and takeProjectMaterial in lib/inventory/actions.ts inserted
-- the line, booked the take, and deleted the line again when the ledger
-- refused the take; a failed delete left an empty unplanned line behind.
--
-- Division of work: the action establishes identity, the organization and the
-- caller's access (a manager, or an employee assigned to the job; a project
-- take is for managers only). The function re-checks that access with the
-- membership under a share lock, reads the job's project itself, and raises
-- the action failure code of the first refusal, so nothing changes. The take
-- goes through record_inventory_movement, which appends the movement, lowers
-- the stock level and counts the take on the new line.
--
-- Signals stay as before: the inserted job_material_lines row and the
-- movement and stock rows reach the Realtime publication; the action
-- revalidates the inventory and Aufträge paths.

-- Refusals: invalid_input, not_authorized, job_not_found, project_not_found,
-- item_not_found, location_not_found; record_inventory_movement raises its own stock errors.
-- Returns the stock of the Lager after the take.
create function public.take_unplanned_inventory_material(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_item_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_reason text,
  p_notes text
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
    p_job_id, v_project_id, v_line_id, null, p_reason
  ) movement;
  return v_quantity_after;
end;
$$;

revoke all on function public.take_unplanned_inventory_material(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text)
  from public, anon, authenticated;
grant execute on function public.take_unplanned_inventory_material(uuid, uuid, uuid, uuid, uuid, uuid, numeric, text, text)
  to service_role;
