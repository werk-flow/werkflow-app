-- A pending manual submission is a proposal that waits for an approver. Its
-- author may take it back before the decision: the entries leave the time
-- record, and a withdrawal event keeps who withdrew which entry, when, and the
-- entry as it was submitted. Nothing that an approver decided changes.
--
-- Division of work as in 20261028140000: the server action establishes
-- identity and the active membership, and names the submission's entries. The
-- function below locks them, refuses every entry that is not the actor's own
-- pending manual entry, and records the withdrawal in the same transaction as
-- the removal. The closed-period trigger on time_entries still refuses a day
-- of a closed period.

-- Append-only: service_role inserts and reads. The event-history guard
-- (20260907010100) refuses an update or delete for every role, the table
-- owner included; the organization's deletion still removes its events by
-- cascade. A separate ledger from time_entry_audit_events, which records the
-- Admins' own direct changes that the Verlauf shows to Admin and Büro.
create table public.time_entry_withdrawals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- No foreign key: the event outlives its entry.
  entry_id uuid not null,
  -- The author of the submission, who withdrew it.
  actor_id uuid not null,
  entry_timestamp timestamptz not null,
  withdrawn_entry jsonb not null,
  created_at timestamptz not null default now()
);

create index time_entry_withdrawals_organization_timestamp_idx
  on public.time_entry_withdrawals (organization_id, entry_timestamp);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.time_entry_withdrawals enable row level security;

revoke all on table public.time_entry_withdrawals from public, anon, authenticated, service_role;
grant select, insert on table public.time_entry_withdrawals to service_role;

create trigger guard_event_ledger_history before update or delete on public.time_entry_withdrawals
  for each row execute function app_private.guard_event_ledger_history();

-- Withdraws the actor's own pending manual entries: all of them or none.
-- Refusals: invalid_input, entry_not_found, not_a_member, target_not_found
-- (from the batch lock), not_authorized for an entry of another person,
-- entry_not_pending for a decided or a clocked entry; a closed period raises
-- WFP01 'period_closed'. Returns the number of withdrawn entries.
create function public.withdraw_pending_time_entries(
  p_actor_id uuid,
  p_organization_id uuid,
  p_entry_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_withdrawn integer;
begin
  perform app_private.lock_time_entry_batch(p_actor_id, p_organization_id, p_entry_ids);
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and entry.user_id <> p_actor_id
  ) then
    raise exception 'not_authorized';
  end if;
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and (entry.status <> 'pending' or not entry.is_manual)
  ) then
    raise exception 'entry_not_pending';
  end if;

  insert into public.time_entry_withdrawals (
    organization_id, entry_id, actor_id, entry_timestamp, withdrawn_entry
  )
  select p_organization_id, entry.id, p_actor_id, entry.timestamp,
    jsonb_build_object('entry_type', entry.entry_type, 'timestamp', entry.timestamp,
      'job_id', entry.job_id, 'created_at', entry.created_at)
  from public.time_entries entry
  where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids);

  delete from public.time_entries entry
  where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids);
  get diagnostics v_withdrawn = row_count;
  return v_withdrawn;
end;
$$;

revoke all on function public.withdraw_pending_time_entries(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.withdraw_pending_time_entries(uuid, uuid, uuid[]) to service_role;
