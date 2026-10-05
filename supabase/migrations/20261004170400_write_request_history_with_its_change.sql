-- Capturing, editing, closing and reopening an Anfrage writes the request and
-- its history row together or not at all. The server actions in
-- lib/requests/actions.ts wrote client_requests first and inserted the
-- client_request_events row in a second statement whose failure was only
-- logged, so a request could change without its history row. The reference,
-- assignee and request number pre-checks were separate reads before the write;
-- a failed read refused with the wrong cause or let the write continue.
--
-- Division of work: the action establishes identity, the active membership,
-- the manager role and the request's organization, and passes server-resolved
-- values. Each function locks the request and the actor's membership, repeats
-- the state and reference checks under those locks and raises the action
-- failure code of the first refusal, so nothing changes. The unique index
-- client_requests_org_number_unique decides a taken request number.
--
-- Signals stay as before: the request INSERT or UPDATE reaches the Realtime
-- publication of client_requests; client_request_events stays unpublished.

-- The actor holds the manager role in the organization until commit: a
-- removal or a role change waits for this call or makes it refuse.
-- Runs as the calling function's owner; no role executes it directly.
create function app_private.lock_request_manager(p_organization_id uuid, p_actor_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
    and member.role in ('admin', 'buero')
  for share;
  if not found then raise exception 'not_authorized'; end if;
end;
$$;

-- The assignee is a member of the organization and stays one until commit.
create function app_private.assert_request_assignee(p_organization_id uuid, p_assigned_to uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if p_assigned_to is null then return; end if;
  perform 1 from public.organization_members member
  where member.organization_id = p_organization_id and member.user_id = p_assigned_to
  for key share;
  if not found then raise exception 'assignee_not_found'; end if;
end;
$$;

-- Captures a request with its 'created' history row. Refusals: invalid_input,
-- not_authorized, summary_required, client_not_found, site_requires_client,
-- site_not_found, site_client_mismatch, contact_requires_client,
-- contact_not_found, contact_client_mismatch, assignee_not_found,
-- request_number_taken. Returns the new request.
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
  p_received_at timestamptz
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
  if coalesce(btrim(p_summary), '') = '' then raise exception 'summary_required'; end if;
  perform app_private.assert_work_customer_references(p_organization_id, p_client_id, p_site_id, p_contact_id);
  perform app_private.assert_request_assignee(p_organization_id, p_assigned_to);

  begin
    insert into public.client_requests (
      organization_id, request_number, client_id, contact_id, site_id,
      caller_name, caller_phone, caller_email, caller_address, summary, details,
      category, urgency, source, assigned_to, received_at, created_by
    ) values (
      p_organization_id, p_request_number, p_client_id, p_contact_id, p_site_id,
      p_caller_name, p_caller_phone, p_caller_email, p_caller_address, p_summary, p_details,
      coalesce(p_category, 'sonstiges'), coalesce(p_urgency, 'normal'), coalesce(p_source, 'telefon'),
      p_assigned_to, coalesce(p_received_at, now()), p_actor_id
    )
    returning * into v_request;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'client_requests_org_number_unique' then raise exception 'request_number_taken'; end if;
    raise;
  end;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, v_request.id, 'created',
    jsonb_build_object(
      'summary', v_request.summary, 'category', v_request.category, 'urgency', v_request.urgency,
      'source', v_request.source, 'clientId', v_request.client_id
    ),
    p_actor_id
  );

  return v_request;
end;
$$;

-- Saves the named columns of an open request and records the change as
-- 'matched' (a first customer), 'status_changed' or 'updated' with the
-- changed fields. Refusals: invalid_input, request_not_found, not_authorized,
-- request_not_editable, summary_required, the customer reference codes of
-- create_client_request, assignee_not_found, request_number_taken.
-- Returns the saved request.
create function public.update_client_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_changes jsonb
)
returns public.client_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_assignments text := app_private.work_edit_assignments(p_changes, array[
    'summary', 'details', 'request_number', 'client_id', 'site_id', 'contact_id', 'caller_name',
    'caller_phone', 'caller_email', 'caller_address', 'category', 'urgency', 'source', 'assigned_to',
    'received_at', 'status'
  ]);
  v_previous public.client_requests;
  v_changed public.client_requests;
  v_request public.client_requests;
  v_constraint text;
  v_event_type text;
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null or v_assignments is null then
    raise exception 'invalid_input';
  end if;
  -- An edit only moves between the open states; conversion and closing have
  -- their own functions.
  if p_changes ? 'status' and coalesce(p_changes ->> 'status', '') not in ('offen', 'in_klaerung') then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for no key update;
  if not found then raise exception 'request_not_found'; end if;
  perform app_private.lock_request_manager(p_organization_id, p_actor_id);
  if v_previous.status not in ('offen', 'in_klaerung') then raise exception 'request_not_editable'; end if;

  v_changed := jsonb_populate_record(v_previous, p_changes);
  if p_changes ? 'summary' and coalesce(btrim(v_changed.summary), '') = '' then
    raise exception 'summary_required';
  end if;
  if p_changes ?| array['client_id', 'site_id', 'contact_id'] then
    perform app_private.assert_work_customer_references(
      p_organization_id, v_changed.client_id, v_changed.site_id, v_changed.contact_id
    );
  end if;
  if p_changes ? 'assigned_to' then
    perform app_private.assert_request_assignee(p_organization_id, v_changed.assigned_to);
  end if;

  begin
    execute format(
      'update public.client_requests request set %s
       from jsonb_populate_record(null::public.client_requests, $1) changes
       where request.organization_id = $2 and request.id = $3
       returning request.*',
      v_assignments
    ) into v_request using p_changes, p_organization_id, p_request_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'client_requests_org_number_unique' then raise exception 'request_number_taken'; end if;
    raise;
  end;

  v_event_type := case
    when p_changes ? 'client_id' and v_request.client_id is not null and v_previous.client_id is null
      then 'matched'
    when p_changes ? 'status' and v_request.status <> v_previous.status then 'status_changed'
    else 'updated'
  end;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, v_event_type,
    jsonb_build_object(
      'changedFields',
      (select jsonb_agg(change_key order by change_key) from jsonb_object_keys(p_changes) change_key)
    ),
    p_actor_id
  );

  return v_request;
