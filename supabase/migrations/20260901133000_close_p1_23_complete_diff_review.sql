-- Close the remaining P1-23 complete-diff review findings without rewriting
-- migrations that have already reached DEV and PROD.

alter table public.time_periods
  add constraint time_periods_closed_requires_close_version
  check (state <> 'closed' or current_close_version_id is not null);

create or replace function app_private.guard_p1_22_correction_application_period()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  fact jsonb;
  fact_timestamp timestamptz;
begin
  if jsonb_typeof(new.before_snapshot->'facts') is distinct from 'array'
     or jsonb_typeof(new.applied_snapshot->'facts') is distinct from 'array' then
    raise exception 'invalid_correction_snapshot';
  end if;
  for fact in
    select value from jsonb_array_elements(new.before_snapshot->'facts')
    union all
    select value from jsonb_array_elements(new.applied_snapshot->'facts')
  loop
    if jsonb_typeof(fact->'timestamp') is distinct from 'string' then
      raise exception 'invalid_correction_fact_timestamp';
    end if;
    begin
      fact_timestamp := (fact->>'timestamp')::timestamptz;
    exception when others then
      raise exception 'invalid_correction_fact_timestamp';
    end;
    if fact_timestamp is null then
      raise exception 'invalid_correction_fact_timestamp';
    end if;
    perform app_private.assert_p1_23_period_open(
      new.organization_id,
      (fact_timestamp at time zone 'Europe/Berlin')::date
    );
  end loop;
  return new;
end;
$$;

revoke all on function app_private.guard_p1_22_correction_application_period()
from public, anon, authenticated, service_role;
