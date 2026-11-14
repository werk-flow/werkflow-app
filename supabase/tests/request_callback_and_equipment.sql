-- A request records its promised callback and the Anlage of its own site:
-- capture and edit refuse an Anlage of another organization, customer or site,
-- the attention read marks overdue only the organization's open requests whose
-- callback has passed, and a Servicefall conversion links the request's
-- Anlage (migration 20261129100001_record_request_callback_and_equipment.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('41909000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-callback-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Rückruf"}', now(), now()),
('41909000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-callback-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Rückruf"}', now(), now()),
('41909000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-callback-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Rückruf"}', now(), now()),
('41909000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-callback-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Rückruf"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('41909000-0000-0000-0000-000000000010', 'Request callback SQL',
 '41909000-0000-0000-0000-000000000001', 'REQCALL'),
('41909000-0000-0000-0000-000000000011', 'Request callback SQL other',
 '41909000-0000-0000-0000-000000000004', 'REQCALLO');
insert into public.organization_members (organization_id, user_id, role) values
('41909000-0000-0000-0000-000000000010', '41909000-0000-0000-0000-000000000002', 'buero'),
('41909000-0000-0000-0000-000000000010', '41909000-0000-0000-0000-000000000003', 'employee');

insert into public.clients (id, organization_id, name) values
('41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000010', 'Hausverwaltung Lindenhof GmbH'),
('41909000-0000-0000-0000-000000000021', '41909000-0000-0000-0000-000000000010', 'Erika Musterfrau'),
('41909000-0000-0000-0000-000000000029', '41909000-0000-0000-0000-000000000011', 'Fremder Kunde');
insert into public.client_sites (id, organization_id, client_id, name) values
('41909000-0000-0000-0000-000000000030', '41909000-0000-0000-0000-000000000010',
 '41909000-0000-0000-0000-000000000020', 'Lindenhof 1'),
('41909000-0000-0000-0000-000000000031', '41909000-0000-0000-0000-000000000010',
 '41909000-0000-0000-0000-000000000020', 'Lindenhof 3'),
('41909000-0000-0000-0000-000000000032', '41909000-0000-0000-0000-000000000010',
 '41909000-0000-0000-0000-000000000021', 'Musterweg 5'),
('41909000-0000-0000-0000-000000000039', '41909000-0000-0000-0000-000000000011',
 '41909000-0000-0000-0000-000000000029', 'Fremder Ort');

-- 50: the boiler of Lindenhof 1; 51: Lindenhof 3, same customer; 52: another
-- customer; 53: archived at Lindenhof 1; 59: another organization.
set local app.installed_equipment_write = 'true';
insert into public.installed_equipment (
  id, organization_id, client_id, site_id, equipment_number, name, category, state,
  archived_at, archived_by, archive_reason, created_by, updated_by
) values
('41909000-0000-0000-0000-000000000050', '41909000-0000-0000-0000-000000000010',
 '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', 'ANL-1', 'Gaskessel',
 'heat_generation', 'active', null, null, null,
 '41909000-0000-0000-0000-000000000001', '41909000-0000-0000-0000-000000000001'),
('41909000-0000-0000-0000-000000000051', '41909000-0000-0000-0000-000000000010',
 '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000031', 'ANL-2', 'Wärmepumpe',
 'heat_generation', 'active', null, null, null,
 '41909000-0000-0000-0000-000000000001', '41909000-0000-0000-0000-000000000001'),
('41909000-0000-0000-0000-000000000052', '41909000-0000-0000-0000-000000000010',
 '41909000-0000-0000-0000-000000000021', '41909000-0000-0000-0000-000000000032', 'ANL-3', 'Therme',
 'heat_generation', 'active', null, null, null,
 '41909000-0000-0000-0000-000000000001', '41909000-0000-0000-0000-000000000001'),
('41909000-0000-0000-0000-000000000053', '41909000-0000-0000-0000-000000000010',
 '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', 'ANL-4', 'Alter Kessel',
 'heat_generation', 'decommissioned', now(), '41909000-0000-0000-0000-000000000001', 'Ausgebaut',
 '41909000-0000-0000-0000-000000000001', '41909000-0000-0000-0000-000000000001'),
('41909000-0000-0000-0000-000000000059', '41909000-0000-0000-0000-000000000011',
 '41909000-0000-0000-0000-000000000029', '41909000-0000-0000-0000-000000000039', 'ANL-1', 'Fremdanlage',
 'heat_generation', 'active', null, null, null,
 '41909000-0000-0000-0000-000000000004', '41909000-0000-0000-0000-000000000004');
reset app.installed_equipment_write;

-- 40: open at Lindenhof 1 with the boiler; 41: open at Lindenhof 1 with the
-- archived boiler; 49: another organization.
insert into public.client_requests (id, organization_id, summary, client_id, site_id, equipment_id) values
('41909000-0000-0000-0000-000000000040', '41909000-0000-0000-0000-000000000010', 'Heizung kalt',
 '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030',
 '41909000-0000-0000-0000-000000000050'),
('41909000-0000-0000-0000-000000000041', '41909000-0000-0000-0000-000000000010', 'Kessel ausgebaut',
 '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030',
 '41909000-0000-0000-0000-000000000053'),
('41909000-0000-0000-0000-000000000049', '41909000-0000-0000-0000-000000000011', 'Fremde Anfrage',
 null, null, null);

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- The organizations' requests and history as one comparable value.
create function pg_temp.request_state() returns text language sql as $$
  select coalesce((
    select string_agg(to_jsonb(request)::text, '|' order by request.id)
    from public.client_requests request
    where request.organization_id in ('41909000-0000-0000-0000-000000000010', '41909000-0000-0000-0000-000000000011')
  ), '') || '#' || (
    select count(*)::text from public.client_request_events event
    where event.organization_id in ('41909000-0000-0000-0000-000000000010', '41909000-0000-0000-0000-000000000011')
  );
$$;
grant execute on function pg_temp.request_state() to service_role;

create temporary table request_state_before as select pg_temp.request_state() as state;
grant select on request_state_before to service_role;

set local role service_role;

-- A capture refuses an Anlage outside the request's organization, customer or
-- site, an Anlage without a site, and an archived one.
select pg_temp.expect_refusal('capture with an Anlage of another organization', $sql$
  select public.create_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, null, null, null, null, null, '41909000-0000-0000-0000-000000000059')
$sql$, 'equipment_not_found');
select pg_temp.expect_refusal('capture with an Anlage of another customer', $sql$
  select public.create_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, null, null, null, null, null, '41909000-0000-0000-0000-000000000052')
