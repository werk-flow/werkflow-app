-- dispatch_challenge_open items are identified by the challenge
-- (acknowledgement) row so concurrent challenges on one dispatch stay
-- distinct; the org-validation mapping follows that identity.

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
  elsif new.source_type='dispatch_acknowledgement' then
    if not exists (select 1 from public.planning_dispatches d where d.id=new.source_id and d.organization_id=new.organization_id)
      then raise exception 'attention source dispatch organization mismatch'; end if;
  elsif new.source_type='dispatch_challenge_open' then
    if not exists (
      select 1 from public.planning_dispatch_acknowledgements a
      where a.id=new.source_id and a.organization_id=new.organization_id and a.state='challenged'
    ) then raise exception 'attention source dispatch challenge organization mismatch'; end if;
  elsif new.source_type='job_parking_review' then
    if not exists (select 1 from public.jobs j where j.id=new.source_id and j.organization_id=new.organization_id)
      then raise exception 'attention source job organization mismatch'; end if;
  end if;
  return new;
end;
$$;