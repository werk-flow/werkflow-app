-- Bereitschaft (werk-flow/werkflow-planning#469): the office plans who is on
-- call when, hands the duty over with a note, and every member sees who is on
-- call now. A shift books no time and changes no Zeitkonto; how standby time
-- counts stays with time tracking.
--
-- 1. on_call_shifts: one row per shift with its start, end, optional label
--    (for example „Heizung“), handover note and version. A shift that never
--    started is cancelled, not deleted; one that runs is ended by moving its
--    end to now. on_call_shift_members names the people of the shift.
-- 2. on_call_shift_events: the append-only history. Every write adds one row
--    per changed shift with the whole state after it, so the earlier version
--    of a shift changed after its start stays readable.
-- 3. Admin and Büro write through the four functions below; each locks the
--    shift, repeats the checks and writes its history in the same call. A
--    handover ends the running shift now and starts the next in one call.
--    Another shift with the same label in the same time is a confirmation,
--    not a refusal: the call names p_confirm_overlap.
-- 4. Every member of the organization reads the shifts and their people
--    through the Data API, without who planned or changed them; the history
--    stays with the server. read_on_call_shifts hands the server the shifts
--    of a window with names and phone numbers, and for the office the
--    history and the people it may plan.
--
-- Expand-only: new objects that the previous release never reads.
--
-- Prevention: Tier 1 (constraints, history guard, function checks, grants),
-- Tier 2 supabase/tests/on_call_shifts.sql.

-- 1. Shifts and their people.
create table public.on_call_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text,
  handover_note text not null default '',
  cancelled_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  -- Null once the person's account is deleted: the shift stays.
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint on_call_shifts_range_check check (ends_at > starts_at),
  constraint on_call_shifts_label_check check (
    label is null or (label = btrim(label) and char_length(label) between 1 and 60)
  ),
  constraint on_call_shifts_note_check check (char_length(handover_note) <= 2000)
);

create unique index on_call_shifts_replident_idx on public.on_call_shifts (id, organization_id);
create index on_call_shifts_window_idx on public.on_call_shifts (organization_id, ends_at, starts_at);
create index on_call_shifts_created_by_fk_idx on public.on_call_shifts (created_by);
create index on_call_shifts_updated_by_fk_idx on public.on_call_shifts (updated_by);

create table public.on_call_shift_members (
  shift_id uuid not null,
  organization_id uuid not null,
  employee_record_id uuid not null,
  primary key (shift_id, employee_record_id),
  constraint on_call_shift_members_shift_fk foreign key (shift_id, organization_id)
    references public.on_call_shifts (id, organization_id) on delete cascade,
  constraint on_call_shift_members_employee_fk foreign key (employee_record_id, organization_id)
    references public.employee_records (id, organization_id) on delete cascade
);

create index on_call_shift_members_employee_fk_idx
  on public.on_call_shift_members (employee_record_id, organization_id);
create index on_call_shift_members_organization_idx on public.on_call_shift_members (organization_id);

-- 2. History.
create table public.on_call_shift_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shift_id uuid not null,
  kind text not null,
  version integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text,
  handover_note text not null,
  cancelled_at timestamptz,
  member_ids uuid[] not null,
  -- Null once the actor's account is deleted: the change stays, the person does not.
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint on_call_shift_events_shift_fk foreign key (shift_id, organization_id)
    references public.on_call_shifts (id, organization_id) on delete cascade,
  constraint on_call_shift_events_kind_check check (
    kind in ('planned', 'changed', 'ended', 'cancelled', 'handed_over', 'taken_over')
  )
);

create index on_call_shift_events_shift_idx
  on public.on_call_shift_events (shift_id, organization_id, version);
create index on_call_shift_events_organization_idx on public.on_call_shift_events (organization_id);
create index on_call_shift_events_actor_id_fk_idx on public.on_call_shift_events (actor_id);

create trigger guard_event_ledger_history before update or delete on public.on_call_shift_events
  for each row execute function app_private.guard_event_ledger_history();

create trigger on_call_shifts_updated_at before update on public.on_call_shifts
  for each row execute function public.update_updated_at_column();

-- 4. Reads. Every member with effective access reads the shifts and their
-- people of their organization; who planned or changed a shift stays with the
-- server. Realtime checks the subscriber's column privileges: id and
-- organization_id stay selectable, so an event and its filter still arrive.
alter table public.on_call_shifts enable row level security;
alter table public.on_call_shift_members enable row level security;
alter table public.on_call_shift_events enable row level security;

