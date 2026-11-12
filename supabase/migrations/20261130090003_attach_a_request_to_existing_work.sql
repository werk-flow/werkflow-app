-- Triage attaches an open request to existing work of its customer, once
-- (werk-flow/werkflow-planning#328). Until now a new message about running
-- work could only become new work or be closed.
--
-- One call writes the request's summary and details into the work's history
-- (work_request_entries), links the request's documents to the work as a
-- second link to the same file, marks the request 'hinzugefuegt' and records
-- the 'attached' request history row. A request has one entry at most
-- (unique request_id). A retry under the attempt key of the attach returns
-- its entry and writes nothing; any other second attach is refused.
--
-- Expand-only: a new enum value, a new table and new functions. The work
-- delete guard is replaced with one more kind of history.
--
-- Prevention: Tier 1, the unique request_id of work_request_entries; Tier 2,
-- supabase/tests/request_attach_to_work.sql.

alter type public.request_status add value if not exists 'hinzugefuegt';

-- One row per attached request: the entry in the history of the job, project
-- or Servicefall it was attached to, and the link between request and work.
-- Append-only: the server inserts through attach_client_request_to_work and
-- reads; the ledger guard below refuses any update or delete but the cascade
-- of a deleted request, work or organization.
create table public.work_request_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.client_requests(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  service_case_id uuid,
  -- The request's words when it was attached; a later request edit is refused
  -- because the request is no longer open.
  summary text not null,
  details text,
  attempt_key uuid not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint work_request_entries_one_request unique (request_id),
  constraint work_request_entries_one_target check (
    num_nonnulls(job_id, project_id, service_case_id) = 1
  ),
  foreign key (service_case_id, organization_id)
    references public.service_cases(id, organization_id) on delete cascade
);

create index work_request_entries_job_idx
  on public.work_request_entries (organization_id, job_id, created_at)
  where job_id is not null;
create index work_request_entries_project_idx
  on public.work_request_entries (organization_id, project_id, created_at)
  where project_id is not null;
create index work_request_entries_service_case_idx
  on public.work_request_entries (organization_id, service_case_id, created_at)
  where service_case_id is not null;

-- A backstop under the attach function: request and work belong to the
-- entry's organization and to the same customer.
create function app_private.validate_work_request_entry()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request_client_id uuid;
  v_work_client_id uuid;
begin
  select request.client_id into v_request_client_id
  from public.client_requests request
  where request.id = new.request_id and request.organization_id = new.organization_id;
  if v_request_client_id is null then
    raise exception 'work_request_entry request must belong to the organization and a customer';
  end if;

  if new.job_id is not null then
    select job.client_id into v_work_client_id from public.jobs job
    where job.id = new.job_id and job.organization_id = new.organization_id;
  elsif new.project_id is not null then
    select project.client_id into v_work_client_id from public.projects project
    where project.id = new.project_id and project.organization_id = new.organization_id;
  else
    select service_case.client_id into v_work_client_id from public.service_cases service_case
    where service_case.id = new.service_case_id and service_case.organization_id = new.organization_id;
  end if;
  if v_work_client_id is distinct from v_request_client_id then
    raise exception 'work_request_entry work must belong to the request''s customer';
  end if;
  return new;
end;
$$;

create trigger work_request_entries_validate
  before insert on public.work_request_entries
  for each row execute function app_private.validate_work_request_entry();

-- History is append-only, also for privileged roles; the cascade of a
-- deleted request, work or organization still removes its entries.
create trigger guard_event_ledger_history
  before update or delete on public.work_request_entries
  for each row execute function app_private.guard_event_ledger_history();

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.work_request_entries enable row level security;

-- Valid under revoked default privileges (migration 20260928095752) and under
-- the old automatic grants alike: remove everything, then grant what is used.
revoke all on table public.work_request_entries from public, anon, authenticated, service_role;
grant select, insert on table public.work_request_entries to service_role;

-- Work with an attached request has history: it is not deleted, as work with
-- lifecycle events, blockers, dependencies or artifacts is not.
create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if pg_trigger_depth() > 1 and old.organization_id::text = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) then return old; end if;

  if tg_table_name = 'jobs' and (
    exists (select 1 from public.work_execution_events event where event.job_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.job_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_job_id = old.id or dependency.predecessor_job_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.job_id = old.id)
    or exists (select 1 from public.work_request_entries entry where entry.job_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;

  if tg_table_name = 'projects' and (
    exists (select 1 from public.work_execution_events event where event.project_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.project_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_project_id = old.id or dependency.predecessor_project_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.project_id = old.id)
    or exists (select 1 from public.work_request_entries entry where entry.project_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;
  return old;
end;
$function$;

-- Attaches an open request with a customer to one open job, project or
-- Servicefall of that customer: writes the work's history entry, links the
-- request's documents to the work with their audit events, marks the request
-- 'hinzugefuegt', records the 'attached' request history row and touches the
-- work, so its open views refresh. Exactly one of p_job_id, p_project_id and
-- p_service_case_id names the work. A retry under the attempt key of the
-- attach to that work returns its entry and writes nothing.
-- Refusals: invalid_input, not_authorized, request_not_found,
-- already_attached, request_not_editable, client_required, work_not_found,
-- work_client_mismatch, work_closed.
create function public.attach_client_request_to_work(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_job_id uuid,
  p_project_id uuid,
  p_service_case_id uuid,
  p_attempt_key uuid
)
returns public.work_request_entries
language plpgsql
-- Definer, as the other request writes are: it takes the manager lock
-- (app_private.lock_request_manager), which no client role may call.
security definer
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_entry public.work_request_entries;
  v_work_client_id uuid;
  v_work_closed boolean;
  v_work_number text;
  v_target text;
begin
  if p_organization_id is null or p_actor_id is null or p_request_id is null
    or p_attempt_key is null or num_nonnulls(p_job_id, p_project_id, p_service_case_id) <> 1
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_request_manager(p_organization_id, p_actor_id);

  select * into v_request from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for update;
  if not found then raise exception 'request_not_found'; end if;

  select * into v_entry from public.work_request_entries entry
  where entry.organization_id = p_organization_id and entry.request_id = p_request_id;
  if found then
    if v_entry.attempt_key = p_attempt_key
      and v_entry.job_id is not distinct from p_job_id
      and v_entry.project_id is not distinct from p_project_id
      and v_entry.service_case_id is not distinct from p_service_case_id
    then
      return v_entry;
    end if;
    raise exception 'already_attached';
  end if;

  if v_request.status not in ('offen', 'in_klaerung') then raise exception 'request_not_editable'; end if;
  if v_request.client_id is null then raise exception 'client_required'; end if;

  -- The work row is locked, so a concurrent close waits for this attach or
  -- makes it refuse.
  if p_job_id is not null then
    v_target := 'job';
    select job.client_id, job.job_number,
      coalesce(job.execution_state, app_private.resolve_legacy_job_execution_state(job.status))
        in ('execution_complete', 'handed_over', 'cancelled')
    into v_work_client_id, v_work_number, v_work_closed
    from public.jobs job
    where job.organization_id = p_organization_id and job.id = p_job_id
    for update;
  elsif p_project_id is not null then
    v_target := 'project';
    select project.client_id, project.project_number,
      app_private.resolve_project_execution_state(project.id)
        in ('execution_complete', 'handed_over', 'cancelled')
    into v_work_client_id, v_work_number, v_work_closed
    from public.projects project
    where project.organization_id = p_organization_id and project.id = p_project_id
    for update;
  else
    v_target := 'service_case';
    select service_case.client_id, service_case.case_number,
      service_case.status in ('resolved', 'closed_without_visit', 'duplicate')
    into v_work_client_id, v_work_number, v_work_closed
    from public.service_cases service_case
    where service_case.organization_id = p_organization_id and service_case.id = p_service_case_id
    for update;
  end if;
  if not found then raise exception 'work_not_found'; end if;
  if v_work_client_id is distinct from v_request.client_id then raise exception 'work_client_mismatch'; end if;
  if v_work_closed then raise exception 'work_closed'; end if;

  insert into public.work_request_entries (
    organization_id, request_id, job_id, project_id, service_case_id,
    summary, details, attempt_key, created_by
  ) values (
    p_organization_id, p_request_id, p_job_id, p_project_id, p_service_case_id,
    v_request.summary, v_request.details, p_attempt_key, p_actor_id
  )
  returning * into v_entry;

  update public.client_requests request
  set status = 'hinzugefuegt'
  where request.organization_id = p_organization_id and request.id = p_request_id;

  -- The request's documents, as a second link to the same file.
  with source_documents as (
    select distinct link.document_id from public.document_links link
    join public.documents document
      on document.id = link.document_id and document.organization_id = p_organization_id
    where link.organization_id = p_organization_id and link.request_id = p_request_id
      and document.deleted_at is null
  ),
  added as (
    insert into public.document_links (
      organization_id, document_id, job_id, project_id, service_case_id, created_by
    )
    select p_organization_id, source_documents.document_id, p_job_id, p_project_id, p_service_case_id,
      p_actor_id
    from source_documents
    where not exists (
      select 1 from public.document_links existing
      where existing.organization_id = p_organization_id
        and existing.document_id = source_documents.document_id
        and existing.job_id is not distinct from p_job_id
        and existing.project_id is not distinct from p_project_id
        and existing.service_case_id is not distinct from p_service_case_id
    )
    returning document_id
  )
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  )
  select p_organization_id, added.document_id, p_actor_id, 'linked',
    jsonb_strip_nulls(jsonb_build_object(
      'jobId', p_job_id, 'projectId', p_project_id, 'serviceCaseId', p_service_case_id,
      'requestId', p_request_id, 'via', 'request_attach'
    ))
  from added;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'attached',
    jsonb_build_object(
      'target', v_target, 'workNumber', v_work_number, 'entryId', v_entry.id,
      'attemptKey', p_attempt_key
    ) || jsonb_strip_nulls(jsonb_build_object(
      'jobId', p_job_id, 'projectId', p_project_id, 'serviceCaseId', p_service_case_id
    )),
    p_actor_id
  );

  -- The work changed: its published row signals its open views.
  if p_job_id is not null then
    update public.jobs job set updated_at = now()
    where job.organization_id = p_organization_id and job.id = p_job_id;
  elsif p_project_id is not null then
    update public.projects project set updated_at = now()
    where project.organization_id = p_organization_id and project.id = p_project_id;
  else
    perform set_config('app.service_case_write', 'true', true);
    update public.service_cases service_case set updated_at = now(), updated_by = p_actor_id
    where service_case.organization_id = p_organization_id and service_case.id = p_service_case_id;
    perform set_config('app.service_case_write', 'false', true);
  end if;

  return v_entry;
end;
$$;

-- The open work of the request's customer that the request can be attached
-- to, at most p_limit rows: jobs, projects and Servicefälle that are not
-- finished, at the request's site first, then the most recently changed,
-- filtered by number, title or site. A request without a customer has none.
-- Refusal: request_not_found.
create function public.list_request_work_targets(
  p_organization_id uuid,
  p_request_id uuid,
  p_search text,
  p_limit integer
)
returns table (
  kind text,
  id uuid,
  number text,
  title text,
  site_label text,
  at_request_site boolean,
  updated_at timestamptz
)
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
  v_client_id uuid;
  v_site_id uuid;
  v_search text := lower(btrim(coalesce(p_search, '')));
begin
  select request.client_id, request.site_id into v_client_id, v_site_id
  from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id;
  if not found then raise exception 'request_not_found'; end if;
  if v_client_id is null then return; end if;

  return query
  with work as (
    select 'job'::text as kind, job.id, job.job_number as number, job.title, job.site_id, job.updated_at
    from public.jobs job
    where job.organization_id = p_organization_id and job.client_id = v_client_id
      and coalesce(job.execution_state, app_private.resolve_legacy_job_execution_state(job.status))
        not in ('execution_complete', 'handed_over', 'cancelled')
    union all
    select 'project'::text, project.id, project.project_number, project.name, project.site_id,
      project.updated_at
    from public.projects project
    where project.organization_id = p_organization_id and project.client_id = v_client_id
      and app_private.resolve_project_execution_state(project.id)
        not in ('execution_complete', 'handed_over', 'cancelled')
    union all
    select 'service_case'::text, service_case.id, service_case.case_number, service_case.summary,
      service_case.site_id, service_case.updated_at
    from public.service_cases service_case
    where service_case.organization_id = p_organization_id and service_case.client_id = v_client_id
      and service_case.status not in ('resolved', 'closed_without_visit', 'duplicate')
  ),
  labelled as (
    select work.kind, work.id, work.number, work.title,
      nullif(concat_ws(' · ', nullif(site.name, ''), nullif(concat_ws(', ', nullif(site.street, ''),
        nullif(concat_ws(' ', nullif(site.postal_code, ''), nullif(site.city, '')), '')), '')), '')
        as site_label,
      coalesce(work.site_id = v_site_id, false) as at_request_site,
      work.updated_at
    from work
    left join public.client_sites site
      on site.organization_id = p_organization_id and site.id = work.site_id
  )
  select labelled.kind, labelled.id, labelled.number, labelled.title, labelled.site_label,
    labelled.at_request_site, labelled.updated_at
  from labelled
  where v_search = ''
    or strpos(lower(concat_ws(' ', labelled.number, labelled.title, labelled.site_label)), v_search) > 0
  order by labelled.at_request_site desc, labelled.updated_at desc, labelled.id
  limit least(greatest(coalesce(p_limit, 50), 1), 101);
end;
$$;

revoke all on function app_private.validate_work_request_entry() from public, anon, authenticated, service_role;
revoke all on function public.attach_client_request_to_work(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.attach_client_request_to_work(uuid, uuid, uuid, uuid, uuid, uuid, uuid)
  to service_role;
revoke all on function public.list_request_work_targets(uuid, uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.list_request_work_targets(uuid, uuid, text, integer)
  to service_role;
