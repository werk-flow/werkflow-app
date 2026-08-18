
alter table public.planning_series
  drop constraint planning_series_segment_check;
alter table public.planning_series
  add constraint planning_series_segment_check
  check (
    segment_end_before_local is null
    or segment_end_before_local > segment_start_local
  );
