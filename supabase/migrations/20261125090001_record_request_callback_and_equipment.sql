-- A live call leaves the request with one accountable next step: the promised
-- callback time („Rückruf bis“), its owner (assigned_to) and, when the caller
-- names it, the Anlage of the request's site. Capture and edit store both in
-- the one call that writes the request and its history row; the Anlage must
-- belong to the request's organization, customer and site. `Aufgaben` reads
-- the open requests with list_open_request_attention, which says whose
-- callback has passed. Converting the request into a Servicefall links its
-- Anlage.
--
-- Expand-only: the previous build never writes the two new columns, calls
-- create_client_request with the seventeen arguments the new signature keeps
-- in place, and sends no Anlage to create_service_case.

alter table public.client_requests
  add column callback_due_at timestamptz,
  add column equipment_id uuid;

-- @destructive: after release 34f34e62: the foreign key constrains only the new equipment_id column, which that build never writes
alter table public.client_requests
  add constraint client_requests_equipment_fk foreign key (equipment_id, organization_id)
    references public.installed_equipment (id, organization_id);

create index client_requests_equipment_fk_idx
  on public.client_requests (equipment_id, organization_id);

-- The Anlage of a request belongs to the request's organization, customer and
-- site, and stays so until commit. A newly chosen Anlage must also be active.
-- Refusals: equipment_not_found, equipment_requires_site,
-- equipment_client_mismatch, equipment_site_mismatch, equipment_not_active.
-- Runs as the calling function's owner; no role executes it directly.
create function app_private.assert_request_equipment(
  p_organization_id uuid,
  p_client_id uuid,
  p_site_id uuid,
  p_equipment_id uuid,
  p_require_active boolean
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_equipment record;
begin
  if p_equipment_id is null then return; end if;
  select equipment.client_id, equipment.site_id, equipment.archived_at, equipment.voided_at
  into v_equipment
  from public.installed_equipment equipment
  where equipment.organization_id = p_organization_id and equipment.id = p_equipment_id
  for key share;
  if not found then raise exception 'equipment_not_found'; end if;
  if p_site_id is null then raise exception 'equipment_requires_site'; end if;
  if v_equipment.client_id is distinct from p_client_id then raise exception 'equipment_client_mismatch'; end if;
  if v_equipment.site_id <> p_site_id then raise exception 'equipment_site_mismatch'; end if;
  if p_require_active and (v_equipment.archived_at is not null or v_equipment.voided_at is not null) then
    raise exception 'equipment_not_active';
  end if;
end;
$$;

-- @destructive: after release 34f34e62: the replacement below keeps every argument of this one in place and defaults the two new ones, so that build's calls resolve to it
drop function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz
);

-- Captures a request with its 'created' history row. Refusals: invalid_input,
-- not_authorized, summary_required, client_not_found, site_requires_client,
-- site_not_found, site_client_mismatch, contact_requires_client,
-- contact_not_found, contact_client_mismatch, the Anlage codes of
-- assert_request_equipment, assignee_not_found, request_number_taken.
-- Returns the new request.
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
  p_equipment_id uuid default null
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
  perform app_private.assert_request_equipment(p_organization_id, p_client_id, p_site_id, p_equipment_id, true);
  perform app_private.assert_request_assignee(p_organization_id, p_assigned_to);

  begin
    insert into public.client_requests (
      organization_id, request_number, client_id, contact_id, site_id, equipment_id,
      caller_name, caller_phone, caller_email, caller_address, summary, details,
      category, urgency, source, assigned_to, received_at, callback_due_at, created_by
    ) values (
      p_organization_id, p_request_number, p_client_id, p_contact_id, p_site_id, p_equipment_id,
      p_caller_name, p_caller_phone, p_caller_email, p_caller_address, p_summary, p_details,
      coalesce(p_category, 'sonstiges'), coalesce(p_urgency, 'normal'), coalesce(p_source, 'telefon'),
      p_assigned_to, coalesce(p_received_at, now()), p_callback_due_at, p_actor_id
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
    ) || jsonb_strip_nulls(jsonb_build_object(
      'callbackDueAt', v_request.callback_due_at, 'equipmentId', v_request.equipment_id
    )),
    p_actor_id
  );

  return v_request;
end;
$$;