$sql$, 'equipment_client_mismatch');
select pg_temp.expect_refusal('capture with an Anlage of another site', $sql$
  select public.create_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, null, null, null, null, null, '41909000-0000-0000-0000-000000000051')
$sql$, 'equipment_site_mismatch');
select pg_temp.expect_refusal('capture with an Anlage and no site', $sql$
  select public.create_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41909000-0000-0000-0000-000000000020', null, null,
    null, null, null, null, null, null, null, null, null, null, '41909000-0000-0000-0000-000000000050')
$sql$, 'equipment_requires_site');
select pg_temp.expect_refusal('capture with an archived Anlage', $sql$
  select public.create_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, null, null, null, null, null, '41909000-0000-0000-0000-000000000053')
$sql$, 'equipment_not_active');
select pg_temp.expect_refusal('capture with an Anlage by a field worker', $sql$
  select public.create_client_request('41909000-0000-0000-0000-000000000003', '41909000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, null, null, null, null, null, '41909000-0000-0000-0000-000000000050')
$sql$, 'not_authorized');

-- An edit refuses the same Anlagen, and a site change that names a mismatched one.
select pg_temp.expect_refusal('edit to an Anlage of another organization', $sql$
  select public.update_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    '41909000-0000-0000-0000-000000000040', '{"equipment_id":"41909000-0000-0000-0000-000000000059"}')
$sql$, 'equipment_not_found');
select pg_temp.expect_refusal('edit to an Anlage of another customer', $sql$
  select public.update_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    '41909000-0000-0000-0000-000000000040', '{"equipment_id":"41909000-0000-0000-0000-000000000052"}')
$sql$, 'equipment_client_mismatch');
select pg_temp.expect_refusal('edit to an Anlage of another site', $sql$
  select public.update_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    '41909000-0000-0000-0000-000000000040', '{"equipment_id":"41909000-0000-0000-0000-000000000051"}')
$sql$, 'equipment_site_mismatch');
select pg_temp.expect_refusal('edit to another site that keeps a named Anlage of the old one', $sql$
  select public.update_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    '41909000-0000-0000-0000-000000000040',
    '{"site_id":"41909000-0000-0000-0000-000000000031","equipment_id":"41909000-0000-0000-0000-000000000050"}')
$sql$, 'equipment_site_mismatch');
select pg_temp.expect_refusal('edit to an archived Anlage', $sql$
  select public.update_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    '41909000-0000-0000-0000-000000000040', '{"equipment_id":"41909000-0000-0000-0000-000000000053"}')
$sql$, 'equipment_not_active');
select pg_temp.expect_refusal('edit of an Anlage on a request of another organization', $sql$
  select public.update_client_request('41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000010',
    '41909000-0000-0000-0000-000000000049', '{"equipment_id":"41909000-0000-0000-0000-000000000050"}')
$sql$, 'request_not_found');

