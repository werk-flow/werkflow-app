-- Stable append order for events that intentionally share one transition time.

alter table public.time_segment_events
  add column event_sequence bigint generated always as identity;

create unique index time_segment_events_sequence_key
  on public.time_segment_events(event_sequence);
