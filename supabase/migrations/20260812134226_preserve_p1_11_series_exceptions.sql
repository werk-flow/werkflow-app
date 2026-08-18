do $$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.reschedule_planning_series(uuid,uuid,uuid,integer,text,jsonb,jsonb,jsonb,jsonb,text,jsonb,text,text)'::regprocedure
  )
  into v_definition;

  v_rewritten := replace(
    v_definition,
    'is_exception = id = p_occurrence_id or is_exception,',
    'is_exception = occurrence.is_exception,'
  );

  if v_rewritten = v_definition then
    raise exception 'expected series exception assignment not found';
  end if;

  execute v_rewritten;
end;
$$;

revoke all on function public.reschedule_planning_series(
  uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.reschedule_planning_series(
  uuid, uuid, uuid, integer, text, jsonb, jsonb, jsonb, jsonb, text, jsonb, text, text
) to postgres, service_role;