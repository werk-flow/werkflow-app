
do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.create_planning_entry_materialized(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,jsonb,text,text)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    'case when v_series_id is null then ''one'' else ''series'' end',
    'case when v_series_id is null then ''one'' else ''whole_series'' end'
  );
  if v_updated = v_definition then
    raise exception 'create event scope patch did not match';
  end if;
  execute v_updated;

  select pg_get_functiondef(
    'public.update_planning_occurrence(uuid,uuid,uuid,integer,jsonb,jsonb,jsonb,text,jsonb,text,text)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    'p_occurrence_id, ''updated'', ''one'',',
    'p_occurrence_id, ''edited'', ''one'','
  );
  if v_updated = v_definition then
    raise exception 'update event type patch did not match';
  end if;
  execute v_updated;

  select pg_get_functiondef(
    'public.reschedule_planning_series(uuid,uuid,uuid,integer,text,jsonb,jsonb,jsonb,jsonb,text,jsonb,text,text)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    'case when v_before.id is null then ''generated'' else ''updated'' end,',
    'case when v_before.id is null then ''created'' else ''edited'' end,'
  );
  v_updated := replace(
    v_updated,
    'case when p_scope = ''future'' then ''series_split'' else ''series_updated'' end,',
    'case when p_scope = ''future'' then ''series_split'' else ''series_changed'' end,'
  );
  v_updated := replace(
    v_updated,
    E'      p_scope,\n',
    E'      case when p_scope = ''future'' then ''this_and_future'' else ''whole_series'' end,\n'
  );
  if v_updated = v_definition then
    raise exception 'series event vocabulary patch did not match';
  end if;
  execute v_updated;
end
$migration$;

alter table public.planning_events
  drop constraint planning_events_reason_check;
alter table public.planning_events
  add constraint planning_events_reason_check
  check (
    reason is null
    or (length(btrim(reason)) >= 3 and length(btrim(reason)) <= 1000)
  );
