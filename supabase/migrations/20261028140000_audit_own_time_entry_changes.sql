-- Own time entries (owner decision 2026-10-27). A Büro member changes their
-- own recorded time only through a Zeitkorrektur with a second approver. An
-- Admin may still edit or delete their own entries directly, and every such
-- change leaves an audit event: who, when, the entry before and after. The
-- Verlauf tab of Zeiterfassung shows the events to Admin and Büro.
--
-- Division of work as in 20261003110000: the server action establishes
-- identity, the active membership and the caller's right over the entry's
-- person. The functions below refuse an own entry for every actor but an
-- Admin, and write the audit event in the same transaction as the change.

-- Append-only: service_role inserts and reads, nobody updates or deletes a
-- row; the organization's deletion removes its events by cascade.
create table public.time_entry_audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- No foreign key: the event of a deletion outlives its entry.
  entry_id uuid not null,
  -- The Admin who changed their own entry.
  actor_id uuid not null,
  action text not null check (action in ('edit', 'delete')),
  -- The recorded time before the change, which the Verlauf range filters by.
  entry_timestamp timestamptz not null,
  before_entry jsonb not null,
  after_entry jsonb,
  created_at timestamptz not null default now(),
  constraint time_entry_audit_events_after_matches_action check ((action = 'delete') = (after_entry is null))
);

create index time_entry_audit_events_organization_timestamp_idx
  on public.time_entry_audit_events (organization_id, entry_timestamp);

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.time_entry_audit_events enable row level security;

revoke all on table public.time_entry_audit_events from public, anon, authenticated, service_role;
grant select, insert on table public.time_entry_audit_events to service_role;

-- Applies the changed fields of one entry: the keys timestamp, entry_type and
-- job_id that p_changes carries; a missing key keeps the stored value. An own
-- entry changes only for an Admin and records an audit event when its state
-- changed. Refusals: entry_not_found, not_authorized; a closed period raises
-- WFP01 'period_closed'. Returns the changed entry.
create function public.update_time_entry(
  p_actor_id uuid,
  p_organization_id uuid,
  p_entry_id uuid,
  p_changes jsonb
)
returns public.time_entries
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_before public.time_entries;
  v_after public.time_entries;
  v_before_state jsonb;
  v_after_state jsonb;
begin
  select * into v_before from public.time_entries entry
  where entry.organization_id = p_organization_id and entry.id = p_entry_id
  for update;
  if not found then
    raise exception 'entry_not_found';
  end if;
  if v_before.user_id = p_actor_id and not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
      and member.role = 'admin'
  ) then
    raise exception 'not_authorized';
  end if;

  update public.time_entries entry
  set
    timestamp = case when p_changes ? 'timestamp'
      then (p_changes ->> 'timestamp')::timestamptz else entry.timestamp end,
    entry_type = case when p_changes ? 'entry_type'
      then p_changes ->> 'entry_type' else entry.entry_type end,
    job_id = case when p_changes ? 'job_id'
      then (p_changes ->> 'job_id')::uuid else entry.job_id end
  where entry.id = p_entry_id
  returning * into v_after;

  if v_before.user_id = p_actor_id then
    v_before_state := jsonb_build_object('entry_type', v_before.entry_type,
      'timestamp', v_before.timestamp, 'job_id', v_before.job_id, 'status', v_before.status);
    v_after_state := jsonb_build_object('entry_type', v_after.entry_type,
      'timestamp', v_after.timestamp, 'job_id', v_after.job_id, 'status', v_after.status);
    if v_before_state is distinct from v_after_state then
      insert into public.time_entry_audit_events (
        organization_id, entry_id, actor_id, action, entry_timestamp, before_entry, after_entry
      ) values (
        p_organization_id, p_entry_id, p_actor_id, 'edit', v_before.timestamp, v_before_state, v_after_state
      );
    end if;
  end if;
  return v_after;
end;
$$;

revoke all on function public.update_time_entry(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_time_entry(uuid, uuid, uuid, jsonb) to service_role;

-- 20261003110000's deletion, which now also refuses an own entry for every
-- actor but an Admin and records an audit event for each own entry it deletes.
-- Refusals: invalid_input, entry_not_found, not_a_member, target_not_found,
-- not_authorized; a closed period raises WFP01 'period_closed'. Returns the
-- number of deleted entries.
create or replace function public.delete_time_entries(
  p_actor_id uuid,
  p_organization_id uuid,
  p_entry_ids uuid[],
  p_authorized_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_deleted integer;
begin
  perform app_private.lock_time_entry_batch(p_actor_id, p_organization_id, p_entry_ids);
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and entry.user_id <> all (coalesce(p_authorized_user_ids, '{}'))
  ) then
    raise exception 'not_authorized';
  end if;
  if exists (
    select 1 from public.time_entries entry
    where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
      and entry.user_id = p_actor_id
  ) and not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_actor_id
      and member.role = 'admin'
  ) then
    raise exception 'not_authorized';
  end if;

  insert into public.time_entry_audit_events (
    organization_id, entry_id, actor_id, action, entry_timestamp, before_entry
  )
  select p_organization_id, entry.id, p_actor_id, 'delete', entry.timestamp,
    jsonb_build_object('entry_type', entry.entry_type, 'timestamp', entry.timestamp,
      'job_id', entry.job_id, 'status', entry.status)
  from public.time_entries entry
  where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids)
    and entry.user_id = p_actor_id;

  delete from public.time_entries entry
  where entry.organization_id = p_organization_id and entry.id = any(p_entry_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
