-- The week, the member status and the clock read the approved corrections of
-- one person's window on every read. read_time_correction_applications found
-- them by unpacking the JSON snapshots of every application of the
-- organization, so each read touched the organization's whole correction
-- history (werk-flow/werkflow-planning#610). Each application now writes, in
-- its own transaction, the span of each person's facts per snapshot into a
-- side table, and the read starts from an index on organization, person and
-- span. The approval also signals a person it moves time to, so their open
-- views read again (section 4).

-- 1. One row per application, snapshot and person: the first and last fact
-- timestamp of that person in that snapshot. Both snapshots count: moving time
-- out of a window still suppresses its original source there.
create table public.time_correction_application_spans (
  application_id uuid not null references public.time_correction_applications (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  snapshot text not null check (snapshot in ('before', 'after')),
  user_id uuid not null,
  span tstzrange not null,
  primary key (application_id, snapshot, user_id)
);
-- Range overlap with an equality on organization and person (btree_gist).
create index time_correction_application_spans_person_span_idx
  on public.time_correction_application_spans using gist (organization_id, user_id, span);
create index time_correction_application_spans_organization_id_fk_idx
  on public.time_correction_application_spans (organization_id);

-- RLS without a policy: only the server reads it, through the function below;
-- only the trigger writes it.
alter table public.time_correction_application_spans enable row level security;
revoke all on table public.time_correction_application_spans from public, anon, authenticated, service_role;
grant select on table public.time_correction_application_spans to service_role;

-- 2. The spans of one application, from its two snapshots. A fact without a
-- person or a time names no one's window.
create function app_private.time_correction_snapshot_spans(p_before jsonb, p_after jsonb)
returns table (snapshot text, user_id uuid, span tstzrange)
language sql immutable set search_path to '' as $$
  select facts.snapshot, (facts.fact ->> 'userId')::uuid,
    pg_catalog.tstzrange(min((facts.fact ->> 'timestamp')::timestamptz), max((facts.fact ->> 'timestamp')::timestamptz), '[]')
  from (
    select 'before' as snapshot, fact from pg_catalog.jsonb_array_elements(p_before -> 'facts') fact
    union all
    select 'after', fact from pg_catalog.jsonb_array_elements(p_after -> 'facts') fact
  ) facts
  where facts.fact ->> 'userId' is not null and facts.fact ->> 'timestamp' is not null
  group by facts.snapshot, (facts.fact ->> 'userId')::uuid;
$$;
revoke all on function app_private.time_correction_snapshot_spans(jsonb, jsonb) from public, anon, authenticated, service_role;

-- 3. Applications are immutable (guard_time_correction_applications_immutable),
-- so an insert is the only write that changes their spans.
create function app_private.record_time_correction_application()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_record record;
begin
  insert into public.time_correction_application_spans (application_id, organization_id, snapshot, user_id, span)
  select new.id, new.organization_id, spans.snapshot, spans.user_id, spans.span
  from app_private.time_correction_snapshot_spans(new.before_snapshot, new.applied_snapshot) spans;

  -- 4. A person the correction moves time to cannot read the request, so no
  -- time_correction_requests event reaches their open views. Their own
  -- employment_target_signals row carries only ids and a timestamp, and only
  -- they select it (20270503090002_signal_target_changes_to_the_employee.sql).
  -- The subject hears of the request itself. Records are locked in id order,
  -- as signal_employment_target_change does, so a concurrent relink commits
  -- first and the login that holds the record now gets the signal.
  for v_record in
    select employee.id, employee.organization_id, employee.user_id
    from public.employee_records employee
    where employee.organization_id = new.organization_id
      and employee.user_id is not null
      and employee.id in (
        select (fact ->> 'employeeRecordId')::uuid
        from (
          select fact from pg_catalog.jsonb_array_elements(new.before_snapshot -> 'facts') fact
          union all
          select fact from pg_catalog.jsonb_array_elements(new.applied_snapshot -> 'facts') fact
        ) facts
        where fact ->> 'employeeRecordId' is not null
      )
      and employee.id <> (
        select request.subject_employee_record_id from public.time_correction_requests request
        where request.id = new.request_id and request.organization_id = new.organization_id
      )
    order by employee.id
    for share
  loop
    insert into public.employment_target_signals (organization_id, employee_record_id, user_id)
    values (v_record.organization_id, v_record.id, v_record.user_id)
    on conflict (employee_record_id) do update set updated_at = now()
    where public.employment_target_signals.user_id = excluded.user_id;
  end loop;
  return null;
end;
$$;
revoke all on function app_private.record_time_correction_application() from public, anon, authenticated, service_role;

create trigger record_time_correction_application
  after insert on public.time_correction_applications
  for each row execute function app_private.record_time_correction_application();

-- The applications approved before this migration.
insert into public.time_correction_application_spans (application_id, organization_id, snapshot, user_id, span)
select application.id, application.organization_id, spans.snapshot, spans.user_id, spans.span
from public.time_correction_applications application
cross join lateral app_private.time_correction_snapshot_spans(application.before_snapshot, application.applied_snapshot) spans;

-- 5. The read, same signature and rows as before. Without person and window it
-- returns the organization's history (correction validation). Otherwise it
-- starts from the spans: a fact interval that overlaps the window, inclusive at
-- both ends, includes overnight facts whose endpoints lie outside it. Each
-- branch's parameter test is a one-time filter, so only one branch runs.
create or replace function public.read_time_correction_applications(
  p_organization_id uuid,
  p_user_ids uuid[] default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns setof public.time_correction_applications
language sql stable security invoker set search_path = '' as $$
  select application.* from public.time_correction_applications application
  where application.organization_id = p_organization_id
    and p_user_ids is null and p_from is null and p_to is null
  union all
  select application.* from public.time_correction_applications application
  where application.organization_id = p_organization_id
    and p_user_ids is not null
    and application.id in (
      select span.application_id from public.time_correction_application_spans span
      where span.organization_id = p_organization_id
        and span.user_id = any (p_user_ids)
        and span.span && pg_catalog.tstzrange(p_from, p_to, '[]')
    )
  union all
  select application.* from public.time_correction_applications application
  where application.organization_id = p_organization_id
    and p_user_ids is null and (p_from is not null or p_to is not null)
    and application.id in (
      select span.application_id from public.time_correction_application_spans span
      where span.organization_id = p_organization_id
        and span.span && pg_catalog.tstzrange(p_from, p_to, '[]')
    );
$$;
