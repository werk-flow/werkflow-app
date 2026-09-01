create or replace function app_private.transition_work_on_canonical_time_start()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform app_private.apply_time_activity_job_start(
    new.organization_id, new.started_by, new.job_id, new.kind
  );
  return new;
end;
$$;
