-- Time-account decisions follow the same approval rule as the server code.
--
-- 1. A person never decides an adjustment request they proposed.
-- 2. can_p1_23_approve_employee applies the holder scope of
--    lib/responsibilities/resolution.ts (resolveEffectiveResponsibility and
--    canHolderApproveTarget): a holder through a direct assignment or an
--    Admin role default decides for everyone but themselves; a Büro role
--    default decides only for a person whose role is `employee`. A substitute
--    inherits the scope of the holder they stand in for.
--
-- A person without a login holds no role and counts as an employee. A person
-- with a login but no current membership has no known role, so only an
-- Admin source or a direct assignment reaches them.
--
-- Signatures, results and grants stay as before; the decisions only refuse
-- more.
--
-- 3. The proposer withdraws their own open request instead. A withdrawal is
--    not a decision: it has its own status and event type, so the history
--    never shows a proposer deciding their own request.

-- The source of the actor's effective time-approval responsibility today:
-- 'direct', 'admin' or 'buero', or null when the actor holds none or has no
-- effective access. Mirrors resolveEffectiveResponsibility: an active member is a member whose
-- personnel record has no exit before tomorrow; the newest configuration in
-- effect names the base holders, otherwise every active Admin and Büro member
-- is one; a substitute without a base source inherits the base source of the
-- first effective delegation, ordered as the server orders them.
create or replace function app_private.p1_23_time_approval_source(
  p_organization_id uuid, p_actor_id uuid
)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  business_date date := (current_timestamp at time zone 'Europe/Berlin')::date;
  latest_configuration_id uuid;
  actor_record_id uuid;
  actor_source text;
begin
  -- A suspended or ended person holds nothing (security.md, "Revocation boundaries").
  if not app_private.p1_24_has_effective_access(p_organization_id, p_actor_id) then
    return null;
  end if;

  select employee.id into actor_record_id
  from public.employee_records employee
  join public.organization_members member
    on member.organization_id = employee.organization_id and member.user_id = employee.user_id
  where employee.organization_id = p_organization_id and employee.user_id = p_actor_id
    and (employee.exit_date is null or employee.exit_date > business_date);
  if actor_record_id is null then return null; end if;

  select configuration.id into latest_configuration_id
  from public.organization_responsibility_configurations configuration
  where configuration.organization_id = p_organization_id
    and configuration.responsibility = 'time_approval'
    and configuration.effective_from <= current_timestamp
  order by configuration.effective_from desc, configuration.created_at desc, configuration.id desc
  limit 1;

  -- The base source of every active member of the organization.
  with active_member as (
    select employee.id as record_id, member.role
    from public.employee_records employee
    join public.organization_members member
      on member.organization_id = employee.organization_id and member.user_id = employee.user_id
    where employee.organization_id = p_organization_id
      and (employee.exit_date is null or employee.exit_date > business_date)
  ),
  base_source as (
    select active_member.record_id,
      case
        when latest_configuration_id is null then
          case when active_member.role in ('admin', 'buero') then active_member.role::text end
        when assignment.source = 'direct' then 'direct'
        when assignment.source = 'role_default' then assignment.role_snapshot::text
      end as source
    from active_member
    left join public.organization_responsibility_assignments assignment
      on assignment.configuration_id = latest_configuration_id
     and assignment.employee_record_id = active_member.record_id
  ),
  own_source as (
    select base_source.source from base_source
    where base_source.record_id = actor_record_id and base_source.source is not null
  ),
  inherited_source as (
    select base_source.source
    from public.organization_responsibility_delegations delegation
    join base_source
      on base_source.record_id = delegation.delegator_employee_record_id
     and base_source.source is not null
    where delegation.organization_id = p_organization_id
      and delegation.responsibility = 'time_approval'
      and delegation.substitute_employee_record_id = actor_record_id
      and delegation.valid_from <= business_date and delegation.valid_until >= business_date
      and (delegation.revoked_from is null or delegation.revoked_from > business_date)
    order by delegation.valid_from desc, delegation.valid_until asc, delegation.id asc
    limit 1
  )
  select coalesce((select source from own_source), (select source from inherited_source))
  into actor_source;
  return actor_source;
end;
$$;

create or replace function app_private.can_p1_23_approve_employee(
  p_organization_id uuid, p_actor_id uuid, p_employee_record_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.employee_records employee
    left join public.organization_members member
      on member.organization_id = employee.organization_id and member.user_id = employee.user_id
    cross join lateral (
      select app_private.p1_23_time_approval_source(p_organization_id, p_actor_id) as kind
    ) source
    where employee.id = p_employee_record_id and employee.organization_id = p_organization_id
      and source.kind is not null
      and employee.user_id is distinct from p_actor_id
      and (
        source.kind in ('direct', 'admin')
        or (employee.user_id is null or member.role = 'employee')
      )
  );
$$;

revoke all on function app_private.p1_23_time_approval_source(uuid, uuid) from public, anon, authenticated;

