create or replace function app_private.installed_equipment_site_snapshot(
  p_site_id uuid,
  p_organization_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'siteId', site.id,
    'name', site.name,
    'street', site.street,
    'postalCode', site.postal_code,
    'city', site.city
  )
  from public.client_sites site
  where site.id = p_site_id and site.organization_id = p_organization_id;
$$;

create or replace function app_private.installed_equipment_snapshot(
  p_equipment_id uuid,
  p_organization_id uuid
)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(equipment) || jsonb_build_object(
    'identifiers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', identifier.id,
        'identifierType', identifier.identifier_type,
        'value', identifier.value,
        'issuer', identifier.issuer
      ) order by identifier.created_at, identifier.id)
      from public.installed_equipment_identifiers identifier
      where identifier.equipment_id = equipment.id
        and identifier.organization_id = equipment.organization_id
    ), '[]'::jsonb)
  )
  from public.installed_equipment equipment
  where equipment.id = p_equipment_id
    and equipment.organization_id = p_organization_id;
$$;

create or replace function app_private.sync_installed_equipment_identifiers(
  p_equipment_id uuid,
  p_organization_id uuid,
  p_actor_id uuid,
  p_identifiers jsonb
)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_identifier jsonb;
  v_type public.installed_equipment_identifier_type;
  v_value text;
  v_issuer text;
begin
  if jsonb_typeof(coalesce(p_identifiers, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_identifiers, '[]'::jsonb)) > 30 then
    raise exception 'installed_equipment_identifiers_invalid';
  end if;

  delete from public.installed_equipment_identifiers identifier
  where identifier.equipment_id = p_equipment_id
    and identifier.organization_id = p_organization_id;

  for v_identifier in
    select value from jsonb_array_elements(coalesce(p_identifiers, '[]'::jsonb))
  loop
    begin
      v_type := (v_identifier->>'identifierType')::public.installed_equipment_identifier_type;
    exception when invalid_text_representation then
      raise exception 'installed_equipment_identifier_type_invalid';
    end;
    v_value := nullif(btrim(v_identifier->>'value'), '');
    v_issuer := nullif(btrim(v_identifier->>'issuer'), '');
    if v_value is null then raise exception 'installed_equipment_identifier_value_required'; end if;

    insert into public.installed_equipment_identifiers (
      organization_id, equipment_id, identifier_type, value, issuer, created_by
    ) values (
      p_organization_id, p_equipment_id, v_type, v_value, v_issuer, p_actor_id
    );
  end loop;
end;
$$;

create or replace function app_private.record_installed_equipment_event(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_event_type public.installed_equipment_event_type,
  p_from_state public.installed_equipment_state,
  p_to_state public.installed_equipment_state,
  p_effective_at timestamptz,
  p_actor_id uuid,
  p_reason text,
  p_request_operation text,
  p_idempotency_key uuid,
  p_corrects_event_id uuid,
  p_before_snapshot jsonb,
  p_after_snapshot jsonb
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_event_id uuid := gen_random_uuid();
  v_site_id uuid;
begin
  select equipment.site_id into v_site_id
  from public.installed_equipment equipment
  where equipment.id = p_equipment_id
    and equipment.organization_id = p_organization_id;
  if not found then raise exception 'installed_equipment_not_found'; end if;

  insert into public.installed_equipment_events (
    id, organization_id, equipment_id, event_type, from_state, to_state,
    effective_at, actor_id, reason, request_operation, idempotency_key,
    corrects_event_id, site_snapshot, before_snapshot, after_snapshot
  ) values (
    v_event_id, p_organization_id, p_equipment_id, p_event_type,
    p_from_state, p_to_state, p_effective_at, p_actor_id,
    nullif(btrim(p_reason), ''), btrim(p_request_operation), p_idempotency_key,
    p_corrects_event_id,
    app_private.installed_equipment_site_snapshot(v_site_id, p_organization_id),
    p_before_snapshot, p_after_snapshot
  );
  return v_event_id;
end;
$$;

create or replace function app_private.next_installed_equipment_number(
  p_organization_id uuid
)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_next integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':installed-equipment-number', 0)
  );
  select coalesce(max(
    substring(equipment.equipment_number from ('^ANL-' || v_year || '-([0-9]+)$'))::integer
  ), 0) + 1
  into v_next
  from public.installed_equipment equipment
  where equipment.organization_id = p_organization_id
    and equipment.equipment_number ~ ('^ANL-' || v_year || '-[0-9]+$');
  return 'ANL-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;

