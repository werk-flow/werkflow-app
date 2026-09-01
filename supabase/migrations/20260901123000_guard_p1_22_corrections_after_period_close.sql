-- P1-23 closes the effective-time write boundary used by P1-22. Requests may
-- still be drafted, but an approved correction cannot be applied until every
-- affected calendar month has been reopened by an administrator.

create or replace function app_private.guard_time_correction_closed_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare fact jsonb; local_date date;
begin
  for fact in
    select value from jsonb_array_elements(new.before_snapshot -> 'facts')
    union all
    select value from jsonb_array_elements(new.applied_snapshot -> 'facts')
  loop
    begin
      local_date := ((fact->>'timestamp')::timestamptz at time zone 'Europe/Berlin')::date;
    exception when others then
      raise exception 'time_correction_timestamp_invalid';
    end;
    perform app_private.assert_p1_23_period_open(new.organization_id, local_date);
  end loop;
  return new;
end;
$$;

create trigger guard_time_correction_closed_period
before insert on public.time_correction_applications
for each row execute function app_private.guard_time_correction_closed_period();

revoke all on function app_private.guard_time_correction_closed_period()
from public, anon, authenticated, service_role;
