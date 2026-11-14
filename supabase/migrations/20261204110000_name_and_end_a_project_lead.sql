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
-- Expand-only: two new functions; the previous release calls neither.
--
-- Prevention: Tier 1 (function checks), Tier 2 supabase/tests/work_leads.sql.

-- Locks the project or job for the naming; false when it is not in the
-- organization.
create function app_private.lock_work_lead_target(
  p_organization_id uuid,
  p_project_id uuid,
  p_job_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path to ''
as $$
begin
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
  return found;
end;
$$;
revoke all on function app_private.lock_work_lead_target(uuid, uuid, uuid) from public, anon, authenticated;

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
  if not app_private.lock_work_lead_target(p_organization_id, p_project_id, p_job_id) then
    raise exception 'work_lead_target_not_found';
  end if;

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
  if not app_private.lock_work_lead_target(p_organization_id, p_project_id, p_job_id) then
    raise exception 'work_lead_target_not_found';
  end if;

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
