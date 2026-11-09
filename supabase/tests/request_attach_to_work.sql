-- Triage attaches an open request to open work of its customer once: one
-- call writes the work's history entry, links the request's documents to the
-- work, marks the request attached and records its history. A retry under
-- the attempt key returns the first entry and writes nothing; work of another
-- customer or organization, closed work and a second attach are refused
-- before anything is written (migration
-- 20261129090002_attach_a_request_to_existing_work.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('32800000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-attach-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Anhang"}', now(), now()),
('32800000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-attach-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Anhang"}', now(), now()),
('32800000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-attach-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Anhang"}', now(), now()),
('32800000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-attach-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Anhang"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('32800000-0000-0000-0000-000000000010', 'Request attach SQL',
 '32800000-0000-0000-0000-000000000001', 'REQATTCH'),
('32800000-0000-0000-0000-000000000011', 'Request attach SQL other',
 '32800000-0000-0000-0000-000000000004', 'REQATTCO');
insert into public.organization_members (organization_id, user_id, role) values
('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000002', 'buero'),
('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000003', 'employee');

-- 20: the requests' customer, 21: another customer, 22: a customer of the other organization.
insert into public.clients (id, organization_id, name) values
('32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000010', 'Hausverwaltung Lindenhof GmbH'),
('32800000-0000-0000-0000-000000000021', '32800000-0000-0000-0000-000000000010', 'Erika Musterfrau'),
('32800000-0000-0000-0000-000000000022', '32800000-0000-0000-0000-000000000011', 'Fremde Kundin');
-- 30: the requests' site, 31: another site of the customer, 32: the other customer's, 33: the other organization's.
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city) values
('32800000-0000-0000-0000-000000000030', '32800000-0000-0000-0000-000000000010',
 '32800000-0000-0000-0000-000000000020', 'Lindenhof 1', 'Lindenstraße 1', '10115', 'Berlin'),
('32800000-0000-0000-0000-000000000031', '32800000-0000-0000-0000-000000000010',
 '32800000-0000-0000-0000-000000000020', 'Lindenhof 7', 'Lindenstraße 7', '10115', 'Berlin'),
('32800000-0000-0000-0000-000000000032', '32800000-0000-0000-0000-000000000010',
 '32800000-0000-0000-0000-000000000021', 'Musterweg 3', 'Musterweg 3', '10117', 'Berlin'),
('32800000-0000-0000-0000-000000000033', '32800000-0000-0000-0000-000000000011',
 '32800000-0000-0000-0000-000000000022', 'Fremdweg 9', 'Fremdweg 9', '10119', 'Berlin');

-- Jobs: 50 open at another site of the customer, 51 open at the requests'
-- site, 52 finished, 53 cancelled, 54 open of the other customer, 55 open in
-- the other organization.
insert into public.jobs (
  id, organization_id, title, job_number, client_id, site_id, status, execution_state, created_by, updated_at
) values
('32800000-0000-0000-0000-000000000050', '32800000-0000-0000-0000-000000000010', 'Strangsanierung',
 'A-50', '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000031',
 'in_bearbeitung', null, '32800000-0000-0000-0000-000000000001', now() - interval '1 day'),
('32800000-0000-0000-0000-000000000051', '32800000-0000-0000-0000-000000000010', 'Heizungswartung',
 'A-51', '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030',
 'nicht_bearbeitet', null, '32800000-0000-0000-0000-000000000001', now() - interval '3 days'),
('32800000-0000-0000-0000-000000000052', '32800000-0000-0000-0000-000000000010', 'Fertige Arbeit',
 'A-52', '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030',
 'fertig', null, '32800000-0000-0000-0000-000000000001', now()),
('32800000-0000-0000-0000-000000000053', '32800000-0000-0000-0000-000000000010', 'Abgesagte Arbeit',
 'A-53', '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030',
 'nicht_bearbeitet', 'cancelled', '32800000-0000-0000-0000-000000000001', now()),
('32800000-0000-0000-0000-000000000054', '32800000-0000-0000-0000-000000000010', 'Andere Kundin',
 'A-54', '32800000-0000-0000-0000-000000000021', '32800000-0000-0000-0000-000000000032',
 'nicht_bearbeitet', null, '32800000-0000-0000-0000-000000000001', now()),
('32800000-0000-0000-0000-000000000055', '32800000-0000-0000-0000-000000000011', 'Fremde Arbeit',
 'A-55', '32800000-0000-0000-0000-000000000022', '32800000-0000-0000-0000-000000000033',
 'nicht_bearbeitet', null, '32800000-0000-0000-0000-000000000004', now());

