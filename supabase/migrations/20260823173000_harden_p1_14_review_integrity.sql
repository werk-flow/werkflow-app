-- Preserve P1-12 read markers when their parking-review identity moves from
-- the job to the migrated canonical parking blocker.
delete from public.attention_read_states legacy
using public.work_blockers blocker
where legacy.source_type = 'job_parking_review'
  and blocker.organization_id = legacy.organization_id
  and blocker.job_id = legacy.source_id
  and blocker.kind = 'parking'
  and blocker.legacy_source = 'job_parking_contexts'
  and exists (
    select 1
    from public.attention_read_states canonical
    where canonical.organization_id = legacy.organization_id
      and canonical.user_id = legacy.user_id
      and canonical.source_type = 'work_blocker_review'
      and canonical.source_id = blocker.id
  );

update public.attention_read_states legacy set
  source_type = 'work_blocker_review',
  source_id = blocker.id,
  updated_at = now()
from public.work_blockers blocker
where legacy.source_type = 'job_parking_review'
  and blocker.organization_id = legacy.organization_id
  and blocker.job_id = legacy.source_id
  and blocker.kind = 'parking'
  and blocker.legacy_source = 'job_parking_contexts';

create index work_dependencies_created_by_idx
  on public.work_dependencies(created_by);
create index work_dependencies_updated_by_idx
  on public.work_dependencies(updated_by);
create index work_dependencies_removed_by_idx
  on public.work_dependencies(removed_by)
  where removed_by is not null;
create index work_blockers_responsible_employee_idx
  on public.work_blockers(responsible_employee_record_id)
  where responsible_employee_record_id is not null;

create or replace function public.upsert_work_blocker(
  p_organization_id uuid,
  p_actor_id uuid,
  p_blocker_id uuid,
  p_expected_version bigint,
  p_job_id uuid,
  p_project_id uuid,
  p_instruction_item_id uuid,
  p_kind public.work_blocker_kind,
  p_reason public.work_blocker_reason,
  p_details text,
  p_responsible_employee_record_id uuid,
  p_next_review_date date
)
returns table (blocker_id uuid, blocker_version bigint)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_role public.org_role;
  v_is_manager boolean;
  v_owner_user_id uuid;
  v_current public.work_blockers%rowtype;
  v_next_version bigint;
  v_before jsonb;
  v_after jsonb;
  v_event_type text;
