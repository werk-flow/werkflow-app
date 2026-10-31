-- An Admin corrects the opening date (`opened_on`) of a time account that was
-- opened on the wrong day. A period counts an account only from its opening
-- date on, so an account dated too late blocks every earlier month with
-- „Zeitkonto fehlt“.
--
-- The correction keeps the ledger append-only. It never rewrites the opening
-- event: it books a reversal of the current opening on its old date and a new
-- opening with the same minutes on the corrected date, both as
-- `opening_balance` events, and records the pair with old date, new date and
-- reason in time_account_opening_corrections. The account's balance stays the
-- same; the opening minutes move to the month the account now starts in. Both
-- events change the source fingerprint of every period from the earlier date
-- on, so a prepared month goes stale and is prepared again.
--
-- A closed period on or after the earlier of both dates used the old opening
-- (or its absence): the correction is refused while one exists. Reopen the
-- period first.
--
-- Invariants in the database:
-- - Every account has exactly one current opening event, and its date is the
--   account's `opened_on` (deferred constraint trigger, checked at commit
--   after an opening event, a correction, a new account or a changed
--   `opened_on`). It replaces the unique index that allowed one opening event
--   per account.
-- - A correction row matches its events: the reversal undoes the reversed
--   opening on its date, the new opening carries the same minutes on the
--   corrected date.
-- - Corrections and account events are history: no delete except the
--   cascade of an organization deletion. Corrections also refuse update and
--   client access; events already refused update.

create table public.time_account_opening_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  account_id uuid not null,
  previous_opened_on date not null,
  corrected_opened_on date not null,
  reason text not null,
  reversed_event_id uuid not null,
  reversal_event_id uuid not null,
  opening_event_id uuid not null,
  operation_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint time_account_opening_corrections_account_org_fkey
    foreign key (account_id, organization_id)
    references public.time_accounts(id, organization_id) on delete restrict,
  constraint time_account_opening_corrections_reversed_org_fkey
    foreign key (reversed_event_id, organization_id)
    references public.time_account_events(id, organization_id) on delete restrict,
  constraint time_account_opening_corrections_reversal_org_fkey
    foreign key (reversal_event_id, organization_id)
    references public.time_account_events(id, organization_id) on delete restrict,
  constraint time_account_opening_corrections_opening_org_fkey
    foreign key (opening_event_id, organization_id)
    references public.time_account_events(id, organization_id) on delete restrict,
  constraint time_account_opening_corrections_operation_unique unique (organization_id, operation_id),
  constraint time_account_opening_corrections_reversed_unique unique (reversed_event_id),
  constraint time_account_opening_corrections_reversal_unique unique (reversal_event_id),
  constraint time_account_opening_corrections_opening_unique unique (opening_event_id),
  constraint time_account_opening_corrections_reason check (nullif(btrim(reason), '') is not null),
  constraint time_account_opening_corrections_dates_differ check (previous_opened_on <> corrected_opened_on)
);
create index time_account_opening_corrections_account_idx
  on public.time_account_opening_corrections(organization_id, account_id, created_at);

-- RLS without a policy: the settings page reads through the server only.
alter table public.time_account_opening_corrections enable row level security;
revoke all on table public.time_account_opening_corrections from public, anon, authenticated, service_role;
grant select on table public.time_account_opening_corrections to service_role;

create trigger guard_time_account_opening_corrections_immutable
before update on public.time_account_opening_corrections
for each row execute function app_private.guard_p1_23_immutable();

-- The one legitimate delete is the cascade of an organization deletion,
-- recognised by the organization row being gone (the rule of
-- app_private.guard_closed_period_time_write).
create function app_private.guard_time_account_history_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.organizations where id = old.organization_id) then
    raise exception 'p1_23_history_immutable';
  end if;
  return old;
end;
$$;

create trigger guard_time_account_opening_corrections_delete
before delete on public.time_account_opening_corrections
for each row execute function app_private.guard_time_account_history_delete();

-- A deleted opening event would leave an account without its current
-- opening; no writer deletes an account event.
create trigger guard_time_account_events_delete
before delete on public.time_account_events
for each row execute function app_private.guard_time_account_history_delete();

-- A correction row must describe its events exactly.
create function app_private.guard_time_account_opening_correction_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  reversed public.time_account_events%rowtype;
  reversal public.time_account_events%rowtype;
  opening public.time_account_events%rowtype;
