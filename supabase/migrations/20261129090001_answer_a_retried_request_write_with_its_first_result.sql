-- A retried capture, promotion or conversion of an Anfrage answers with the
-- first result (werk-flow/werkflow-planning#324). A save whose response was
-- lost left the dialog open; the second press created a second request, or
-- refused the promotion or conversion the first press had made.
--
-- Each dialog creates one attempt key per opening and sends it with every
-- press. The capture stores its key on the request, unique per organization;
-- a promotion and a conversion record theirs in their history row. A call
-- under a key that already wrote returns what that call wrote and writes
-- nothing. Another key, another conversion target or a closed request is
-- refused as before, before anything is written. A Servicefall conversion
-- already answers a repeated key (create_service_case).
--
-- Expand-only: each replaced function keeps every argument of the one it
-- replaces in place and defaults the new p_attempt_key, so the previous
-- build's calls resolve to it and behave as before.
--
-- Prevention: Tier 2, supabase/tests/request_retry_results.sql.

alter table public.client_requests add column attempt_key uuid;

alter table public.client_requests
  add constraint client_requests_org_attempt_key_unique unique (organization_id, attempt_key);

-- Locks a request for its conversion into p_target ('job' or 'project') and
-- returns the work an earlier conversion under p_attempt_key made into that
-- target, or null while the request is open. Refusals: request_not_found,
-- already_converted. Runs as the calling function's owner.
create function app_private.lock_request_for_conversion(
  p_organization_id uuid,
  p_request_id uuid,
  p_attempt_key uuid,
  p_target text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_work_id uuid;
begin
  select * into v_request from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for update;
  if not found then raise exception 'request_not_found'; end if;
  if v_request.status in ('offen', 'in_klaerung')
    and v_request.converted_job_id is null
    and v_request.converted_project_id is null
  then
    return null;
  end if;

  v_work_id := case p_target
    when 'job' then v_request.converted_job_id
    when 'project' then v_request.converted_project_id
  end;
  if p_attempt_key is not null and v_work_id is not null and exists (
    select 1 from public.client_request_events event
    where event.organization_id = p_organization_id
      and event.request_id = p_request_id
      and event.event_type = 'converted'
      and event.event_payload ->> 'target' = p_target
      and event.event_payload ->> 'attemptKey' = p_attempt_key::text
      and event.event_payload ->> case p_target when 'job' then 'jobId' else 'projectId' end
        = v_work_id::text
  ) then
    return v_work_id;
  end if;
  raise exception 'already_converted';
end;
$$;

-- @destructive: after release 34f34e62: the replacement below keeps every argument of this one in place and defaults the new one, so that build's calls resolve to it
drop function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz,
  timestamptz, uuid
);

-- Captures a request with its 'created' history row, or returns the request
-- an earlier capture under p_attempt_key made. Refusals: invalid_input,
-- not_authorized, summary_required, client_not_found, site_requires_client,
-- site_not_found, site_client_mismatch, contact_requires_client,
-- contact_not_found, contact_client_mismatch, the Anlage codes of
-- app_private.assert_request_equipment, assignee_not_found,
-- request_number_taken.
create function public.create_client_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_summary text,
  p_details text,
  p_request_number text,
  p_client_id uuid,
  p_site_id uuid,
  p_contact_id uuid,
  p_caller_name text,
  p_caller_phone text,
  p_caller_email text,
  p_caller_address text,
  p_category public.request_category,
  p_urgency public.request_urgency,
  p_source public.request_source,
  p_assigned_to uuid,
  p_received_at timestamptz,
  p_callback_due_at timestamptz default null,
  p_equipment_id uuid default null,
  p_attempt_key uuid default null
)
returns public.client_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null then raise exception 'invalid_input'; end if;
  perform app_private.lock_request_manager(p_organization_id, p_actor_id);
  select * into v_request from public.client_requests request
  where request.organization_id = p_organization_id and request.attempt_key = p_attempt_key;
  if found then return v_request; end if;

  if coalesce(btrim(p_summary), '') = '' then raise exception 'summary_required'; end if;
  perform app_private.assert_work_customer_references(p_organization_id, p_client_id, p_site_id, p_contact_id);
  perform app_private.assert_request_equipment(p_organization_id, p_client_id, p_site_id, p_equipment_id, true);
  perform app_private.assert_request_assignee(p_organization_id, p_assigned_to);

  begin
    insert into public.client_requests (
      organization_id, request_number, client_id, contact_id, site_id, equipment_id,
      caller_name, caller_phone, caller_email, caller_address, summary, details,
      category, urgency, source, assigned_to, received_at, callback_due_at, attempt_key, created_by
    ) values (
      p_organization_id, p_request_number, p_client_id, p_contact_id, p_site_id, p_equipment_id,
      p_caller_name, p_caller_phone, p_caller_email, p_caller_address, p_summary, p_details,
      coalesce(p_category, 'sonstiges'), coalesce(p_urgency, 'normal'), coalesce(p_source, 'telefon'),
      p_assigned_to, coalesce(p_received_at, now()), p_callback_due_at, p_attempt_key, p_actor_id
    )
    returning * into v_request;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'client_requests_org_number_unique' then raise exception 'request_number_taken'; end if;
    -- A concurrent capture under the same key committed first: answer with it.
    if v_constraint = 'client_requests_org_attempt_key_unique' then
      select * into strict v_request from public.client_requests request
      where request.organization_id = p_organization_id and request.attempt_key = p_attempt_key;
      return v_request;
    end if;
    raise;
  end;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_request.id, 'created',
    jsonb_build_object(
      'summary', v_request.summary, 'category', v_request.category, 'urgency', v_request.urgency,
      'source', v_request.source, 'clientId', v_request.client_id
    ) || jsonb_strip_nulls(jsonb_build_object(
      'callbackDueAt', v_request.callback_due_at, 'equipmentId', v_request.equipment_id
    )),
    p_actor_id
  );

  return v_request;
