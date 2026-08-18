
create or replace function app_private.prevent_planning_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (
    select 1
    from public.organizations
    where id = old.organization_id
  ) then
    return old;
  end if;

  raise exception 'planning history is append-only';
end;
$$;

create or replace function app_private.sync_legacy_job_planning_occurrence()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  occurrence_id uuid;
begin
  if current_setting('app.planning_projection_write', true) = 'true' then
    return new;
  end if;

  if new.planned_date is null then
    update public.planning_occurrences
    set
      status = 'cancelled',
      version = version + 1,
      updated_at = now()
    where legacy_source_job_id = new.id
      and status <> 'cancelled'
    returning id into occurrence_id;
  else
    insert into public.planning_occurrences (
      organization_id,
      job_id,
      entry_kind,
      time_kind,
      start_at,
      end_at,
      start_date,
      end_date_exclusive,
      timezone,
      status,
      is_exception,
      legacy_source_job_id,
      created_by,
      updated_by
    )
    values (
      new.organization_id,
      new.id,
      'job_visit',
      case
        when new.planned_time is null then 'all_day'::public.planning_time_kind
        else 'timed'::public.planning_time_kind
      end,
      case
        when new.planned_time is not null
          then (new.planned_date + new.planned_time) at time zone 'Europe/Berlin'
        else null
      end,
      case
        when new.planned_time is not null
          then ((new.planned_date + new.planned_time) at time zone 'Europe/Berlin')
            + make_interval(mins => coalesce(new.estimated_duration_minutes, 60))
        else null
      end,
      case when new.planned_time is null then new.planned_date else null end,
      case when new.planned_time is null then new.planned_date + 1 else null end,
      'Europe/Berlin',
      'scheduled',
      false,
      new.id,
      new.created_by,
      new.created_by
    )
    on conflict (legacy_source_job_id)
      where legacy_source_job_id is not null
    do update set
      organization_id = excluded.organization_id,
      job_id = excluded.job_id,
      time_kind = excluded.time_kind,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      start_date = excluded.start_date,
      end_date_exclusive = excluded.end_date_exclusive,
      status = 'scheduled',
      version = public.planning_occurrences.version + 1,
      updated_at = now()
    returning id into occurrence_id;
  end if;

  if occurrence_id is not null and tg_op = 'UPDATE' then
    insert into public.planning_events (
      organization_id,
      occurrence_id,
      event_type,
      mutation_scope,
      after_state
    )
    values (
      new.organization_id,
      occurrence_id,
      'legacy_synced',
      'system',
      jsonb_build_object(
        'planned_date', new.planned_date,
        'planned_time', new.planned_time,
        'estimated_duration_minutes', new.estimated_duration_minutes
      )
    );
  end if;

  return new;
end;
$$;

create or replace function app_private.sync_legacy_job_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_job_id uuid;
  target_user_id uuid;
  target_organization_id uuid;
  target_occurrence_id uuid;
  target_employee_record_id uuid;
begin
  target_job_id := case when tg_op = 'DELETE' then old.job_id else new.job_id end;
  target_user_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;

  select j.organization_id, o.id
    into target_organization_id, target_occurrence_id
  from public.jobs j
  join public.planning_occurrences o on o.legacy_source_job_id = j.id
  where j.id = target_job_id;

  if target_occurrence_id is null then
    return coalesce(new, old);
  end if;

  select id into target_employee_record_id
  from public.employee_records
  where organization_id = target_organization_id
    and user_id = target_user_id;

  if target_employee_record_id is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    delete from public.planning_occurrence_assignments
    where occurrence_id = target_occurrence_id
      and employee_record_id = target_employee_record_id;
  else
    insert into public.planning_occurrence_assignments (
      organization_id,
      occurrence_id,
      employee_record_id,
      assigned_by,
      assigned_at
    )
    values (
      target_organization_id,
      target_occurrence_id,
      target_employee_record_id,
      new.assigned_by,
      new.assigned_at
    )
    on conflict (occurrence_id, employee_record_id) do nothing;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function app_private.sync_legacy_job_planning_occurrence() from public, anon, authenticated;
revoke all on function app_private.sync_legacy_job_assignment() from public, anon, authenticated;

create trigger jobs_sync_legacy_planning_insert
after insert on public.jobs
for each row
when (new.planned_date is not null)
execute function app_private.sync_legacy_job_planning_occurrence();

create trigger jobs_sync_legacy_planning_update
after update of planned_date, planned_time, estimated_duration_minutes on public.jobs
for each row
when (
  old.planned_date is distinct from new.planned_date
  or old.planned_time is distinct from new.planned_time
  or old.estimated_duration_minutes is distinct from new.estimated_duration_minutes
)
execute function app_private.sync_legacy_job_planning_occurrence();

create trigger job_assignments_sync_legacy_planning_insert
after insert on public.job_assignments
for each row execute function app_private.sync_legacy_job_assignment();

create trigger job_assignments_sync_legacy_planning_delete
after delete on public.job_assignments
for each row execute function app_private.sync_legacy_job_assignment();
