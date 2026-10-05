-- Creating the visit job of due maintenance work is all or nothing. The
-- server action createMaintenanceVisit took the next job number, created the
-- job through createJob, linked it to the due items with
-- link_maintenance_due_visit in a second call and deleted the job again when
-- the link was refused; a failed delete was only logged and left a visit job
-- without its due work behind.
--
-- Division of work: the action establishes the service manager, reads the
-- plans of the due items and prepares the job from the plan's template
-- exactly as createJob does. The function takes the job number under the
-- creation lock, creates the job and links it to the due items in one
-- transaction, so a refused link keeps the number free. Signals stay as
-- before: the job and the due work rows reach the Realtime publication.

-- Creates the visit job with the next job number and links it to the due
-- items. Refusals: those of app_private.create_job_record and of
-- link_maintenance_due_visit.
create function public.create_maintenance_visit_job(
  p_organization_id uuid,
  p_actor_id uuid,
  p_maintenance_due_work_ids uuid[],
  p_expected_versions bigint[],
  p_reason text,
  p_idempotency_key uuid,
  p_job jsonb,
  p_selected_user_ids uuid[],
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean,
  p_template_version_id uuid,
  p_template_assessment boolean
)
returns public.jobs
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job public.jobs;
begin
  if p_job ? 'job_number' then raise exception 'invalid_input'; end if;

  -- The same lock app_private.create_job_record takes before its number check.
  perform pg_advisory_xact_lock(hashtextextended('job_number:' || p_organization_id::text, 0));
  v_job := app_private.create_job_record(
    p_organization_id, p_actor_id,
    p_job || jsonb_build_object('job_number', public.generate_job_number(p_organization_id)),
    p_selected_user_ids, p_assessed_for_date, p_selected_employee_record_ids,
    p_requirements_snapshot, p_coverage_snapshot, p_coverage_fingerprint, p_override_reason,
    p_team_source_id, p_record_assessment, p_template_version_id, p_template_assessment
  );

  perform public.link_maintenance_due_visit(
    p_organization_id, p_maintenance_due_work_ids, v_job.id, null, p_expected_versions,
    p_reason, p_actor_id, p_idempotency_key
  );

  return v_job;
end;
$$;

revoke all on function public.create_maintenance_visit_job(
  uuid, uuid, uuid[], bigint[], text, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text,
  uuid, boolean, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.create_maintenance_visit_job(
  uuid, uuid, uuid[], bigint[], text, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text,
  uuid, boolean, uuid, boolean
) to service_role;
