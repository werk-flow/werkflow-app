create or replace function app_private.assert_service_case_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app_private.service_case_actor_is_manager(p_organization_id, p_actor_id) then
    raise exception 'service_case_not_authorized';
  end if;
end;
$$;

create or replace function app_private.lock_service_case_operation(
  p_organization_id uuid,
  p_operation text,
  p_idempotency_key uuid
)
returns void language sql volatile set search_path = ''
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_organization_id::text || ':' || p_operation || ':' || p_idempotency_key::text,
      0
    )
  );
$$;

create or replace function app_private.next_service_case_number(
  p_organization_id uuid
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_next integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':service-case-number', 0)
  );
  select coalesce(max(
    substring(service_case.case_number from ('^SRV-' || v_year || '-([0-9]+)$'))::integer
  ), 0) + 1
  into v_next
  from public.service_cases service_case
  where service_case.organization_id = p_organization_id
    and service_case.case_number ~ ('^SRV-' || v_year || '-[0-9]+$');
  return 'SRV-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function app_private.service_case_snapshot(
  p_service_case_id uuid,
  p_organization_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(service_case) || jsonb_build_object(
    'equipmentIds', coalesce((
      select jsonb_agg(link.equipment_id order by link.equipment_id)
      from public.service_case_equipment_links link
      where link.service_case_id = service_case.id
        and link.organization_id = service_case.organization_id
    ), '[]'::jsonb)
  )
  from public.service_cases service_case
  where service_case.id = p_service_case_id
    and service_case.organization_id = p_organization_id;
$$;

