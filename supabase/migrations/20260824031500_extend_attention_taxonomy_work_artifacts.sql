alter table public.attention_read_states
  drop constraint if exists attention_read_states_source_type_check;
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'vacation_request_approval', 'client_request_open', 'vacation_decision',
      'sickness_report', 'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review',
      'work_artifact_review', 'work_artifact_correction', 'work_defect_due'
    ]::text[])
  );

alter table public.attention_events
  drop constraint if exists attention_events_source_type_check;
alter table public.attention_events
  add constraint attention_events_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'vacation_request_approval', 'client_request_open', 'vacation_decision',
      'sickness_report', 'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review',
      'work_artifact_review', 'work_artifact_correction', 'work_defect_due'
    ]::text[])
  );

create or replace function app_private.validate_attention_source_org()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = new.organization_id and member.user_id = new.user_id
  ) then raise exception 'attention state user is not a member of the organization'; end if;

  if new.source_type in ('vacation_decision', 'vacation_request_approval') then
    if not exists (select 1 from public.vacation_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source vacation request organization mismatch'; end if;
  elsif new.source_type = 'sickness_report' then
    if not exists (select 1 from public.sickness_reports report where report.id = new.source_id and report.organization_id = new.organization_id)
      then raise exception 'attention source sickness report organization mismatch'; end if;
  elsif new.source_type = 'employee_certification_expiry' then
    if not exists (select 1 from public.employee_capabilities capability where capability.id = new.source_id and capability.organization_id = new.organization_id and capability.capability_kind = 'certification')
      then raise exception 'attention source employee certification organization mismatch'; end if;
  elsif new.source_type = 'client_request_open' then
    if not exists (select 1 from public.client_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source client request organization mismatch'; end if;
  elsif new.source_type = 'client_follow_up' then
    if not exists (select 1 from public.client_follow_ups follow_up where follow_up.id = new.source_id and follow_up.organization_id = new.organization_id)
      then raise exception 'attention source client follow-up organization mismatch'; end if;
  elsif new.source_type = 'time_session_approval' then
    if not exists (select 1 from public.time_entries entry where entry.id = new.source_id and entry.organization_id = new.organization_id)
      then raise exception 'attention source time entry organization mismatch'; end if;
  elsif new.source_type = 'time_change_request_approval' then
    if not exists (select 1 from public.entry_change_requests request where request.id = new.source_id and request.organization_id = new.organization_id)
      then raise exception 'attention source change request organization mismatch'; end if;
  elsif new.source_type = 'dispatch_acknowledgement' then
    if not exists (select 1 from public.planning_dispatches dispatch where dispatch.id = new.source_id and dispatch.organization_id = new.organization_id)
      then raise exception 'attention source dispatch organization mismatch'; end if;
  elsif new.source_type = 'dispatch_challenge_open' then
    if not exists (select 1 from public.planning_dispatch_acknowledgements acknowledgement where acknowledgement.id = new.source_id and acknowledgement.organization_id = new.organization_id and acknowledgement.state = 'challenged')
      then raise exception 'attention source dispatch challenge organization mismatch'; end if;
  elsif new.source_type = 'job_parking_review' then
    if not exists (select 1 from public.jobs job where job.id = new.source_id and job.organization_id = new.organization_id)
      then raise exception 'attention source job organization mismatch'; end if;
  elsif new.source_type = 'work_blocker_review' then
    if not exists (select 1 from public.work_blockers blocker where blocker.id = new.source_id and blocker.organization_id = new.organization_id)
      then raise exception 'attention source work blocker organization mismatch'; end if;
  elsif new.source_type in ('work_artifact_review', 'work_artifact_correction', 'work_defect_due') then
    if not exists (select 1 from public.work_artifacts artifact where artifact.id = new.source_id and artifact.organization_id = new.organization_id)
      then raise exception 'attention source work artifact organization mismatch'; end if;
  end if;
  return new;
end;
$$;

revoke all on function app_private.validate_attention_source_org()
from public, anon, authenticated;
grant execute on function app_private.validate_attention_source_org()
to postgres, service_role;
