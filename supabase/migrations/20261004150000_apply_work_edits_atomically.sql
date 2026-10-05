-- Editing a project, editing a job and changing an instruction list each apply
-- completely or not at all. The server actions wrote in separate statements:
-- updateProject saved the project and then moved its jobs to the new customer,
-- with an unchecked compensating write when the second step failed; updateJob
-- saved the job and then replaced its assignments, and reported a partial
-- update when the replacement was refused; the instruction list order was one
-- UPDATE per item, and creating or deleting an item renumbered the list in a
-- second step after the insert or the delete had committed.
--
-- Division of work: the action establishes identity, the active membership,
-- the role and the object, resolves every value it writes on the server and
-- checks the references for a clear message. Each function locks its rows,
-- repeats the checks that guard the organization boundary and the data under
-- that lock, and raises the action failure code of the first refusal, so
-- nothing changes. Signals stay as before: the written rows reach the Realtime
-- publication, a deleted item writes its realtime_deletions notice through its
-- trigger, and the jobs triggers sync planning and dispatch rows in the same
-- transaction.

-- A customer, site and contact of this organization that belong together.
-- Runs as the calling function's owner; no role executes it directly.
create function app_private.assert_work_customer_references(
  p_organization_id uuid,
  p_client_id uuid,
  p_site_id uuid,
  p_contact_id uuid
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_reference_client_id uuid;
begin
  if p_client_id is not null and not exists (
    select 1 from public.clients client
    where client.organization_id = p_organization_id and client.id = p_client_id
  ) then
    raise exception 'client_not_found';
  end if;

  if p_site_id is not null then
    if p_client_id is null then raise exception 'site_requires_client'; end if;
    select site.client_id into v_reference_client_id from public.client_sites site
    where site.organization_id = p_organization_id and site.id = p_site_id;
    if not found then raise exception 'site_not_found'; end if;
    if v_reference_client_id is distinct from p_client_id then raise exception 'site_client_mismatch'; end if;
  end if;

  if p_contact_id is not null then
    if p_client_id is null then raise exception 'contact_requires_client'; end if;
    select contact.client_id into v_reference_client_id from public.client_contacts contact
    where contact.organization_id = p_organization_id and contact.id = p_contact_id;
    if not found then raise exception 'contact_not_found'; end if;
    if v_reference_client_id is distinct from p_client_id then raise exception 'contact_client_mismatch'; end if;
  end if;
end;
$$;

-- The SET list of an edit: only the named columns, so a column trigger fires
-- exactly as for the former PostgREST update. Refuses an unknown column.
create function app_private.work_edit_assignments(p_changes jsonb, p_allowed_columns text[])
returns text
language plpgsql
immutable
security invoker
set search_path to ''
as $$
declare
  v_assignments text;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or exists (
    select 1 from jsonb_object_keys(p_changes) change_key
    where change_key <> all (p_allowed_columns)
  ) then
    raise exception 'invalid_input';
  end if;
  select string_agg(format('%1$I = changes.%1$I', change_key), ', ' order by change_key)
  into v_assignments
  from jsonb_object_keys(p_changes) change_key;
  return v_assignments;
end;
$$;

-- Saves the named project columns and, when the customer changes, moves every
-- job of the project to the new customer without the previous customer's site
-- and contact. Refusals: invalid_input, project_not_found,
-- name_or_description_required, project_number_taken, client_not_found,
-- site_requires_client, site_not_found, site_client_mismatch,
-- contact_requires_client, contact_not_found, contact_client_mismatch.
create function public.update_project_with_jobs(
  p_organization_id uuid,
  p_project_id uuid,
  p_changes jsonb
)
returns public.projects
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_assignments text := app_private.work_edit_assignments(p_changes, array[
    'name', 'description', 'client_id', 'site_id', 'contact_id', 'project_number',
    'planned_start_date', 'planned_end_date'
  ]);
  v_previous_client_id uuid;
  v_project public.projects;
begin
  if v_assignments is null then raise exception 'invalid_input'; end if;

  select project.client_id into v_previous_client_id from public.projects project
  where project.organization_id = p_organization_id and project.id = p_project_id
  for no key update;
  if not found then raise exception 'project_not_found'; end if;

  execute format(
    'update public.projects project set %s
     from jsonb_populate_record(null::public.projects, $1) changes
     where project.organization_id = $2 and project.id = $3
     returning project.*',
    v_assignments
  ) into v_project using p_changes, p_organization_id, p_project_id;

  if btrim(v_project.name) = '' and coalesce(btrim(v_project.description), '') = '' then
    raise exception 'name_or_description_required';
  end if;
  if p_changes ? 'project_number' and v_project.project_number is not null and exists (
    select 1 from public.projects other
    where other.organization_id = p_organization_id
      and other.project_number = v_project.project_number
      and other.id <> p_project_id
  ) then
    raise exception 'project_number_taken';
  end if;
  if p_changes ?| array['client_id', 'site_id', 'contact_id'] then
    perform app_private.assert_work_customer_references(
      p_organization_id, v_project.client_id, v_project.site_id, v_project.contact_id
    );
  end if;

  -- The previous customer's sites and contacts no longer fit the jobs.
  if v_project.client_id is distinct from v_previous_client_id then
    update public.jobs job
    set client_id = v_project.client_id, site_id = null, contact_id = null
    where job.organization_id = p_organization_id and job.project_id = p_project_id;
  end if;

  return v_project;
end;
$$;

-- Saves the named job columns and, when asked, replaces the assignments with
-- their qualification assessment through replace_job_assignments_with_assessment.
-- Refusals: invalid_input, job_not_found, title_or_description_required,
-- project_not_found, job_number_taken, the customer reference codes of
-- update_project_with_jobs; a refused assignment raises that function's error.
create function public.update_job_with_assignments(
  p_organization_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_changes jsonb,
  p_replace_assignments boolean,
  p_selected_user_ids uuid[],
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean
)
returns public.jobs
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_assignments text := app_private.work_edit_assignments(p_changes, array[
    'title', 'description', 'project_id', 'client_id', 'site_id', 'contact_id', 'job_number',
    'priority', 'planned_date', 'planned_time', 'estimated_duration_minutes',
    'planned_working_minutes', 'location', 'status'
  ]);
  v_job public.jobs;
begin
  -- An edit only takes a parked job back into the plan; every other status
  -- change has its own workflow.
  if p_changes ? 'status' and p_changes ->> 'status' is distinct from 'nicht_bearbeitet' then
    raise exception 'invalid_input';
  end if;
  if v_assignments is null and not coalesce(p_replace_assignments, false) then
    raise exception 'invalid_input';
  end if;

  select * into v_job from public.jobs job
  where job.organization_id = p_organization_id and job.id = p_job_id
  for no key update;
  if not found then raise exception 'job_not_found'; end if;

  if v_assignments is not null then
    execute format(
      'update public.jobs job set %s
       from jsonb_populate_record(null::public.jobs, $1) changes
       where job.organization_id = $2 and job.id = $3
       returning job.*',
      v_assignments
    ) into v_job using p_changes, p_organization_id, p_job_id;

    if btrim(v_job.title) = '' and coalesce(btrim(v_job.description), '') = '' then
      raise exception 'title_or_description_required';
    end if;
    if v_job.project_id is not null and p_changes ? 'project_id' and not exists (
      select 1 from public.projects project
      where project.organization_id = p_organization_id and project.id = v_job.project_id
    ) then
      raise exception 'project_not_found';
    end if;
    if p_changes ? 'job_number' and v_job.job_number is not null and exists (
      select 1 from public.jobs other
      where other.organization_id = p_organization_id
        and other.job_number = v_job.job_number
        and other.id <> p_job_id
    ) then
      raise exception 'job_number_taken';
    end if;
    if p_changes ?| array['project_id', 'client_id', 'site_id', 'contact_id'] then
      perform app_private.assert_work_customer_references(
        p_organization_id, v_job.client_id, v_job.site_id, v_job.contact_id
      );
    end if;
  end if;

  if coalesce(p_replace_assignments, false) then
    perform public.replace_job_assignments_with_assessment(
      p_organization_id, p_job_id, p_selected_user_ids, p_actor_id, p_assessed_for_date,
      p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
      p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment
    );
  end if;

  return v_job;
end;
$$;

-- The first step of every list change: the job or the project locked against a
-- concurrent list change, and the ids of its items in display order, locked.
-- Runs as the calling function's owner; no role executes it directly.
create function app_private.lock_instruction_list(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns uuid[]
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_item_ids uuid[];
begin
  if num_nonnulls(p_job_id, p_project_id) <> 1 then raise exception 'invalid_input'; end if;
  if p_job_id is not null then
    perform 1 from public.jobs job
    where job.organization_id = p_organization_id and job.id = p_job_id
    for no key update;
    if not found then raise exception 'job_not_found'; end if;
  else
    perform 1 from public.projects project
    where project.organization_id = p_organization_id and project.id = p_project_id
    for no key update;
    if not found then raise exception 'project_not_found'; end if;
  end if;

  select coalesce(array_agg(locked.id order by locked.sort_order, locked.created_at, locked.id), '{}')
  into v_item_ids
  from (
    select item.id, item.sort_order, item.created_at from public.job_instruction_items item
    where item.organization_id = p_organization_id
      and (item.job_id = p_job_id or item.project_id = p_project_id)
    order by item.id
    for update
  ) locked;
  return v_item_ids;
end;
$$;

-- Numbers the named items 0..n-1 in the given order, in one statement.
create function app_private.write_instruction_order(p_organization_id uuid, p_item_ids uuid[])
returns void
language sql
security invoker
set search_path to ''
as $$
  update public.job_instruction_items item
  set sort_order = ordered.position - 1, updated_at = now()
  from unnest(p_item_ids) with ordinality as ordered(id, position)
  where item.organization_id = p_organization_id and item.id = ordered.id;
$$;

-- Puts the whole list of a job or a project in the given order.
-- Refusals: invalid_input, job_not_found, project_not_found, invalid_reorder.
create function public.reorder_instruction_items(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_item_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_current_ids uuid[] := app_private.lock_instruction_list(p_organization_id, p_job_id, p_project_id);
  v_item_count integer := coalesce(cardinality(p_item_ids), 0);
begin
  if v_item_count <> cardinality(v_current_ids)
    or v_item_count <> (select count(distinct item_id) from unnest(p_item_ids) item_id)
    or exists (select 1 from unnest(p_item_ids) item_id where item_id <> all (v_current_ids))
  then
    raise exception 'invalid_reorder';
  end if;
  perform app_private.write_instruction_order(p_organization_id, p_item_ids);
end;
$$;

-- Adds an item to a job's list after the named item, or at the end, and
-- returns its id. Refusals: invalid_input, job_not_found, content_required,
-- item_not_found.
create function public.create_job_instruction_item(
  p_organization_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_content text,
  p_after_item_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_current_ids uuid[];
  v_position integer;
  v_item_id uuid;
begin
  if p_job_id is null then raise exception 'invalid_input'; end if;
  v_current_ids := app_private.lock_instruction_list(p_organization_id, p_job_id, null);
  if coalesce(btrim(p_content), '') = '' then raise exception 'content_required'; end if;

  v_position := cardinality(v_current_ids);
  if p_after_item_id is not null then
    v_position := array_position(v_current_ids, p_after_item_id);
    if v_position is null then raise exception 'item_not_found'; end if;
  end if;

  insert into public.job_instruction_items (organization_id, job_id, content, sort_order, created_by)
  values (p_organization_id, p_job_id, p_content, v_position, p_actor_id)
  returning id into v_item_id;

  perform app_private.write_instruction_order(
    p_organization_id,
    v_current_ids[1:v_position] || v_item_id || v_current_ids[v_position + 1:]
  );
  return v_item_id;
end;
$$;

-- Deletes an item of a job's or a project's list and closes the gap.
-- Refusals: item_not_found; a work artifact or dependency that references the
-- item refuses the delete through its foreign key.
create function public.delete_instruction_item(p_organization_id uuid, p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job_id uuid;
  v_project_id uuid;
  v_current_ids uuid[];
begin
  select item.job_id, item.project_id into v_job_id, v_project_id
  from public.job_instruction_items item
  where item.organization_id = p_organization_id and item.id = p_item_id;
  if not found then raise exception 'item_not_found'; end if;

  v_current_ids := app_private.lock_instruction_list(p_organization_id, v_job_id, v_project_id);
  if not p_item_id = any (v_current_ids) then raise exception 'item_not_found'; end if;

  delete from public.job_instruction_items item
  where item.organization_id = p_organization_id and item.id = p_item_id;
  perform app_private.write_instruction_order(p_organization_id, array_remove(v_current_ids, p_item_id));
end;
$$;

revoke all on function app_private.assert_work_customer_references(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.work_edit_assignments(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function app_private.lock_instruction_list(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.write_instruction_order(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.update_project_with_jobs(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.update_job_with_assignments(
  uuid, uuid, uuid, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean
) from public, anon, authenticated;
revoke all on function public.reorder_instruction_items(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.create_job_instruction_item(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_instruction_item(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.update_project_with_jobs(uuid, uuid, jsonb) to service_role;
grant execute on function public.update_job_with_assignments(
  uuid, uuid, uuid, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean
) to service_role;
grant execute on function public.reorder_instruction_items(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function public.create_job_instruction_item(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.delete_instruction_item(uuid, uuid) to service_role;