create or replace function app_private.sync_service_case_equipment_links(
  p_organization_id uuid,
  p_service_case_id uuid,
  p_actor_id uuid,
  p_equipment_ids jsonb
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment_id uuid;
begin
  if jsonb_typeof(coalesce(p_equipment_ids, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_equipment_ids, '[]'::jsonb)) > 30 then
    raise exception 'service_case_equipment_ids_invalid';
  end if;

  perform set_config('app.service_case_write', 'true', true);
  delete from public.service_case_equipment_links link
  where link.organization_id = p_organization_id
    and link.service_case_id = p_service_case_id
    and link.equipment_id not in (
      select value::text::uuid
      from jsonb_array_elements_text(coalesce(p_equipment_ids, '[]'::jsonb)) value
    );

  for v_equipment_id in
    select distinct value::text::uuid
    from jsonb_array_elements_text(coalesce(p_equipment_ids, '[]'::jsonb)) value
  loop
    insert into public.service_case_equipment_links (
      organization_id, service_case_id, equipment_id, created_by
    ) values (
      p_organization_id, p_service_case_id, v_equipment_id, p_actor_id
    ) on conflict (service_case_id, equipment_id) do nothing;
  end loop;
  perform set_config('app.service_case_write', 'false', true);
end;
$$;

create or replace function app_private.record_service_case_event(
  p_organization_id uuid,
  p_service_case_id uuid,
  p_event_type public.service_case_event_type,
  p_actor_id uuid,
  p_reason text,
  p_request_operation text,
  p_idempotency_key uuid,
  p_request_payload jsonb,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_event_id uuid;
begin
  insert into public.service_case_events (
    organization_id, service_case_id, event_type, actor_id, reason,
    request_operation, idempotency_key, request_payload,
    before_snapshot, after_snapshot
  ) values (
    p_organization_id, p_service_case_id, p_event_type, p_actor_id,
    nullif(btrim(p_reason), ''), btrim(p_request_operation), p_idempotency_key,
    p_request_payload, p_before_snapshot, p_after_snapshot
  ) returning id into v_event_id;
  return v_event_id;
end;
$$;

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
    p_organization_id, p_service_case_id, p_actor_id,
    coalesce(p_payload->'equipmentIds', '[]'::jsonb)
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

create or replace function public.update_service_case(
  p_organization_id uuid,
  p_service_case_id uuid,
  p_expected_version bigint,
  p_payload jsonb,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.service_cases
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing_event public.service_case_events%rowtype;
  v_before public.service_cases%rowtype;
  v_after public.service_cases%rowtype;
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_status public.service_case_status;
  v_urgency public.request_urgency;
  v_charge_context public.service_case_charge_context;
  v_event_type public.service_case_event_type :=
    'triage_updated'::public.service_case_event_type;
begin
  perform app_private.assert_service_case_manager(p_organization_id, p_actor_id);
  perform app_private.lock_service_case_operation(
    p_organization_id, 'update', p_idempotency_key
  );
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'service_case_reason_required';
  end if;

  select * into v_existing_event
  from public.service_case_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'update'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_event.service_case_id <> p_service_case_id
       or v_existing_event.request_payload <> p_payload then
      raise exception 'service_case_idempotency_conflict';
    end if;
    select * into strict v_after from public.service_cases service_case
    where service_case.id = p_service_case_id
      and service_case.organization_id = p_organization_id;
    return v_after;
  end if;

  select * into v_before from public.service_cases service_case
  where service_case.id = p_service_case_id
    and service_case.organization_id = p_organization_id
  for update;
  if not found then raise exception 'service_case_not_found'; end if;
  if v_before.version <> p_expected_version then
    raise exception 'service_case_stale_version';
  end if;

  v_status := (p_payload->>'status')::public.service_case_status;
  v_urgency := (p_payload->>'urgency')::public.request_urgency;
  v_charge_context := (p_payload->>'chargeContext')::public.service_case_charge_context;
  if v_status in ('resolved', 'closed_without_visit', 'duplicate')
     and nullif(btrim(p_payload->>'resolutionNote'), '') is null then
    raise exception 'service_case_resolution_note_required';
  end if;
  if v_status = 'duplicate' and not exists (
    select 1 from public.service_case_relations relation
    where relation.organization_id = p_organization_id
      and relation.service_case_id = p_service_case_id
      and relation.relation_type = 'duplicate_of'
  ) then raise exception 'service_case_duplicate_relation_required'; end if;

  v_before_snapshot := app_private.service_case_snapshot(
    p_service_case_id, p_organization_id
  );
  perform set_config('app.service_case_write', 'true', true);
  update public.service_cases service_case set
    summary = btrim(p_payload->>'summary'),
    urgency = v_urgency,
    status = v_status,
    charge_context = v_charge_context,
    access_instructions = case
      when p_payload ? 'accessInstructions'
        then nullif(btrim(p_payload->>'accessInstructions'), '')
      else v_before.access_instructions
    end,
    triage_note = case
      when p_payload ? 'triageNote'
        then nullif(btrim(p_payload->>'triageNote'), '')
      else v_before.triage_note
    end,
    resolution_note = case
      when p_payload ? 'resolutionNote'
        then nullif(btrim(p_payload->>'resolutionNote'), '')
      else v_before.resolution_note
    end,
    job_id = case
      when p_payload ? 'jobId'
        then nullif(p_payload->>'jobId', '')::uuid
      else v_before.job_id
    end,
    version = service_case.version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where service_case.id = p_service_case_id
    and service_case.organization_id = p_organization_id
  returning * into v_after;
  perform set_config('app.service_case_write', 'false', true);

  perform app_private.sync_service_case_equipment_links(
    p_organization_id, p_service_case_id, p_actor_id,
    coalesce(p_payload->'equipmentIds', '[]'::jsonb)
  );
  v_after_snapshot := app_private.service_case_snapshot(
    p_service_case_id, p_organization_id
  );
  if v_before.status is distinct from v_after.status then
    v_event_type := 'status_changed'::public.service_case_event_type;
  elsif v_before.job_id is distinct from v_after.job_id then
    v_event_type := case when v_after.job_id is null
      then 'job_unlinked'::public.service_case_event_type
      else 'job_linked'::public.service_case_event_type end;
  elsif (v_before_snapshot->'equipmentIds') is distinct from
        (v_after_snapshot->'equipmentIds') then
    v_event_type := 'equipment_links_updated'::public.service_case_event_type;
  end if;
  perform app_private.record_service_case_event(
    p_organization_id, p_service_case_id, v_event_type, p_actor_id, p_reason,
    'update', p_idempotency_key, p_payload,
    v_before_snapshot, v_after_snapshot
  );
  return v_after;
end;
$$;

create or replace function public.link_service_case_relation(
  p_organization_id uuid,
  p_service_case_id uuid,
  p_related_service_case_id uuid,
  p_relation_type public.service_case_relation_type,
  p_expected_version bigint,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.service_case_relations
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing_event public.service_case_events%rowtype;
  v_case public.service_cases%rowtype;
  v_related public.service_cases%rowtype;
  v_relation public.service_case_relations%rowtype;
  v_payload jsonb := jsonb_build_object(
    'relatedServiceCaseId', p_related_service_case_id,
    'relationType', p_relation_type,
    'reason', btrim(p_reason)
  );
  v_before_snapshot jsonb;
begin
  perform app_private.assert_service_case_manager(p_organization_id, p_actor_id);
  perform app_private.lock_service_case_operation(
    p_organization_id, 'relation_link', p_idempotency_key
  );
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'service_case_reason_required';
  end if;
  select * into v_existing_event from public.service_case_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'relation_link'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_event.service_case_id <> p_service_case_id
       or v_existing_event.request_payload <> v_payload then
      raise exception 'service_case_idempotency_conflict';
    end if;
    select * into strict v_relation from public.service_case_relations relation
    where relation.organization_id = p_organization_id
      and relation.service_case_id = p_service_case_id
      and relation.related_service_case_id = p_related_service_case_id
      and relation.relation_type = p_relation_type;
    return v_relation;
  end if;

  select * into v_case from public.service_cases service_case
  where service_case.id = p_service_case_id
    and service_case.organization_id = p_organization_id for update;
  if not found then raise exception 'service_case_not_found'; end if;
  select * into v_related from public.service_cases service_case
  where service_case.id = p_related_service_case_id
    and service_case.organization_id = p_organization_id;
  if not found then raise exception 'service_case_related_not_found'; end if;
  if v_case.client_id <> v_related.client_id then
    raise exception 'service_case_relation_mismatch';
  end if;
  if v_case.version <> p_expected_version then
    raise exception 'service_case_stale_version';
  end if;
  v_before_snapshot := app_private.service_case_snapshot(
    p_service_case_id, p_organization_id
  );
  insert into public.service_case_relations (
    organization_id, service_case_id, related_service_case_id,
    relation_type, reason, created_by
  ) values (
    p_organization_id, p_service_case_id, p_related_service_case_id,
    p_relation_type, btrim(p_reason), p_actor_id
  ) returning * into v_relation;
  perform set_config('app.service_case_write', 'true', true);
  update public.service_cases set
    version = version + 1, updated_by = p_actor_id, updated_at = now()
  where id = p_service_case_id and organization_id = p_organization_id;
  perform set_config('app.service_case_write', 'false', true);
  perform app_private.record_service_case_event(
    p_organization_id, p_service_case_id, 'relation_linked', p_actor_id,
    p_reason, 'relation_link', p_idempotency_key, v_payload,
    v_before_snapshot,
    app_private.service_case_snapshot(p_service_case_id, p_organization_id)
  );
  return v_relation;
end;
$$;

create or replace function public.link_service_case_evidence(
  p_organization_id uuid,
  p_service_case_id uuid,
  p_work_artifact_revision_id uuid,
  p_expected_version bigint,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.service_case_evidence_links
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing_event public.service_case_events%rowtype;
  v_case public.service_cases%rowtype;
  v_link public.service_case_evidence_links%rowtype;
  v_payload jsonb := jsonb_build_object(
    'workArtifactRevisionId', p_work_artifact_revision_id
  );
  v_before_snapshot jsonb;
begin
  perform app_private.assert_service_case_manager(p_organization_id, p_actor_id);
  perform app_private.lock_service_case_operation(
    p_organization_id, 'evidence_link', p_idempotency_key
  );
  select * into v_existing_event from public.service_case_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'evidence_link'
    and event.idempotency_key = p_idempotency_key;
  if found then
    if v_existing_event.service_case_id <> p_service_case_id
       or v_existing_event.request_payload <> v_payload then
      raise exception 'service_case_idempotency_conflict';
    end if;
    select * into strict v_link from public.service_case_evidence_links link
    where link.organization_id = p_organization_id
      and link.service_case_id = p_service_case_id
      and link.work_artifact_revision_id = p_work_artifact_revision_id;
    return v_link;
  end if;

  select * into v_case from public.service_cases service_case
  where service_case.id = p_service_case_id
    and service_case.organization_id = p_organization_id for update;
  if not found then raise exception 'service_case_not_found'; end if;
  if v_case.version <> p_expected_version then
    raise exception 'service_case_stale_version';
  end if;
  if v_case.job_id is null or not exists (
    select 1
    from public.work_artifact_revisions revision
    join public.work_artifacts artifact
      on artifact.id = revision.artifact_id
     and artifact.organization_id = revision.organization_id
    where revision.id = p_work_artifact_revision_id
      and revision.organization_id = p_organization_id
      and artifact.job_id = v_case.job_id
  ) then raise exception 'service_case_evidence_mismatch'; end if;
  v_before_snapshot := app_private.service_case_snapshot(
    p_service_case_id, p_organization_id
  );
  insert into public.service_case_evidence_links (
    organization_id, service_case_id, work_artifact_revision_id, created_by
  ) values (
    p_organization_id, p_service_case_id, p_work_artifact_revision_id, p_actor_id
  ) returning * into v_link;
  perform set_config('app.service_case_write', 'true', true);
  update public.service_cases set
    version = version + 1, updated_by = p_actor_id, updated_at = now()
  where id = p_service_case_id and organization_id = p_organization_id;
  perform set_config('app.service_case_write', 'false', true);
  perform app_private.record_service_case_event(
    p_organization_id, p_service_case_id, 'evidence_linked', p_actor_id,
    'Arbeitsnachweis verknüpft', 'evidence_link', p_idempotency_key,
    v_payload, v_before_snapshot,
    app_private.service_case_snapshot(p_service_case_id, p_organization_id)
  );
  return v_link;
end;
$$;

revoke all on function app_private.assert_service_case_manager(uuid, uuid),
  app_private.lock_service_case_operation(uuid, text, uuid),
  app_private.next_service_case_number(uuid),
  app_private.service_case_snapshot(uuid, uuid),
  app_private.sync_service_case_equipment_links(uuid, uuid, uuid, jsonb),
  app_private.record_service_case_event(uuid, uuid, public.service_case_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function app_private.assert_service_case_manager(uuid, uuid),
  app_private.lock_service_case_operation(uuid, text, uuid),
  app_private.next_service_case_number(uuid),
  app_private.service_case_snapshot(uuid, uuid),
  app_private.sync_service_case_equipment_links(uuid, uuid, uuid, jsonb),
  app_private.record_service_case_event(uuid, uuid, public.service_case_event_type,
    uuid, text, text, uuid, jsonb, jsonb, jsonb)
to service_role;

revoke all on function public.create_service_case(uuid, uuid, jsonb, uuid, uuid),
  public.update_service_case(uuid, uuid, bigint, jsonb, text, uuid, uuid),
  public.link_service_case_relation(uuid, uuid, uuid,
    public.service_case_relation_type, bigint, text, uuid, uuid),
  public.link_service_case_evidence(uuid, uuid, uuid, bigint, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.create_service_case(uuid, uuid, jsonb, uuid, uuid),
  public.update_service_case(uuid, uuid, bigint, jsonb, text, uuid, uuid),
  public.link_service_case_relation(uuid, uuid, uuid,
    public.service_case_relation_type, bigint, text, uuid, uuid),
  public.link_service_case_evidence(uuid, uuid, uuid, bigint, uuid, uuid)
to service_role;
