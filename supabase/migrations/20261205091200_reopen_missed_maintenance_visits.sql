-- A maintenance visit that did not happen never drops its due obligation.
--
-- * A manager records „Besuch hat nicht stattgefunden“ on a due item with a
--   visit job: the item returns to `open` with its due date, without the job
--   and the appointment, and its history names the missed job and the reason.
-- * Cancelling a visit job reopens its uncompleted due items the same way, in
--   the transaction of the cancellation.
-- * The workspace page reader filters and counts overdue due work: open or
--   with a visit job, due before the caller's Berlin today.
--
-- The previous page reader `list_maintenance_workspace_page` stays for the
-- previous release's code and now reads through the new one; a later release
-- drops it.

alter type public.maintenance_due_event_type add value if not exists 'visit_missed';

create type public.maintenance_missed_visit_reason as enum (
  'customer_absent', 'customer_cancelled', 'postponed', 'other', 'job_cancelled'
);

-- The missed job lives in the history, never in maintenance_due_work.job_id:
-- an open item has no job (maintenance_due_work_visit_shape).
-- @destructive: after release 55088f06f04b: the deployed build never writes the two new columns, and the key accepts their null
alter table public.maintenance_due_work_events
  add column missed_job_id uuid,
  add column missed_reason public.maintenance_missed_visit_reason,
  add constraint maintenance_due_work_events_missed_job_fkey
    foreign key (missed_job_id, organization_id)
    references public.jobs(id, organization_id) on delete no action;
-- @destructive: after release 55088f06f04b: the deployed build never writes the two new columns, and the rule accepts both null
alter table public.maintenance_due_work_events
  add constraint maintenance_due_work_events_missed_shape
    check ((missed_job_id is null) = (missed_reason is null)) not valid;
create index maintenance_due_work_events_missed_job_idx
  on public.maintenance_due_work_events (missed_job_id, organization_id)
  where missed_job_id is not null;