end;
$$;

-- Closes an open request with the reason and the note and records 'closed'.
-- Refusals: invalid_input, request_not_found, not_authorized,
-- request_not_editable. Returns the closed request.
create function public.close_client_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid,
  p_reason public.request_close_reason,
  p_note text
)
returns public.client_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_request public.client_requests;
  v_note text := nullif(btrim(p_note), '');
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null or p_reason is null then
    raise exception 'invalid_input';
  end if;

  select * into v_request from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for no key update;
  if not found then raise exception 'request_not_found'; end if;
  perform app_private.lock_request_manager(p_organization_id, p_actor_id);
  if v_request.status not in ('offen', 'in_klaerung') then raise exception 'request_not_editable'; end if;

  update public.client_requests request
  set status = 'geschlossen', closed_reason = p_reason, closed_note = v_note,
      closed_by = p_actor_id, closed_at = now()
  where request.organization_id = p_organization_id and request.id = p_request_id
  returning * into v_request;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'closed',
    jsonb_build_object('reason', p_reason, 'note', v_note), p_actor_id
  );

  return v_request;
end;
$$;

-- Reopens a closed request and records 'reopened' with the previous reason and
-- note. Refusals: invalid_input, request_not_found, not_authorized,
-- request_not_closed. Returns the reopened request.
create function public.reopen_client_request(
  p_actor_id uuid,
  p_organization_id uuid,
  p_request_id uuid
)
returns public.client_requests
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_previous public.client_requests;
  v_request public.client_requests;
begin
  if p_actor_id is null or p_organization_id is null or p_request_id is null then
    raise exception 'invalid_input';
  end if;

  select * into v_previous from public.client_requests request
  where request.organization_id = p_organization_id and request.id = p_request_id
  for no key update;
  if not found then raise exception 'request_not_found'; end if;
  perform app_private.lock_request_manager(p_organization_id, p_actor_id);
  if v_previous.status <> 'geschlossen' then raise exception 'request_not_closed'; end if;

  update public.client_requests request
  set status = 'offen', closed_reason = null, closed_note = null, closed_by = null, closed_at = null
  where request.organization_id = p_organization_id and request.id = p_request_id
  returning * into v_request;

  insert into public.client_request_events (
    organization_id, request_id, event_type, event_payload, created_by
  ) values (
    p_organization_id, p_request_id, 'reopened',
    jsonb_build_object('previousReason', v_previous.closed_reason, 'previousNote', v_previous.closed_note),
    p_actor_id
  );

  return v_request;
end;
$$;

revoke all on function app_private.lock_request_manager(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.assert_request_assignee(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.update_client_request(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.close_client_request(uuid, uuid, uuid, public.request_close_reason, text)
  from public, anon, authenticated;
revoke all on function public.reopen_client_request(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz
) to service_role;
grant execute on function public.update_client_request(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.close_client_request(uuid, uuid, uuid, public.request_close_reason, text)
  to service_role;
grant execute on function public.reopen_client_request(uuid, uuid, uuid) to service_role;