end;
$$;

-- @destructive: after release 34f34e62: the replacement below keeps every argument of this one in place and defaults the new one, so that build's calls resolve to it
drop function public.promote_client_request_caller(uuid, uuid, uuid, text, public.client_type);

-- Creates the customer from the captured caller fields, its first work site
-- from the captured address and its primary contact from the caller's name,
-- phone and email, links all three to the open request and records the
-- 'promoted' event with p_attempt_key, or refuses and changes nothing. A
-- request without an address gets no site. A retry under the key of the
-- promotion that linked the request's customer returns the request.
-- Refusals: invalid_input, request_not_found, not_authorized,
-- request_not_editable, already_matched, caller_name_required.
-- Returns the linked request.
create function public.promote_client_request_caller(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_name text,
  p_client_type public.client_type,
  p_attempt_key uuid default null
)
returns public.client_requests
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_name text;
  v_address text;
  v_address_parts text[];
  v_client_id uuid;
  v_contact_id uuid;
  v_site_id uuid;
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_request from public.client_requests request
  where request.id = p_request_id and request.organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'request_not_found';
  end if;

  -- A share lock holds the actor's membership until commit: a removal or a
  -- role change waits for this call or makes it refuse.
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role in ('admin', 'buero')
  for share;
  if not found then
    raise exception 'not_authorized';
  end if;

  if p_attempt_key is not null and v_request.client_id is not null and exists (
    select 1 from public.client_request_events event
    where event.organization_id = p_organization_id
      and event.request_id = p_request_id
      and event.event_type = 'promoted'
      and event.event_payload ->> 'attemptKey' = p_attempt_key::text
      and event.event_payload ->> 'clientId' = v_request.client_id::text
  ) then
    return v_request;
  end if;

  if v_request.status not in ('offen', 'in_klaerung') then
    raise exception 'request_not_editable';
  end if;
  if v_request.client_id is not null then
    raise exception 'already_matched';
  end if;

  v_name := coalesce(nullif(btrim(p_name), ''), nullif(btrim(v_request.caller_name), ''));
  if v_name is null then
    raise exception 'caller_name_required';
  end if;

  insert into public.clients (organization_id, name, client_type, email, phone, address)
  values (
    p_organization_id, v_name, coalesce(p_client_type, 'privat'),
    v_request.caller_email, v_request.caller_phone, v_request.caller_address
  )
  returning id into v_client_id;

  -- A contact's email is one address or blank (lib/clients/contact-email.ts).
  -- Only a captured email that matches a stricter pattern than that check
  -- moves to the contact; any other text, such as "keine", stays on the
  -- request, so the contact editor never blocks on it.
  insert into public.client_contacts (
    organization_id, client_id, name, email, phone, is_primary, created_by
  ) values (
    p_organization_id, v_client_id,
    coalesce(nullif(btrim(v_request.caller_name), ''), v_name),
    case
      when length(btrim(v_request.caller_email)) <= 320
        and btrim(v_request.caller_email)
          ~ '^[A-Za-z0-9_+-]+(\.[A-Za-z0-9_+-]+)*@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$'
      then btrim(v_request.caller_email)
    end,
    nullif(btrim(v_request.caller_phone), ''),
    true, p_actor_id
  )
  returning id into v_contact_id;

  -- "Street 5, 12345 City" splits into its parts; any other text stays whole
  -- in the street, as adopting a customer address as a site does.
  v_address := nullif(btrim(v_request.caller_address), '');
  if v_address is not null then
    v_address_parts := regexp_match(v_address, '^(.+?)\s*,\s*(\d{5})\s+(.+)$');
    insert into public.client_sites (
      organization_id, client_id, name, street, postal_code, city, primary_contact_id,
      is_primary, created_by
    ) values (
      p_organization_id, v_client_id, 'Hauptstandort',
      coalesce(v_address_parts[1], v_address), v_address_parts[2], v_address_parts[3], v_contact_id,
      true, p_actor_id
    )
    returning id into v_site_id;
  end if;

  update public.client_requests request
  set client_id = v_client_id, site_id = v_site_id, contact_id = v_contact_id
  where request.id = p_request_id and request.organization_id = p_organization_id
  returning * into v_request;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'promoted',
    jsonb_build_object('clientId', v_client_id, 'clientName', v_name)
      || jsonb_strip_nulls(jsonb_build_object('attemptKey', p_attempt_key)),
    p_actor_id
  );

  return v_request;
