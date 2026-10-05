-- Closing transitions at Berlin midnight belong to the preceding working day.
-- Check both snapshots so deletion and movement cannot bypass a closed period.
create or replace function app_private.guard_time_correction_closed_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fact jsonb;
  timestamp_text text;
  local_timestamp timestamp;
  local_date date;
begin
  for fact in
    select value from jsonb_array_elements(coalesce(new.before_snapshot -> 'facts', '[]'::jsonb))
    union all
    select value from jsonb_array_elements(coalesce(new.applied_snapshot -> 'facts', '[]'::jsonb))
  loop
    timestamp_text := nullif(fact ->> 'timestamp', '');
    if timestamp_text is null then
      raise exception 'time_correction_timestamp_invalid';
    end if;
    begin
      local_timestamp := timestamp_text::timestamptz at time zone 'Europe/Berlin';
      local_date := local_timestamp::date;
    exception when others then
      raise exception 'time_correction_timestamp_invalid';
    end;
    if fact ->> 'entryType' in ('clock_out', 'break_end')
      and local_timestamp::time = time '00:00:00' then
      local_date := local_date - 1;
    end if;
    perform app_private.assert_p1_23_period_open(new.organization_id, local_date);
  end loop;
  return new;
end;
$$;

revoke all on function app_private.guard_time_correction_closed_period()
  from public, anon, authenticated, service_role;