-- Projects: 60 open, 61 finished.
insert into public.projects (
  id, organization_id, name, project_number, client_id, site_id, status_override, created_by, updated_at
) values
('32800000-0000-0000-0000-000000000060', '32800000-0000-0000-0000-000000000010', 'Badsanierung',
 'P-60', '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000031', null,
 '32800000-0000-0000-0000-000000000001', now() - interval '2 days'),
('32800000-0000-0000-0000-000000000061', '32800000-0000-0000-0000-000000000010', 'Abgeschlossenes Projekt',
 'P-61', '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030', 'abgeschlossen',
 '32800000-0000-0000-0000-000000000001', now());

-- Servicefälle: 70 open at the requests' site, 71 resolved.
select set_config('app.service_case_write', 'true', true);
insert into public.service_cases (
  id, organization_id, case_number, intake_type, client_id, site_id, original_statement, summary,
  status, resolution_note, created_by, updated_by, updated_at
) values
('32800000-0000-0000-0000-000000000070', '32800000-0000-0000-0000-000000000010', 'S-70', 'direct',
 '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030', 'Therme tropft',
 'Therme tropft', 'new', null, '32800000-0000-0000-0000-000000000001', '32800000-0000-0000-0000-000000000001',
 now() - interval '4 days'),
('32800000-0000-0000-0000-000000000071', '32800000-0000-0000-0000-000000000010', 'S-71', 'direct',
 '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030', 'Erledigt',
 'Erledigt', 'resolved', 'Dichtung getauscht', '32800000-0000-0000-0000-000000000001', '32800000-0000-0000-0000-000000000001',
 now());
select set_config('app.service_case_write', 'false', true);

-- Requests of the customer at site 30: 40 attaches to job 51, 41 to project
-- 60, 42 to Servicefall 70, 43 is only refused; 44 has no customer, 45 is closed.
insert into public.client_requests (
  id, organization_id, summary, details, client_id, site_id, caller_name, status, closed_reason, closed_at
) values
('32800000-0000-0000-0000-000000000040', '32800000-0000-0000-0000-000000000010', 'Heizung wieder kalt',
 'Seit gestern Abend, Wohnung 3 links.', '32800000-0000-0000-0000-000000000020',
 '32800000-0000-0000-0000-000000000030', null, 'offen', null, null),
('32800000-0000-0000-0000-000000000041', '32800000-0000-0000-0000-000000000010', 'Fliesenfarbe geändert',
 null, '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030', null,
 'in_klaerung', null, null),
('32800000-0000-0000-0000-000000000042', '32800000-0000-0000-0000-000000000010', 'Tropft stärker',
 null, '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030', null, 'offen', null, null),
('32800000-0000-0000-0000-000000000043', '32800000-0000-0000-0000-000000000010', 'Noch ein Anruf',
 null, '32800000-0000-0000-0000-000000000020', '32800000-0000-0000-0000-000000000030', null, 'offen', null, null),
('32800000-0000-0000-0000-000000000044', '32800000-0000-0000-0000-000000000010', 'Unbekannt',
 null, null, null, 'Erika Musterfrau', 'offen', null, null),
('32800000-0000-0000-0000-000000000045', '32800000-0000-0000-0000-000000000010', 'Erledigt',
 null, '32800000-0000-0000-0000-000000000020', null, null, 'geschlossen', 'kein_bedarf', now());

-- A photo on request 40, already linked to job 51 once, and one on request 41.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, size_bytes, uploaded_by
) values
('32800000-0000-0000-0000-000000000080', '32800000-0000-0000-0000-000000000010',
 '32800000-0000-0000-0000-000000000010/d80/heizung.jpg', 'heizung.jpg', 'heizung.jpg', 10,
 '32800000-0000-0000-0000-000000000001'),
('32800000-0000-0000-0000-000000000081', '32800000-0000-0000-0000-000000000010',
 '32800000-0000-0000-0000-000000000010/d81/thermostat.jpg', 'thermostat.jpg', 'thermostat.jpg', 10,
 '32800000-0000-0000-0000-000000000001'),
('32800000-0000-0000-0000-000000000082', '32800000-0000-0000-0000-000000000010',
 '32800000-0000-0000-0000-000000000010/d82/fliesen.jpg', 'fliesen.jpg', 'fliesen.jpg', 10,
 '32800000-0000-0000-0000-000000000001');
insert into public.document_links (organization_id, document_id, request_id, job_id, created_by) values
('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000080',
 '32800000-0000-0000-0000-000000000040', null, '32800000-0000-0000-0000-000000000001'),