create or replace function app_private.assert_installed_equipment_manager(
  p_organization_id uuid,
  p_actor_id uuid
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not app_private.installed_equipment_actor_is_manager(
    p_organization_id, p_actor_id
  ) then raise exception 'installed_equipment_not_authorized'; end if;
end;
$$;

create or replace function public.create_installed_equipment(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing_equipment_id uuid;
  v_equipment public.installed_equipment%rowtype;
  v_state public.installed_equipment_state;
  v_category public.installed_equipment_category;
  v_subtype public.installed_equipment_subtype;
  v_client_id uuid := (p_payload->>'clientId')::uuid;
  v_site_id uuid := (p_payload->>'siteId')::uuid;
  v_parent_id uuid := nullif(p_payload->>'parentEquipmentId', '')::uuid;
  v_effective_at timestamptz := coalesce(
    nullif(p_payload->>'effectiveAt', '')::timestamptz, now()
  );
  v_snapshot jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);

  select event.equipment_id into v_existing_equipment_id
  from public.installed_equipment_events event
  where event.organization_id = p_organization_id
    and event.request_operation = 'create'
    and event.idempotency_key = p_idempotency_key
  order by event.recorded_at
  limit 1;
  if found then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = v_existing_equipment_id
      and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;

  begin
    v_state := (p_payload->>'state')::public.installed_equipment_state;
    v_category := (p_payload->>'category')::public.installed_equipment_category;
    v_subtype := nullif(p_payload->>'subtype', '')::public.installed_equipment_subtype;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'installed_equipment_classification_invalid';
  end;
  if v_state not in ('unknown', 'active', 'inactive') then
    raise exception 'installed_equipment_initial_state_invalid';
  end if;

  if not exists (
    select 1 from public.client_sites site
    where site.id = v_site_id
      and site.client_id = v_client_id
      and site.organization_id = p_organization_id
      and site.is_active
  ) then raise exception 'installed_equipment_site_invalid'; end if;

  perform set_config('app.installed_equipment_write', 'true', true);
  insert into public.installed_equipment (
    id, organization_id, client_id, site_id, parent_equipment_id,
    equipment_number, name, category, subtype, manufacturer, model,
    location_detail, technical_notes, state, installation_date,
    commissioning_date, warranty_provider, warranty_basis,
    warranty_start_date, warranty_end_date, created_by, updated_by
  ) values (
    p_equipment_id, p_organization_id, v_client_id, v_site_id, v_parent_id,
    app_private.next_installed_equipment_number(p_organization_id),
    btrim(p_payload->>'name'), v_category, v_subtype,
    nullif(btrim(p_payload->>'manufacturer'), ''),
    nullif(btrim(p_payload->>'model'), ''),
    nullif(btrim(p_payload->>'locationDetail'), ''),
    nullif(btrim(p_payload->>'technicalNotes'), ''),
    v_state,
    nullif(p_payload->>'installationDate', '')::date,
    nullif(p_payload->>'commissioningDate', '')::date,
    nullif(btrim(p_payload->>'warrantyProvider'), ''),
    nullif(btrim(p_payload->>'warrantyBasis'), ''),
    nullif(p_payload->>'warrantyStartDate', '')::date,
    nullif(p_payload->>'warrantyEndDate', '')::date,
    p_actor_id, p_actor_id
  ) returning * into v_equipment;

  perform app_private.sync_installed_equipment_identifiers(
    p_equipment_id, p_organization_id, p_actor_id, p_payload->'identifiers'
  );
  perform set_config('app.installed_equipment_write', 'false', true);
  v_snapshot := app_private.installed_equipment_snapshot(
    p_equipment_id, p_organization_id
  );
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, 'registered', null, v_state,
    v_effective_at, p_actor_id, nullif(btrim(p_payload->>'reason'), ''),
    'create', p_idempotency_key, null, null, v_snapshot
  );
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

