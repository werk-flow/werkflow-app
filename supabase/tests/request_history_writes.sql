-- Capturing, editing, closing and reopening an Anfrage write the request and
-- its history row in one call or nothing, and refuse with the action's failure
-- codes (migration 20261004170400_write_request_history_with_its_change.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('41704000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-history-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Verlauf"}', now(), now()),
('41704000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-history-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Verlauf"}', now(), now()),
('41704000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-history-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Verlauf"}', now(), now()),
('41704000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-history-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Verlauf"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('41704000-0000-0000-0000-000000000010', 'Request history SQL',
 '41704000-0000-0000-0000-000000000001', 'REQHIST'),
('41704000-0000-0000-0000-000000000011', 'Request history SQL other',
 '41704000-0000-0000-0000-000000000004', 'REQHISTO');
insert into public.organization_members (organization_id, user_id, role) values
('41704000-0000-0000-0000-000000000010', '41704000-0000-0000-0000-000000000002', 'buero'),
('41704000-0000-0000-0000-000000000010', '41704000-0000-0000-0000-000000000003', 'employee');

insert into public.clients (id, organization_id, name) values
('41704000-0000-0000-0000-000000000020', '41704000-0000-0000-0000-000000000010', 'Kunde A'),
('41704000-0000-0000-0000-000000000021', '41704000-0000-0000-0000-000000000010', 'Kunde B'),
('41704000-0000-0000-0000-000000000029', '41704000-0000-0000-0000-000000000011', 'Fremder Kunde');
insert into public.client_sites (id, organization_id, client_id, name) values
('41704000-0000-0000-0000-000000000030', '41704000-0000-0000-0000-000000000010',
 '41704000-0000-0000-0000-000000000020', 'Heizraum');

insert into public.client_requests (id, organization_id, request_number, summary) values
('41704000-0000-0000-0000-000000000040', '41704000-0000-0000-0000-000000000010', 'AN-1', 'Heizung kalt'),
('41704000-0000-0000-0000-000000000041', '41704000-0000-0000-0000-000000000010', 'AN-2', 'Zweite Anfrage'),
('41704000-0000-0000-0000-000000000049', '41704000-0000-0000-0000-000000000011', null, 'Fremde Anfrage');
insert into public.client_requests (
  id, organization_id, summary, status, closed_reason, closed_note, closed_by, closed_at
) values (
  '41704000-0000-0000-0000-000000000043', '41704000-0000-0000-0000-000000000010', 'Geschlossen',
  'geschlossen', 'duplikat', 'Doppelt erfasst', '41704000-0000-0000-0000-000000000001', now()
);

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_refusal then
      raise exception '% refused with % instead of %', p_label, sqlerrm, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- The organization's requests and history as one comparable value.
create function pg_temp.request_state() returns text language sql as $$
  select coalesce((
    select string_agg(to_jsonb(request)::text, '|' order by request.id)
    from public.client_requests request
    where request.organization_id in ('41704000-0000-0000-0000-000000000010', '41704000-0000-0000-0000-000000000011')
  ), '') || '#' || (
    select count(*)::text from public.client_request_events event
    where event.organization_id in ('41704000-0000-0000-0000-000000000010', '41704000-0000-0000-0000-000000000011')
  );
$$;

create temporary table request_state_before as select pg_temp.request_state() as state;

-- Every refusal keeps its code and changes nothing.
set local role service_role;

select pg_temp.expect_refusal('capture by a field worker', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000003', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, null, null, null, null, null, null, null, null, null, null, null, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('capture by an outsider', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000004', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, null, null, null, null, null, null, null, null, null, null, null, null, null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('capture without a summary', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '  ', null, null, null, null, null, null, null, null, null, null, null, null, null, null)
$sql$, 'summary_required');
select pg_temp.expect_refusal('capture for a customer of another organization', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41704000-0000-0000-0000-000000000029', null, null,
    null, null, null, null, null, null, null, null, null)
$sql$, 'client_not_found');
select pg_temp.expect_refusal('capture with a site and no customer', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, null, null, '41704000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, null, null, null, null)
$sql$, 'site_requires_client');
select pg_temp.expect_refusal('capture with a site of another customer', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, null, '41704000-0000-0000-0000-000000000021', '41704000-0000-0000-0000-000000000030', null,
    null, null, null, null, null, null, null, null, null)
$sql$, 'site_client_mismatch');
select pg_temp.expect_refusal('capture assigned to a non-member', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, null, null, null, null, null, null, null, null, null, null, null,
    '41704000-0000-0000-0000-000000000004', null)