end;
$$;

-- @destructive: after release 34f34e62: the replacement below keeps every argument of this one in place and defaults the new one, so the visit-assessing wrapper's calls resolve to it
drop function public.convert_client_request_to_job(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean
);

-- Converts an open request into a standalone job of a customer: creates the
-- job with its assignments and template, marks the request converted, links
-- the request's documents to the job and records the 'converted' event with
-- p_attempt_key. A retry under that key returns the job and writes nothing.
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
  p_template_assessment boolean,
  p_attempt_key uuid default null
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
  v_converted_job_id uuid;
begin
  v_converted_job_id := app_private.lock_request_for_conversion(
    p_organization_id, p_request_id, p_attempt_key, 'job'
  );
  if v_converted_job_id is not null then
    select * into strict v_job from public.jobs job
    where job.organization_id = p_organization_id and job.id = v_converted_job_id;
    return v_job;
  end if;
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
    jsonb_build_object('target', 'job', 'jobId', v_job.id, 'jobNumber', v_job.job_number)
      || jsonb_strip_nulls(jsonb_build_object('attemptKey', p_attempt_key)),
    p_actor_id
  );

  return v_job;
end;
$$;

-- @destructive: after release 34f34e62: the replacement below keeps every argument of this one in place and defaults the new one, so that build's calls resolve to it
drop function public.convert_client_request_to_job_with_visit_assessment(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, jsonb
);

