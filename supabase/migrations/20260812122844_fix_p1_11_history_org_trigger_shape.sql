
create or replace function app_private.validate_planning_history_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.occurrence_id is not null and not exists (
    select 1
    from public.planning_occurrences occurrence
    where occurrence.id = new.occurrence_id
      and occurrence.organization_id = new.organization_id
  ) then
    raise exception 'planning history occurrence organization mismatch';
  end if;

  if tg_table_name = 'planning_events' then
    if new.series_id is not null and not exists (
      select 1
      from public.planning_series series
      where series.id = new.series_id
        and series.organization_id = new.organization_id
    ) then
      raise exception 'planning history series organization mismatch';
    end if;
  end if;

  return new;
end;
$$;