-- Saves the named columns of an open request and records the change as
-- 'matched' (a first customer), 'status_changed' or 'updated' with the
-- changed fields. A new customer or site that leaves the Anlage behind clears
-- it in the same save. Refusals: invalid_input, request_not_found,
-- not_authorized, request_not_editable, summary_required, the customer and
-- Anlage codes of create_client_request, assignee_not_found,
-- request_number_taken. Returns the saved request.
create or replace function public.update_client_request(
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
  v_editable_columns constant text[] := array[
    'summary', 'details', 'request_number', 'client_id', 'site_id', 'contact_id', 'equipment_id',
    'caller_name', 'caller_phone', 'caller_email', 'caller_address', 'category', 'urgency', 'source',
    'assigned_to', 'received_at', 'callback_due_at', 'status'
  ];
  v_changes jsonb := p_changes;
  v_assignments text := app_private.work_edit_assignments(p_changes, v_editable_columns);
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
  -- The Anlage hangs off the site: another customer or site without a named
  -- Anlage drops it.
  if not p_changes ? 'equipment_id'
     and v_previous.equipment_id is not null
     and (v_changed.client_id is distinct from v_previous.client_id
          or v_changed.site_id is distinct from v_previous.site_id) then
    v_changes := v_changes || jsonb_build_object('equipment_id', null);
    v_changed.equipment_id := null;
    v_assignments := app_private.work_edit_assignments(v_changes, v_editable_columns);
  end if;
  if v_changes ?| array['client_id', 'site_id', 'equipment_id'] then
    perform app_private.assert_request_equipment(
      p_organization_id, v_changed.client_id, v_changed.site_id, v_changed.equipment_id,
      v_changed.equipment_id is distinct from v_previous.equipment_id
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
    ) into v_request using v_changes, p_organization_id, p_request_id;
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
      (select jsonb_agg(change_key order by change_key) from jsonb_object_keys(v_changes) change_key)
    ),
    p_actor_id
  );

  return v_request;
end;
$$;

-- The organization's open requests for `Aufgaben`, oldest first: whether the
-- promised callback has passed, and whether the owner is still a manager. An
-- overdue callback is its owner's task, and every manager's while it has no
-- owner who is still a manager.
create function public.list_open_request_attention(p_organization_id uuid)
returns table (
  id uuid,
  request_number text,
  summary text,
  status public.request_status,
  urgency public.request_urgency,
  assigned_to uuid,
  received_at timestamptz,
  callback_due_at timestamptz,
  callback_overdue boolean,
  owner_is_manager boolean
)
language sql
stable
security invoker
set search_path to ''
as $$
  select
    request.id, request.request_number, request.summary, request.status, request.urgency,
    request.assigned_to, request.received_at, request.callback_due_at,
    coalesce(request.callback_due_at < now(), false),
    exists (
      select 1 from public.organization_members member
      where member.organization_id = p_organization_id
        and member.user_id = request.assigned_to
        and member.role in ('admin', 'buero')
    )
  from public.client_requests request
  where request.organization_id = p_organization_id
    and request.status in ('offen', 'in_klaerung')
  order by request.received_at, request.id;
$$;

