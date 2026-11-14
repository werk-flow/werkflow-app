-- Admin and Büro name and end a project lead („Projektleitung“)
-- (werk-flow/werkflow-planning#381, part 2). The holdings, the lead rule and
-- the lead's review are in 20261201150000_name_a_project_lead_per_work.sql.
--
-- name_work_lead and end_work_lead are the office's two writes, one call each:
-- naming ends the open holding and opens the new one together, so the history
-- never shows two leads or a gap the office did not choose.
--
-- Each call names the open holding its caller saw (p_expected_lead_id, null
-- for none). The target's row lock orders concurrent calls; a call whose
-- holding changed meanwhile is refused with work_lead_changed, so one office
-- user never silently replaces another's choice. A repeat of a call that
-- already applied changes nothing: naming the current lead again, or ending a
-- holding that is already ended while no other is open.
--
-- Division of work: the server actions establish identity, organization and
-- the manager role and pass them. The functions check the actor again, load
-- every id inside the organization and write.
--
-- A project lead reads no row of a job they are not on, so the jobs'
-- Realtime events never reach them. A change of a job, an instruction or an
-- Arbeitsnachweis of a project touches the project's open holding instead,
-- whose event the lead receives (data model: touch the owning root).
--
-- Expand-only: two new functions and three triggers that only touch
-- updated_at of an open holding; the previous release calls neither function
-- and reads updated_at of no holding.
--
-- Prevention: Tier 1 (function checks), Tier 2 supabase/tests/work_leads.sql.

create function public.name_work_lead(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_lead_user_id uuid,
  p_expected_lead_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_record_id uuid;
  v_open public.work_leads%rowtype;
  v_lead_id uuid;
begin
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id) then
    raise exception 'work_lead_not_authorized';
  end if;
  -- The target's row lock orders concurrent calls on the same work.
  if num_nonnulls(p_project_id, p_job_id) <> 1 then raise exception 'work_lead_target_invalid'; end if;
  if p_project_id is not null then
    perform 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id
    for no key update;
  else
    perform 1 from public.jobs job
    where job.id = p_job_id and job.organization_id = p_organization_id
    for no key update;
  end if;
  if not found then raise exception 'work_lead_target_not_found'; end if;

  -- A member of this organization with effective access who has not left,
  -- as the lead rule counts them.
  select employee.id into v_record_id
  from public.employee_records employee
  join public.organization_members member
    on member.organization_id = employee.organization_id and member.user_id = employee.user_id
  where employee.organization_id = p_organization_id
    and employee.user_id = p_lead_user_id
    and (employee.exit_date is null
      or employee.exit_date >= (now() at time zone 'Europe/Berlin')::date);
  if v_record_id is null or not app_private.p1_24_has_effective_access(p_organization_id, p_lead_user_id) then
    raise exception 'work_lead_member_not_eligible';
  end if;

  select * into v_open from public.work_leads work_lead
  where work_lead.organization_id = p_organization_id
    and work_lead.ended_at is null
    and (work_lead.project_id = p_project_id or work_lead.job_id = p_job_id);
  if found and v_open.employee_record_id = v_record_id then
    return jsonb_build_object('leadId', v_open.id, 'changed', false);
  end if;
  if v_open.id is distinct from p_expected_lead_id then raise exception 'work_lead_changed'; end if;
  if v_open.id is not null then
    update public.work_leads set ended_at = now(), ended_by = p_actor_id where id = v_open.id;
  end if;

  insert into public.work_leads (organization_id, project_id, job_id, employee_record_id, started_by)
  values (p_organization_id, p_project_id, p_job_id, v_record_id, p_actor_id)
  returning id into v_lead_id;
  return jsonb_build_object('leadId', v_lead_id, 'changed', true);
end;
$$;
revoke all on function public.name_work_lead(uuid, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.name_work_lead(uuid, uuid, uuid, uuid, uuid, uuid) to service_role;

create function public.end_work_lead(
  p_organization_id uuid,
  p_actor_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_expected_lead_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_open_id uuid;
begin
  if not app_private.p1_24_is_manager(p_organization_id, p_actor_id) then
    raise exception 'work_lead_not_authorized';
  end if;
  -- The target's row lock orders concurrent calls on the same work.
  if num_nonnulls(p_project_id, p_job_id) <> 1 then raise exception 'work_lead_target_invalid'; end if;
  if p_project_id is not null then
    perform 1 from public.projects project
    where project.id = p_project_id and project.organization_id = p_organization_id
    for no key update;
  else
    perform 1 from public.jobs job
    where job.id = p_job_id and job.organization_id = p_organization_id
    for no key update;
  end if;
  if not found then raise exception 'work_lead_target_not_found'; end if;

  select work_lead.id into v_open_id from public.work_leads work_lead
  where work_lead.organization_id = p_organization_id
    and work_lead.ended_at is null
    and (work_lead.project_id = p_project_id or work_lead.job_id = p_job_id);
  if v_open_id is null then return jsonb_build_object('leadId', p_expected_lead_id, 'changed', false); end if;
  if v_open_id is distinct from p_expected_lead_id then raise exception 'work_lead_changed'; end if;
  update public.work_leads set ended_at = now(), ended_by = p_actor_id where id = v_open_id;
  return jsonb_build_object('leadId', v_open_id, 'changed', true);
end;
$$;
revoke all on function public.end_work_lead(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.end_work_lead(uuid, uuid, uuid, uuid, uuid) to service_role;

-- The touch. Each trigger names the projects whose open holding signals the
-- change; a project without one updates no row.
create function app_private.touch_work_lead_of_projects(p_organization_id uuid, p_project_ids uuid[])
returns void
language sql
security definer
set search_path to ''
as $$
  update public.work_leads work_lead set updated_at = now()
  where work_lead.organization_id = p_organization_id
    and work_lead.ended_at is null
    and work_lead.project_id = any (p_project_ids);
$$;
revoke all on function app_private.touch_work_lead_of_projects(uuid, uuid[]) from public, anon, authenticated;

create function app_private.touch_work_lead_from_job()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  perform app_private.touch_work_lead_of_projects(coalesce(new.organization_id, old.organization_id), array_remove(array[
    case when tg_op <> 'DELETE' then new.project_id end,
    case when tg_op <> 'INSERT' then old.project_id end
  ], null));
  return null;
end;
$$;
revoke all on function app_private.touch_work_lead_from_job() from public, anon, authenticated;

-- An instruction item or an Arbeitsnachweis names its job or its project.
create function app_private.touch_work_lead_from_work_row()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end);
begin
  perform app_private.touch_work_lead_of_projects((v_row->>'organization_id')::uuid, array(
    select (v_row->>'project_id')::uuid where v_row->>'project_id' is not null
    union
    select job.project_id from public.jobs job
    where job.id = (v_row->>'job_id')::uuid
      and job.organization_id = (v_row->>'organization_id')::uuid
      and job.project_id is not null
  ));
  return null;
end;
$$;
revoke all on function app_private.touch_work_lead_from_work_row() from public, anon, authenticated;

create trigger touch_work_lead after insert or update or delete on public.jobs
  for each row execute function app_private.touch_work_lead_from_job();
create trigger touch_work_lead after insert or update or delete on public.job_instruction_items
  for each row execute function app_private.touch_work_lead_from_work_row();
create trigger touch_work_lead after insert or update on public.work_artifacts
  for each row execute function app_private.touch_work_lead_from_work_row();