('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000081',
 '32800000-0000-0000-0000-000000000040', null, '32800000-0000-0000-0000-000000000001'),
('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000081',
 null, '32800000-0000-0000-0000-000000000051', '32800000-0000-0000-0000-000000000001'),
('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000082',
 '32800000-0000-0000-0000-000000000041', null, '32800000-0000-0000-0000-000000000001');

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
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role, authenticated;

-- Every row an attach writes, and the request states.
create function pg_temp.written_rows() returns text language sql as $$
  select concat_ws('/',
    (select count(*) from public.work_request_entries
     where organization_id in ('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000011')),
    (select count(*) from public.client_request_events
     where organization_id = '32800000-0000-0000-0000-000000000010'),
    (select count(*) from public.document_links where organization_id = '32800000-0000-0000-0000-000000000010'),
    (select count(*) from public.document_audit_events
     where organization_id = '32800000-0000-0000-0000-000000000010'),
    (select string_agg(request.id::text || ':' || request.status::text, ',' order by request.id)
     from public.client_requests request
     where request.organization_id = '32800000-0000-0000-0000-000000000010'));
$$;
grant execute on function pg_temp.written_rows() to service_role;

-- An attach by the Büro member of the first organization.
create function pg_temp.attach(
  p_request_id uuid, p_job_id uuid, p_project_id uuid, p_service_case_id uuid, p_attempt_key uuid
) returns public.work_request_entries language sql as $$
  select public.attach_client_request_to_work('32800000-0000-0000-0000-000000000010',
    '32800000-0000-0000-0000-000000000002', p_request_id, p_job_id, p_project_id, p_service_case_id,
    p_attempt_key);
$$;
grant execute on function pg_temp.attach(uuid, uuid, uuid, uuid, uuid) to service_role;

set local role service_role;

-- The attach dialog lists the customer's open work, the request's site first,
-- then the most recently changed; finished, cancelled and other customers'
-- work is not offered.
do $$
declare
  v_listed text;
begin
  select string_agg(target.kind || ':' || target.number || ':' || target.at_request_site::text, ',')
  into v_listed
  from public.list_request_work_targets('32800000-0000-0000-0000-000000000010',
    '32800000-0000-0000-0000-000000000040', '', 50) target;
  if v_listed is distinct from
    'job:A-51:true,service_case:S-70:true,job:A-50:false,project:P-60:false'
  then
    raise exception 'the open work of the customer was listed as %', v_listed;
  end if;

  select string_agg(target.number || ':' || coalesce(target.site_label, ''), ',') into v_listed
  from public.list_request_work_targets('32800000-0000-0000-0000-000000000010',
    '32800000-0000-0000-0000-000000000040', 'lindenstraße 7', 50) target;
  if v_listed is distinct from
    'A-50:Lindenhof 7 · Lindenstraße 7, 10115 Berlin,P-60:Lindenhof 7 · Lindenstraße 7, 10115 Berlin'
  then
    raise exception 'a search by site listed %', v_listed;
  end if;

  select string_agg(target.number, ',') into v_listed
  from public.list_request_work_targets('32800000-0000-0000-0000-000000000010',
    '32800000-0000-0000-0000-000000000040', '', 2) target;
  if v_listed is distinct from 'A-51,S-70' then
    raise exception 'a limit of two listed %', v_listed;
  end if;

  if exists (select 1 from public.list_request_work_targets('32800000-0000-0000-0000-000000000010',
    '32800000-0000-0000-0000-000000000044', '', 50))
  then
    raise exception 'a request without a customer listed work';
  end if;
end;
$$;
select pg_temp.expect_refusal('listing work for another organization''s request', $sql$
  select * from public.list_request_work_targets('32800000-0000-0000-0000-000000000011',
    '32800000-0000-0000-0000-000000000040', '', 50)
$sql$, 'request_not_found');

-- Refusals write nothing.
do $$
declare
  v_before text := pg_temp.written_rows();
