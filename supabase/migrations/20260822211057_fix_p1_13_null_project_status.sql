do $$
declare
  function_definition text;
  corrected_definition text;
  nullable_comparison constant text := 'project.status_override = ''abgeschlossen''';
  null_safe_comparison constant text := 'project.status_override is not distinct from ''abgeschlossen''';
begin
  select pg_get_functiondef(
    'public.apply_work_template(uuid,uuid,uuid,text,uuid,uuid,boolean,date,uuid[],uuid[],jsonb,jsonb,text,text,uuid)'::regprocedure
  ) into function_definition;

  if strpos(function_definition, nullable_comparison) = 0 then
    raise exception 'Expected project-status guard was not found in apply_work_template';
  end if;

  corrected_definition := replace(
    function_definition,
    nullable_comparison,
    null_safe_comparison
  );
  execute corrected_definition;
end;
$$;