create or replace function public.update_installed_equipment_details(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_expected_version bigint,
  p_payload jsonb,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment public.installed_equipment%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_category public.installed_equipment_category;
  v_subtype public.installed_equipment_subtype;
  v_event_type public.installed_equipment_event_type :=
    'details_corrected'::public.installed_equipment_event_type;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'update_details'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;

  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id
    and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.archived_at is not null then raise exception 'installed_equipment_archived'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  if length(btrim(coalesce(p_payload->>'reason', ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;

  begin
    v_category := (p_payload->>'category')::public.installed_equipment_category;
    v_subtype := nullif(p_payload->>'subtype', '')::public.installed_equipment_subtype;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'installed_equipment_classification_invalid';
  end;

  v_before := app_private.installed_equipment_snapshot(
    p_equipment_id, p_organization_id
  );
  if v_equipment.installation_date is distinct from nullif(p_payload->>'installationDate', '')::date then
    v_event_type := 'installation_recorded';
  elsif v_equipment.commissioning_date is distinct from nullif(p_payload->>'commissioningDate', '')::date then
    v_event_type := 'commissioning_recorded';
  elsif v_equipment.warranty_provider is distinct from nullif(btrim(p_payload->>'warrantyProvider'), '')
     or v_equipment.warranty_basis is distinct from nullif(btrim(p_payload->>'warrantyBasis'), '')
     or v_equipment.warranty_start_date is distinct from nullif(p_payload->>'warrantyStartDate', '')::date
     or v_equipment.warranty_end_date is distinct from nullif(p_payload->>'warrantyEndDate', '')::date then
    v_event_type := 'warranty_recorded';
  end if;

  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set
    name = btrim(p_payload->>'name'),
    category = v_category,
    subtype = v_subtype,
    manufacturer = nullif(btrim(p_payload->>'manufacturer'), ''),
    model = nullif(btrim(p_payload->>'model'), ''),
    location_detail = nullif(btrim(p_payload->>'locationDetail'), ''),
    technical_notes = nullif(btrim(p_payload->>'technicalNotes'), ''),
    installation_date = nullif(p_payload->>'installationDate', '')::date,
    commissioning_date = nullif(p_payload->>'commissioningDate', '')::date,
    warranty_provider = nullif(btrim(p_payload->>'warrantyProvider'), ''),
    warranty_basis = nullif(btrim(p_payload->>'warrantyBasis'), ''),
    warranty_start_date = nullif(p_payload->>'warrantyStartDate', '')::date,
    warranty_end_date = nullif(p_payload->>'warrantyEndDate', '')::date,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where equipment.id = p_equipment_id
    and equipment.organization_id = p_organization_id;

  perform app_private.sync_installed_equipment_identifiers(
    p_equipment_id, p_organization_id, p_actor_id, p_payload->'identifiers'
  );
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(
    p_equipment_id, p_organization_id
  );
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, v_event_type,
    v_equipment.state, v_equipment.state,
    coalesce(nullif(p_payload->>'effectiveAt', '')::timestamptz, now()),
    p_actor_id, p_payload->>'reason', 'update_details', p_idempotency_key,
    null, v_before, v_after
  );
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

create or replace function app_private.installed_equipment_transition_allowed(
  p_from public.installed_equipment_state,
  p_to public.installed_equipment_state
)
returns boolean language sql immutable set search_path = ''
as $$
  select case
    when p_from = 'unknown' then p_to in ('active', 'inactive', 'removed', 'replaced', 'decommissioned')
    when p_from = 'active' then p_to in ('inactive', 'removed', 'replaced', 'decommissioned')
    when p_from = 'inactive' then p_to in ('active', 'removed', 'replaced', 'decommissioned')
    when p_from = 'removed' then p_to = 'active'
    else false
  end;
$$;

create or replace function public.transition_installed_equipment(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_expected_version bigint,
  p_to_state public.installed_equipment_state,
  p_effective_at timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment public.installed_equipment%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_event_type public.installed_equipment_event_type;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'transition'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;

  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  if v_equipment.archived_at is not null then
    raise exception 'installed_equipment_archived';
  end if;
  if not app_private.installed_equipment_transition_allowed(v_equipment.state, p_to_state) then
    raise exception 'installed_equipment_transition_not_allowed';
  end if;
  if p_to_state = 'replaced' then
    raise exception 'installed_equipment_use_replace_action';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;

  v_event_type := case p_to_state
    when 'active' then 'activated'::public.installed_equipment_event_type
    when 'inactive' then 'inactivated'::public.installed_equipment_event_type
    when 'removed' then 'removed'::public.installed_equipment_event_type
    when 'decommissioned' then 'decommissioned'::public.installed_equipment_event_type
    else 'details_corrected'::public.installed_equipment_event_type
  end;
  v_before := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set
    state = p_to_state,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where equipment.id = p_equipment_id;
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, v_event_type,
    v_equipment.state, p_to_state, p_effective_at, p_actor_id, p_reason,
    'transition', p_idempotency_key, null, v_before, v_after
  );
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

create or replace function public.replace_installed_equipment(
  p_organization_id uuid,
  p_predecessor_id uuid,
  p_successor_id uuid,
  p_expected_version bigint,
  p_successor_payload jsonb,
  p_effective_at timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_predecessor public.installed_equipment%rowtype;
  v_successor public.installed_equipment%rowtype;
  v_successor_state public.installed_equipment_state;
  v_category public.installed_equipment_category;
  v_subtype public.installed_equipment_subtype;
  v_before jsonb;
  v_after jsonb;
  v_successor_snapshot jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_predecessor_id
      and event.request_operation = 'replace'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_successor from public.installed_equipment equipment
    where equipment.organization_id = p_organization_id
      and equipment.predecessor_equipment_id = p_predecessor_id
      and equipment.voided_at is null;
    if not found then raise exception 'installed_equipment_idempotency_conflict'; end if;
    return v_successor;
  end if;

  select * into v_predecessor from public.installed_equipment equipment
  where equipment.id = p_predecessor_id
    and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_predecessor.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_predecessor.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  if v_predecessor.state not in ('active', 'inactive')
     or v_predecessor.archived_at is not null then
    raise exception 'installed_equipment_replace_not_allowed';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;

  begin
    v_successor_state := (p_successor_payload->>'state')::public.installed_equipment_state;
    v_category := (p_successor_payload->>'category')::public.installed_equipment_category;
    v_subtype := nullif(p_successor_payload->>'subtype', '')::public.installed_equipment_subtype;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'installed_equipment_classification_invalid';
  end;
  if v_successor_state not in ('unknown', 'active', 'inactive') then
    raise exception 'installed_equipment_successor_state_invalid';
  end if;

  v_before := app_private.installed_equipment_snapshot(p_predecessor_id, p_organization_id);
  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set
    state = 'replaced', version = version + 1, updated_by = p_actor_id, updated_at = now()
  where equipment.id = p_predecessor_id;

  insert into public.installed_equipment (
    id, organization_id, client_id, site_id, parent_equipment_id,
    predecessor_equipment_id, equipment_number, name, category, subtype,
    manufacturer, model, location_detail, technical_notes, state,
    installation_date, commissioning_date, warranty_provider, warranty_basis,
    warranty_start_date, warranty_end_date, created_by, updated_by
  ) values (
    p_successor_id, p_organization_id, v_predecessor.client_id,
    v_predecessor.site_id, v_predecessor.parent_equipment_id, p_predecessor_id,
    app_private.next_installed_equipment_number(p_organization_id),
    btrim(p_successor_payload->>'name'), v_category, v_subtype,
    nullif(btrim(p_successor_payload->>'manufacturer'), ''),
    nullif(btrim(p_successor_payload->>'model'), ''),
    nullif(btrim(p_successor_payload->>'locationDetail'), ''),
    nullif(btrim(p_successor_payload->>'technicalNotes'), ''),
    v_successor_state,
    nullif(p_successor_payload->>'installationDate', '')::date,
    nullif(p_successor_payload->>'commissioningDate', '')::date,
    nullif(btrim(p_successor_payload->>'warrantyProvider'), ''),
    nullif(btrim(p_successor_payload->>'warrantyBasis'), ''),
    nullif(p_successor_payload->>'warrantyStartDate', '')::date,
    nullif(p_successor_payload->>'warrantyEndDate', '')::date,
    p_actor_id, p_actor_id
  ) returning * into v_successor;

  perform app_private.sync_installed_equipment_identifiers(
    p_successor_id, p_organization_id, p_actor_id,
    p_successor_payload->'identifiers'
  );
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(p_predecessor_id, p_organization_id);
  v_successor_snapshot := app_private.installed_equipment_snapshot(
    p_successor_id, p_organization_id
  );
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_predecessor_id, 'replaced', v_predecessor.state,
    'replaced', p_effective_at, p_actor_id, p_reason, 'replace',
    p_idempotency_key, null, v_before, v_after
  );
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_successor_id, 'registered', null,
    v_successor_state, p_effective_at, p_actor_id, p_reason, 'replace',
    p_idempotency_key, null, null, v_successor_snapshot
  );
  return v_successor;
end;
$$;

create or replace function public.correct_installed_equipment_terminal_action(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_expected_version bigint,
  p_corrects_event_id uuid,
  p_effective_at timestamptz,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment public.installed_equipment%rowtype;
  v_corrected public.installed_equipment_events%rowtype;
  v_successor public.installed_equipment%rowtype;
  v_successor_registration public.installed_equipment_events%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_successor_before jsonb;
  v_successor_after jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'correct_terminal'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;

  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.archived_at is not null then raise exception 'installed_equipment_archived'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  select * into v_corrected from public.installed_equipment_events event
  where event.id = p_corrects_event_id
    and event.organization_id = p_organization_id
    and event.equipment_id = p_equipment_id
    and event.event_type in ('replaced', 'decommissioned')
    and event.to_state = v_equipment.state;
  if not found or v_corrected.from_state is null then
    raise exception 'installed_equipment_correction_target_invalid';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;
  v_before := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform set_config('app.installed_equipment_write', 'true', true);
  if v_equipment.state = 'replaced' then
    select * into v_successor from public.installed_equipment successor
    where successor.organization_id = p_organization_id
      and successor.predecessor_equipment_id = p_equipment_id
      and successor.voided_at is null
    for update;
    if not found then raise exception 'installed_equipment_successor_not_found'; end if;
    select * into v_successor_registration
    from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = v_successor.id
      and event.event_type = 'registered'
      and event.request_operation = 'replace'
      and event.idempotency_key = v_corrected.idempotency_key;
    if not found then raise exception 'installed_equipment_successor_origin_invalid'; end if;
    v_successor_before := app_private.installed_equipment_snapshot(
      v_successor.id, p_organization_id
    );
    update public.installed_equipment successor set
      voided_at = now(),
      voided_by = p_actor_id,
      void_reason = btrim(p_reason),
      version = version + 1,
      updated_by = p_actor_id,
      updated_at = now()
    where successor.id = v_successor.id;
    v_successor_after := app_private.installed_equipment_snapshot(
      v_successor.id, p_organization_id
    );
  end if;
  update public.installed_equipment equipment set
    state = v_corrected.from_state,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where equipment.id = p_equipment_id;
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, 'terminal_action_corrected',
    v_equipment.state, v_corrected.from_state, p_effective_at, p_actor_id,
    p_reason, 'correct_terminal', p_idempotency_key, p_corrects_event_id,
    v_before, v_after
  );
  if v_successor.id is not null then
    perform app_private.record_installed_equipment_event(
      p_organization_id, v_successor.id, 'terminal_action_corrected',
      v_successor.state, v_successor.state, p_effective_at, p_actor_id,
      p_reason, 'correct_terminal', p_idempotency_key,
      v_successor_registration.id,
      v_successor_before, v_successor_after
    );
  end if;
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

create or replace function public.set_installed_equipment_archived(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_expected_version bigint,
  p_archived boolean,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment public.installed_equipment%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'archive'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  if p_archived and v_equipment.state not in ('removed', 'replaced', 'decommissioned') then
    raise exception 'installed_equipment_archive_not_allowed';
  end if;
  if p_archived = (v_equipment.archived_at is not null) then
    raise exception 'installed_equipment_archive_state_unchanged';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;
  v_before := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set
    archived_at = case when p_archived then now() else null end,
    archived_by = case when p_archived then p_actor_id else null end,
    archive_reason = case when p_archived then btrim(p_reason) else null end,
    version = version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where equipment.id = p_equipment_id;
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id,
    case when p_archived then 'archived'::public.installed_equipment_event_type
         else 'archive_restored'::public.installed_equipment_event_type end,
    v_equipment.state, v_equipment.state, now(), p_actor_id, p_reason,
    'archive', p_idempotency_key, null, v_before, v_after
  );
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

create or replace function public.set_installed_equipment_work_link(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_expected_version bigint,
  p_job_id uuid,
  p_project_id uuid,
  p_linked boolean,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment public.installed_equipment%rowtype;
  v_event_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_affected_rows bigint;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if num_nonnulls(p_job_id, p_project_id) <> 1 then
    raise exception 'installed_equipment_work_target_invalid';
  end if;
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'work_link'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;

  if p_job_id is not null and not exists (
    select 1 from public.jobs job
    where job.id = p_job_id
      and job.organization_id = p_organization_id
      and job.client_id = v_equipment.client_id
      and (job.site_id is null or job.site_id = v_equipment.site_id)
  ) then raise exception 'installed_equipment_job_target_invalid'; end if;
  if p_project_id is not null and not exists (
    select 1 from public.projects project
    where project.id = p_project_id
      and project.organization_id = p_organization_id
      and project.client_id = v_equipment.client_id
      and (project.site_id is null or project.site_id = v_equipment.site_id)
  ) then raise exception 'installed_equipment_project_target_invalid'; end if;

  v_before := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform set_config('app.installed_equipment_write', 'true', true);
  if p_linked then
    insert into public.installed_equipment_work_links (
      organization_id, equipment_id, job_id, project_id, created_by
    ) values (
      p_organization_id, p_equipment_id, p_job_id, p_project_id, p_actor_id
    ) on conflict do nothing;
    get diagnostics v_affected_rows = row_count;
  else
    delete from public.installed_equipment_work_links link
    where link.organization_id = p_organization_id
      and link.equipment_id = p_equipment_id
      and link.job_id is not distinct from p_job_id
      and link.project_id is not distinct from p_project_id;
    get diagnostics v_affected_rows = row_count;
  end if;
  if v_affected_rows = 0 then
    perform set_config('app.installed_equipment_write', 'false', true);
    return v_equipment;
  end if;
  update public.installed_equipment equipment set
    version = version + 1, updated_by = p_actor_id, updated_at = now()
  where equipment.id = p_equipment_id;
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  v_event_id := app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id,
    case when p_linked then 'work_linked'::public.installed_equipment_event_type
         else 'work_unlinked'::public.installed_equipment_event_type end,
    v_equipment.state, v_equipment.state, now(), p_actor_id,
    nullif(btrim(p_reason), ''), 'work_link', p_idempotency_key,
    null, v_before, v_after
  );
  insert into public.installed_equipment_event_links (
    organization_id, event_id, job_id, project_id
  ) values (p_organization_id, v_event_id, p_job_id, p_project_id);
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

create or replace function public.link_installed_equipment_source(
  p_organization_id uuid,
  p_equipment_id uuid,
  p_expected_version bigint,
  p_source jsonb,
  p_reason text,
  p_actor_id uuid,
  p_idempotency_key uuid
)
returns public.installed_equipment
language plpgsql security definer set search_path = ''
as $$
declare
  v_equipment public.installed_equipment%rowtype;
  v_event_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_target_type text := p_source->>'targetType';
  v_target_id uuid := nullif(p_source->>'targetId', '')::uuid;
begin
  perform app_private.assert_installed_equipment_manager(p_organization_id, p_actor_id);
  if v_target_type not in ('job', 'project', 'artifact_revision', 'handover_release', 'document') then
    raise exception 'installed_equipment_source_target_invalid';
  end if;
  if exists (
    select 1 from public.installed_equipment_events event
    where event.organization_id = p_organization_id
      and event.equipment_id = p_equipment_id
      and event.request_operation = 'source_link'
      and event.idempotency_key = p_idempotency_key
  ) then
    select * into v_equipment from public.installed_equipment equipment
    where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id;
    if found then return v_equipment; end if;
    raise exception 'installed_equipment_idempotency_conflict';
  end if;
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id and equipment.organization_id = p_organization_id
  for update;
  if not found then raise exception 'installed_equipment_not_found'; end if;
  if v_equipment.voided_at is not null then raise exception 'installed_equipment_voided'; end if;
  if v_equipment.version <> p_expected_version then
    raise exception 'installed_equipment_stale_version';
  end if;
  if length(btrim(coalesce(p_reason, ''))) not between 3 and 1000 then
    raise exception 'installed_equipment_reason_required';
  end if;

  if v_target_type = 'job' and not exists (
    select 1 from public.jobs job where job.id = v_target_id
      and job.organization_id = p_organization_id
      and job.client_id = v_equipment.client_id
      and (job.site_id is null or job.site_id = v_equipment.site_id)
  ) then raise exception 'installed_equipment_source_target_invalid'; end if;
  if v_target_type = 'project' and not exists (
    select 1 from public.projects project where project.id = v_target_id
      and project.organization_id = p_organization_id
      and project.client_id = v_equipment.client_id
      and (project.site_id is null or project.site_id = v_equipment.site_id)
  ) then raise exception 'installed_equipment_source_target_invalid'; end if;
  if v_target_type = 'artifact_revision' and not exists (
    select 1
    from public.work_artifact_revisions revision
    join public.work_artifacts artifact on artifact.id = revision.artifact_id
    left join public.jobs job on job.id = artifact.job_id
    left join public.projects project on project.id = artifact.project_id
    where revision.id = v_target_id
      and revision.organization_id = p_organization_id
      and artifact.organization_id = p_organization_id
      and (revision.site_id is null or revision.site_id = v_equipment.site_id)
      and (
        (
          job.id is not null
          and job.organization_id = p_organization_id
          and job.client_id = v_equipment.client_id
          and (job.site_id is null or job.site_id = v_equipment.site_id)
        ) or (
          project.id is not null
          and project.organization_id = p_organization_id
          and project.client_id = v_equipment.client_id
          and (project.site_id is null or project.site_id = v_equipment.site_id)
        )
      )
  ) then raise exception 'installed_equipment_source_target_invalid'; end if;
  if v_target_type = 'handover_release' and not exists (
    select 1
    from public.work_handover_releases release
    join public.work_handover_packages package on package.id = release.package_id
    left join public.jobs job on job.id = package.job_id
    left join public.projects project on project.id = package.project_id
    where release.id = v_target_id
      and release.organization_id = p_organization_id
      and package.organization_id = p_organization_id
      and (
        (
          job.id is not null
          and job.organization_id = p_organization_id
          and job.client_id = v_equipment.client_id
          and (job.site_id is null or job.site_id = v_equipment.site_id)
        ) or (
          project.id is not null
          and project.organization_id = p_organization_id
          and project.client_id = v_equipment.client_id
          and (project.site_id is null or project.site_id = v_equipment.site_id)
        )
      )
  ) then raise exception 'installed_equipment_source_target_invalid'; end if;
  if v_target_type = 'document' and not exists (
    select 1
    from public.documents document
    join public.document_links link on link.document_id = document.id
    left join public.jobs job on job.id = link.job_id
    left join public.projects project on project.id = link.project_id
    where document.id = v_target_id
      and document.organization_id = p_organization_id
      and document.deleted_at is null
      and link.organization_id = p_organization_id
      and (
        link.equipment_id = v_equipment.id
        or link.client_id = v_equipment.client_id
        or (
          job.id is not null
          and job.organization_id = p_organization_id
          and job.client_id = v_equipment.client_id
          and (job.site_id is null or job.site_id = v_equipment.site_id)
        )
        or (
          project.id is not null
          and project.organization_id = p_organization_id
          and project.client_id = v_equipment.client_id
          and (project.site_id is null or project.site_id = v_equipment.site_id)
        )
      )
  ) then raise exception 'installed_equipment_source_target_invalid'; end if;

  v_before := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set
    version = version + 1, updated_by = p_actor_id, updated_at = now()
  where equipment.id = p_equipment_id;
  perform set_config('app.installed_equipment_write', 'false', true);
  v_after := app_private.installed_equipment_snapshot(p_equipment_id, p_organization_id);
  v_event_id := app_private.record_installed_equipment_event(
    p_organization_id, p_equipment_id, 'source_linked',
    v_equipment.state, v_equipment.state, now(), p_actor_id, p_reason,
    'source_link', p_idempotency_key, null, v_before, v_after
  );

  insert into public.installed_equipment_event_links (
    organization_id, event_id, job_id, project_id, work_artifact_revision_id,
    work_handover_release_id, document_id, document_version_number,
    document_storage_path
  ) values (
    p_organization_id, v_event_id,
    case when v_target_type = 'job' then v_target_id end,
    case when v_target_type = 'project' then v_target_id end,
    case when v_target_type = 'artifact_revision' then v_target_id end,
    case when v_target_type = 'handover_release' then v_target_id end,
    case when v_target_type = 'document' then v_target_id end,
    case when v_target_type = 'document' then (p_source->>'documentVersionNumber')::integer end,
    case when v_target_type = 'document' then p_source->>'documentStoragePath' end
  );
  select * into v_equipment from public.installed_equipment equipment
  where equipment.id = p_equipment_id;
  return v_equipment;
end;
$$;

revoke all on function app_private.installed_equipment_site_snapshot(uuid, uuid)
from public, anon, authenticated;
revoke all on function app_private.installed_equipment_snapshot(uuid, uuid)
from public, anon, authenticated;
revoke all on function app_private.sync_installed_equipment_identifiers(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function app_private.record_installed_equipment_event(
  uuid, uuid, public.installed_equipment_event_type,
  public.installed_equipment_state, public.installed_equipment_state,
  timestamptz, uuid, text, text, uuid, uuid, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function app_private.next_installed_equipment_number(uuid)
from public, anon, authenticated;
revoke all on function app_private.assert_installed_equipment_manager(uuid, uuid)
from public, anon, authenticated;
revoke all on function app_private.installed_equipment_transition_allowed(
  public.installed_equipment_state, public.installed_equipment_state
) from public, anon, authenticated;

grant execute on function app_private.installed_equipment_site_snapshot(uuid, uuid)
to service_role;
grant execute on function app_private.installed_equipment_snapshot(uuid, uuid)
to service_role;
grant execute on function app_private.sync_installed_equipment_identifiers(uuid, uuid, uuid, jsonb)
to service_role;
grant execute on function app_private.record_installed_equipment_event(
  uuid, uuid, public.installed_equipment_event_type,
  public.installed_equipment_state, public.installed_equipment_state,
  timestamptz, uuid, text, text, uuid, uuid, jsonb, jsonb
) to service_role;
grant execute on function app_private.next_installed_equipment_number(uuid)
to service_role;
grant execute on function app_private.assert_installed_equipment_manager(uuid, uuid)
to service_role;
grant execute on function app_private.installed_equipment_transition_allowed(
  public.installed_equipment_state, public.installed_equipment_state
) to service_role;

revoke all on function public.create_installed_equipment(uuid, uuid, jsonb, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.update_installed_equipment_details(uuid, uuid, bigint, jsonb, uuid, uuid)
from public, anon, authenticated;
revoke all on function public.transition_installed_equipment(
  uuid, uuid, bigint, public.installed_equipment_state, timestamptz, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.replace_installed_equipment(
  uuid, uuid, uuid, bigint, jsonb, timestamptz, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.correct_installed_equipment_terminal_action(
  uuid, uuid, bigint, uuid, timestamptz, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.set_installed_equipment_archived(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.set_installed_equipment_work_link(
  uuid, uuid, bigint, uuid, uuid, boolean, text, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.link_installed_equipment_source(
  uuid, uuid, bigint, jsonb, text, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.create_installed_equipment(uuid, uuid, jsonb, uuid, uuid)
to service_role;
grant execute on function public.update_installed_equipment_details(uuid, uuid, bigint, jsonb, uuid, uuid)
to service_role;
grant execute on function public.transition_installed_equipment(
  uuid, uuid, bigint, public.installed_equipment_state, timestamptz, text, uuid, uuid
) to service_role;
grant execute on function public.replace_installed_equipment(
  uuid, uuid, uuid, bigint, jsonb, timestamptz, text, uuid, uuid
) to service_role;
grant execute on function public.correct_installed_equipment_terminal_action(
  uuid, uuid, bigint, uuid, timestamptz, text, uuid, uuid
) to service_role;
grant execute on function public.set_installed_equipment_archived(
  uuid, uuid, bigint, boolean, text, uuid, uuid
) to service_role;
grant execute on function public.set_installed_equipment_work_link(
  uuid, uuid, bigint, uuid, uuid, boolean, text, uuid, uuid
) to service_role;
grant execute on function public.link_installed_equipment_source(
  uuid, uuid, bigint, jsonb, text, uuid, uuid
) to service_role;