$sql$, 'assignee_not_found');
select pg_temp.expect_refusal('capture with a taken number', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, 'AN-1', null, null, null, null, null, null, null, null, null, null, null, null)
$sql$, 'request_number_taken');

select pg_temp.expect_refusal('edit of a request of another organization', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000049', '{"summary":"Geändert"}')
$sql$, 'request_not_found');
select pg_temp.expect_refusal('edit by a field worker', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000003', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"summary":"Geändert"}')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('edit of a closed request', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000043', '{"summary":"Geändert"}')
$sql$, 'request_not_editable');
select pg_temp.expect_refusal('edit that converts', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"status":"umgewandelt"}')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('edit of a column outside the list', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"organization_id":"41704000-0000-0000-0000-000000000011"}')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('empty edit', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{}')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('edit without a summary', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"summary":" "}')
$sql$, 'summary_required');
select pg_temp.expect_refusal('edit to a customer of another organization', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"client_id":"41704000-0000-0000-0000-000000000029"}')
$sql$, 'client_not_found');
select pg_temp.expect_refusal('edit to a site without a customer', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"site_id":"41704000-0000-0000-0000-000000000030"}')
$sql$, 'site_requires_client');
select pg_temp.expect_refusal('edit to a non-member assignee', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"assigned_to":"41704000-0000-0000-0000-000000000004"}')
$sql$, 'assignee_not_found');
select pg_temp.expect_refusal('edit to a taken number', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"request_number":"AN-2"}')
$sql$, 'request_number_taken');

