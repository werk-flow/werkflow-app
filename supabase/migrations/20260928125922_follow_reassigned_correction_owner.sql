-- Follow the effective owner when correcting time that was reassigned. Keep the
-- original subject for deleted or mixed-owner snapshots. Responsibility and
-- target-identity checks in the RPC and application trigger remain unchanged.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_original text := 'select application.source_fingerprint, request.subject_employee_record_id';
  v_replacement text := $replacement$select application.source_fingerprint, coalesce((
        select case when count(distinct fact->>'employeeRecordId') = 1
          then min(fact->>'employeeRecordId')::uuid end
        from jsonb_array_elements(application.applied_snapshot->'facts') fact
      ), request.subject_employee_record_id)$replacement$;
begin
  foreach v_function in array array[
    'app_private.p1_22_create_time_correction_request_impl(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb,jsonb)'::regprocedure,
    'app_private.p1_22_revise_time_correction_request_impl(uuid,uuid,uuid,bigint,text,text,text,jsonb,jsonb,jsonb)'::regprocedure
  ] loop
    select pg_get_functiondef(v_function) into v_definition;
    if (length(v_definition) - length(replace(v_definition, v_original, ''))) / length(v_original) <> 1
    then raise exception 'Unexpected correction source definition for %', v_function; end if;
    execute replace(v_definition, v_original, v_replacement);
  end loop;
end;
$$;
