-- Reporting, recording, ending, correcting, cancelling a Krankmeldung and
-- setting its evidence state write the report and its history row together or
-- not at all. The server actions in lib/sickness/actions.ts wrote
-- sickness_reports first and inserted the sickness_report_events row in a
-- second statement whose failure was only logged, so a report could change
-- without its history row. The state checks (active report, reason for someone
-- else's report, the end date against the stored start and day portion) ran on
-- a read taken before the write.
--
-- Division of work: the action establishes identity, the active membership,
-- the role, the employee record and the report's organization, validates the
-- dates and passes server-resolved values. Each function locks the report (or
-- the employee record for a new report) and the actor's membership, repeats
-- the state checks under those locks and raises the action failure code of the
-- first refusal, so nothing changes. The exclusion constraint
-- sickness_reports_no_active_overlap decides an overlapping active report.
--
-- Signals stay as before: the report INSERT or UPDATE reaches the Realtime
-- publication of sickness_reports; sickness_report_events stays unpublished.

-- The actor stays a member of the organization until commit and may write the
-- report of the employee record: their own, or any as admin or Büro. With
-- p_manager_only only admin and Büro may. Returns whether the record is the
-- actor's own. Runs as the calling function's owner; no role executes it
-- directly.
create function app_private.lock_sickness_actor(
  p_organization_id uuid,
  p_actor_id uuid,
  p_employee_record_id uuid,
  p_manager_only boolean
)
returns boolean
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_role text;
  v_own boolean;
begin
  select member.role::text into v_role from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
  for share;
  if not found then raise exception 'not_authorized'; end if;
  v_own := exists (
    select 1 from public.employee_records record
    where record.organization_id = p_organization_id
      and record.id = p_employee_record_id
      and record.user_id = p_actor_id
  );
  if v_role not in ('admin', 'buero') and (p_manager_only or not v_own) then
    raise exception 'not_authorized';
  end if;
  return v_own;
end;
$$;

-- The report of the organization, locked until commit.
create function app_private.lock_sickness_report(p_organization_id uuid, p_report_id uuid)
returns public.sickness_reports
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_report public.sickness_reports;
begin
  select * into v_report from public.sickness_reports report
  where report.organization_id = p_organization_id and report.id = p_report_id
  for no key update;
  if not found then raise exception 'not_found'; end if;
  return v_report;
end;
$$;

-- Appends one history row of the report.
create function app_private.append_sickness_report_event(
  p_report public.sickness_reports,
  p_event_type text,
  p_payload jsonb,
  p_actor_id uuid
)
returns void
language sql
security invoker
set search_path to ''
as $$
  insert into public.sickness_report_events (
    organization_id, sickness_report_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_report.organization_id, p_report.id, p_report.employee_record_id, p_event_type, p_payload, p_actor_id
  );
$$;

-- Records a report for the employee record with its 'reported' history row: a
-- self-report (p_self_reported) for the actor's own record, an office entry
-- by admin or Büro for any record of the organization. Refusals:
-- invalid_input, no_employee_record (self-report), record_not_found (office
-- entry), not_authorized, overlap_conflict. Returns the new report.
create function public.create_sickness_report(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_absence_type text,
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_evidence_required boolean,
  p_self_reported boolean
)
returns public.sickness_reports
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_report public.sickness_reports;
  v_own boolean;
begin
  if p_actor_id is null or p_organization_id is null or p_employee_record_id is null
    or p_evidence_required is null or p_self_reported is null then
    raise exception 'invalid_input';
  end if;

  perform 1 from public.employee_records record
  where record.organization_id = p_organization_id and record.id = p_employee_record_id
  for key share;
  if not found then
    raise exception '%', case when p_self_reported then 'no_employee_record' else 'record_not_found' end;
  end if;
  v_own := app_private.lock_sickness_actor(
    p_organization_id, p_actor_id, p_employee_record_id, not p_self_reported
  );
  if p_self_reported and not v_own then raise exception 'no_employee_record'; end if;

  begin
    insert into public.sickness_reports (
      organization_id, employee_record_id, absence_type, start_date, end_date, day_portion,
      status, evidence_required, evidence_status, reported_by
    ) values (
      p_organization_id, p_employee_record_id, p_absence_type, p_start_date, p_end_date, p_day_portion,
      'reported', p_evidence_required,
      case when p_evidence_required then 'pending' else 'not_required' end, p_actor_id
    )
    returning * into v_report;
  exception when exclusion_violation then
    raise exception 'overlap_conflict';
  end;

  perform app_private.append_sickness_report_event(v_report, 'reported', jsonb_build_object(
    'absence_type', v_report.absence_type,
    'start_date', v_report.start_date,
    'end_date', v_report.end_date,
    'day_portion', v_report.day_portion,
    'evidence_required', v_report.evidence_required,
    'self_reported', p_self_reported
  ), p_actor_id);

  return v_report;
end;
$$;

-- Sets the end date of an active report and records 'ended'. Refusals:
-- invalid_input, not_found, not_authorized, report_not_active, invalid_range,
-- range_too_long, half_day_needs_single_day, overlap_conflict. Returns the
-- saved report.
create function public.end_sickness_report(
  p_actor_id uuid,
  p_organization_id uuid,
  p_report_id uuid,
  p_end_date date
)
returns public.sickness_reports
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.sickness_reports;
  v_report public.sickness_reports;
begin
  if p_actor_id is null or p_organization_id is null or p_report_id is null or p_end_date is null then
    raise exception 'invalid_input';
  end if;

  v_previous := app_private.lock_sickness_report(p_organization_id, p_report_id);
  perform app_private.lock_sickness_actor(p_organization_id, p_actor_id, v_previous.employee_record_id, false);
  if v_previous.status <> 'reported' then raise exception 'report_not_active'; end if;
  if p_end_date < v_previous.start_date then raise exception 'invalid_range'; end if;
  if p_end_date > v_previous.start_date + 366 then raise exception 'range_too_long'; end if;
  if v_previous.day_portion = 'half_day' and p_end_date <> v_previous.start_date then
    raise exception 'half_day_needs_single_day';
  end if;

  begin
    update public.sickness_reports report set end_date = p_end_date
    where report.organization_id = p_organization_id and report.id = p_report_id
    returning * into v_report;
  exception when exclusion_violation then
    raise exception 'overlap_conflict';
  end;

  perform app_private.append_sickness_report_event(v_report, 'ended', jsonb_build_object(
    'before', jsonb_build_object('end_date', v_previous.end_date),
    'after', jsonb_build_object('end_date', v_report.end_date)
  ), p_actor_id);

  return v_report;
end;
$$;

-- Corrects type, dates and day portion of an active report and records
-- 'corrected'. Someone else's report needs a reason. Refusals: invalid_input,
-- not_found, not_authorized, report_not_active, reason_required,
-- overlap_conflict. Returns the saved report.
create function public.correct_sickness_report(
  p_actor_id uuid,
  p_organization_id uuid,
  p_report_id uuid,
  p_absence_type text,
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_reason text
)
returns public.sickness_reports
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.sickness_reports;
  v_report public.sickness_reports;
  v_own boolean;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_actor_id is null or p_organization_id is null or p_report_id is null then
    raise exception 'invalid_input';
  end if;

  v_previous := app_private.lock_sickness_report(p_organization_id, p_report_id);
  v_own := app_private.lock_sickness_actor(p_organization_id, p_actor_id, v_previous.employee_record_id, false);
  if v_previous.status <> 'reported' then raise exception 'report_not_active'; end if;
  if not v_own and v_reason is null then raise exception 'reason_required'; end if;

  begin
    update public.sickness_reports report
    set absence_type = p_absence_type, start_date = p_start_date, end_date = p_end_date,
        day_portion = p_day_portion
    where report.organization_id = p_organization_id and report.id = p_report_id
    returning * into v_report;
  exception when exclusion_violation then
    raise exception 'overlap_conflict';
  end;

  perform app_private.append_sickness_report_event(v_report, 'corrected', jsonb_build_object(
    'before', jsonb_build_object(
      'absence_type', v_previous.absence_type, 'start_date', v_previous.start_date,
      'end_date', v_previous.end_date, 'day_portion', v_previous.day_portion
    ),
    'after', jsonb_build_object(
      'absence_type', v_report.absence_type, 'start_date', v_report.start_date,
      'end_date', v_report.end_date, 'day_portion', v_report.day_portion
    ),
    'reason', v_reason
  ), p_actor_id);

  return v_report;
end;
$$;

-- Cancels an active report as recorded in error and records 'cancelled'.
-- Someone else's report needs a reason. Refusals: invalid_input, not_found,
-- not_authorized, report_not_active, reason_required. Returns the cancelled
-- report.
create function public.cancel_sickness_report(
  p_actor_id uuid,
  p_organization_id uuid,
  p_report_id uuid,
  p_reason text
)
returns public.sickness_reports
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.sickness_reports;
  v_report public.sickness_reports;
  v_own boolean;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_actor_id is null or p_organization_id is null or p_report_id is null then
    raise exception 'invalid_input';
  end if;

  v_previous := app_private.lock_sickness_report(p_organization_id, p_report_id);
  v_own := app_private.lock_sickness_actor(p_organization_id, p_actor_id, v_previous.employee_record_id, false);
  if v_previous.status <> 'reported' then raise exception 'report_not_active'; end if;
  if not v_own and v_reason is null then raise exception 'reason_required'; end if;

  update public.sickness_reports report
  set status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(), cancellation_reason = v_reason
  where report.organization_id = p_organization_id and report.id = p_report_id
  returning * into v_report;

  perform app_private.append_sickness_report_event(v_report, 'cancelled', jsonb_build_object(
    'start_date', v_previous.start_date, 'end_date', v_previous.end_date, 'reason', v_reason
  ), p_actor_id);

  return v_report;
end;
$$;

-- Sets whether an active report needs evidence and its state, by admin or
-- Büro, and records 'evidence_updated'. Refusals: invalid_input, not_found,
-- not_authorized, report_not_active, invalid_evidence_state. Returns the
-- saved report.
create function public.set_sickness_evidence(
  p_actor_id uuid,
  p_organization_id uuid,
  p_report_id uuid,
  p_evidence_required boolean,
  p_evidence_status text
)
returns public.sickness_reports
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.sickness_reports;
  v_report public.sickness_reports;
begin
  if p_actor_id is null or p_organization_id is null or p_report_id is null or p_evidence_required is null then
    raise exception 'invalid_input';
  end if;

  v_previous := app_private.lock_sickness_report(p_organization_id, p_report_id);
  perform app_private.lock_sickness_actor(p_organization_id, p_actor_id, v_previous.employee_record_id, true);
  if v_previous.status <> 'reported' then raise exception 'report_not_active'; end if;
  if p_evidence_status is null or p_evidence_status <> all (
    case when p_evidence_required then array['pending', 'received'] else array['not_required'] end
  ) then
    raise exception 'invalid_evidence_state';
  end if;

  update public.sickness_reports report
  set evidence_required = p_evidence_required, evidence_status = p_evidence_status
  where report.organization_id = p_organization_id and report.id = p_report_id
  returning * into v_report;

  perform app_private.append_sickness_report_event(v_report, 'evidence_updated', jsonb_build_object(
    'before', jsonb_build_object(
      'evidence_required', v_previous.evidence_required, 'evidence_status', v_previous.evidence_status
    ),
    'after', jsonb_build_object(
      'evidence_required', v_report.evidence_required, 'evidence_status', v_report.evidence_status
    )
  ), p_actor_id);

  return v_report;
end;
$$;

revoke all on function app_private.lock_sickness_actor(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function app_private.lock_sickness_report(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.append_sickness_report_event(public.sickness_reports, text, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_sickness_report(uuid, uuid, uuid, text, date, date, text, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.end_sickness_report(uuid, uuid, uuid, date)
  from public, anon, authenticated;
revoke all on function public.correct_sickness_report(uuid, uuid, uuid, text, date, date, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_sickness_report(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.set_sickness_evidence(uuid, uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.create_sickness_report(uuid, uuid, uuid, text, date, date, text, boolean, boolean)
  to service_role;
grant execute on function public.end_sickness_report(uuid, uuid, uuid, date) to service_role;
grant execute on function public.correct_sickness_report(uuid, uuid, uuid, text, date, date, text, text)
  to service_role;
grant execute on function public.cancel_sickness_report(uuid, uuid, uuid, text) to service_role;
grant execute on function public.set_sickness_evidence(uuid, uuid, uuid, boolean, text) to service_role;
