-- Converting an Anfrage into a job or a project is all or nothing. The server
-- actions convertRequestToJob and convertRequestToProject created the work
-- through createJob or createProject, then claimed the request in a second
-- statement and deleted the new work when the claim lost a race; that delete
-- was only logged when it failed, so a duplicate job or project could remain.
-- The request's documents were linked one by one with an audit row whose
-- result was never checked, and the history row was a best-effort insert.
--
-- Division of work: the action establishes identity, the active membership,
-- the manager role and the request's organization and prepares the work
-- exactly as createJob and createProject do. Each function locks the request
-- first, so a concurrent conversion waits and then refuses with
-- already_converted before it creates anything. Signals stay as before: the
-- new work, the request update and the new document links reach the Realtime
-- publication through their tables.

-- Links every document of a request to the work it became, each new link
-- with its 'linked' audit event. A link that already exists is kept without a
-- second event. Runs as the calling function's owner; no role executes it.
create function app_private.link_request_documents_to_work(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_job_id uuid,
  p_project_id uuid
)
returns void
language sql
security invoker
set search_path to ''
as $$
  with source_documents as (
    select distinct link.document_id from public.document_links link
    where link.organization_id = p_organization_id and link.request_id = p_request_id
  ),
  added as (
    insert into public.document_links (organization_id, document_id, job_id, project_id, created_by)
    select p_organization_id, source_documents.document_id, p_job_id, p_project_id, p_actor_id
    from source_documents
    on conflict do nothing
    returning document_id
  )
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  )
  select p_organization_id, added.document_id, p_actor_id, 'linked',
    jsonb_build_object(
      'jobId', p_job_id, 'projectId', p_project_id, 'requestId', p_request_id,
      'via', 'request_conversion'
    )
  from added;
$$;

-- Locks an open request for its conversion. Refusals: request_not_found,
-- already_converted. Runs as the calling function's owner.
create function app_private.lock_request_for_conversion(p_organization_id uuid, p_request_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_request public.client_requests;
begin
  select * into v_request from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for update;
  if not found then raise exception 'request_not_found'; end if;
  if v_request.status not in ('offen', 'in_klaerung')
    or v_request.converted_job_id is not null
    or v_request.converted_project_id is not null
  then
    raise exception 'already_converted';
  end if;
end;
$$;

-- Converts an open request into a standalone job of a customer: creates the
-- job with its assignments and template, marks the request converted, links
-- the request's documents to the job and records the 'converted' event.
-- Refusals: request_not_found, already_converted, standalone_job_only,
-- client_required, those of app_private.create_job_record.
create function public.convert_client_request_to_job(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_job jsonb,
  p_selected_user_ids uuid[],
  p_assessed_for_date date,
  p_selected_employee_record_ids uuid[],
  p_requirements_snapshot jsonb,
  p_coverage_snapshot jsonb,
  p_coverage_fingerprint text,
  p_override_reason text,
  p_team_source_id uuid,
  p_record_assessment boolean,
  p_template_version_id uuid,
  p_template_assessment boolean
)
returns public.jobs
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_job_fields jsonb := p_job;
  v_address text;
  v_job public.jobs;
begin
  perform app_private.lock_request_for_conversion(p_organization_id, p_request_id);
  if nullif(p_job ->> 'project_id', '') is not null then raise exception 'standalone_job_only'; end if;
  if nullif(p_job ->> 'client_id', '') is null then raise exception 'client_required'; end if;

  -- P1-01 snapshot rule: a job at a site without its own Ort records the
  -- site's current address.
  if nullif(p_job ->> 'site_id', '') is not null and coalesce(btrim(p_job ->> 'location'), '') = '' then
    select nullif(concat_ws(', ', nullif(site.street, ''),
      nullif(concat_ws(' ', nullif(site.postal_code, ''), nullif(site.city, '')), '')), '')
    into v_address
    from public.client_sites site
    where site.organization_id = p_organization_id and site.id = (p_job ->> 'site_id')::uuid;
    if v_address is not null then
      v_job_fields := v_job_fields || jsonb_build_object('location', v_address);
    end if;
  end if;

  v_job := app_private.create_job_record(
    p_organization_id, p_actor_id, v_job_fields, p_selected_user_ids, p_assessed_for_date,
    p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
    p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment,
    p_template_version_id, p_template_assessment
  );

  update public.client_requests request
  set status = 'umgewandelt', converted_job_id = v_job.id, converted_by = p_actor_id,
    converted_at = now()
  where request.organization_id = p_organization_id and request.id = p_request_id;

  perform app_private.link_request_documents_to_work(
    p_organization_id, p_actor_id, p_request_id, v_job.id, null
  );

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'converted',
    jsonb_build_object('target', 'job', 'jobId', v_job.id, 'jobNumber', v_job.job_number),
    p_actor_id
  );

  return v_job;
end;
$$;

-- Converts an open request into a project of a customer, with the same steps
-- as convert_client_request_to_job. Refusals: request_not_found,
-- already_converted, client_required, those of
-- app_private.create_project_record.
create function public.convert_client_request_to_project(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_project jsonb,
  p_template_version_id uuid
)
returns public.projects
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_project public.projects;
begin
  perform app_private.lock_request_for_conversion(p_organization_id, p_request_id);
  if nullif(p_project ->> 'client_id', '') is null then raise exception 'client_required'; end if;

  v_project := app_private.create_project_record(
    p_organization_id, p_actor_id, p_project, p_template_version_id
  );

  update public.client_requests request
  set status = 'umgewandelt', converted_project_id = v_project.id, converted_by = p_actor_id,
    converted_at = now()
  where request.organization_id = p_organization_id and request.id = p_request_id;

  perform app_private.link_request_documents_to_work(
    p_organization_id, p_actor_id, p_request_id, null, v_project.id
  );

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'converted',
    jsonb_build_object(
      'target', 'project', 'projectId', v_project.id, 'projectNumber', v_project.project_number
    ),
    p_actor_id
  );

  return v_project;
end;
$$;

revoke all on function app_private.link_request_documents_to_work(uuid, uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.lock_request_for_conversion(uuid, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.convert_client_request_to_job(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.convert_client_request_to_job(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean
) to service_role;
revoke all on function public.convert_client_request_to_project(uuid, uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_client_request_to_project(uuid, uuid, uuid, jsonb, uuid)
  to service_role;