-- Converts the request as convert_client_request_to_job does and records the
-- capacity assessment of the visit the new job plans. A retry under the key
-- of the conversion returns its job without assessing a visit again.
create function public.convert_client_request_to_job_with_visit_assessment(
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
  p_template_assessment boolean,
  p_visit_assessment jsonb,
  p_attempt_key uuid default null
)
returns public.jobs
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_job public.jobs;
  v_converted_job_id uuid;
begin
  -- The request first, as the conversion locks it: a job it already had is
  -- the one a retry gets back, and that job's visit is assessed already.
  select request.converted_job_id into v_converted_job_id
  from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for update;
  v_job := public.convert_client_request_to_job(
    p_organization_id, p_actor_id, p_request_id, p_job, p_selected_user_ids, p_assessed_for_date,
    p_selected_employee_record_ids, p_requirements_snapshot, p_coverage_snapshot,
    p_coverage_fingerprint, p_override_reason, p_team_source_id, p_record_assessment,
    p_template_version_id, p_template_assessment, p_attempt_key
  );
  if v_job.id = v_converted_job_id then return v_job; end if;
  -- The new job had no visit before this call.
  perform app_private.record_job_visit_assessment(
    p_organization_id, v_job.id, p_actor_id, null, '{}'::uuid[], p_visit_assessment
  );
  return v_job;
end;
$function$;

-- @destructive: after release 34f34e62: the replacement below keeps every argument of this one in place and defaults the new one, so that build's calls resolve to it
drop function public.convert_client_request_to_project(uuid, uuid, uuid, jsonb, uuid);

-- Converts an open request into a project of a customer, with the same steps
-- as convert_client_request_to_job. A retry under the key of the conversion
-- returns the project and writes nothing. Refusals: request_not_found,
-- already_converted, client_required, those of
-- app_private.create_project_record.
create function public.convert_client_request_to_project(
  p_organization_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_project jsonb,
  p_template_version_id uuid,
  p_attempt_key uuid default null
)
returns public.projects
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_project public.projects;
  v_converted_project_id uuid;
begin
  v_converted_project_id := app_private.lock_request_for_conversion(
    p_organization_id, p_request_id, p_attempt_key, 'project'
  );
  if v_converted_project_id is not null then
    select * into strict v_project from public.projects project
    where project.organization_id = p_organization_id and project.id = v_converted_project_id;
    return v_project;
  end if;
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
    ) || jsonb_strip_nulls(jsonb_build_object('attemptKey', p_attempt_key)),
    p_actor_id
  );

  return v_project;
end;
$$;

-- @destructive: after release 34f34e62: only the conversion functions this migration replaces called it
drop function app_private.lock_request_for_conversion(uuid, uuid);

revoke all on function app_private.lock_request_for_conversion(uuid, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz,
  timestamptz, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz,
  timestamptz, uuid, uuid
) to service_role;
revoke all on function public.promote_client_request_caller(uuid, uuid, uuid, text, public.client_type, uuid)
  from public, anon, authenticated;
grant execute on function public.promote_client_request_caller(uuid, uuid, uuid, text, public.client_type, uuid)
  to service_role;
revoke all on function public.convert_client_request_to_job(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, uuid
) from public, anon, authenticated;
grant execute on function public.convert_client_request_to_job(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, uuid
) to service_role;
revoke all on function public.convert_client_request_to_job_with_visit_assessment(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, jsonb,
  uuid
) from public, anon, authenticated;
grant execute on function public.convert_client_request_to_job_with_visit_assessment(
  uuid, uuid, uuid, jsonb, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean, uuid, boolean, jsonb,
  uuid
) to service_role;
revoke all on function public.convert_client_request_to_project(uuid, uuid, uuid, jsonb, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_client_request_to_project(uuid, uuid, uuid, jsonb, uuid, uuid)
  to service_role;