select pg_temp.expect_refusal('closing a request of another organization', $sql$
  select public.close_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000049', 'kein_bedarf', null)
$sql$, 'request_not_found');
select pg_temp.expect_refusal('closing by a field worker', $sql$
  select public.close_client_request('41704000-0000-0000-0000-000000000003', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', 'kein_bedarf', null)
$sql$, 'not_authorized');
select pg_temp.expect_refusal('closing a closed request', $sql$
  select public.close_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000043', 'abgelehnt', null)
$sql$, 'request_not_editable');
select pg_temp.expect_refusal('reopening a request of another organization', $sql$
  select public.reopen_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000049')
$sql$, 'request_not_found');
select pg_temp.expect_refusal('reopening by an outsider', $sql$
  select public.reopen_client_request('41704000-0000-0000-0000-000000000004', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000043')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('reopening an open request', $sql$
  select public.reopen_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040')
$sql$, 'request_not_closed');

reset role;

-- The history row is the last step. When it is refused, the request write is
-- rolled back with it: no request exists or changes without its history row.
create function pg_temp.refuse_request_event() returns trigger language plpgsql as $$
begin
  raise exception 'history refused';
end;
$$;
create trigger refuse_request_event before insert on public.client_request_events
  for each row execute function pg_temp.refuse_request_event();

set local role service_role;
select pg_temp.expect_refusal('capture whose history row is refused', $sql$
  select public.create_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    'Anfrage', null, 'AN-9', null, null, null, null, null, null, null, null, null, null, null, null)
$sql$, 'history refused');
select pg_temp.expect_refusal('edit whose history row is refused', $sql$
  select public.update_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', '{"summary":"Geändert","status":"in_klaerung"}')
$sql$, 'history refused');
select pg_temp.expect_refusal('closing whose history row is refused', $sql$
  select public.close_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000040', 'kein_bedarf', 'egal')
$sql$, 'history refused');
select pg_temp.expect_refusal('reopening whose history row is refused', $sql$
  select public.reopen_client_request('41704000-0000-0000-0000-000000000002', '41704000-0000-0000-0000-000000000010',
    '41704000-0000-0000-0000-000000000043')
$sql$, 'history refused');
reset role;

drop trigger refuse_request_event on public.client_request_events;

do $$
begin
  if pg_temp.request_state() <> (select state from request_state_before) then
    raise exception 'a refused request write changed requests or history';
  end if;
end;
$$;

-- Each clean write stores the request and exactly its history row.
set local role service_role;

do $$
declare
  v_org constant uuid := '41704000-0000-0000-0000-000000000010';
  v_actor constant uuid := '41704000-0000-0000-0000-000000000002';
  v_client constant uuid := '41704000-0000-0000-0000-000000000020';
  v_other_client constant uuid := '41704000-0000-0000-0000-000000000021';
  v_site constant uuid := '41704000-0000-0000-0000-000000000030';
  v_open constant uuid := '41704000-0000-0000-0000-000000000040';
  v_request public.client_requests;
  v_events text[];
begin
  v_request := public.create_client_request(v_actor, v_org, 'Wasserhahn tropft', null, 'AN-3',
    v_client, v_site, null, 'Erika Muster', null, null, null, null, null, null,
    '41704000-0000-0000-0000-000000000003', null);
  if v_request.organization_id <> v_org or v_request.summary <> 'Wasserhahn tropft'
    or v_request.request_number <> 'AN-3' or v_request.client_id <> v_client or v_request.site_id <> v_site
    or v_request.category <> 'sonstiges' or v_request.urgency <> 'normal' or v_request.source <> 'telefon'
    or v_request.status <> 'offen' or v_request.assigned_to <> '41704000-0000-0000-0000-000000000003'
    or v_request.created_by <> v_actor or v_request.received_at is null
  then raise exception 'a capture stored the wrong request: %', to_jsonb(v_request); end if;
  if (
    select array_agg(event_type || ':' || event_payload::text || ':' || created_by::text)
    from public.client_request_events where request_id = v_request.id
  ) <> array['created:' || jsonb_build_object('summary', 'Wasserhahn tropft', 'category', 'sonstiges',
    'urgency', 'normal', 'source', 'telefon', 'clientId', v_client)::text || ':' || v_actor::text]
  then raise exception 'a capture did not record its history row'; end if;

  v_request := public.update_client_request(v_actor, v_org, v_open,
    jsonb_build_object('client_id', v_client, 'site_id', v_site));
  if v_request.client_id <> v_client or v_request.site_id <> v_site then
    raise exception 'matching a customer did not save it';
  end if;
  v_request := public.update_client_request(v_actor, v_org, v_open,
    jsonb_build_object('client_id', v_other_client, 'site_id', null, 'contact_id', null));
  if v_request.client_id <> v_other_client or v_request.site_id is not null then
    raise exception 'changing the customer kept the previous site';
  end if;
  v_request := public.update_client_request(v_actor, v_org, v_open, '{"status":"in_klaerung"}');
  v_request := public.update_client_request(v_actor, v_org, v_open, '{"request_number":"AN-1","details":"Keller"}');
  if v_request.status <> 'in_klaerung' or v_request.request_number <> 'AN-1' or v_request.details <> 'Keller' then
    raise exception 'an edit did not save its columns: %', to_jsonb(v_request);
  end if;

  v_request := public.close_client_request(v_actor, v_org, v_open, 'kein_bedarf', '  erledigt  ');
  if v_request.status <> 'geschlossen' or v_request.closed_reason <> 'kein_bedarf'
    or v_request.closed_note <> 'erledigt' or v_request.closed_by <> v_actor or v_request.closed_at is null
  then raise exception 'closing stored the wrong request: %', to_jsonb(v_request); end if;
  v_request := public.reopen_client_request(v_actor, v_org, v_open);
  if v_request.status <> 'offen' or num_nonnulls(
    v_request.closed_reason, v_request.closed_note, v_request.closed_by, v_request.closed_at
  ) <> 0 then raise exception 'reopening kept the closing facts: %', to_jsonb(v_request); end if;

  select array_agg(event_type || ':' || event_payload::text order by event_type, event_payload::text)
  into v_events
  from public.client_request_events where request_id = v_open and created_by = v_actor;
  if v_events <> array[
    'closed:' || '{"note": "erledigt", "reason": "kein_bedarf"}',
    'matched:' || '{"changedFields": ["client_id", "site_id"]}',
    'reopened:' || '{"previousNote": "erledigt", "previousReason": "kein_bedarf"}',
    'status_changed:' || '{"changedFields": ["status"]}',
    'updated:' || '{"changedFields": ["client_id", "contact_id", "site_id"]}',
    'updated:' || '{"changedFields": ["details", "request_number"]}'
  ] then raise exception 'the edits recorded the wrong history: %', v_events; end if;
end;
$$;

reset role;

do $$
declare
  v_function text;
  v_role text;
begin
  foreach v_function in array array[
    'public.create_client_request(uuid, uuid, text, text, text, uuid, uuid, uuid, text, text, text, text, '
      || 'public.request_category, public.request_urgency, public.request_source, uuid, timestamptz)',
    'public.update_client_request(uuid, uuid, uuid, jsonb)',
    'public.close_client_request(uuid, uuid, uuid, public.request_close_reason, text)',
    'public.reopen_client_request(uuid, uuid, uuid)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'execute') then
      raise exception '% lost its service_role grant', v_function;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_function, 'execute') then
        raise exception '% is executable by %', v_function, v_role;
      end if;
    end loop;
  end loop;
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(v_role, 'app_private.lock_request_manager(uuid, uuid)', 'execute')
      or has_function_privilege(v_role, 'app_private.assert_request_assignee(uuid, uuid)', 'execute')
    then raise exception 'a request write helper is executable by %', v_role; end if;
  end loop;
end;
$$;

rollback;
