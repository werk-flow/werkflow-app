
create or replace function public.set_planning_occurrence_status(
  p_organization_id uuid,
  p_actor_id uuid,
  p_occurrence_id uuid,
  p_expected_version integer,
  p_status public.planning_occurrence_status,
  p_reason text
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_before public.planning_occurrences%rowtype;
  v_after public.planning_occurrences%rowtype;
  v_projection record;
begin
  if p_status not in ('skipped', 'cancelled') then
    raise exception 'invalid_planning_status';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'planning_reason_required';
  end if;

  select * into v_before
  from public.planning_occurrences
  where id = p_occurrence_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'planning_occurrence_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'stale_planning_occurrence'; end if;
  if (v_before.start_at is not null and v_before.start_at <= now())
     or (v_before.start_date is not null
         and v_before.start_date <= (now() at time zone 'Europe/Berlin')::date) then
    raise exception 'started_planning_occurrence_immutable';
  end if;

  update public.planning_occurrences
  set status = p_status,
      is_exception = series_id is not null or is_exception,
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = now()
  where id = p_occurrence_id
  returning * into v_after;

  insert into public.planning_events (
    organization_id, series_id, occurrence_id, event_type, mutation_scope,
    before_state, after_state, reason, created_by
  ) values (
    p_organization_id, v_before.series_id, p_occurrence_id,
    case when p_status = 'skipped' then 'skipped' else 'cancelled' end,
    'one', to_jsonb(v_before), to_jsonb(v_after), trim(p_reason), p_actor_id
  );

  if v_before.job_id is not null then
    select occurrence.start_at, occurrence.start_date, occurrence.end_at
    into v_projection
    from public.planning_occurrences occurrence
    where occurrence.organization_id = p_organization_id
      and occurrence.job_id = v_before.job_id
      and occurrence.status = 'scheduled'
    order by coalesce(occurrence.start_at, occurrence.start_date::timestamptz)
    limit 1;

    perform set_config('app.planning_projection_write', 'true', true);
    update public.jobs
    set planned_date = case when v_projection.start_at is null and v_projection.start_date is null
          then null
          else coalesce(
            (v_projection.start_at at time zone 'Europe/Berlin')::date,
            v_projection.start_date
          )
        end,
        planned_time = case when v_projection.start_at is null then null
          else (v_projection.start_at at time zone 'Europe/Berlin')::time end,
        updated_at = now()
    where id = v_before.job_id and organization_id = p_organization_id;
  end if;

  return v_after.version;
end;
$$;

revoke all on function public.set_planning_occurrence_status(
  uuid, uuid, uuid, integer, public.planning_occurrence_status, text
) from public, anon, authenticated;
grant execute on function public.set_planning_occurrence_status(
  uuid, uuid, uuid, integer, public.planning_occurrence_status, text
) to service_role;
