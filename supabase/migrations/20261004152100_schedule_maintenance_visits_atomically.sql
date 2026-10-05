-- Scheduling a maintenance visit is all or nothing. The server action
-- scheduleMaintenanceVisit in lib/maintenance/actions.ts created the calendar
-- occurrence in one call and linked it to the due work in a second. When the
-- link was refused (a stale version, a due item without its visit job), the
-- action deleted the occurrence again, and that delete is refused by the
-- append-only planning history, so the unlinked appointment stayed. Both steps
-- now run in one function call, and so one transaction.
--
-- Division of work: the action establishes identity, the active membership and
-- the manager role, materializes the occurrence and assesses capacity and
-- qualifications exactly as createPlanningEntry does, and refuses unconfirmed
-- conflicts before it calls. The function repeats the manager check, locks the
-- due item, refuses an occurrence for another job than the due item's visit
-- job (maintenance_due_job_mismatch), and raises the failure code of the first
-- refusal of create_planning_entry_materialized or
-- set_maintenance_due_occurrence, so nothing changes. A replay with the same
-- idempotency key returns the stored occurrence through the replay paths of
-- both functions.
--
-- Side effects stay as before: the occurrence, its assignments, assessment,
-- planning event and job projection, and the due event visit_rescheduled.

-- Refusals: maintenance_not_authorized, maintenance_due_not_found,
-- maintenance_due_job_mismatch, maintenance_stale_version,
-- maintenance_due_schedule_not_allowed, maintenance_idempotency_conflict, and
-- those of create_planning_entry_materialized. Returns the occurrence id.
create function public.schedule_maintenance_visit(
  p_organization_id uuid,
  p_actor_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_occurrence jsonb,
  p_assignments jsonb,
  p_idempotency_key uuid,
  p_capacity_snapshot jsonb,
  p_capacity_fingerprint text,
  p_qualification_snapshot jsonb,
  p_qualification_fingerprint text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_due_job_id uuid;
  v_occurrence_ids uuid[];
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  if p_occurrence is null or jsonb_typeof(p_occurrence) <> 'object' then
    raise exception 'invalid_input';
  end if;

  select due_work.job_id into v_due_job_id
  from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id
    and due_work.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'maintenance_due_not_found';
  end if;
  if v_due_job_id is not null
    and v_due_job_id is distinct from nullif(p_occurrence->>'jobId', '')::uuid
  then
    raise exception 'maintenance_due_job_mismatch';
  end if;

  v_occurrence_ids := public.create_planning_entry_materialized(
    p_organization_id, p_actor_id, null, jsonb_build_array(p_occurrence), p_assignments,
    p_idempotency_key, p_capacity_snapshot, p_capacity_fingerprint, p_qualification_snapshot,
    p_qualification_fingerprint, null
  );
  if cardinality(v_occurrence_ids) <> 1 then
    raise exception 'invalid_input';
  end if;
  perform public.set_maintenance_due_occurrence(
    p_organization_id, p_maintenance_due_work_id, p_expected_version, v_occurrence_ids[1],
    p_actor_id, p_idempotency_key
  );
  return v_occurrence_ids[1];
end;
$$;

revoke all on function public.schedule_maintenance_visit(
  uuid, uuid, uuid, bigint, jsonb, jsonb, uuid, jsonb, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.schedule_maintenance_visit(
  uuid, uuid, uuid, bigint, jsonb, jsonb, uuid, jsonb, text, jsonb, text
) to service_role;
