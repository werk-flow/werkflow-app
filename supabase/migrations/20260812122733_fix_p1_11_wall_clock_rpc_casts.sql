
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
    'p_organization_id, v_series_id, v_lineage_id, v_original_start_local,',
    'p_organization_id, v_series_id, v_lineage_id, v_original_start_local::timestamp,'
  );
  v_updated := replace(
    v_updated,
    '''Europe/Berlin'', p_series->>''startsAtLocal'',',
    '''Europe/Berlin'', (p_series->>''startsAtLocal'')::timestamp,'
  );
  v_updated := replace(
    v_updated,
    'p_series->>''segmentStartLocal'',',
    '(p_series->>''segmentStartLocal'')::timestamp,'
  );
  v_updated := replace(
    v_updated,
    'nullif(p_series->>''segmentEndBeforeLocal'', ''''),',
    'nullif(p_series->>''segmentEndBeforeLocal'', '''')::timestamp,'
  );
  v_updated := replace(
    v_updated,
    'nullif(p_series->>''generatedThroughLocal'', ''''),',
    'nullif(p_series->>''generatedThroughLocal'', '''')::timestamp,'
  );
  if v_updated = v_definition then
    raise exception 'create planning cast patch did not match';
  end if;
  execute v_updated;

  select pg_get_functiondef(
    'public.reschedule_planning_series(uuid,uuid,uuid,integer,text,jsonb,jsonb,jsonb,jsonb,text,jsonb,text,text)'::regprocedure
  ) into v_definition;
  v_updated := replace(
    v_definition,
    'v_boundary text;',
    'v_boundary timestamp without time zone;'
  );
  v_updated := replace(
    v_updated,
    'v_identity text;',
    'v_identity timestamp without time zone;'
  );
  v_updated := replace(
    v_updated,
    'v_identity := v_item->>''identityOriginalStartLocal'';',
    'v_identity := (v_item->>''identityOriginalStartLocal'')::timestamp;'
  );
  v_updated := replace(
    v_updated,
    'item.value->>''identityOriginalStartLocal'' = occurrence.original_start_local',
    '(item.value->>''identityOriginalStartLocal'')::timestamp = occurrence.original_start_local'
  );
  v_updated := replace(
    v_updated,
    '''Europe/Berlin'',
      p_series->>''startsAtLocal'',',
    '''Europe/Berlin'',
      (p_series->>''startsAtLocal'')::timestamp,'
  );
  v_updated := replace(
    v_updated,
    'v_boundary, nullif(p_series->>''generatedThroughLocal'', ''''),',
    'v_boundary, nullif(p_series->>''generatedThroughLocal'', '''')::timestamp,'
  );
  v_updated := replace(
    v_updated,
    'set starts_at_local = p_series->>''startsAtLocal'',',
    'set starts_at_local = (p_series->>''startsAtLocal'')::timestamp,'
  );
  v_updated := replace(
    v_updated,
    'generated_through_local = nullif(p_series->>''generatedThroughLocal'', ''''),',
    'generated_through_local = nullif(p_series->>''generatedThroughLocal'', '''')::timestamp,'
  );
  v_updated := replace(
    v_updated,
    'v_identity, v_old_series.job_id,',
    'v_identity, v_old_series.job_id,'
  );
  v_updated := replace(
    v_updated,
    'value->>''occurrenceOriginalStartLocal'' = v_identity',
    '(value->>''occurrenceOriginalStartLocal'')::timestamp = v_identity'
  );
  if v_updated = v_definition then
    raise exception 'series planning cast patch did not match';
  end if;
  execute v_updated;
end
$migration$;

drop function if exists public.create_planning_entry(
  uuid, uuid, jsonb, jsonb, jsonb, jsonb, text, jsonb, text, text
);
