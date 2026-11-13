-- Planned job material has one database write that answers a repeated source
-- once (werk-flow/werkflow-planning#376).
--
-- The office's create actions inserted a planned material line with the
-- service role after reading the article and the Lager in separate requests.
-- Converting an accepted offer must create the job and its planned material in
-- one database function call, so the write becomes a function another
-- function can call inside its own transaction:
--
-- 1. job_material_lines.source_kind and source_id name the record a line was
--    planned from, for example an order line. Both are set or both are empty.
--    A unique index keeps one line per source and organization; a line without
--    a source stays free.
-- 2. plan_job_material plans an article on a job or a project and returns the
--    line's id. A call naming a source that already has a line returns that
--    line and changes nothing; a call that names the same source for another
--    job or project is refused (material_source_conflict). Two concurrent calls
--    for one source yield one line: the second waits on the unique index and
--    then answers with the first line. It changes no stock.
-- 3. The function runs as security invoker and is executable by service_role
--    only, as record_job_material_use: it crosses no RLS, so the caller's
--    rights suffice, and a calling function (security invoker under
--    service_role, or a definer) brings rights of its own. It neither commits
--    nor takes an advisory lock; its only locks are the transaction's row
--    locks on the membership it re-checks and on the rows it writes. Each
--    refusal is a named exception: invalid_input, quantity_required,
--    not_authorized, job_not_found, project_not_found, item_not_found,
--    location_not_found, material_source_conflict.
--
-- An article a line references stays archived, never deleted: the line's
-- foreign key (on delete restrict) refuses the delete for every writer.
--
-- The source columns are server-only: no client role reads them.

alter table public.job_material_lines
  add column source_kind text,
  add column source_id uuid;

-- @destructive: after release acce7e96d681d3b83ab86aa65c54bb3d8542f4be: that build never writes source_kind or source_id, which stay empty for its writes and satisfy both checks
alter table public.job_material_lines
  add constraint job_material_lines_source_complete
    check ((source_kind is null) = (source_id is null)) not valid,
  add constraint job_material_lines_source_kind_format
    check (source_kind ~ '^[a-z][a-z0-9_]{0,62}$') not valid;

-- @destructive: after release acce7e96d681d3b83ab86aa65c54bb3d8542f4be: that build never writes source_id, so none of its lines enters this partial index
create unique index job_material_lines_source_idx
  on public.job_material_lines (organization_id, source_kind, source_id)
  where source_id is not null;

create function public.plan_job_material(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_item_id uuid,
  p_planned_quantity numeric,
  p_preferred_location_id uuid default null,
  p_notes text default null,
  p_source_kind text default null,
  p_source_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role public.org_role;
  v_project_id uuid := p_project_id;
  v_is_billable boolean;
  v_line_id uuid;
begin
  if num_nonnulls(p_job_id, p_project_id) <> 1
    or (p_source_kind is null) <> (p_source_id is null)
    or p_source_kind !~ '^[a-z][a-z0-9_]{0,62}$'
  then
    raise exception 'invalid_input';
  end if;
  if p_planned_quantity is null or round(p_planned_quantity, 3) <= 0 then
    raise exception 'quantity_required';
  end if;

  -- The action checked the same role; a removed membership or role since then refuses here.
  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
  for share;
  if v_role is null or v_role not in ('admin', 'buero') then
    raise exception 'not_authorized';
  end if;

  if p_job_id is not null then
    select job.project_id into v_project_id from public.jobs job
    where job.id = p_job_id and job.organization_id = p_organization_id;
    if not found then
      raise exception 'job_not_found';
    end if;
  else
    perform 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id;
    if not found then
      raise exception 'project_not_found';
    end if;
  end if;

  select item.is_billable into v_is_billable from public.inventory_items item
  where item.id = p_item_id and item.organization_id = p_organization_id;
  if v_is_billable is null then
    raise exception 'item_not_found';
  end if;
  if p_preferred_location_id is not null then
    perform 1 from public.inventory_locations location
    where location.id = p_preferred_location_id and location.organization_id = p_organization_id;
    if not found then
      raise exception 'location_not_found';
    end if;
  end if;

  if p_source_id is not null then
    insert into public.job_material_lines (
      organization_id, job_id, project_id, item_id, preferred_location_id, planned_quantity,
      is_billable, notes, created_by, source_kind, source_id
    ) values (
      p_organization_id, p_job_id, v_project_id, p_item_id, p_preferred_location_id, p_planned_quantity,
      v_is_billable, nullif(btrim(coalesce(p_notes, '')), ''), p_actor_id, p_source_kind, p_source_id
    )
    on conflict (organization_id, source_kind, source_id) where source_id is not null do nothing
    returning id into v_line_id;

    if v_line_id is null then
      -- The source already has a line, committed before or by a call this one waited for.
      select line.id into v_line_id from public.job_material_lines line
      where line.organization_id = p_organization_id
        and line.source_kind = p_source_kind
        and line.source_id = p_source_id
        and line.job_id is not distinct from p_job_id
        and (p_job_id is not null or line.project_id = p_project_id);
      if v_line_id is null then
        raise exception 'material_source_conflict';
      end if;
    end if;
    return v_line_id;
  end if;

  insert into public.job_material_lines (
    organization_id, job_id, project_id, item_id, preferred_location_id, planned_quantity,
    is_billable, notes, created_by
  ) values (
    p_organization_id, p_job_id, v_project_id, p_item_id, p_preferred_location_id, p_planned_quantity,
    v_is_billable, nullif(btrim(coalesce(p_notes, '')), ''), p_actor_id
  )
  returning id into v_line_id;
  return v_line_id;
end;
$$;

revoke all on function public.plan_job_material(uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.plan_job_material(uuid, uuid, uuid, uuid, uuid, numeric, uuid, text, text, uuid)
  to service_role;