begin
  if (p_job_id is not null)::integer
      + (p_project_id is not null)::integer
      + (p_instruction_item_id is not null)::integer <> 1
    or p_reason is null
    or p_responsible_employee_record_id is null
    or p_next_review_date is null
    or (p_reason = 'other' and nullif(btrim(coalesce(p_details, '')), '') is null)
  then raise exception 'work_blocker_invalid_input'; end if;

  select m.role into v_role from public.organization_members m
  where m.organization_id = p_organization_id and m.user_id = p_actor_id;
  if v_role is null then raise exception 'work_blocker_not_authorized'; end if;
  v_is_manager := v_role in ('admin', 'buero');
  select e.user_id into v_owner_user_id from public.employee_records e
  where e.id = p_responsible_employee_record_id
    and e.organization_id = p_organization_id;
  if v_owner_user_id is null then raise exception 'work_blocker_owner_invalid'; end if;

  if not v_is_manager then
    if p_job_id is null or p_kind <> 'blocker' or v_owner_user_id <> p_actor_id
      or p_next_review_date <> (now() at time zone 'Europe/Berlin')::date
      or not exists (
        select 1 from public.job_assignments a
        where a.job_id = p_job_id and a.user_id = p_actor_id
      )
    then raise exception 'work_blocker_not_authorized'; end if;
  end if;

  if p_blocker_id is null then
    insert into public.work_blockers (
      organization_id, job_id, project_id, instruction_item_id, kind, reason,
      details, responsible_employee_record_id, next_review_date, created_by,
      updated_by
    ) values (
      p_organization_id, p_job_id, p_project_id, p_instruction_item_id,
      p_kind, p_reason, nullif(btrim(coalesce(p_details, '')), ''),
      p_responsible_employee_record_id, p_next_review_date, p_actor_id, p_actor_id
    ) returning * into v_current;
    v_before := null;
    v_event_type := case when p_kind = 'parking' then 'parked' else 'created' end;
  else
    select * into v_current from public.work_blockers b
    where b.id = p_blocker_id and b.organization_id = p_organization_id
    for update;
    if not found then raise exception 'work_blocker_not_found'; end if;
    if v_current.version <> p_expected_version then
      raise exception 'work_blocker_stale_version';
    end if;
    if v_current.state <> 'open' then raise exception 'work_blocker_not_open'; end if;
    if v_current.job_id is distinct from p_job_id
      or v_current.project_id is distinct from p_project_id
      or v_current.instruction_item_id is distinct from p_instruction_item_id
      or v_current.kind is distinct from p_kind
    then raise exception 'work_blocker_target_mismatch'; end if;
    if not v_is_manager and v_current.responsible_employee_record_id
      <> p_responsible_employee_record_id then
      raise exception 'work_blocker_not_authorized';
    end if;
    v_before := to_jsonb(v_current);
    v_next_version := v_current.version + 1;
    update public.work_blockers set
      reason = p_reason,
      details = nullif(btrim(coalesce(p_details, '')), ''),
      responsible_employee_record_id = p_responsible_employee_record_id,
      next_review_date = p_next_review_date,
      version = v_next_version,
      updated_by = p_actor_id,
      updated_at = now()
    where id = p_blocker_id
    returning * into v_current;
    v_event_type := 'updated';
  end if;

  v_after := to_jsonb(v_current);
  insert into public.work_blocker_events (
    organization_id, blocker_id, event_type, before_state, after_state, created_by
  ) values (
    p_organization_id, v_current.id, v_event_type, v_before, v_after, p_actor_id
  );
  return query select v_current.id, v_current.version;
end;
$$;

