
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
    'p_organization_id, v_series_id, v_lineage_id, v_original_start_local::timestamp,',
    'p_organization_id, v_series_id, v_lineage_id, case when v_series_id is null then null else v_original_start_local::timestamp end,'
  );
  if v_updated = v_definition then
    raise exception 'one-off identity patch did not match';
  end if;
  execute v_updated;
end
$migration$;