begin
  select * into reversed from public.time_account_events where id = new.reversed_event_id;
  select * into reversal from public.time_account_events where id = new.reversal_event_id;
  select * into opening from public.time_account_events where id = new.opening_event_id;
  if reversed.id is null or reversal.id is null or opening.id is null
    or reversed.event_kind <> 'opening_balance'
    or reversal.event_kind <> 'opening_balance'
    or opening.event_kind <> 'opening_balance'
    or reversed.account_id <> new.account_id
    or reversal.account_id <> new.account_id
    or opening.account_id <> new.account_id
    or reversed.effective_date <> new.previous_opened_on
    or reversal.effective_date <> new.previous_opened_on
    or reversal.minutes <> -reversed.minutes
    or opening.effective_date <> new.corrected_opened_on
    or opening.minutes <> reversed.minutes
  then
    raise exception 'opening_correction_mismatch';
  end if;
  return new;
end;
$$;

create trigger guard_time_account_opening_correction_events
before insert on public.time_account_opening_corrections
for each row execute function app_private.guard_time_account_opening_correction_events();

-- Exactly one current opening per account, dated on the account's opening
-- date. Current: neither a reversal nor reversed by a correction.
create function app_private.guard_time_account_current_opening()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_account_id uuid := case tg_table_name
    when 'time_accounts' then (to_jsonb(new) ->> 'id')::uuid
    else (to_jsonb(new) ->> 'account_id')::uuid
  end;
  current_openings integer;
  current_date_value date;
begin
  select count(*), max(event.effective_date) into current_openings, current_date_value
  from public.time_account_events event
  where event.account_id = v_account_id
    and event.event_kind = 'opening_balance'
    and not exists (
      select 1 from public.time_account_opening_corrections correction
      where correction.reversed_event_id = event.id or correction.reversal_event_id = event.id
    );
  if current_openings <> 1 or current_date_value is distinct from (
    select account.opened_on from public.time_accounts account where account.id = v_account_id
  ) then
    raise exception 'opening_event_conflict';
  end if;
  return null;
end;
$$;

create constraint trigger guard_time_account_current_opening
after insert on public.time_account_events
deferrable initially deferred
for each row when (new.event_kind = 'opening_balance')
execute function app_private.guard_time_account_current_opening();

create constraint trigger guard_time_account_current_opening
after insert on public.time_account_opening_corrections
deferrable initially deferred
for each row execute function app_private.guard_time_account_current_opening();

create constraint trigger guard_time_account_current_opening
after insert or update of opened_on on public.time_accounts
deferrable initially deferred
for each row execute function app_private.guard_time_account_current_opening();

-- @destructive: after release aab4733d: no code relies on the index; the current-opening constraint trigger above replaces it and a correction needs a second opening event
drop index public.time_account_events_opening_unique;

