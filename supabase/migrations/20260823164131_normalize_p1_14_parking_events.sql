-- P1-14 parking cancels concrete occurrences and must use P1-11's established
-- planning event vocabulary.

create or replace function app_private.normalize_work_parking_planning_event()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.event_type = 'status_changed'
    and new.mutation_scope = 'occurrence'
    and new.reason in ('work_parked', 'project_parked')
  then
    new.event_type := 'cancelled';
    new.mutation_scope := 'one';
  end if;
  return new;
end;
$$;

create trigger normalize_work_parking_planning_event
before insert on public.planning_events
for each row execute function app_private.normalize_work_parking_planning_event();

revoke all on function app_private.normalize_work_parking_planning_event()
from public, anon, authenticated;
grant execute on function app_private.normalize_work_parking_planning_event()
to postgres, service_role;