create or replace function public.decide_time_account_adjustment(
  p_organization_id uuid,
  p_request_id uuid,
  p_expected_version bigint,
  p_decision public.time_period_finding_decision,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_record public.time_account_adjustment_requests;
  prior_event_id uuid;
  event_kind public.time_account_event_kind;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':adjustment:' || p_request_id::text, 0
  ));
  select request_id into prior_event_id
  from public.time_account_adjustment_events
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then return prior_event_id; end if;
  select * into request_record from public.time_account_adjustment_requests
  where id = p_request_id and organization_id = p_organization_id for update;
  if request_record.id is null then raise exception 'request_not_found'; end if;
  if request_record.version <> p_expected_version then raise exception 'stale_version'; end if;
  if request_record.status <> 'submitted' then raise exception 'request_not_pending'; end if;
  if p_decision not in ('approved', 'rejected') then raise exception 'invalid_decision'; end if;
  if request_record.requested_by = p_actor_id then raise exception 'own_proposal'; end if;
  if not app_private.can_p1_23_approve_employee(
    p_organization_id, p_actor_id, request_record.employee_record_id
  ) then raise exception 'not_responsible_or_self_approval'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  update public.time_account_adjustment_requests set
    status = case when p_decision = 'approved'
      then 'approved'::public.time_account_request_status
      else 'rejected'::public.time_account_request_status end,
    version = version + 1,
    decided_by = p_actor_id,
    decision_reason = p_reason,
    decided_at = clock_timestamp()
  where id = p_request_id;
  insert into public.time_account_adjustment_events(
    organization_id, request_id, event_type, actor_id, operation_id, reason,
    responsibility_snapshot
  ) values (
    p_organization_id, p_request_id, p_decision::text, p_actor_id,
    p_operation_id, p_reason,
    jsonb_build_object('responsibility', 'time_approval', 'actorId', p_actor_id)
  );
  if p_decision = 'approved' then
    event_kind := request_record.adjustment_kind::text::public.time_account_event_kind;
    perform app_private.assert_p1_23_period_open(
      p_organization_id, request_record.effective_date
    );
    insert into public.time_account_events(
      organization_id, account_id, employee_record_id, event_kind,
      effective_date, minutes, reason, adjustment_request_id, operation_id,
      request_hash, created_by
    ) values (
      p_organization_id, request_record.account_id,
      request_record.employee_record_id, event_kind,
      request_record.effective_date, request_record.minutes,
      request_record.reason, request_record.id, gen_random_uuid(),
      request_record.request_hash, p_actor_id
    );
    update public.time_accounts set
      current_balance_minutes = current_balance_minutes + request_record.minutes,
      version = version + 1,
      updated_at = now()
    where id = request_record.account_id;
  end if;
  return p_request_id;
end;
$$;

alter type public.time_account_request_status add value if not exists 'withdrawn';

-- @destructive: after release 52803322d588: widens the event types by withdrawn; that build writes only the types the new rule keeps
alter table public.time_account_adjustment_events
  drop constraint time_account_adjustment_events_event_type_check,
  add constraint time_account_adjustment_events_event_type_check
    check (event_type in ('submitted', 'approved', 'rejected', 'superseded', 'withdrawn'));

-- The proposer, still an Admin or Büro member, closes their own open request
-- without a decision. A replay of the same operation returns the request.
create or replace function public.withdraw_time_account_adjustment(
  p_organization_id uuid,
  p_request_id uuid,
  p_expected_version bigint,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  request_record public.time_account_adjustment_requests;
  prior_request_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':adjustment:' || p_request_id::text, 0
  ));
  select request_id into prior_request_id
  from public.time_account_adjustment_events
  where organization_id = p_organization_id and operation_id = p_operation_id;
  if found then return prior_request_id; end if;
  if not app_private.is_p1_23_org_manager(p_organization_id, p_actor_id) then
    raise exception 'not_authorized';
  end if;
  select * into request_record from public.time_account_adjustment_requests
  where id = p_request_id and organization_id = p_organization_id for update;
  if request_record.id is null then raise exception 'request_not_found'; end if;
  if request_record.requested_by <> p_actor_id then raise exception 'not_proposer'; end if;
  if request_record.version <> p_expected_version then raise exception 'stale_version'; end if;
  if request_record.status <> 'submitted' then raise exception 'request_not_pending'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  update public.time_account_adjustment_requests set
    status = 'withdrawn',
    version = version + 1,
    decided_by = p_actor_id,
    decision_reason = p_reason,
    decided_at = clock_timestamp()
  where id = p_request_id;
  insert into public.time_account_adjustment_events(
    organization_id, request_id, event_type, actor_id, operation_id, reason
  ) values (
    p_organization_id, p_request_id, 'withdrawn', p_actor_id, p_operation_id, p_reason
  );
  return p_request_id;
end;
$$;

revoke all on function public.withdraw_time_account_adjustment(uuid, uuid, bigint, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.withdraw_time_account_adjustment(uuid, uuid, bigint, text, uuid, uuid)
  to service_role;
