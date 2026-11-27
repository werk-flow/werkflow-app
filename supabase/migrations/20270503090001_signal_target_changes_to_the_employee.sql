-- An employee's open Zeiterfassung and vacation overview missed a change of
-- their own entry and exit dates or employment conditions
-- (werk-flow/werkflow-planning#589). The views listen to employee_records and
-- employment_conditions, but only Admin and Büro select those rows, so
-- Realtime never delivered the event to the employee. The rows also carry the
-- office's notes about the person (employee_records.notes,
-- employment_conditions.note) and contact data, and Realtime sends whole rows,
-- so the employee gets no read of them. Instead each change touches a signal
-- row that holds only ids and a timestamp. Only its own person selects it, so
-- Realtime delivers it to nobody else, and the views then read again through
-- the reads the employee already has (weekly-targets, own-vacation-overview).

-- 1. The signal: one row per personnel record that has a login.
create table public.employment_target_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_record_id uuid not null references public.employee_records (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint employment_target_signals_record_unique unique (employee_record_id)
);
create index employment_target_signals_organization_id_fk_idx
  on public.employment_target_signals (organization_id);
create index employment_target_signals_user_id_fk_idx
  on public.employment_target_signals (user_id);

alter table public.employment_target_signals enable row level security;
-- The person reads their own row while they are a member of its
-- organization; a former member hears of no later change.
create policy employment_target_signals_select_own on public.employment_target_signals
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (select app_private.get_user_org_ids((select auth.uid())))
  );
-- The trigger below writes as its definer; no client or server role writes.
-- service_role keeps the SELECT every public table grants it.
revoke all on table public.employment_target_signals from public, anon, authenticated, service_role;
grant select on table public.employment_target_signals to authenticated, service_role;

-- 2. Realtime (docs/technical/realtime-and-caching.md, "Add Realtime data").
create unique index employment_target_signals_replident_idx
  on public.employment_target_signals (id, organization_id);
alter table public.employment_target_signals
  replica identity using index employment_target_signals_replident_idx;
-- No deletion notice: a notice reaches every member of the organization, and
-- a signal row belongs to one person. A row leaves only with its record, its
-- person's login or its organization, and no open view needs to hear of that.
-- lib/realtime/tables.ts lists the table as own-user, and realtime:check
-- refuses the deletion trigger on it.
alter publication supabase_realtime add table public.employment_target_signals;

-- 3. Touches the signal of each personnel record a target input of changed.
-- A record without a login has nobody to tell; one that lost its login drops
-- its signal. A record deleted in the same statement is gone from the read
-- and gets no signal. Definer rights, because a record write of any caller
-- must be able to touch the signal, which no client role writes.
create function app_private.signal_employment_target_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_record_ids uuid[];
begin
  if tg_table_name = 'employee_records' then
    v_record_ids := array[new.id];
  elsif tg_op = 'INSERT' then
    v_record_ids := array[new.employee_record_id];
  elsif tg_op = 'UPDATE' then
    v_record_ids := array[old.employee_record_id, new.employee_record_id];
  else
    v_record_ids := array[old.employee_record_id];
  end if;

  delete from public.employment_target_signals signal
  using public.employee_records record
  where record.id = any (v_record_ids)
    and signal.employee_record_id = record.id
    and record.user_id is null;

  insert into public.employment_target_signals (organization_id, employee_record_id, user_id)
  select record.organization_id, record.id, record.user_id
  from public.employee_records record
  where record.id = any (v_record_ids)
    and record.user_id is not null
  on conflict (employee_record_id) do update
    set user_id = excluded.user_id, organization_id = excluded.organization_id, updated_at = now();
  return null;
end;
$$;
revoke all on function app_private.signal_employment_target_change() from public, anon, authenticated;

-- The entry and exit dates bound every daily target; a changed login moves
-- the signal to the person who now owns the record.
create trigger signal_employment_target_on_insert
  after insert on public.employee_records
  for each row
  when (new.user_id is not null)
  execute function app_private.signal_employment_target_change();
create trigger signal_employment_target_on_update
  after update of entry_date, exit_date, user_id on public.employee_records
  for each row
  when (old.entry_date is distinct from new.entry_date
    or old.exit_date is distinct from new.exit_date
    or old.user_id is distinct from new.user_id)
  execute function app_private.signal_employment_target_change();

-- Weekly hours derive the target and the vacation days set the entitlement.
-- An organization's deletion skips the call, as for the deletion notices
-- (20270111100001_index_every_foreign_key_and_skip_teardown_triggers.sql).
create trigger signal_employment_target
  after insert or update on public.employment_conditions
  for each row
  execute function app_private.signal_employment_target_change();
create trigger signal_employment_target_on_delete
  after delete on public.employment_conditions
  for each row
  when (not coalesce(old.organization_id::text = any (pg_catalog.string_to_array(
    pg_catalog.current_setting('app.deleting_organization_ids', true), ',')), false))
  execute function app_private.signal_employment_target_change();