revoke all on function public.upsert_work_blocker(
  uuid, uuid, uuid, bigint, uuid, uuid, uuid, public.work_blocker_kind,
  public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated;
grant execute on function public.upsert_work_blocker(
  uuid, uuid, uuid, bigint, uuid, uuid, uuid, public.work_blocker_kind,
  public.work_blocker_reason, text, uuid, date
) to service_role;

create or replace function public.park_work_target(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_execution_version bigint,
  p_reason public.work_blocker_reason,
  p_details text,
  p_responsible_employee_record_id uuid,
  p_next_review_date date
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_blocker_id uuid;
  v_existing_child_blocker_ids uuid[] := '{}'::uuid[];
begin
  if p_target_type = 'project' then
    select coalesce(array_agg(b.id), '{}'::uuid[])
    into v_existing_child_blocker_ids
    from public.work_blockers b
    join public.jobs j on j.id = b.job_id
    where b.organization_id = p_organization_id
      and b.kind = 'parking'
      and b.state = 'open'
      and j.organization_id = p_organization_id
      and j.project_id = p_target_id;
  end if;

  v_blocker_id := app_private.park_work_target_base(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_execution_version, p_reason, p_details,
    p_responsible_employee_record_id, p_next_review_date
  );

  if p_target_type = 'project' then
    update public.work_blockers b set
      parent_project_parking_blocker_id = v_blocker_id
    where b.organization_id = p_organization_id
      and b.kind = 'parking'
      and b.state = 'open'
      and b.parent_project_parking_blocker_id is null
      and not (b.id = any(v_existing_child_blocker_ids))
      and b.job_id in (
        select j.id from public.jobs j
        where j.organization_id = p_organization_id
          and j.project_id = p_target_id
      );
  end if;

  return v_blocker_id;
end;
$$;

revoke all on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) from public, anon, authenticated;
grant execute on function public.park_work_target(
  uuid, uuid, text, uuid, bigint, public.work_blocker_reason, text, uuid, date
) to service_role;

create or replace function app_private.build_work_gate_snapshot(
  p_organization_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_incomplete_required integer;
  v_reopened_predecessors integer;
  v_open_blockers integer;
  v_open_start_dependencies integer;
  v_open_completion_dependencies integer;
  v_active_clock integer := 0;
  v_incomplete_project_children integer := 0;
begin
  select count(*) into v_incomplete_required
  from public.job_instruction_items i
  where i.organization_id = p_organization_id
    and ((p_job_id is not null and i.job_id = p_job_id)
      or (p_project_id is not null and i.project_id = p_project_id))
    and i.requirement_state = 'required' and not i.is_completed;

  select count(*) into v_reopened_predecessors
  from public.job_instruction_item_dependencies d
  join public.job_instruction_items dependent on dependent.id = d.dependent_item_id
  join public.job_instruction_items predecessor on predecessor.id = d.predecessor_item_id
  where d.organization_id = p_organization_id
    and dependent.is_completed and not predecessor.is_completed
    and ((p_job_id is not null and dependent.job_id = p_job_id)
      or (p_project_id is not null and dependent.project_id = p_project_id));

  select count(*) into v_open_blockers
  from public.work_blockers b
  where b.organization_id = p_organization_id and b.state = 'open'
    and (
      (p_job_id is not null and (b.job_id = p_job_id or b.instruction_item_id in (
        select i.id from public.job_instruction_items i where i.job_id = p_job_id
      )))
      or (p_project_id is not null and (b.project_id = p_project_id or b.instruction_item_id in (
        select i.id from public.job_instruction_items i where i.project_id = p_project_id
      )))
    );

  select count(*) filter (
      where d.effect = 'blocks_start' and not app_private.work_dependency_is_satisfied(d.id)
    ), count(*) filter (
      where d.effect = 'blocks_completion' and not app_private.work_dependency_is_satisfied(d.id)
    )
  into v_open_start_dependencies, v_open_completion_dependencies
  from public.work_dependencies d
  where d.organization_id = p_organization_id and d.removed_at is null
    and ((p_job_id is not null and d.dependent_job_id = p_job_id)
      or (p_project_id is not null and d.dependent_project_id = p_project_id));

  if p_job_id is not null then
    select count(*) into v_active_clock from (
      select distinct on (t.user_id) t.entry_type, t.job_id
      from public.time_entries t
      where t.organization_id = p_organization_id
        and t.status not in ('rejected', 'pending_delete')
      order by t.user_id, t.timestamp desc
    ) latest
    where latest.entry_type in ('clock_in', 'break_end') and latest.job_id = p_job_id;
  end if;

  if p_project_id is not null then
    select count(*) into v_incomplete_project_children
    from public.jobs j
    where j.organization_id = p_organization_id and j.project_id = p_project_id
      and coalesce(j.execution_state, app_private.resolve_legacy_job_execution_state(j.status))
        not in ('execution_complete', 'handed_over', 'cancelled');
  end if;

  return jsonb_build_object(
    'incompleteRequiredInstructions', v_incomplete_required,
    'reopenedInstructionPredecessors', v_reopened_predecessors,
    'openBlockers', v_open_blockers,
    'openStartDependencies', v_open_start_dependencies,
    'openCompletionDependencies', v_open_completion_dependencies,
    'activeJobClocks', v_active_clock,
    'incompleteProjectChildren', v_incomplete_project_children,
    'notAssessable', jsonb_build_array(
      'time_segment_completeness', 'material_consumption', 'measurements',
      'defects', 'formal_approvals', 'instruction_evidence',
      'customer_decision', 'signature', 'handover_package', 'tool_custody'
    )
  );
end;
$$;

revoke all on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function app_private.build_work_gate_snapshot(uuid, uuid, uuid)
to service_role;