create policy on_call_shifts_select_member on public.on_call_shifts
  for select to authenticated
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));
create policy on_call_shift_members_select_member on public.on_call_shift_members
  for select to authenticated
  using (organization_id in (select app_private.get_user_org_ids((select auth.uid()))));

revoke all on table public.on_call_shifts, public.on_call_shift_members, public.on_call_shift_events
  from public, anon, authenticated, service_role;
grant select (
  id, organization_id, starts_at, ends_at, label, handover_note, cancelled_at, version, updated_at
) on table public.on_call_shifts to authenticated;
grant select on table public.on_call_shift_members to authenticated;
grant select, insert, update on table public.on_call_shifts to service_role;
grant select, insert, delete on table public.on_call_shift_members to service_role;
grant select, insert on table public.on_call_shift_events to service_role;

-- Realtime (docs/technical/realtime-and-caching.md, "Add Realtime data"): the
-- shift is the owning root; every write bumps its version, so its people and
-- history stay unpublished.
alter table public.on_call_shifts replica identity using index on_call_shifts_replident_idx;
create trigger emit_realtime_deletion after delete on public.on_call_shifts
  for each row execute function app_private.emit_realtime_deletion();
alter publication supabase_realtime add table public.on_call_shifts;

-- 3. Writes.

-- The actor is an Admin or Büro member of the organization with effective
-- access; the share lock holds the membership until commit.
create function app_private.require_on_call_planner(p_organization_id uuid, p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role = any (array['admin'::public.org_role, 'buero'::public.org_role])
    and app_private.p1_24_has_effective_access(member.organization_id, member.user_id)
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;
end;
$$;
revoke all on function app_private.require_on_call_planner(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.require_on_call_planner(uuid, uuid) to service_role;

-- Checks a shift's new state and returns its people without repeats.
-- Refusals: on_call_shift_invalid_range (end not after start, or longer than
-- 31 days), on_call_shift_in_past (the end has passed),
-- on_call_member_required, on_call_member_invalid (a person who is no current
-- personnel record of the organization), on_call_shift_overlaps (another
-- shift with the same label in the same time, unless p_confirm_overlap).
create function app_private.check_on_call_shift_state(
  p_organization_id uuid,
  p_shift_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_label text,
  p_member_ids uuid[],
  p_confirm_overlap boolean
)
returns uuid[]
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_member_ids uuid[] := array(select distinct unnest(coalesce(p_member_ids, '{}')));
begin
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
    or p_ends_at - p_starts_at > interval '31 days' then
    raise exception 'on_call_shift_invalid_range';
  end if;
  if p_ends_at <= now() then
    raise exception 'on_call_shift_in_past';
  end if;
  if cardinality(v_member_ids) = 0 then
    raise exception 'on_call_member_required';
  end if;
  if cardinality(v_member_ids) > 20 or (
    select count(*) from public.employee_records record
    where record.organization_id = p_organization_id
      and record.id = any (v_member_ids)
      and (record.exit_date is null
        or record.exit_date >= (p_starts_at at time zone 'Europe/Berlin')::date)
  ) <> cardinality(v_member_ids) then
    raise exception 'on_call_member_invalid';
  end if;
  -- One planner of the organization at a time from here to commit, so two
  -- unconfirmed overlapping saves never both pass the question below.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':on-call-shifts', 0));
  if not coalesce(p_confirm_overlap, false) and exists (
    select 1 from public.on_call_shifts other
    where other.organization_id = p_organization_id
      and other.id <> p_shift_id
      and other.cancelled_at is null
      and other.label is not distinct from p_label
      and other.starts_at < p_ends_at
      and other.ends_at > p_starts_at
  ) then
    raise exception 'on_call_shift_overlaps';
  end if;
  return v_member_ids;
