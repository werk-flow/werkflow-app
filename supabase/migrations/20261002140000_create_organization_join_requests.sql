-- Joining an organization by its code creates a request, not a membership
-- (owner decision 2026-10-02, docs/features/employee-management.md). An Admin
-- or Büro user of that organization approves or declines it; only the approval
-- creates the membership. Invite links stay immediate.
--
-- The server writes every row through the service role
-- (lib/org/join-request-actions.ts). Client roles only read: the requester
-- sees their own requests, Admin and Büro see the requests of their
-- organization. That read is what Realtime delivers to the waiting requester
-- and to the approvers.
create table public.organization_join_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  -- The approver or decliner. No foreign key: the decision stays on record
  -- when that account is deleted later.
  decided_by uuid,
  constraint organization_join_requests_status_check
    check (status in ('pending', 'approved', 'declined', 'withdrawn')),
  constraint organization_join_requests_decided_at_check
    check ((status = 'pending') = (decided_at is null)),
  constraint organization_join_requests_decided_by_check
    check (status not in ('approved', 'declined') or decided_by is not null)
);

-- One open request per person at a time.
create unique index organization_join_requests_one_pending_per_user_idx
  on public.organization_join_requests (user_id) where status = 'pending';
create index organization_join_requests_pending_by_organization_idx
  on public.organization_join_requests (organization_id, requested_at) where status = 'pending';
create index organization_join_requests_user_requested_at_idx
  on public.organization_join_requests (user_id, requested_at desc);

-- The state machine: pending -> approved | declined | withdrawn, and a closed
-- request never changes again. Only the decision columns move.
create function app_private.guard_organization_join_request_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'join_request_not_pending';
  end if;
  if new.status not in ('approved', 'declined', 'withdrawn')
    or new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
    or new.requested_at is distinct from old.requested_at
  then
    raise exception 'join_request_invalid_transition';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_organization_join_request_transition() from public, anon, authenticated;

create trigger organization_join_requests_guard_transition
  before update on public.organization_join_requests
  for each row execute function app_private.guard_organization_join_request_transition();

alter table public.organization_join_requests enable row level security;

create policy organization_join_requests_select_own on public.organization_join_requests
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy organization_join_requests_select_approvers on public.organization_join_requests
  for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));

revoke all on table public.organization_join_requests from public, anon, authenticated, service_role;
grant select on table public.organization_join_requests to authenticated;
grant select, insert, update on table public.organization_join_requests to service_role;

-- Realtime (docs/technical/realtime-and-caching.md, "Adding new Realtime data"):
-- the waiting requester enters the app when the approval lands, and the
-- approvers' lists update without a reload.
create unique index organization_join_requests_replident_idx
  on public.organization_join_requests (id, organization_id);
alter table public.organization_join_requests
  replica identity using index organization_join_requests_replident_idx;
create trigger emit_realtime_deletion
  after delete on public.organization_join_requests
  for each row execute function app_private.emit_realtime_deletion();
alter publication supabase_realtime add table public.organization_join_requests;

-- The approval in one transaction: lock the open request, check that the
-- approver is Admin or Büro of its organization and that the requester's other
-- organizations share its owner, create the employee membership, and close the
-- request. The membership insert runs the same triggers as every other join
-- (personnel record, role-default responsibilities). Returns the requester.
create function public.approve_organization_join_request(
  p_request_id uuid,
  p_organization_id uuid,
  p_approver_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.organization_join_requests%rowtype;
  v_owner_id uuid;
begin
  select * into v_request
  from public.organization_join_requests
  where id = p_request_id and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'join_request_not_found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'join_request_not_pending';
  end if;
  if p_organization_id not in (select app_private.get_user_admin_or_manager_org_ids(p_approver_id)) then
    raise exception 'not_authorized';
  end if;

  select admin_id into v_owner_id from public.organizations where id = p_organization_id;
  if exists (
    select 1
    from public.organization_members member
    join public.organizations organization on organization.id = member.organization_id
    where member.user_id = v_request.user_id and organization.admin_id <> v_owner_id
  ) then
    raise exception 'admin_mismatch';
  end if;

  insert into public.organization_members (user_id, organization_id, role)
  values (v_request.user_id, p_organization_id, 'employee')
  on conflict (user_id, organization_id) do nothing;

  update public.organization_join_requests
  set status = 'approved', decided_at = now(), decided_by = p_approver_id
  where id = p_request_id;

  return v_request.user_id;
end;
$$;
revoke all on function public.approve_organization_join_request(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.approve_organization_join_request(uuid, uuid, uuid) to service_role;

-- The attention identity union in lib/attention/types.ts and these checks stay
-- in step (the Aufgaben item for an open join request).
alter table public.attention_read_states
  drop constraint attention_read_states_source_type_check;
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request'
    ])
  );
alter table public.attention_events
  drop constraint attention_events_source_type_check;
alter table public.attention_events
  add constraint attention_events_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request'
    ])
  );
