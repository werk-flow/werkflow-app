-- A login that loses its personnel record heard nothing
-- (werk-flow/werkflow-planning#621). The relink trigger of
-- 20270503090002_signal_target_changes_to_the_employee.sql deleted the old
-- login's signal row, and the table sends no deletion notice, so the person's
-- open week, clock, „Vorgemerkte Zeit“ and correction history kept the old
-- record's data until their next read. Now the row stays with its login,
-- names no record and moves its timestamp: the person's own select policy
-- delivers that one update, and the update carries the row's ids, the login
-- and a timestamp, never the record the person no longer holds (the replica
-- identity sends only id and organization_id as the old row).

-- 1. A cleared row leaves with its login's membership, so no row outlives
-- the person it tells; a live row keeps following its record, as before. An
-- organization's deletion skips the call: its cascade takes every row. This
-- comes first: a join inserts a membership, whose trigger creates the record
-- and then writes a signal, so the migration takes the memberships' lock
-- (here) before the signals' (section 2), in that order. The migration runs
-- as one transaction, which keeps every lock to its end.
create function app_private.retire_cleared_employment_target_signals()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  delete from public.employment_target_signals signal
  where signal.organization_id = old.organization_id
    and signal.user_id = old.user_id
    and signal.employee_record_id is null;
  return null;
end;
$$;
revoke all on function app_private.retire_cleared_employment_target_signals() from public, anon, authenticated;

create trigger retire_cleared_employment_target_signals
  after delete on public.organization_members
  for each row
  when (not coalesce(old.organization_id::text = any (pg_catalog.string_to_array(
    pg_catalog.current_setting('app.deleting_organization_ids', true), ',')), false))
  execute function app_private.retire_cleared_employment_target_signals();

-- 2. A cleared signal names no record.
alter table public.employment_target_signals alter column employee_record_id drop not null;

-- Realtime checks a queued event against the current row under its key but
-- sends the row as the WAL holds it, without the columns the subscriber may
-- not select. So an update queued while the login still held the record
-- would reach it after the clear with that record's id. No client reads the
-- record id: the views only hear that the row moved, then read again.
-- @destructive: after release 8a73d1d0a: the deployed build never selects employment_target_signals, it only listens to the table
revoke select on table public.employment_target_signals from authenticated;
grant select (id, organization_id, user_id, updated_at) on table public.employment_target_signals to authenticated;

-- 3. The record trigger clears the old login's row instead of deleting it.
-- The key stays with the same login, so a queued event of it reaches nobody
-- else; the new login still gets a new row and key, as before. A login that
-- is no longer a member of the record's organization (its account or its
-- membership is going) has nobody to tell, and its row goes as before. The
-- membership is read under FOR KEY SHARE: a removal that holds it is waited
-- for, so a refused removal still leaves a cleared row and a committed one
-- none; a removal that starts later waits for this commit, and its trigger
-- (section 1) then sees the cleared row. A removal that holds the membership
-- and then waits for this record (remove_member_with_time_capture, or an
-- account deletion that ends the membership before it clears the login)
-- deadlocks with it; Postgres cancels one, which the caller retries, and
-- nothing is lost. Skipping a held membership instead would drop the signal
-- of a person whose removal is then refused. A login that gets a record
-- retires its earlier cleared row: the new record's row tells it from now on,
-- and a person holds at most one record per organization
-- (employee_records_org_user_unique).
create or replace function app_private.signal_employment_target_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_record_ids uuid[];
  v_record record;
  v_departed record;
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

  for v_record in
    select employee.id, employee.organization_id, employee.user_id
    from public.employee_records employee
    where employee.id = any (v_record_ids)
    order by employee.id
    for share
  loop
    for v_departed in
      select signal.id, signal.user_id
      from public.employment_target_signals signal
      where signal.employee_record_id = v_record.id
        and signal.user_id is distinct from v_record.user_id
      for update
    loop
      perform 1 from public.organization_members membership
      where membership.organization_id = v_record.organization_id
        and membership.user_id = v_departed.user_id
      for key share;
      if found then
        update public.employment_target_signals signal
        set employee_record_id = null, updated_at = now()
        where signal.id = v_departed.id;
      else
        delete from public.employment_target_signals signal where signal.id = v_departed.id;
      end if;
    end loop;
    if v_record.user_id is not null then
      if tg_table_name = 'employee_records' then
        delete from public.employment_target_signals signal
        where signal.organization_id = v_record.organization_id
          and signal.user_id = v_record.user_id
          and signal.employee_record_id is null;
      end if;
      insert into public.employment_target_signals (organization_id, employee_record_id, user_id)
      values (v_record.organization_id, v_record.id, v_record.user_id)
      on conflict (employee_record_id) do update set updated_at = now();
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function app_private.signal_employment_target_change() from public, anon, authenticated;
