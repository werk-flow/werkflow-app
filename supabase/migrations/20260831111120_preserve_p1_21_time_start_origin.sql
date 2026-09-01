create or replace function app_private.start_work_from_time_activity(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_expected_version bigint
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform set_config('app.work_transition_origin', 'automatic_time_start', true);
  perform public.transition_work_execution(
    p_organization_id, p_actor_id, 'job', p_job_id,
    p_expected_version, 'in_progress', null, false
  );
  perform set_config('app.work_transition_origin', '', true);
end;
$$;

revoke all on function app_private.start_work_from_time_activity(
  uuid, uuid, uuid, bigint
) from public, anon, authenticated;
grant execute on function app_private.start_work_from_time_activity(
  uuid, uuid, uuid, bigint
) to service_role;

create or replace function app_private.apply_time_activity_job_start(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_id uuid,
  p_segment_kind public.time_segment_kind
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_job public.jobs%rowtype;
  v_job_state public.work_execution_state;
begin
  if p_job_id is null or p_segment_kind not in ('work', 'callout') then return; end if;

  select * into strict v_job from public.jobs job
  where job.id = p_job_id and job.organization_id = p_organization_id;
  v_job_state := coalesce(
    v_job.execution_state,
    app_private.resolve_legacy_job_execution_state(v_job.status)
  );
  if v_job_state in ('not_started', 'interrupted') then
    perform app_private.start_work_from_time_activity(
      p_organization_id, p_actor_id, p_job_id, v_job.execution_version
    );
  elsif v_job_state in ('execution_complete', 'handed_over', 'cancelled') then
    raise exception 'time_transition_job_terminal';
  end if;
end;
$$;

revoke all on function app_private.apply_time_activity_job_start(
  uuid, uuid, uuid, public.time_segment_kind
) from public, anon, authenticated;
grant execute on function app_private.apply_time_activity_job_start(
  uuid, uuid, uuid, public.time_segment_kind
) to service_role;

create or replace function app_private.transition_work_on_canonical_time_start()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform app_private.apply_time_activity_job_start(
    new.organization_id, new.created_by, new.job_id, new.kind
  );
  return new;
end;
$$;

create trigger transition_work_on_canonical_time_start
after insert on public.time_segments
for each row execute function app_private.transition_work_on_canonical_time_start();

revoke all on function app_private.transition_work_on_canonical_time_start()
from public, anon, authenticated;
