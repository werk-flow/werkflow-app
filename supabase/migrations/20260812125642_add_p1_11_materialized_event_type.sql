
alter table public.planning_events
  drop constraint planning_events_type_check;
alter table public.planning_events
  add constraint planning_events_type_check
  check (event_type = any (array[
    'created'::text,
    'moved'::text,
    'resized'::text,
    'reassigned'::text,
    'edited'::text,
    'series_split'::text,
    'series_changed'::text,
    'series_stopped'::text,
    'skipped'::text,
    'cancelled'::text,
    'override_recorded'::text,
    'legacy_synced'::text,
    'materialized'::text
  ]));
