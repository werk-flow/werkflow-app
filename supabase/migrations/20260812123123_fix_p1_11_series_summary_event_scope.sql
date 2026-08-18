
do $migration$
declare v_definition text; v_updated text;
begin
 select pg_get_functiondef(
  'public.reschedule_planning_series(uuid,uuid,uuid,integer,text,jsonb,jsonb,jsonb,jsonb,text,jsonb,text,text)'::regprocedure
 ) into v_definition;
 v_updated := replace(
  v_definition,
  'p_scope, to_jsonb(v_old_series),',
  'case when p_scope = ''future'' then ''this_and_future'' else ''whole_series'' end, to_jsonb(v_old_series),'
 );
 if v_updated=v_definition then raise exception 'final series scope patch did not match';end if;
 execute v_updated;
end
$migration$;