end;
$$;
revoke all on function app_private.check_on_call_shift_state(uuid, uuid, timestamptz, timestamptz, text, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function app_private.check_on_call_shift_state(uuid, uuid, timestamptz, timestamptz, text, uuid[], boolean)
  to service_role;

-- Makes the checked people the shift's people.
create function app_private.replace_on_call_shift_members(
  p_organization_id uuid,
  p_shift_id uuid,
  p_member_ids uuid[]
)
returns void
language sql
security invoker
set search_path to ''
as $$
  delete from public.on_call_shift_members member
  where member.shift_id = p_shift_id and member.organization_id = p_organization_id
    and not (member.employee_record_id = any (p_member_ids));
  insert into public.on_call_shift_members (shift_id, organization_id, employee_record_id)
  select p_shift_id, p_organization_id, member_id from unnest(p_member_ids) member_id
  on conflict (shift_id, employee_record_id) do nothing;
$$;
revoke all on function app_private.replace_on_call_shift_members(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function app_private.replace_on_call_shift_members(uuid, uuid, uuid[]) to service_role;

-- Appends the shift's state after a write to its history.
create function app_private.record_on_call_shift_event(
  p_organization_id uuid,
  p_shift_id uuid,
  p_kind text,
  p_actor_id uuid
)
returns void
language sql
security invoker
set search_path to ''
as $$
  insert into public.on_call_shift_events (
    organization_id, shift_id, kind, version, starts_at, ends_at, label, handover_note,
    cancelled_at, member_ids, actor_id
  )
  select shift.organization_id, shift.id, p_kind, shift.version, shift.starts_at, shift.ends_at,
    shift.label, shift.handover_note, shift.cancelled_at,
    array(select member.employee_record_id from public.on_call_shift_members member
      where member.shift_id = shift.id and member.organization_id = shift.organization_id
      order by member.employee_record_id),
    p_actor_id
  from public.on_call_shifts shift
  where shift.id = p_shift_id and shift.organization_id = p_organization_id;
$$;
revoke all on function app_private.record_on_call_shift_event(uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.record_on_call_shift_event(uuid, uuid, text, uuid) to service_role;

-- Plans a shift under the id the caller chose. A call repeated after its
-- answer was lost finds its shift and writes nothing. Refusals: not_authorized,
-- on_call_shift_exists for an id that names another planner's or
-- organization's shift, and those of check_on_call_shift_state. Returns
-- {"shiftId", "version"}.
create function public.plan_on_call_shift(
  p_actor_id uuid,
  p_organization_id uuid,
  p_shift_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_label text,
  p_handover_note text,
  p_member_ids uuid[],
  p_confirm_overlap boolean
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_existing public.on_call_shifts;
  v_member_ids uuid[];
begin
  perform app_private.require_on_call_planner(p_organization_id, p_actor_id);
  select * into v_existing from public.on_call_shifts shift where shift.id = p_shift_id;
  if found then
    if v_existing.organization_id <> p_organization_id or v_existing.created_by is distinct from p_actor_id then
      raise exception 'on_call_shift_exists';
    end if;
    return jsonb_build_object('shiftId', v_existing.id, 'version', v_existing.version);
  end if;

  v_member_ids := app_private.check_on_call_shift_state(
    p_organization_id, p_shift_id, p_starts_at, p_ends_at, p_label, p_member_ids, p_confirm_overlap
  );
  insert into public.on_call_shifts (
    id, organization_id, starts_at, ends_at, label, handover_note, created_by, updated_by
  ) values (
    p_shift_id, p_organization_id, p_starts_at, p_ends_at, p_label, coalesce(p_handover_note, ''),
    p_actor_id, p_actor_id
  );
  perform app_private.replace_on_call_shift_members(p_organization_id, p_shift_id, v_member_ids);
  perform app_private.record_on_call_shift_event(p_organization_id, p_shift_id, 'planned', p_actor_id);
  return jsonb_build_object('shiftId', p_shift_id, 'version', 1);
end;
$$;
revoke all on function public.plan_on_call_shift(uuid, uuid, uuid, timestamptz, timestamptz, text, text, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.plan_on_call_shift(uuid, uuid, uuid, timestamptz, timestamptz, text, text, uuid[], boolean)
  to service_role;

-- Locks the organization's shift for a change the caller made on the version
-- it saw. Refusals: not_authorized, on_call_shift_not_found,
-- on_call_shift_changed (another write came first), on_call_shift_over (the
-- shift was cancelled or has ended).
create function app_private.lock_on_call_shift(
  p_actor_id uuid,
  p_organization_id uuid,
  p_shift_id uuid,
  p_expected_version integer
)
returns public.on_call_shifts
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_shift public.on_call_shifts;
begin
  perform app_private.require_on_call_planner(p_organization_id, p_actor_id);
  select * into v_shift from public.on_call_shifts shift
  where shift.id = p_shift_id and shift.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'on_call_shift_not_found';
  end if;
  if v_shift.version is distinct from p_expected_version then
    raise exception 'on_call_shift_changed';
  end if;
  if v_shift.cancelled_at is not null or v_shift.ends_at <= now() then
    raise exception 'on_call_shift_over';
  end if;
  return v_shift;
end;
$$;
revoke all on function app_private.lock_on_call_shift(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function app_private.lock_on_call_shift(uuid, uuid, uuid, integer) to service_role;

-- Changes a shift that has not ended. A running shift keeps its start
-- (on_call_shift_started otherwise); its earlier version stays in the
-- history. Refusals: those of lock_on_call_shift and check_on_call_shift_state.
create function public.change_on_call_shift(
  p_actor_id uuid,
  p_organization_id uuid,
  p_shift_id uuid,
  p_expected_version integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_label text,
  p_handover_note text,
  p_member_ids uuid[],
  p_confirm_overlap boolean
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_shift public.on_call_shifts;
  v_member_ids uuid[];
begin
  v_shift := app_private.lock_on_call_shift(p_actor_id, p_organization_id, p_shift_id, p_expected_version);
  if v_shift.starts_at <= now() and p_starts_at is distinct from v_shift.starts_at then
    raise exception 'on_call_shift_started';
  end if;
  v_member_ids := app_private.check_on_call_shift_state(
    p_organization_id, p_shift_id, p_starts_at, p_ends_at, p_label, p_member_ids, p_confirm_overlap
  );
  update public.on_call_shifts shift
  set starts_at = p_starts_at, ends_at = p_ends_at, label = p_label,
    handover_note = coalesce(p_handover_note, ''), version = shift.version + 1, updated_by = p_actor_id
  where shift.id = p_shift_id and shift.version = p_expected_version;
  perform app_private.replace_on_call_shift_members(p_organization_id, p_shift_id, v_member_ids);
  perform app_private.record_on_call_shift_event(p_organization_id, p_shift_id, 'changed', p_actor_id);
  return jsonb_build_object('shiftId', p_shift_id, 'version', v_shift.version + 1);
end;
$$;
revoke all on function public.change_on_call_shift(uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.change_on_call_shift(uuid, uuid, uuid, integer, timestamptz, timestamptz, text, text, uuid[], boolean)
  to service_role;

-- Ends a running shift now, or cancels one that has not started. Refusals:
-- those of lock_on_call_shift.
create function public.end_on_call_shift(
  p_actor_id uuid,
  p_organization_id uuid,
  p_shift_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_shift public.on_call_shifts;
  v_now timestamptz := now();
begin
  v_shift := app_private.lock_on_call_shift(p_actor_id, p_organization_id, p_shift_id, p_expected_version);
  if v_shift.starts_at < v_now then
    update public.on_call_shifts shift
    set ends_at = v_now, version = shift.version + 1, updated_by = p_actor_id
    where shift.id = p_shift_id and shift.version = p_expected_version;
    perform app_private.record_on_call_shift_event(p_organization_id, p_shift_id, 'ended', p_actor_id);
  else
    update public.on_call_shifts shift
    set cancelled_at = v_now, version = shift.version + 1, updated_by = p_actor_id
    where shift.id = p_shift_id and shift.version = p_expected_version;
    perform app_private.record_on_call_shift_event(p_organization_id, p_shift_id, 'cancelled', p_actor_id);
  end if;
  return jsonb_build_object('shiftId', p_shift_id, 'version', v_shift.version + 1);
end;
$$;
revoke all on function public.end_on_call_shift(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.end_on_call_shift(uuid, uuid, uuid, integer) to service_role;

-- Hands a running shift over: ends it now and starts the next shift, under
-- the id the caller chose, from the same instant with the note for the people
-- who take over. A call repeated after its answer was lost finds the next
-- shift and writes nothing. Refusals: on_call_shift_not_running for a shift
-- that has not started, those of lock_on_call_shift and of
-- check_on_call_shift_state. Returns the next shift's {"shiftId", "version"}.
create function public.hand_over_on_call_shift(
  p_actor_id uuid,
  p_organization_id uuid,
  p_shift_id uuid,
  p_expected_version integer,
  p_next_shift_id uuid,
  p_next_ends_at timestamptz,
  p_next_label text,
  p_handover_note text,
  p_member_ids uuid[],
  p_confirm_overlap boolean
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_shift public.on_call_shifts;
  v_existing public.on_call_shifts;
  v_member_ids uuid[];
  v_now timestamptz := now();
begin
  perform app_private.require_on_call_planner(p_organization_id, p_actor_id);
  select * into v_existing from public.on_call_shifts shift where shift.id = p_next_shift_id;
  if found then
    if v_existing.organization_id <> p_organization_id or v_existing.created_by is distinct from p_actor_id then
      raise exception 'on_call_shift_exists';
    end if;
    return jsonb_build_object('shiftId', v_existing.id, 'version', v_existing.version);
  end if;

  v_shift := app_private.lock_on_call_shift(p_actor_id, p_organization_id, p_shift_id, p_expected_version);
  if v_shift.starts_at >= v_now then
    raise exception 'on_call_shift_not_running';
  end if;
  update public.on_call_shifts shift
  set ends_at = v_now, version = shift.version + 1, updated_by = p_actor_id
  where shift.id = p_shift_id and shift.version = p_expected_version;
  perform app_private.record_on_call_shift_event(p_organization_id, p_shift_id, 'handed_over', p_actor_id);

  v_member_ids := app_private.check_on_call_shift_state(
    p_organization_id, p_next_shift_id, v_now, p_next_ends_at, p_next_label, p_member_ids, p_confirm_overlap
  );
  insert into public.on_call_shifts (
    id, organization_id, starts_at, ends_at, label, handover_note, created_by, updated_by
  ) values (
    p_next_shift_id, p_organization_id, v_now, p_next_ends_at, p_next_label,
    coalesce(p_handover_note, ''), p_actor_id, p_actor_id
  );
  perform app_private.replace_on_call_shift_members(p_organization_id, p_next_shift_id, v_member_ids);
  perform app_private.record_on_call_shift_event(p_organization_id, p_next_shift_id, 'taken_over', p_actor_id);
  return jsonb_build_object('shiftId', p_next_shift_id, 'version', 1);
end;
$$;
revoke all on function public.hand_over_on_call_shift(uuid, uuid, uuid, integer, uuid, timestamptz, text, text, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.hand_over_on_call_shift(uuid, uuid, uuid, integer, uuid, timestamptz, text, text, uuid[], boolean)
  to service_role;

-- The shifts that touch [p_from, p_until), earliest first, with each
-- person's name and phone, as one value so no row cap cuts it short. For the
-- office (p_for_office) also the cancelled shifts, each shift's history and
-- the people it may plan. The server resolves the caller and the role first.
create function public.read_on_call_shifts(
  p_organization_id uuid,
  p_from timestamptz,
  p_until timestamptz,
  p_for_office boolean
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  with person as (
    select record.id,
      coalesce(
        nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), ''),
        nullif(btrim(concat_ws(' ', record.first_name, record.last_name)), ''),
        'Unbekannt'
      ) as name,
      nullif(btrim(record.phone), '') as phone,
      record.exit_date
    from public.employee_records record
    left join public.profiles profile on profile.id = record.user_id
    where record.organization_id = p_organization_id
  ), shift as (
    select shift.*
    from public.on_call_shifts shift
    where shift.organization_id = p_organization_id
      and shift.starts_at < p_until
      and shift.ends_at > p_from
      and (p_for_office or shift.cancelled_at is null)
  )
  select jsonb_build_object(
    'shifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', shift.id,
        'startsAt', shift.starts_at,
        'endsAt', shift.ends_at,
        'label', shift.label,
        'handoverNote', shift.handover_note,
        'cancelledAt', shift.cancelled_at,
        'version', shift.version,
        'members', coalesce((
          select jsonb_agg(jsonb_build_object(
            'employeeRecordId', person.id, 'name', person.name, 'phone', person.phone
          ) order by person.name, person.id)
          from public.on_call_shift_members member
          join person on person.id = member.employee_record_id
          where member.shift_id = shift.id
        ), '[]'::jsonb),
        'history', case when p_for_office then coalesce((
          select jsonb_agg(jsonb_build_object(
            'kind', event.kind,
            'version', event.version,
            'startsAt', event.starts_at,
            'endsAt', event.ends_at,
            'label', event.label,
            'handoverNote', event.handover_note,
            'cancelledAt', event.cancelled_at,
            'memberIds', to_jsonb(event.member_ids),
            'actorName', coalesce(
              nullif(btrim(concat_ws(' ', actor.first_name, actor.last_name)), ''), 'Unbekannt'
            ),
            'createdAt', event.created_at
          ) order by event.created_at, event.version)
          from public.on_call_shift_events event
          left join public.profiles actor on actor.id = event.actor_id
          where event.shift_id = shift.id and event.organization_id = p_organization_id
        ), '[]'::jsonb) else '[]'::jsonb end
      ) order by shift.starts_at, shift.id)
      from shift
    ), '[]'::jsonb),
    'people', case when p_for_office then coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeRecordId', person.id, 'name', person.name, 'phone', person.phone,
        'active', person.exit_date is null or person.exit_date >= (now() at time zone 'Europe/Berlin')::date
      ) order by person.name, person.id)
      from person
    ), '[]'::jsonb) else '[]'::jsonb end
  );
$$;
revoke all on function public.read_on_call_shifts(uuid, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.read_on_call_shifts(uuid, timestamptz, timestamptz, boolean) to service_role;