do $$
begin
  if pg_temp.request_state() is distinct from (select state from request_state_before) then
    raise exception 'a refused capture or edit changed a request or its history';
  end if;
end;
$$;

-- Capture stores the callback and the Anlage with the history row; an edit
-- moves the callback, and a site change without a named Anlage drops it.
do $$
declare
  v_actor constant uuid := '41909000-0000-0000-0000-000000000002';
  v_org constant uuid := '41909000-0000-0000-0000-000000000010';
  v_due constant timestamptz := date_trunc('second', now()) + interval '1 day';
  v_request public.client_requests;
  v_payload jsonb;
begin
  v_request := public.create_client_request(v_actor, v_org,
    'Heizung kalt', null, null, '41909000-0000-0000-0000-000000000020', '41909000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, 'notfall', null, v_actor, null, v_due, '41909000-0000-0000-0000-000000000050');
  if v_request.callback_due_at is distinct from v_due or v_request.equipment_id is distinct from '41909000-0000-0000-0000-000000000050' then
    raise exception 'a capture did not store its callback and Anlage: %', to_jsonb(v_request);
  end if;
  select event_payload into v_payload from public.client_request_events
  where request_id = v_request.id and event_type = 'created';
  if v_payload ->> 'equipmentId' is distinct from '41909000-0000-0000-0000-000000000050'
    or (v_payload ->> 'callbackDueAt')::timestamptz is distinct from v_due then
    raise exception 'the created history row lacks the callback or the Anlage: %', v_payload;
  end if;

  v_request := public.update_client_request(v_actor, v_org, v_request.id,
    jsonb_build_object('callback_due_at', v_due + interval '2 hours'));
  if v_request.callback_due_at is distinct from v_due + interval '2 hours'
    or v_request.equipment_id is distinct from '41909000-0000-0000-0000-000000000050' then
    raise exception 'moving the callback did not keep the Anlage: %', to_jsonb(v_request);
  end if;

  v_request := public.update_client_request(v_actor, v_org, v_request.id,
    '{"site_id":"41909000-0000-0000-0000-000000000031"}');
  if v_request.equipment_id is not null then
    raise exception 'a site change kept the Anlage of the old site: %', to_jsonb(v_request);
  end if;
  select event_payload into v_payload from public.client_request_events
  where request_id = v_request.id and event_type = 'updated' and event_payload -> 'changedFields' ? 'site_id';
  if v_payload is distinct from '{"changedFields": ["equipment_id", "site_id"]}'::jsonb then
    raise exception 'the site change did not record the dropped Anlage: %', v_payload;
  end if;
  perform public.close_client_request(v_actor, v_org, v_request.id, 'kein_bedarf', null);

  -- An Anlage archived after the capture stays while other fields change.
  v_request := public.update_client_request(v_actor, v_org, '41909000-0000-0000-0000-000000000041',
    '{"summary":"Kessel ausgebaut, Rückruf"}');
  if v_request.equipment_id is distinct from '41909000-0000-0000-0000-000000000053' then
    raise exception 'an edit dropped or refused an Anlage archived after the capture: %', to_jsonb(v_request);
  end if;
end;
$$;

-- The attention read returns only the organization's open requests, and
-- marks overdue exactly those whose promised callback has passed, with
-- whether their owner is still a manager.
reset role;
insert into public.client_requests (
  id, organization_id, summary, status, assigned_to, callback_due_at, closed_reason, closed_at
) values
('41909000-0000-0000-0000-000000000060', '41909000-0000-0000-0000-000000000010', 'Überfällig beim Büro',
 'offen', '41909000-0000-0000-0000-000000000002', now() - interval '2 hours', null, null),
('41909000-0000-0000-0000-000000000061', '41909000-0000-0000-0000-000000000010', 'Überfällig beim Monteur',
 'in_klaerung', '41909000-0000-0000-0000-000000000003', now() - interval '3 hours', null, null),
('41909000-0000-0000-0000-000000000062', '41909000-0000-0000-0000-000000000010', 'Überfällig ohne Zuständige',
 'offen', null, now() - interval '1 hour', null, null),
('41909000-0000-0000-0000-000000000063', '41909000-0000-0000-0000-000000000010', 'Noch nicht fällig',
 'offen', '41909000-0000-0000-0000-000000000002', now() + interval '1 hour', null, null),
('41909000-0000-0000-0000-000000000064', '41909000-0000-0000-0000-000000000010', 'Ohne Rückruf',
 'offen', '41909000-0000-0000-0000-000000000002', null, null, null),
('41909000-0000-0000-0000-000000000065', '41909000-0000-0000-0000-000000000010', 'Geschlossen',
 'geschlossen', '41909000-0000-0000-0000-000000000002', now() - interval '4 hours', 'kein_bedarf', now()),
('41909000-0000-0000-0000-000000000069', '41909000-0000-0000-0000-000000000011', 'Fremd überfällig',
 'offen', '41909000-0000-0000-0000-000000000004', now() - interval '5 hours', null, null);
set local role service_role;

do $$
declare
  v_overdue text[];
  v_open text[];
begin
  select
    array_agg(open_request.id::text || ':' || open_request.owner_is_manager::text order by open_request.id)
      filter (where open_request.callback_overdue),
    array_agg(open_request.id::text order by open_request.id)
  into v_overdue, v_open
  from public.list_open_request_attention('41909000-0000-0000-0000-000000000010') open_request;
  if v_overdue is distinct from array[
    '41909000-0000-0000-0000-000000000060:true',
    '41909000-0000-0000-0000-000000000061:false',
    '41909000-0000-0000-0000-000000000062:false'
  ] then raise exception 'the attention read marked the wrong requests overdue: %', v_overdue; end if;
  if v_open is distinct from array[
    '41909000-0000-0000-0000-000000000040', '41909000-0000-0000-0000-000000000041',
    '41909000-0000-0000-0000-000000000060', '41909000-0000-0000-0000-000000000061',
    '41909000-0000-0000-0000-000000000062', '41909000-0000-0000-0000-000000000063',
    '41909000-0000-0000-0000-000000000064'
  ] then raise exception 'the attention read returned requests that are not this organization''s open ones: %', v_open; end if;
end;
$$;

-- A suspended owner keeps the membership row but cannot act: their overdue
-- callback reaches every manager, as an owner who left does.
reset role;
insert into public.personnel_access_lifecycles (organization_id, employee_record_id, state, state_effective_at)
select record.organization_id, record.id, 'suspended', now() from public.employee_records record
where record.organization_id = '41909000-0000-0000-0000-000000000010'
  and record.user_id = '41909000-0000-0000-0000-000000000002';
set local role service_role;
do $$
begin
  if exists (
    select 1 from public.list_open_request_attention('41909000-0000-0000-0000-000000000010') open_request
    where open_request.id = '41909000-0000-0000-0000-000000000060' and open_request.owner_is_manager
  ) then raise exception 'a suspended owner still counted as a manager who handles the overdue callback'; end if;
end;
$$;
reset role;
delete from public.personnel_access_lifecycles
where organization_id = '41909000-0000-0000-0000-000000000010';
set local role service_role;

-- A Servicefall conversion links the request's Anlage beside the named ones.
do $$
declare
  v_case public.service_cases;
  v_links uuid[];
begin
  v_case := public.create_service_case('41909000-0000-0000-0000-000000000010',
    '41909000-0000-0000-0000-000000000070',
    '{"sourceRequestId":"41909000-0000-0000-0000-000000000040","chargeContext":"unknown","equipmentIds":[]}',
    '41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000071');
  select array_agg(link.equipment_id order by link.equipment_id) into v_links
  from public.service_case_equipment_links link where link.service_case_id = v_case.id;
  if v_links is distinct from array['41909000-0000-0000-0000-000000000050'::uuid] then
    raise exception 'the Servicefall did not link the request''s Anlage: %', v_links;
  end if;
end;
$$;

-- A request whose Anlage was archived after the capture does not convert into
-- a Servicefall: the conversion leaves no Servicefall, request change or
-- history behind.
do $$
declare
  v_before text := pg_temp.request_state();
begin
  perform pg_temp.expect_refusal('conversion with an archived Anlage', $sql$
    select public.create_service_case('41909000-0000-0000-0000-000000000010',
      '41909000-0000-0000-0000-000000000072',
      '{"sourceRequestId":"41909000-0000-0000-0000-000000000041","chargeContext":"unknown","equipmentIds":[]}',
      '41909000-0000-0000-0000-000000000002', '41909000-0000-0000-0000-000000000073')
  $sql$, 'service_case_equipment_mismatch');
  if exists (
    select 1 from public.service_cases service_case
    where service_case.source_request_id = '41909000-0000-0000-0000-000000000041'
  ) then
    raise exception 'a refused conversion left a Servicefall behind';
  end if;
  if pg_temp.request_state() is distinct from v_before then
    raise exception 'a refused conversion changed a request or its history';
  end if;
end;
$$;

reset role;

do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.list_open_request_attention(uuid)', 'execute') then
      raise exception 'the attention read is executable by %', v_role;
    end if;
  end loop;
  if not has_function_privilege('service_role', 'public.list_open_request_attention(uuid)', 'execute') then
    raise exception 'the attention read lost its service_role grant';
  end if;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(
      v_role, 'app_private.assert_request_equipment(uuid, uuid, uuid, uuid, boolean)', 'execute'
    ) then raise exception 'the request Anlage check is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
