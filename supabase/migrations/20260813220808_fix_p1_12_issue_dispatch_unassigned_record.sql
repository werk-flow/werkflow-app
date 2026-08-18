-- plpgsql binds record fields eagerly even inside untaken CASE branches, so
-- the job-targeted path failed with 55000 ("v_occurrence is not assigned").
-- Use plain scalars for the planned-schedule snapshot instead.

create or replace function public.issue_planning_dispatch(
  p_organization_id uuid,
  p_actor_id uuid,
  p_occurrence_id uuid default null,
  p_job_id uuid default null,
  p_recipient_employee_record_ids uuid[] default null,
  p_note text default null,
  p_readiness_snapshot jsonb default null,
  p_readiness_fingerprint text default null,
  p_request_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_existing uuid;
  v_occurrence record;
  v_job record;
  v_recipients uuid[];
  v_dispatch_id uuid;
  v_revision_id uuid;
  v_fingerprint text;
  v_schedule_text text;
  v_location text;
  v_site uuid;
  v_valid_count integer;
  v_planned_start_at timestamptz;
  v_planned_end_at timestamptz;
  v_planned_start_date date;
  v_planned_end_date_exclusive date;
begin
  if p_request_id is null then
    raise exception 'dispatch_request_id_required';
  end if;
  if (p_occurrence_id is null) = (p_job_id is null) then
    raise exception 'dispatch_target_invalid';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_organization_id::text || ':dispatch:' || p_request_id::text)
  );
  select id into v_existing
  from public.planning_dispatches
  where organization_id = p_organization_id and creation_request_id = p_request_id;
  if found then
    return v_existing;
  end if;

  if p_occurrence_id is not null then
    select * into v_occurrence
    from public.planning_occurrences
    where id = p_occurrence_id and organization_id = p_organization_id
    for update;
    if not found or v_occurrence.entry_kind <> 'job_visit' then
      raise exception 'dispatch_occurrence_not_found';
    end if;
    if v_occurrence.status <> 'scheduled' then
      raise exception 'dispatch_occurrence_not_scheduled';
    end if;
    select * into v_job from public.jobs
    where id = v_occurrence.job_id and organization_id = p_organization_id;
    if not found or v_job.status in ('geparkt', 'fertig') then
      raise exception 'dispatch_job_not_dispatchable';
    end if;
    select coalesce(array_agg(a.employee_record_id), '{}'::uuid[])
    into v_recipients
    from public.planning_occurrence_assignments a
    where a.occurrence_id = p_occurrence_id;
    if coalesce(array_length(v_recipients, 1), 0) = 0 then
      raise exception 'dispatch_requires_recipients';
    end if;
    v_planned_start_at := v_occurrence.start_at;
    v_planned_end_at := v_occurrence.end_at;
    v_planned_start_date := v_occurrence.start_date;
    v_planned_end_date_exclusive := v_occurrence.end_date_exclusive;
    v_schedule_text := coalesce(
      v_planned_start_at::text || '/' || v_planned_end_at::text,
      v_planned_start_date::text || '/' || v_planned_end_date_exclusive::text,
      'unscheduled'
    );
    v_location := coalesce(v_occurrence.location, v_job.location);
    v_site := v_job.site_id;
  else
    select * into v_job from public.jobs
    where id = p_job_id and organization_id = p_organization_id
    for update;
    if not found then
      raise exception 'dispatch_job_not_found';
    end if;
    if v_job.status = 'fertig' then
      raise exception 'dispatch_job_not_dispatchable';
    end if;
    if exists (
      select 1 from public.planning_occurrences o
      where o.job_id = p_job_id and o.status = 'scheduled'
    ) then
      raise exception 'dispatch_job_has_scheduled_visits';
    end if;
    v_recipients := (
      select coalesce(array_agg(distinct r), '{}'::uuid[])
      from unnest(coalesce(p_recipient_employee_record_ids, '{}'::uuid[])) r
    );
    if coalesce(array_length(v_recipients, 1), 0) = 0 then
      raise exception 'dispatch_requires_recipients';
    end if;
    select count(*) into v_valid_count
    from public.employee_records er
    where er.organization_id = p_organization_id and er.id = any (v_recipients);
    if v_valid_count <> array_length(v_recipients, 1) then
      raise exception 'dispatch_recipient_not_found';
    end if;
    v_schedule_text := 'unscheduled';
    v_location := v_job.location;
    v_site := v_job.site_id;
  end if;

  v_fingerprint := app_private.compute_dispatch_material_fingerprint(
    case when p_occurrence_id is not null
      then 'occurrence:' || p_occurrence_id::text
      else 'job:' || p_job_id::text end,
    v_schedule_text,
    v_location,
    v_site::text,
    p_note,
    v_recipients
  );

  insert into public.planning_dispatches (
    organization_id, occurrence_id, job_id, status, creation_request_id, created_by
  ) values (
    p_organization_id, p_occurrence_id, p_job_id, 'active', p_request_id, p_actor_id
  ) returning id into v_dispatch_id;

  insert into public.planning_dispatch_revisions (
    organization_id, dispatch_id, revision_number, change_kind,
    occurrence_id, job_id,
    planned_start_at, planned_end_at, planned_start_date, planned_end_date_exclusive,
    location_text, site_id, dispatch_note, material_fingerprint,
    readiness_snapshot, readiness_fingerprint, created_by
  ) values (
    p_organization_id, v_dispatch_id, 1, 'issued',
    p_occurrence_id, p_job_id,
    v_planned_start_at, v_planned_end_at,
    v_planned_start_date, v_planned_end_date_exclusive,
    v_location, v_site, nullif(btrim(coalesce(p_note, '')), ''), v_fingerprint,
    p_readiness_snapshot, p_readiness_fingerprint, p_actor_id
  ) returning id into v_revision_id;

  insert into public.planning_dispatch_recipients
    (organization_id, dispatch_id, revision_id, employee_record_id)
  select p_organization_id, v_dispatch_id, v_revision_id, r
  from unnest(v_recipients) r;

  update public.planning_dispatches
  set current_revision_id = v_revision_id
  where id = v_dispatch_id;

  insert into public.planning_dispatch_events
    (organization_id, dispatch_id, revision_id, event_type, payload, created_by)
  values (
    p_organization_id, v_dispatch_id, v_revision_id, 'issued',
    jsonb_build_object(
      'target', case when p_occurrence_id is not null then 'occurrence' else 'job' end,
      'recipientCount', array_length(v_recipients, 1)
    ),
    p_actor_id
  );

  return v_dispatch_id;
end;
$$;