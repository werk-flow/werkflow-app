-- Requesting, withdrawing, deciding and cancelling a vacation request writes
-- the request and its history row together or not at all. The server actions
-- in lib/vacation/actions.ts wrote vacation_requests first and inserted the
-- vacation_request_events row in a second statement whose failure was only
-- logged, so a request could change status without its history row.
--
-- Division of work: the action establishes identity, the active membership,
-- the actor's own employee record and, for a decision or a cancellation, the
-- leave_approval responsibility for the target. It computes the day counts of
-- the request (preview and approved days by year) from the work schedule and
-- the holidays, and passes server-resolved values. Each function locks the
-- request and the actor's membership, repeats the ownership, self-approval
-- and status checks under those locks and raises the action failure code of
-- the first refusal, so nothing changes. The exclusion constraint
-- vacation_requests_no_active_overlap decides an overlapping request.
--
-- Signals stay as before: the request INSERT or UPDATE reaches the Realtime
-- publication of vacation_requests; vacation_request_events stays unpublished.

-- The actor is a member of the organization until commit: a removal waits for
-- this call or makes it refuse. Runs as the calling function's owner; no role
-- executes it directly.
create function app_private.lock_vacation_actor(p_organization_id uuid, p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_actor_id
  for share;
  if not found then raise exception 'not_a_member'; end if;
end;
$$;

-- The request of the organization, locked for its status change until commit.
create function app_private.lock_vacation_request(p_organization_id uuid, p_request_id uuid)
returns public.vacation_requests
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_request public.vacation_requests;
begin
  select * into v_request from public.vacation_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for no key update;
  if not found then raise exception 'request_not_found'; end if;
  return v_request;
end;
$$;

-- Stores the actor's own pending request with its 'requested' history row.
-- Refusals: invalid_input, not_a_member, no_employee_record, overlap_conflict.
-- Returns the new request.
create function public.create_vacation_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_employee_record_id uuid,
  p_start_date date,
  p_end_date date,
  p_day_portion text,
  p_comment text,
  p_preview_days_by_year jsonb
)
returns public.vacation_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.vacation_requests;
  v_comment text := nullif(btrim(p_comment), '');
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_employee_record_id is null
    or p_start_date is null or p_end_date is null or p_day_portion is null
  then raise exception 'invalid_input'; end if;
  perform app_private.lock_vacation_actor(p_organization_id, p_actor_id);
  perform 1 from public.employee_records record
  where record.organization_id = p_organization_id
    and record.id = p_employee_record_id
    and record.user_id = p_actor_id
  for key share;
  if not found then raise exception 'no_employee_record'; end if;

  begin
    insert into public.vacation_requests (
      organization_id, employee_record_id, requested_by, start_date, end_date, day_portion, status, comment
    ) values (
      p_organization_id, p_employee_record_id, p_actor_id, p_start_date, p_end_date, p_day_portion,
      'pending', v_comment
    )
    returning * into v_request;
  exception when exclusion_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'vacation_requests_no_active_overlap' then raise exception 'overlap_conflict'; end if;
    raise;
  end;

  insert into public.vacation_request_events (
    organization_id, vacation_request_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_request.id, p_employee_record_id, 'requested',
    jsonb_build_object(
      'start_date', v_request.start_date, 'end_date', v_request.end_date,
      'day_portion', v_request.day_portion, 'comment', v_comment,
      'preview_days_by_year', p_preview_days_by_year
    ),
    p_actor_id
  );

  return v_request;
end;
$$;

-- The requester withdraws a pending request and records 'withdrawn'.
-- Refusals: invalid_input, request_not_found, not_a_member, not_authorized,
-- request_not_pending. Returns the withdrawn request.
create function public.withdraw_vacation_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid
)
returns public.vacation_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.vacation_requests;
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null then
    raise exception 'invalid_input';
  end if;
  v_request := app_private.lock_vacation_request(p_organization_id, p_request_id);
  perform app_private.lock_vacation_actor(p_organization_id, p_actor_id);
  if not exists (
    select 1 from public.employee_records record
    where record.organization_id = p_organization_id
      and record.id = v_request.employee_record_id
      and record.user_id = p_actor_id
  ) then raise exception 'not_authorized'; end if;
  if v_request.status <> 'pending' then raise exception 'request_not_pending'; end if;

  update public.vacation_requests request
  set status = 'withdrawn'
  where request.organization_id = p_organization_id and request.id = p_request_id
  returning * into v_request;

  insert into public.vacation_request_events (
    organization_id, vacation_request_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, v_request.employee_record_id, 'withdrawn',
    jsonb_build_object('start_date', v_request.start_date, 'end_date', v_request.end_date),
    p_actor_id
  );

  return v_request;