begin
  perform pg_temp.expect_refusal('attaching to work of another customer', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000043', '32800000-0000-0000-0000-000000000054',
      null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'work_client_mismatch');
  perform pg_temp.expect_refusal('attaching to work of another organization', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000043', '32800000-0000-0000-0000-000000000055',
      null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'work_not_found');
  perform pg_temp.expect_refusal('attaching another organization''s request', $sql$
    select public.attach_client_request_to_work('32800000-0000-0000-0000-000000000011',
      '32800000-0000-0000-0000-000000000004', '32800000-0000-0000-0000-000000000043',
      '32800000-0000-0000-0000-000000000055', null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'request_not_found');
  perform pg_temp.expect_refusal('attaching to a finished job', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000043', '32800000-0000-0000-0000-000000000052',
      null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'work_closed');
  perform pg_temp.expect_refusal('attaching to a cancelled job', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000043', '32800000-0000-0000-0000-000000000053',
      null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'work_closed');
  perform pg_temp.expect_refusal('attaching to a finished project', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000043', null,
      '32800000-0000-0000-0000-000000000061', null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'work_closed');
  perform pg_temp.expect_refusal('attaching to a resolved Servicefall', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000043', null, null,
      '32800000-0000-0000-0000-000000000071', '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'work_closed');
  perform pg_temp.expect_refusal('attaching a request without a customer', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000044', '32800000-0000-0000-0000-000000000051',
      null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'client_required');
  perform pg_temp.expect_refusal('attaching a closed request', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000045', '32800000-0000-0000-0000-000000000051',
      null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'request_not_editable');
  perform pg_temp.expect_refusal('naming two works', $sql$
    select pg_temp.attach('32800000-0000-0000-0000-000000000043', '32800000-0000-0000-0000-000000000051',
      '32800000-0000-0000-0000-000000000060', null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'invalid_input');
  perform pg_temp.expect_refusal('a field worker''s attach', $sql$
    select public.attach_client_request_to_work('32800000-0000-0000-0000-000000000010',
      '32800000-0000-0000-0000-000000000003', '32800000-0000-0000-0000-000000000043',
      '32800000-0000-0000-0000-000000000051', null, null, '32800000-0000-0000-0000-0000000000a9')
  $sql$, 'not_authorized');
  if pg_temp.written_rows() is distinct from v_before then
    raise exception 'a refused attach wrote: % then %', v_before, pg_temp.written_rows();
  end if;
end;
$$;

-- One attach writes the entry with the request's words, links the request's
-- documents once each, marks the request attached, records its history row
-- and touches the job. A retry under its key returns the entry and writes nothing.
do $$
declare
  v_key constant uuid := '32800000-0000-0000-0000-0000000000a1';
  v_first public.work_request_entries;
  v_retry public.work_request_entries;
  v_after_first text;
  v_event jsonb;
begin
  v_first := pg_temp.attach('32800000-0000-0000-0000-000000000040', '32800000-0000-0000-0000-000000000051',
    null, null, v_key);
  if v_first.summary is distinct from 'Heizung wieder kalt'
    or v_first.details is distinct from 'Seit gestern Abend, Wohnung 3 links.'
    or v_first.job_id is distinct from '32800000-0000-0000-0000-000000000051'
    or v_first.created_by is distinct from '32800000-0000-0000-0000-000000000002'
  then
    raise exception 'the work history entry was %', to_jsonb(v_first);
  end if;
  if (select status from public.client_requests where id = '32800000-0000-0000-0000-000000000040')
    is distinct from 'hinzugefuegt'
  then
    raise exception 'the attached request was not marked attached';
  end if;
  if (select string_agg(link.document_id::text, ',' order by link.document_id) from public.document_links link
      where link.job_id = '32800000-0000-0000-0000-000000000051')
    is distinct from '32800000-0000-0000-0000-000000000080,32800000-0000-0000-0000-000000000081'
  then
    raise exception 'the request''s documents were not linked to the job once each';
  end if;
  if (select count(*) from public.document_audit_events audit
      where audit.organization_id = '32800000-0000-0000-0000-000000000010'
        and audit.event_payload ->> 'via' = 'request_attach') <> 1
  then
    raise exception 'the new document link was not audited once';
  end if;
  select event.event_payload into v_event from public.client_request_events event
  where event.request_id = '32800000-0000-0000-0000-000000000040' and event.event_type = 'attached';
  if v_event ->> 'target' is distinct from 'job' or v_event ->> 'workNumber' is distinct from 'A-51'
    or v_event ->> 'jobId' is distinct from '32800000-0000-0000-0000-000000000051'
  then
    raise exception 'the request history recorded %', v_event;
  end if;
  if (select updated_at from public.jobs where id = '32800000-0000-0000-0000-000000000051')
    < now() - interval '1 minute'
  then
    raise exception 'the job was not touched';
  end if;

  v_after_first := pg_temp.written_rows();
  v_retry := pg_temp.attach('32800000-0000-0000-0000-000000000040', '32800000-0000-0000-0000-000000000051',
    null, null, v_key);
  if v_retry.id is distinct from v_first.id then
    raise exception 'a retried attach did not return the first entry: % then %', v_first.id, v_retry.id;
  end if;
  if pg_temp.written_rows() is distinct from v_after_first then
    raise exception 'a retried attach wrote again: % then %', v_after_first, pg_temp.written_rows();
  end if;
end;
$$;

-- A second attach under another key, or under the same key to other work, is
-- refused; so is a conversion of the attached request.
select pg_temp.expect_refusal('a second attach under another key', $sql$
  select pg_temp.attach('32800000-0000-0000-0000-000000000040', '32800000-0000-0000-0000-000000000051',
    null, null, '32800000-0000-0000-0000-0000000000b1')
$sql$, 'already_attached');
select pg_temp.expect_refusal('the same key to other work', $sql$
  select pg_temp.attach('32800000-0000-0000-0000-000000000040', '32800000-0000-0000-0000-000000000050',
    null, null, '32800000-0000-0000-0000-0000000000a1')
$sql$, 'already_attached');
select pg_temp.expect_refusal('converting an attached request', $sql$
  select public.convert_client_request_to_project('32800000-0000-0000-0000-000000000010',
    '32800000-0000-0000-0000-000000000002', '32800000-0000-0000-0000-000000000040',
    jsonb_build_object('name', 'Neu', 'client_id', '32800000-0000-0000-0000-000000000020'), null)
$sql$, 'already_converted');

-- A project and a Servicefall take a request the same way; the Servicefall
-- gets the documents as its own links.
do $$
declare
  v_project_entry public.work_request_entries;
  v_case_entry public.work_request_entries;
begin
  v_project_entry := pg_temp.attach('32800000-0000-0000-0000-000000000041', null,
    '32800000-0000-0000-0000-000000000060', null, '32800000-0000-0000-0000-0000000000a2');
  v_case_entry := pg_temp.attach('32800000-0000-0000-0000-000000000042', null, null,
    '32800000-0000-0000-0000-000000000070', '32800000-0000-0000-0000-0000000000a3');
  if v_project_entry.project_id is distinct from '32800000-0000-0000-0000-000000000060'
    or v_case_entry.service_case_id is distinct from '32800000-0000-0000-0000-000000000070'
  then
    raise exception 'the project or Servicefall entry was % and %', to_jsonb(v_project_entry), to_jsonb(v_case_entry);
  end if;
  if not exists (select 1 from public.document_links link
    where link.project_id = '32800000-0000-0000-0000-000000000060'
      and link.document_id = '32800000-0000-0000-0000-000000000082')
  then
    raise exception 'the request''s document was not linked to the project';
  end if;
  if (select updated_at from public.service_cases where id = '32800000-0000-0000-0000-000000000070')
    < now() - interval '1 minute'
  then
    raise exception 'the Servicefall was not touched';
  end if;
end;
$$;

reset role;

-- Work that took a request keeps that history: it is not deleted.
select pg_temp.expect_refusal('deleting a job that took a request', $sql$
  delete from public.jobs where id = '32800000-0000-0000-0000-000000000051'
$sql$, 'work_with_history_cannot_be_deleted');
select pg_temp.expect_refusal('deleting a project that took a request', $sql$
  delete from public.projects where id = '32800000-0000-0000-0000-000000000060'
$sql$, 'work_with_history_cannot_be_deleted');

-- The entry's backstop refuses a request and work of different customers
-- even past the attach function.
select pg_temp.expect_refusal('an entry between customers', $sql$
  insert into public.work_request_entries (organization_id, request_id, job_id, summary, attempt_key)
  values ('32800000-0000-0000-0000-000000000010', '32800000-0000-0000-0000-000000000043',
    '32800000-0000-0000-0000-000000000054', 'Noch ein Anruf', '32800000-0000-0000-0000-0000000000c1')
$sql$, 'work_request_entry work must belong to the request''s customer');

-- The entries are history: no role rewrites or deletes one.
select pg_temp.expect_refusal('rewriting an entry', $sql$
  update public.work_request_entries set summary = 'Anders'
  where request_id = '32800000-0000-0000-0000-000000000040'
$sql$, 'event_ledger_history_immutable');
select pg_temp.expect_refusal('deleting an entry', $sql$
  delete from public.work_request_entries where request_id = '32800000-0000-0000-0000-000000000040'
$sql$, 'event_ledger_history_immutable');

-- Client roles can neither read nor write the entries.
set local role authenticated;
select pg_temp.expect_refusal('a signed-in read of the entries', $sql$
  select * from public.work_request_entries
$sql$, 'permission denied for table work_request_entries');
reset role;

rollback;