create function public.correct_time_account_opening_date(
  p_organization_id uuid,
  p_account_id uuid,
  p_opened_on date,
  p_reason text,
  p_actor_id uuid,
  p_operation_id uuid,
  p_request_hash text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  account_record public.time_accounts%rowtype;
  current_opening public.time_account_events%rowtype;
  existing_id uuid;
  existing_hash text;
  earliest_date date;
  history_reason text;
  reversal_id uuid;
  opening_id uuid;
  correction_id uuid;
begin
  select correction.id, correction.request_hash into existing_id, existing_hash
  from public.time_account_opening_corrections correction
  where correction.organization_id = p_organization_id and correction.operation_id = p_operation_id;
  if found then
    if existing_hash <> p_request_hash then raise exception 'operation_id_conflict'; end if;
    return existing_id;
  end if;
  if not app_private.is_p1_23_org_admin(p_organization_id, p_actor_id) then raise exception 'not_authorized'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'reason_required'; end if;
  if p_opened_on is null then raise exception 'invalid_input'; end if;
  select * into account_record from public.time_accounts
  where id = p_account_id and organization_id = p_organization_id;
  if not found then raise exception 'account_not_found'; end if;
  -- The lock of open_time_account for this person: only a correction under
  -- it changes `opened_on`, so the date read next stays current.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':time_account:' || account_record.employee_record_id::text, 0
  ));
  select * into account_record from public.time_accounts where id = p_account_id;
  if account_record.opened_on = p_opened_on then raise exception 'opening_date_unchanged'; end if;
  earliest_date := least(account_record.opened_on, p_opened_on);
  -- Bounds the month locks below: no time account starts before 2000.
  if earliest_date < date '2000-01-01' then raise exception 'invalid_input'; end if;
  -- The month lock that prepare_time_period and close_time_period take before
  -- they compare a fingerprint, for every month from the earlier date to
  -- today, oldest first: a month without a period row yet is prepared or
  -- closed only after this commit, against a fingerprint that includes it.
  perform pg_advisory_xact_lock(hashtextextended(
    p_organization_id::text || ':p1-23-period:' || month_start::date::text, 0
  ))
  from generate_series(
    date_trunc('month', earliest_date),
    (clock_timestamp() at time zone 'Europe/Berlin')::date,
    interval '1 month'
  ) as month_start;
  -- Then the periods, then the account row: the order of close_time_period,
  -- so the two never deadlock. FOR SHARE conflicts with the close's FOR
  -- UPDATE: a close that holds the row first makes this read see 'closed'; a
  -- close that waits for this commit finds a changed fingerprint and refuses
  -- with stale_calculation.
  perform 1 from public.time_periods period
  where period.organization_id = p_organization_id and period.period_end_date >= earliest_date
  order by period.period_start_date
  for share;
  perform 1 from public.time_accounts where id = p_account_id for update;
  if exists (
    select 1 from public.time_periods period
    where period.organization_id = p_organization_id
      and period.period_end_date >= earliest_date
      and period.state = 'closed'
  ) then raise exception 'opening_date_locked'; end if;
  select event.* into current_opening from public.time_account_events event
  where event.account_id = p_account_id
    and event.event_kind = 'opening_balance'
    and not exists (
      select 1 from public.time_account_opening_corrections correction
      where correction.reversed_event_id = event.id or correction.reversal_event_id = event.id
    );
  if current_opening.id is null then raise exception 'opening_event_conflict'; end if;
  history_reason := format(
    'Eröffnungsdatum korrigiert von %s auf %s: %s',
    to_char(account_record.opened_on, 'DD.MM.YYYY'),
    to_char(p_opened_on, 'DD.MM.YYYY'),
    btrim(p_reason)
  );
  insert into public.time_account_events(
    organization_id, account_id, employee_record_id, event_kind, effective_date,
    minutes, reason, operation_id, request_hash, created_by
  ) values (
    p_organization_id, p_account_id, account_record.employee_record_id, 'opening_balance',
    account_record.opened_on, -current_opening.minutes, history_reason,
    gen_random_uuid(), p_request_hash, p_actor_id
  ) returning id into reversal_id;
  insert into public.time_account_events(
    organization_id, account_id, employee_record_id, event_kind, effective_date,
    minutes, reason, operation_id, request_hash, created_by
  ) values (
    p_organization_id, p_account_id, account_record.employee_record_id, 'opening_balance',
    p_opened_on, current_opening.minutes, history_reason,
    gen_random_uuid(), p_request_hash, p_actor_id
  ) returning id into opening_id;
  insert into public.time_account_opening_corrections(
    organization_id, account_id, previous_opened_on, corrected_opened_on, reason,
    reversed_event_id, reversal_event_id, opening_event_id,
    operation_id, request_hash, created_by
  ) values (
    p_organization_id, p_account_id, account_record.opened_on, p_opened_on, btrim(p_reason),
    current_opening.id, reversal_id, opening_id,
    p_operation_id, p_request_hash, p_actor_id
  ) returning id into correction_id;
  update public.time_accounts set
    opened_on = p_opened_on,
    version = version + 1,
    updated_at = now()
  where id = p_account_id;
  return correction_id;
end;
$$;

revoke all on function app_private.guard_time_account_opening_correction_events() from public, anon, authenticated;
revoke all on function app_private.guard_time_account_current_opening() from public, anon, authenticated;
revoke all on function app_private.guard_time_account_history_delete() from public, anon, authenticated;
revoke all on function public.correct_time_account_opening_date(uuid, uuid, date, text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.correct_time_account_opening_date(uuid, uuid, date, text, uuid, uuid, text)
  to service_role;
