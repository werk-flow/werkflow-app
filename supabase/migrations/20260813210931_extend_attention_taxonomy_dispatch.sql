-- P1-12 attention taxonomy: dispatch acknowledgement (employee task, state
-- version = current revision id), open dispatch challenge (manager task), and
-- overdue parked-job review (manager task). Items stay derived; only the
-- CHECK vocabularies and the org-validation trigger grow.

alter table attention_read_states drop constraint attention_read_states_source_type_check;
alter table attention_read_states add constraint attention_read_states_source_type_check
  check (source_type = any (array[
    'time_session_approval', 'time_change_request_approval',
    'vacation_request_approval', 'client_request_open', 'vacation_decision',
    'sickness_report', 'employee_certification_expiry', 'client_follow_up',
    'dispatch_acknowledgement', 'dispatch_challenge_open', 'job_parking_review'
  ]::text[]));

alter table attention_events drop constraint attention_events_source_type_check;
alter table attention_events add constraint attention_events_source_type_check
  check (source_type = any (array[
    'time_session_approval', 'time_change_request_approval',
    'vacation_request_approval', 'client_request_open', 'vacation_decision',
    'sickness_report', 'employee_certification_expiry', 'client_follow_up',
    'dispatch_acknowledgement', 'dispatch_challenge_open', 'job_parking_review'
  ]::text[]));

create or replace function app_private.validate_attention_source_org()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (
    select 1 from public.organization_members m
    where m.organization_id=new.organization_id and m.user_id=new.user_id
  ) then raise exception 'attention state user is not a member of the organization'; end if;

  if new.source_type in ('vacation_decision','vacation_request_approval') then
    if not exists (select 1 from public.vacation_requests vr where vr.id=new.source_id and vr.organization_id=new.organization_id)
      then raise exception 'attention source vacation request organization mismatch'; end if;
  elsif new.source_type='sickness_report' then
    if not exists (select 1 from public.sickness_reports sr where sr.id=new.source_id and sr.organization_id=new.organization_id)
      then raise exception 'attention source sickness report organization mismatch'; end if;
  elsif new.source_type='employee_certification_expiry' then
    if not exists (
      select 1 from public.employee_capabilities ec
      where ec.id=new.source_id and ec.organization_id=new.organization_id and ec.capability_kind='certification'
    ) then raise exception 'attention source employee certification organization mismatch'; end if;
  elsif new.source_type='client_request_open' then
    if not exists (select 1 from public.client_requests cr where cr.id=new.source_id and cr.organization_id=new.organization_id)
      then raise exception 'attention source client request organization mismatch'; end if;
  elsif new.source_type='client_follow_up' then
    if not exists (select 1 from public.client_follow_ups f where f.id=new.source_id and f.organization_id=new.organization_id)
      then raise exception 'attention source client follow-up organization mismatch'; end if;
  elsif new.source_type='time_session_approval' then
    if not exists (select 1 from public.time_entries te where te.id=new.source_id and te.organization_id=new.organization_id)
      then raise exception 'attention source time entry organization mismatch'; end if;
  elsif new.source_type='time_change_request_approval' then
    if not exists (select 1 from public.entry_change_requests ecr where ecr.id=new.source_id and ecr.organization_id=new.organization_id)
      then raise exception 'attention source change request organization mismatch'; end if;
  elsif new.source_type in ('dispatch_acknowledgement','dispatch_challenge_open') then
    if not exists (select 1 from public.planning_dispatches d where d.id=new.source_id and d.organization_id=new.organization_id)
      then raise exception 'attention source dispatch organization mismatch'; end if;
  elsif new.source_type='job_parking_review' then
    if not exists (select 1 from public.jobs j where j.id=new.source_id and j.organization_id=new.organization_id)
      then raise exception 'attention source job organization mismatch'; end if;
  end if;
  return new;
end;
$$;