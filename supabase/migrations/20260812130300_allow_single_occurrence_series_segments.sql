
alter table public.planning_series
  drop constraint planning_series_end_check;
alter table public.planning_series
  add constraint planning_series_end_check
  check (
    (until_local_date is not null and occurrence_count is null)
    or
    (until_local_date is null and occurrence_count between 1 and 730)
  );