end;
$$;

-- Approves or rejects a pending request and records 'approved' or 'rejected'.
-- An approval stores the approved days by year as the snapshot that a later
-- cancellation restores. Refusals: invalid_input, invalid_decision,
-- reason_required, request_not_found, not_a_member,
-- self_approval_not_allowed, request_not_pending. Returns the decided request.
create function public.decide_vacation_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_decision text,
  p_comment text,
  p_approved_days_by_year jsonb
)
returns public.vacation_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.vacation_requests;
  v_comment text := nullif(btrim(p_comment), '');
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null then
    raise exception 'invalid_input';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then raise exception 'invalid_decision'; end if;
  if p_decision = 'reject' and v_comment is null then raise exception 'reason_required'; end if;
  if p_decision = 'approve' and jsonb_typeof(p_approved_days_by_year) is distinct from 'object' then
    raise exception 'invalid_input';
  end if;

  v_request := app_private.lock_vacation_request(p_organization_id, p_request_id);
  perform app_private.lock_vacation_actor(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.employee_records record
    where record.id = v_request.employee_record_id and record.user_id = p_actor_id
  ) then raise exception 'self_approval_not_allowed'; end if;
  if v_request.status <> 'pending' then raise exception 'request_not_pending'; end if;

  update public.vacation_requests request
  set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
      decided_by = p_actor_id,
      decided_at = now(),
      decision_comment = v_comment,
      approved_days_by_year = case p_decision
        when 'approve' then p_approved_days_by_year else request.approved_days_by_year end
  where request.organization_id = p_organization_id and request.id = p_request_id
  returning * into v_request;

  insert into public.vacation_request_events (
    organization_id, vacation_request_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, v_request.employee_record_id,
    case p_decision when 'approve' then 'approved' else 'rejected' end,
    jsonb_build_object(
      'start_date', v_request.start_date, 'end_date', v_request.end_date,
      'day_portion', v_request.day_portion, 'decision_comment', v_comment
    ) || case p_decision
      when 'approve' then jsonb_build_object('approved_days_by_year', p_approved_days_by_year)
      else '{}'::jsonb
    end,
    p_actor_id
  );

  return v_request;
end;
$$;

-- Cancels an approved request with the reason and records 'cancelled' with the
-- approved days it restores. Refusals: invalid_input, reason_required,
-- request_not_found, not_a_member, self_approval_not_allowed,
-- request_not_approved. Returns the cancelled request.
create function public.cancel_approved_vacation_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_reason text
)
returns public.vacation_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.vacation_requests;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null then
    raise exception 'invalid_input';
  end if;
  if v_reason is null then raise exception 'reason_required'; end if;

  v_request := app_private.lock_vacation_request(p_organization_id, p_request_id);
  perform app_private.lock_vacation_actor(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.employee_records record
    where record.id = v_request.employee_record_id and record.user_id = p_actor_id
  ) then raise exception 'self_approval_not_allowed'; end if;
  if v_request.status <> 'approved' then raise exception 'request_not_approved'; end if;

  update public.vacation_requests request
  set status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(), cancellation_reason = v_reason
  where request.organization_id = p_organization_id and request.id = p_request_id
  returning * into v_request;

  insert into public.vacation_request_events (
    organization_id, vacation_request_id, employee_record_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, v_request.employee_record_id, 'cancelled',
    jsonb_build_object(
      'start_date', v_request.start_date, 'end_date', v_request.end_date,
      'cancellation_reason', v_reason, 'restored_days_by_year', v_request.approved_days_by_year
    ),
    p_actor_id
  );

  return v_request;
end;
$$;

revoke all on function app_private.lock_vacation_actor(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.lock_vacation_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_vacation_request(uuid, uuid, uuid, date, date, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.withdraw_vacation_request(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.decide_vacation_request(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.cancel_approved_vacation_request(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_vacation_request(uuid, uuid, uuid, date, date, text, text, jsonb)
  to service_role;
grant execute on function public.withdraw_vacation_request(uuid, uuid, uuid) to service_role;
grant execute on function public.decide_vacation_request(uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.cancel_approved_vacation_request(uuid, uuid, uuid, text) to service_role;