-- Returns one due item with a visit job to `open` and records the missed
-- visit. The caller holds the item's row lock and has checked its state.
create function app_private.reopen_missed_maintenance_due_work(
  p_before public.maintenance_due_work,
  p_missed_reason public.maintenance_missed_visit_reason,
  p_reason text,
  p_actor_id uuid,
  p_request_operation text,
  p_idempotency_key uuid,
  p_request_payload jsonb
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_after public.maintenance_due_work%rowtype;
  v_previous_write text := coalesce(current_setting('app.maintenance_write', true), '');
begin
  perform set_config('app.maintenance_write', 'true', true);
  update public.maintenance_due_work due_work set status = 'open',
    job_id = null, planning_occurrence_id = null, version = due_work.version + 1,
    updated_by = p_actor_id, updated_at = now()
  where due_work.id = p_before.id and due_work.organization_id = p_before.organization_id
  returning * into v_after;
  perform set_config('app.maintenance_write', v_previous_write, true);
  insert into public.maintenance_due_work_events (
    organization_id, maintenance_due_work_id, event_type, actor_id, reason,
    request_operation, idempotency_key, request_payload, before_snapshot, after_snapshot,
    missed_job_id, missed_reason
  ) values (
    p_before.organization_id, p_before.id, 'visit_missed', p_actor_id,
    nullif(btrim(coalesce(p_reason, '')), ''), p_request_operation, p_idempotency_key,
    p_request_payload, to_jsonb(p_before), to_jsonb(v_after), p_before.job_id, p_missed_reason
  );
  return v_after;
end;
$$;

-- „Besuch hat nicht stattgefunden“: managers only, one item with a visit job,
-- the stated version, a reason code and for `other` a note.
create function public.record_maintenance_visit_missed(
  p_organization_id uuid,
  p_maintenance_due_work_id uuid,
  p_expected_version bigint,
  p_missed_reason public.maintenance_missed_visit_reason,
  p_note text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.maintenance_due_work
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.maintenance_due_work_events%rowtype;
  v_before public.maintenance_due_work%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_payload jsonb := jsonb_build_object('missedReason', p_missed_reason, 'note', v_note);
begin
  perform app_private.assert_maintenance_manager(p_organization_id, p_actor_id);
  perform app_private.lock_maintenance_operation(p_organization_id, 'due_visit_missed', p_idempotency_key);
  if p_missed_reason is null or p_missed_reason = 'job_cancelled' then
    raise exception 'maintenance_missed_reason_invalid';
  end if;
  if (p_missed_reason = 'other' and v_note is null)
     or (v_note is not null and length(v_note) not between 3 and 1000) then
    raise exception 'maintenance_reason_required';
  end if;
  select * into v_existing from public.maintenance_due_work_events event
  where event.organization_id = p_organization_id and event.request_operation = 'due_visit_missed'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.maintenance_due_work_id <> p_maintenance_due_work_id
       or v_existing.request_payload <> v_payload then raise exception 'maintenance_idempotency_conflict'; end if;
    return (select due_work from public.maintenance_due_work due_work
      where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id);
  end if;
  select * into v_before from public.maintenance_due_work due_work
  where due_work.id = p_maintenance_due_work_id and due_work.organization_id = p_organization_id for update;
  if not found then raise exception 'maintenance_due_not_found'; end if;
  if v_before.version <> p_expected_version then raise exception 'maintenance_stale_version'; end if;
  if v_before.status <> 'visit_created' then raise exception 'maintenance_due_visit_missed_not_allowed'; end if;
  return app_private.reopen_missed_maintenance_due_work(
    v_before, p_missed_reason, v_note, p_actor_id, 'due_visit_missed', p_idempotency_key, v_payload
  );
end;
$$;

-- A cancelled visit job reopens every due item it still holds; completed and
-- excepted items keep their state. One history entry per item, keyed by the
-- job's cancellation event.
create function app_private.reopen_maintenance_due_work_of_cancelled_job(
  p_organization_id uuid,
  p_job_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_cancellation_event_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_before public.maintenance_due_work%rowtype;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  if v_reason is not null and length(v_reason) < 3 then v_reason := null; end if;
  for v_before in
    select * from public.maintenance_due_work due_work
    where due_work.organization_id = p_organization_id and due_work.job_id = p_job_id
      and due_work.status = 'visit_created'
    order by due_work.id
    for update
  loop
    perform app_private.reopen_missed_maintenance_due_work(
      v_before, 'job_cancelled', v_reason, p_actor_id,
      'due_job_cancelled:' || v_before.id::text, p_cancellation_event_id,
      jsonb_build_object('missedReason', 'job_cancelled', 'jobId', p_job_id)
    );
  end loop;
end;
$$;

-- The lifecycle entry point of 20260827150600 with one addition: a job's
-- cancellation reopens its due maintenance work in the same transaction.
create or replace function public.transition_work_execution(
  p_organization_id uuid,
  p_actor_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_expected_version bigint,
  p_to_state public.work_execution_state,
  p_reason text default null,
  p_override_gates boolean default false
)
returns table (
  execution_state public.work_execution_state,
  execution_version bigint,
  event_id uuid,
  gate_snapshot jsonb,
  gate_fingerprint text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_origin text := coalesce(current_setting('app.work_transition_origin', true), '');
  v_result record;
begin
  if v_origin in ('p1_17_release', 'p1_17_withdrawal', 'p1_17_correction') then
    perform set_config('app.work_transition_origin', '', true);
    return query select * from app_private.transition_work_execution_for_handover(
      p_organization_id, p_actor_id, p_target_type, p_target_id,
      p_expected_version, p_to_state, p_reason, p_override_gates, v_origin
    );
    return;
  end if;
  if p_to_state = 'handed_over' then raise exception 'work_handover_release_required'; end if;
  select * into v_result from public.transition_work_execution_p1_15(
    p_organization_id, p_actor_id, p_target_type, p_target_id,
    p_expected_version, p_to_state, p_reason, p_override_gates
  ) transition;
  if p_to_state = 'cancelled' and p_target_type = 'job' then
    perform app_private.reopen_maintenance_due_work_of_cancelled_job(
      p_organization_id, p_target_id, p_actor_id, p_reason, v_result.event_id
    );
  end if;
  execution_state := v_result.execution_state;
  execution_version := v_result.execution_version;
  event_id := v_result.event_id;
  gate_snapshot := v_result.gate_snapshot;
  gate_fingerprint := v_result.gate_fingerprint;
  return next;
end;
$$;

-- One bounded page of each workspace list, as list_maintenance_workspace_page
-- (20261004160000) with the overdue rule: due work is überfällig when it is
-- open or has a visit job and its due date lies before p_today (the caller's
-- Berlin date). `overdue` counts the overdue rows the search matches; with
-- p_overdue_only the due list holds only those. Overdue rows sort first
-- because the due list sorts by due date.
create function public.read_maintenance_workspace_page(
  p_organization_id uuid,
  p_today date,
  p_due_through date,
  p_search text,
  p_overdue_only boolean,
  p_due_page integer,
  p_plan_page integer,
  p_coverage_page integer,
  p_page_size integer
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with settings as (
    select least(greatest(coalesce(p_page_size, 50), 1), 100) as size, lower(coalesce(p_search, '')) as needle
  ), plans as materialized (
    select plan.id, plan.updated_at,
      lower(concat_ws(' ',
        plan.plan_number, client.name, site.name,
        (select string_agg(concat_ws(' ', equipment.equipment_number, equipment.name), ' ')
          from public.maintenance_plan_revision_equipment link
          join public.installed_equipment equipment
            on equipment.id = link.equipment_id and equipment.organization_id = p_organization_id
          where link.organization_id = p_organization_id
            and link.maintenance_plan_revision_id = revision.id
            and equipment.archived_at is null and equipment.voided_at is null)
      )) as base_text,
      lower(coalesce(version.name, '')) as template_text
    from public.maintenance_plans plan
    join public.maintenance_plan_revisions revision
      on revision.id = plan.current_revision_id and revision.organization_id = p_organization_id
    left join public.work_template_versions version
      on version.id = revision.template_version_id and version.organization_id = p_organization_id
    left join public.clients client on client.id = plan.client_id and client.organization_id = p_organization_id
    left join public.client_sites site on site.id = plan.site_id and site.organization_id = p_organization_id
    where plan.organization_id = p_organization_id
  ), due as materialized (
    select due.id, due.due_date, due.due_date < p_today as overdue,
      concat_ws(' ', plans.base_text, lower(job.job_number)) as search_text
    from public.maintenance_due_work due
    join plans on plans.id = due.maintenance_plan_id
    left join public.jobs job on job.id = due.job_id and job.organization_id = p_organization_id
    where due.organization_id = p_organization_id
      and due.status in ('open', 'visit_created')
      and due.due_date <= p_due_through
  ), coverages as materialized (
    select coverage.id, coverage.updated_at,
      lower(concat_ws(' ', coverage.coverage_number, coverage.reference, client.name, site.name)) as search_text
    from public.maintenance_coverages coverage
    left join public.clients client on client.id = coverage.client_id and client.organization_id = p_organization_id
    left join public.client_sites site on site.id = coverage.site_id and site.organization_id = p_organization_id
    where coverage.organization_id = p_organization_id
  ), searched_due as materialized (
    select due.* from due, settings
    where settings.needle = '' or strpos(due.search_text, settings.needle) > 0
  ), matching_due as materialized (
    select searched_due.* from searched_due
    where not coalesce(p_overdue_only, false) or searched_due.overdue
  ), matching_plans as materialized (
    select plans.* from plans, settings
    where settings.needle = '' or strpos(concat_ws(' ', plans.base_text, plans.template_text), settings.needle) > 0
  ), matching_coverages as materialized (
    select coverages.* from coverages, settings
    where settings.needle = '' or strpos(coverages.search_text, settings.needle) > 0
  ), due_page as (
    select matching_due.* from matching_due
    order by matching_due.due_date, matching_due.id
    limit (select size from settings)
    offset (greatest(coalesce(p_due_page, 1), 1)::bigint - 1) * (select size from settings)
  ), plan_page as (
    select matching_plans.* from matching_plans
    order by matching_plans.updated_at desc, matching_plans.id
    limit (select size from settings)
    offset (greatest(coalesce(p_plan_page, 1), 1)::bigint - 1) * (select size from settings)
  ), coverage_page as (
    select matching_coverages.* from matching_coverages
    order by matching_coverages.updated_at desc, matching_coverages.id
    limit (select size from settings)
    offset (greatest(coalesce(p_coverage_page, 1), 1)::bigint - 1) * (select size from settings)
  ) select jsonb_build_object(
    'due', jsonb_build_object(
      'total', (select count(*) from matching_due),
      'overdue', (select count(*) from searched_due where searched_due.overdue),
      'hasAny', exists (select 1 from due),
      'ids', coalesce((select jsonb_agg(due_page.id order by due_page.due_date, due_page.id) from due_page), '[]')
    ),
    'plans', jsonb_build_object(
      'total', (select count(*) from matching_plans),
      'hasAny', exists (select 1 from plans),
      'ids', coalesce((select jsonb_agg(plan_page.id order by plan_page.updated_at desc, plan_page.id) from plan_page), '[]')
    ),
    'coverages', jsonb_build_object(
      'total', (select count(*) from matching_coverages),
      'hasAny', exists (select 1 from coverages),
      'ids', coalesce((select jsonb_agg(coverage_page.id order by coverage_page.updated_at desc, coverage_page.id) from coverage_page), '[]')
    )
  );
$$;

-- The previous release's entry point: every due item, the same pages.
create or replace function public.list_maintenance_workspace_page(
  p_organization_id uuid,
  p_due_through date,
  p_search text default '',
  p_due_page integer default 1,
  p_plan_page integer default 1,
  p_coverage_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select public.read_maintenance_workspace_page(
    p_organization_id, (now() at time zone 'Europe/Berlin')::date, p_due_through, p_search, false,
    p_due_page, p_plan_page, p_coverage_page, p_page_size
  );
$$;

revoke all on function app_private.reopen_missed_maintenance_due_work(
  public.maintenance_due_work, public.maintenance_missed_visit_reason, text, uuid, text, uuid, jsonb
) from public, anon, authenticated;
grant execute on function app_private.reopen_missed_maintenance_due_work(
  public.maintenance_due_work, public.maintenance_missed_visit_reason, text, uuid, text, uuid, jsonb
) to service_role;
revoke all on function app_private.reopen_maintenance_due_work_of_cancelled_job(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function app_private.reopen_maintenance_due_work_of_cancelled_job(uuid, uuid, uuid, text, uuid)
  to service_role;
revoke all on function public.record_maintenance_visit_missed(
  uuid, uuid, bigint, public.maintenance_missed_visit_reason, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.record_maintenance_visit_missed(
  uuid, uuid, bigint, public.maintenance_missed_visit_reason, text, uuid, uuid
) to service_role;
revoke all on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) from public, anon, authenticated;
grant execute on function public.transition_work_execution(
  uuid, uuid, text, uuid, bigint, public.work_execution_state, text, boolean
) to service_role;
revoke all on function public.read_maintenance_workspace_page(
  uuid, date, date, text, boolean, integer, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.read_maintenance_workspace_page(
  uuid, date, date, text, boolean, integer, integer, integer, integer
) to service_role;