-- Unchanged but for the request's Anlage, which a conversion links to the new
-- case beside the ones the payload names.
create or replace function public.create_service_case(
  p_organization_id uuid,
  p_service_case_id uuid,
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.service_cases
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing_event public.service_case_events%rowtype;
  v_service_case public.service_cases%rowtype;
  v_request public.client_requests%rowtype;
  v_intake_type public.service_case_intake_type;
  v_client_id uuid;
  v_contact_id uuid;
  v_site_id uuid;
  v_source_request_id uuid := nullif(p_payload->>'sourceRequestId', '')::uuid;
  v_original_statement text;
  v_original_details text;
  v_summary text;
  v_urgency public.request_urgency;
  v_charge_context public.service_case_charge_context;
  v_equipment_ids jsonb := coalesce(p_payload->'equipmentIds', '[]'::jsonb);
  v_snapshot jsonb;
begin
  perform app_private.assert_service_case_manager(p_organization_id, p_actor_id);
  perform app_private.lock_service_case_operation(
    p_organization_id, 'create', p_idempotency_key
  );

  select * into v_existing_event
  from public.service_case_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'create'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_event.service_case_id <> p_service_case_id
       or v_existing_event.request_payload <> p_payload then
      raise exception 'service_case_idempotency_conflict';
    end if;
    select * into strict v_service_case from public.service_cases service_case
    where service_case.id = p_service_case_id
      and service_case.organization_id = p_organization_id;
    return v_service_case;
  end if;

  if v_source_request_id is not null then
    v_intake_type := 'request';
    select * into v_request from public.client_requests request
    where request.id = v_source_request_id
      and request.organization_id = p_organization_id
    for update;
    if not found then raise exception 'service_case_request_not_found'; end if;
    if v_request.status not in ('offen', 'in_klaerung')
       or v_request.converted_at is not null
       or v_request.converted_job_id is not null
       or v_request.converted_project_id is not null then
      raise exception 'service_case_request_already_converted';
    end if;
    if v_request.client_id is null or v_request.site_id is null then
      raise exception 'service_case_request_customer_site_required';
    end if;
    v_client_id := v_request.client_id;
    v_contact_id := v_request.contact_id;
    v_site_id := v_request.site_id;
    v_original_statement := v_request.summary;
    v_original_details := v_request.details;
    v_summary := coalesce(nullif(btrim(p_payload->>'summary'), ''), v_request.summary);
    v_urgency := coalesce(
      nullif(p_payload->>'urgency', '')::public.request_urgency,
      v_request.urgency
    );
    -- An archived or voided Anlage is refused by the link's validation
    -- trigger with service_case_equipment_mismatch.
    if v_request.equipment_id is not null and jsonb_typeof(v_equipment_ids) = 'array' then
      v_equipment_ids := v_equipment_ids || jsonb_build_array(v_request.equipment_id);
    end if;
  else
    v_intake_type := 'direct';
    v_client_id := nullif(p_payload->>'clientId', '')::uuid;
    v_contact_id := nullif(p_payload->>'contactId', '')::uuid;
    v_site_id := nullif(p_payload->>'siteId', '')::uuid;
    v_original_statement := nullif(btrim(p_payload->>'originalStatement'), '');
    v_original_details := nullif(btrim(p_payload->>'originalDetails'), '');
    v_summary := nullif(btrim(p_payload->>'summary'), '');
    v_urgency := coalesce(
      nullif(p_payload->>'urgency', '')::public.request_urgency,
      'normal'::public.request_urgency
    );
    if v_client_id is null or v_site_id is null
       or v_original_statement is null or v_summary is null then
      raise exception 'service_case_direct_input_required';
    end if;
  end if;

  v_charge_context := coalesce(
    nullif(p_payload->>'chargeContext', '')::public.service_case_charge_context,
    'unknown'::public.service_case_charge_context
  );

  perform set_config('app.service_case_write', 'true', true);
  insert into public.service_cases (
    id, organization_id, case_number, intake_type, source_request_id,
    client_id, contact_id, site_id, original_statement, original_details,
    summary, urgency, charge_context, access_instructions, triage_note,
    created_by, updated_by
  ) values (
    p_service_case_id, p_organization_id,
    app_private.next_service_case_number(p_organization_id), v_intake_type,
    v_source_request_id, v_client_id, v_contact_id, v_site_id,
    v_original_statement, v_original_details, v_summary, v_urgency,
    v_charge_context, nullif(btrim(p_payload->>'accessInstructions'), ''),
    nullif(btrim(p_payload->>'triageNote'), ''), p_actor_id, p_actor_id
  ) returning * into v_service_case;
  perform set_config('app.service_case_write', 'false', true);

  perform app_private.sync_service_case_equipment_links(
    p_organization_id, p_service_case_id, p_actor_id, v_equipment_ids
  );

  if v_source_request_id is not null then
    update public.client_requests request set
      status = 'umgewandelt',
      converted_by = p_actor_id,
      converted_at = now(),
      updated_at = now()
    where request.id = v_source_request_id
      and request.organization_id = p_organization_id;
    insert into public.client_request_events (
      organization_id, request_id, event_type, event_payload, created_by
    ) values (
      p_organization_id, v_source_request_id, 'converted_to_service_case',
      jsonb_build_object(
        'serviceCaseId', p_service_case_id,
        'serviceCaseNumber', v_service_case.case_number
      ), p_actor_id
    );
  end if;

  v_snapshot := app_private.service_case_snapshot(
    p_service_case_id, p_organization_id
  );
  perform app_private.record_service_case_event(
    p_organization_id, p_service_case_id, 'created', p_actor_id, null,
    'create', p_idempotency_key, p_payload, null, v_snapshot
  );
  return v_service_case;
end;
$$;

-- The attention identity union in lib/attention/types.ts and these checks stay
-- in step: an open request whose promised callback has passed
-- (client_request_callback_overdue). Expand-only: every earlier value stays allowed.
-- @destructive: after release 34f34e62: the constraint returns below with every earlier source type and one new one
alter table public.attention_read_states
  drop constraint attention_read_states_source_type_check;
-- @destructive: after release 34f34e62: that build writes only source types this list keeps
alter table public.attention_read_states
  add constraint attention_read_states_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request', 'planning_visit_replan',
      'client_request_callback_overdue'
    ])
  );
-- @destructive: after release 34f34e62: the constraint returns below with every earlier source type and one new one
alter table public.attention_events
  drop constraint attention_events_source_type_check;
-- @destructive: after release 34f34e62: that build writes only source types this list keeps
alter table public.attention_events
  add constraint attention_events_source_type_check check (
    source_type = any (array[
      'time_session_approval', 'time_change_request_approval',
      'time_correction_approval', 'vacation_request_approval',
      'client_request_open', 'vacation_decision', 'sickness_report',
      'employee_certification_expiry', 'client_follow_up',
      'dispatch_acknowledgement', 'dispatch_challenge_open',
      'job_parking_review', 'work_blocker_review', 'work_artifact_review',
      'work_artifact_correction', 'work_defect_due', 'work_handover_review',
      'organization_join_request', 'planning_visit_replan',
      'client_request_callback_overdue'
    ])
  );

revoke all on function app_private.assert_request_equipment(uuid, uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz,
  timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.create_client_request(
  uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text,
  public.request_category, public.request_urgency, public.request_source, uuid, timestamptz,
  timestamptz, uuid
) to service_role;
revoke all on function public.list_open_request_attention(uuid) from public, anon, authenticated;
grant execute on function public.list_open_request_attention(uuid) to service_role;
