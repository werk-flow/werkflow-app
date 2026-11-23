-- A retried capture, promotion or conversion of a request answers with the
-- first result: the same attempt key returns the request, customer or work
-- the first call made and writes nothing more. Another key, another target or
-- a closed request is refused before it writes (migration
-- 20261130090002_answer_a_retried_request_write_with_its_first_result.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('41932400-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-retry-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Wiederholung"}', now(), now()),
('41932400-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-retry-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Wiederholung"}', now(), now()),
('41932400-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-retry-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Wiederholung"}', now(), now()),
('41932400-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'request-retry-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Wiederholung"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('41932400-0000-0000-0000-000000000010', 'Request retry SQL',
 '41932400-0000-0000-0000-000000000001', 'REQRETRY'),
('41932400-0000-0000-0000-000000000011', 'Request retry SQL other',
 '41932400-0000-0000-0000-000000000004', 'REQRETRO');
insert into public.organization_members (organization_id, user_id, role) values
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000002', 'buero'),
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000003', 'employee');

insert into public.clients (id, organization_id, name, address) values
('41932400-0000-0000-0000-000000000020', '41932400-0000-0000-0000-000000000010', 'Hausverwaltung Lindenhof GmbH', null),
('41932400-0000-0000-0000-000000000021', '41932400-0000-0000-0000-000000000010', 'Erika Musterfrau',
 'Sonnenweg 3, 10115 Berlin');
insert into public.client_sites (id, organization_id, client_id, name) values
('41932400-0000-0000-0000-000000000030', '41932400-0000-0000-0000-000000000010',
 '41932400-0000-0000-0000-000000000020', 'Lindenhof 1'),
('41932400-0000-0000-0000-000000000031', '41932400-0000-0000-0000-000000000010',
 '41932400-0000-0000-0000-000000000021', 'Sonnenweg 3');
insert into public.client_contacts (id, organization_id, client_id, name) values
('41932400-0000-0000-0000-000000000035', '41932400-0000-0000-0000-000000000010',
 '41932400-0000-0000-0000-000000000020', 'Max Mustermann'),
('41932400-0000-0000-0000-000000000036', '41932400-0000-0000-0000-000000000010',
 '41932400-0000-0000-0000-000000000021', 'Erika Musterfrau');

-- 40: converts into a job; 41: into a project; 42: into a Servicefall;
-- 43: an unknown caller who becomes a customer; 44: closed; 45: into an
-- offer; 46: without a customer; 47: stays open; 48: another organization's.
insert into public.client_requests (
  id, organization_id, summary, client_id, site_id, caller_name, caller_phone, status,
  closed_reason, closed_at
) values
('41932400-0000-0000-0000-000000000040', '41932400-0000-0000-0000-000000000010', 'Heizung kalt',
 '41932400-0000-0000-0000-000000000020', '41932400-0000-0000-0000-000000000030', null, null, 'offen', null, null),
('41932400-0000-0000-0000-000000000041', '41932400-0000-0000-0000-000000000010', 'Bad neu',
 '41932400-0000-0000-0000-000000000020', '41932400-0000-0000-0000-000000000030', null, null, 'offen', null, null),
('41932400-0000-0000-0000-000000000042', '41932400-0000-0000-0000-000000000010', 'Therme tropft',
 '41932400-0000-0000-0000-000000000020', '41932400-0000-0000-0000-000000000030', null, null, 'offen', null, null),
('41932400-0000-0000-0000-000000000043', '41932400-0000-0000-0000-000000000010', 'Rückruf Wartung',
 null, null, 'Erika Musterfrau', '030 4440123', 'in_klaerung', null, null),
('41932400-0000-0000-0000-000000000044', '41932400-0000-0000-0000-000000000010', 'Erledigt',
 '41932400-0000-0000-0000-000000000020', null, null, null, 'geschlossen', 'kein_bedarf', now()),
('41932400-0000-0000-0000-000000000045', '41932400-0000-0000-0000-000000000010', 'Angebot Badsanierung',
 '41932400-0000-0000-0000-000000000020', '41932400-0000-0000-0000-000000000030', null, null, 'in_klaerung', null, null),
('41932400-0000-0000-0000-000000000046', '41932400-0000-0000-0000-000000000010', 'Angebot ohne Kunde',
 null, null, 'Max Mustermann', null, 'offen', null, null),
('41932400-0000-0000-0000-000000000047', '41932400-0000-0000-0000-000000000010', 'Heizung tauschen',
 '41932400-0000-0000-0000-000000000020', null, null, null, 'offen', null, null),
('41932400-0000-0000-0000-000000000048', '41932400-0000-0000-0000-000000000011', 'Fremdes Angebot',
 null, null, 'Erika Musterfrau', null, 'offen', null, null);

-- A job the field worker is assigned to.
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('41932400-0000-0000-0000-000000000050', '41932400-0000-0000-0000-000000000010', 'Bad besichtigen',
 'RT-J-50', '41932400-0000-0000-0000-000000000002');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000050',
 '41932400-0000-0000-0000-000000000003', '41932400-0000-0000-0000-000000000002');

-- Three files of request 45: the first is also a document of the field
-- worker's job, the second a customer document, the third in the trash.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, size_bytes, uploaded_by, deleted_at
) values
('41932400-0000-0000-0000-000000000080', '41932400-0000-0000-0000-000000000010',
 '41932400-0000-0000-0000-000000000010/d80/bad.jpg', 'bad.jpg', 'bad.jpg', 10,
 '41932400-0000-0000-0000-000000000002', null),
('41932400-0000-0000-0000-000000000081', '41932400-0000-0000-0000-000000000010',
 '41932400-0000-0000-0000-000000000010/d81/grundriss.pdf', 'grundriss.pdf', 'grundriss.pdf', 10,
 '41932400-0000-0000-0000-000000000002', null),
('41932400-0000-0000-0000-000000000082', '41932400-0000-0000-0000-000000000010',
 '41932400-0000-0000-0000-000000000010/d82/alt.jpg', 'alt.jpg', 'alt.jpg', 10,
 '41932400-0000-0000-0000-000000000002', null);
insert into public.document_links (organization_id, document_id, request_id, client_id, job_id, created_by) values
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000080',
 null, null, '41932400-0000-0000-0000-000000000050', '41932400-0000-0000-0000-000000000002'),
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000082',
 '41932400-0000-0000-0000-000000000045', null, null, '41932400-0000-0000-0000-000000000002'),
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000080',
 '41932400-0000-0000-0000-000000000045', null, null, '41932400-0000-0000-0000-000000000002'),
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000081',
 '41932400-0000-0000-0000-000000000045', null, null, '41932400-0000-0000-0000-000000000002'),
('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000081',
 null, '41932400-0000-0000-0000-000000000020', null, '41932400-0000-0000-0000-000000000002');
-- A file is trashed after it was linked; its request link stays.
update public.documents set deleted_at = now(), deleted_by = '41932400-0000-0000-0000-000000000002'
where id = '41932400-0000-0000-0000-000000000082';

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

-- Every row a capture, promotion or conversion writes in the organizations.
create function pg_temp.written_rows() returns text language sql as $$
  select concat_ws('/',
    (select count(*) from public.client_requests
     where organization_id in ('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000011')),
    (select count(*) from public.client_request_events
     where organization_id in ('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000011')),
    (select count(*) from public.clients where organization_id = '41932400-0000-0000-0000-000000000010'),
    (select count(*) from public.client_contacts where organization_id = '41932400-0000-0000-0000-000000000010'),
    (select count(*) from public.client_sites where organization_id = '41932400-0000-0000-0000-000000000010'),
    (select count(*) from public.jobs where organization_id = '41932400-0000-0000-0000-000000000010'),
    (select count(*) from public.projects where organization_id = '41932400-0000-0000-0000-000000000010'),
    (select count(*) from public.service_cases where organization_id = '41932400-0000-0000-0000-000000000010'),
    (select count(*) from public.offers
     where organization_id in ('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000011')),
    (select count(*) from public.document_links where organization_id = '41932400-0000-0000-0000-000000000010'),
    (select string_agg(request.id::text || ':' || request.status::text, ',' order by request.id)
     from public.client_requests request
     where request.organization_id = '41932400-0000-0000-0000-000000000010'));
$$;
grant execute on function pg_temp.written_rows() to service_role;

-- A conversion into a job with the given number under the attempt key.
create function pg_temp.convert_to_job(p_request_id uuid, p_job_number text, p_attempt_key uuid)
returns public.jobs language sql as $$
  select public.convert_client_request_to_job('41932400-0000-0000-0000-000000000010',
    '41932400-0000-0000-0000-000000000002', p_request_id,
    jsonb_build_object('title', 'Heizung kalt', 'job_number', p_job_number,
      'client_id', '41932400-0000-0000-0000-000000000020'),
    '{}', current_date, '{}', '[]', '{}', 'fingerprint', null, null, false, null, false,
    p_attempt_key => p_attempt_key);
$$;
grant execute on function pg_temp.convert_to_job(uuid, text, uuid) to service_role;

create function pg_temp.convert_to_project(p_request_id uuid, p_project_number text, p_attempt_key uuid)
returns public.projects language sql as $$
  select public.convert_client_request_to_project('41932400-0000-0000-0000-000000000010',
    '41932400-0000-0000-0000-000000000002', p_request_id,
    jsonb_build_object('name', 'Bad neu', 'project_number', p_project_number,
      'client_id', '41932400-0000-0000-0000-000000000020'),
    null, p_attempt_key => p_attempt_key);
$$;
grant execute on function pg_temp.convert_to_project(uuid, text, uuid) to service_role;

-- A conversion into an offer by the actor at the Objekt and Ansprechpartner under the attempt key.
create function pg_temp.convert_to_offer(
  p_actor_id uuid, p_request_id uuid, p_title text, p_site_id uuid, p_contact_id uuid, p_attempt_key uuid
)
returns public.offers language sql as $$
  select public.convert_client_request_to_offer('41932400-0000-0000-0000-000000000010', p_actor_id,
    p_request_id, p_attempt_key, p_title, p_site_id, p_contact_id);
$$;
grant execute on function pg_temp.convert_to_offer(uuid, uuid, text, uuid, uuid, uuid) to service_role;

set local role service_role;

-- Two captures under one key make one request with one history row; the
-- second answers with the first even when its content changed. The same key
-- in another organization is another capture.
do $$
declare
  v_org constant uuid := '41932400-0000-0000-0000-000000000010';
  v_actor constant uuid := '41932400-0000-0000-0000-000000000002';
  v_key constant uuid := '41932400-0000-0000-0000-0000000000a1';
  v_first public.client_requests;
  v_retry public.client_requests;
  v_other public.client_requests;
  v_requests_before bigint := (select count(*) from public.client_requests
    where organization_id in ('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000011'));
  v_events_before bigint := (select count(*) from public.client_request_events
    where organization_id in ('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000011'));
begin
  v_first := public.create_client_request(v_actor, v_org,
    'Heizung fällt aus', null, null, null, null, null, 'Erika Musterfrau', null, null, null,
    null, null, null, v_actor, null, p_attempt_key => v_key);
  v_retry := public.create_client_request(v_actor, v_org,
    'Heizung fällt aus, Nachtrag', null, null, null, null, null, 'Erika Musterfrau', null, null, null,
    null, null, null, v_actor, null, p_attempt_key => v_key);
  if v_retry.id is distinct from v_first.id or v_retry.summary is distinct from 'Heizung fällt aus' then
    raise exception 'a retried capture did not answer with the first request: % then %',
      to_jsonb(v_first), to_jsonb(v_retry);
  end if;
  if (select count(*) from public.client_requests where organization_id = v_org and attempt_key = v_key) <> 1
    or (select count(*) from public.client_request_events where request_id = v_first.id) <> 1
  then
    raise exception 'two captures under one key wrote more than one request and history row';
  end if;

  v_other := public.create_client_request('41932400-0000-0000-0000-000000000004',
    '41932400-0000-0000-0000-000000000011', 'Fremde Anfrage', null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, p_attempt_key => v_key);
  if v_other.id = v_first.id or v_other.organization_id is distinct from '41932400-0000-0000-0000-000000000011' then
    raise exception 'a key of another organization answered with this organization''s request';
  end if;
  if (select count(*) from public.client_requests
      where organization_id in ('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000011')) is distinct from v_requests_before + 2
    or (select count(*) from public.client_request_events
      where organization_id in ('41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000011')) is distinct from v_events_before + 2
  then
    raise exception 'three captures under one key in two organizations did not write two requests';
  end if;
end;
$$;

-- A field worker's retry is refused before it reads the first capture.
select pg_temp.expect_refusal('a field worker''s capture under a used key', $sql$
  select public.create_client_request('41932400-0000-0000-0000-000000000003',
    '41932400-0000-0000-0000-000000000010', 'Heizung fällt aus', null, null, null, null, null, null, null,
    null, null, null, null, null, null, null, p_attempt_key => '41932400-0000-0000-0000-0000000000a1')
$sql$, 'not_authorized');

-- A repeated conversion into a job or a project under its key returns the
-- same work and writes no second history row.
do $$
declare
  v_job_key constant uuid := '41932400-0000-0000-0000-0000000000b1';
  v_project_key constant uuid := '41932400-0000-0000-0000-0000000000b2';
  v_job public.jobs;
  v_job_retry public.jobs;
  v_project public.projects;
  v_project_retry public.projects;
  v_after_first text;
begin
  v_job := pg_temp.convert_to_job('41932400-0000-0000-0000-000000000040', 'RT-J-1', v_job_key);
  v_project := pg_temp.convert_to_project('41932400-0000-0000-0000-000000000041', 'RT-P-1', v_project_key);
  v_after_first := pg_temp.written_rows();

  -- The retry may carry another number: the first conversion stands.
  v_job_retry := pg_temp.convert_to_job('41932400-0000-0000-0000-000000000040', 'RT-J-2', v_job_key);
  v_project_retry := pg_temp.convert_to_project('41932400-0000-0000-0000-000000000041', 'RT-P-2', v_project_key);
  if v_job_retry.id is distinct from v_job.id or v_project_retry.id is distinct from v_project.id then
    raise exception 'a repeated conversion did not return the first work: % %',
      to_jsonb(v_job_retry), to_jsonb(v_project_retry);
  end if;

  -- The job conversion the action calls answers the same way, without
  -- assessing a visit again.
  v_job_retry := public.convert_client_request_to_job_with_visit_assessment(
    '41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000040',
    '{"title": "Heizung kalt", "job_number": "RT-J-3", "client_id": "41932400-0000-0000-0000-000000000020"}',
    '{}', current_date, '{}', '[]', '{}', 'fingerprint', null, null, false, null, false, '{}',
    p_attempt_key => v_job_key);
  if v_job_retry.id is distinct from v_job.id then
    raise exception 'a repeated job conversion with its visit assessment did not return the first job';
  end if;

  if pg_temp.written_rows() is distinct from v_after_first then
    raise exception 'a repeated conversion wrote again: % then %', v_after_first, pg_temp.written_rows();
  end if;
  if (select count(*) from public.client_request_events
      where request_id in ('41932400-0000-0000-0000-000000000040', '41932400-0000-0000-0000-000000000041')
        and event_type = 'converted') <> 2
  then
    raise exception 'a repeated conversion wrote a second history row';
  end if;
end;
$$;

-- A converted request refuses another target, another key and a conversion
-- without a key, and a closed request refuses any conversion; none writes.
create temporary table rows_before_refusals as select pg_temp.written_rows() as state;
grant select on rows_before_refusals to service_role;
select pg_temp.expect_refusal('a job conversion retried as a project', $sql$
  select pg_temp.convert_to_project('41932400-0000-0000-0000-000000000040', 'RT-P-3',
    '41932400-0000-0000-0000-0000000000b1')
$sql$, 'already_converted');
select pg_temp.expect_refusal('a project conversion retried as a job', $sql$
  select pg_temp.convert_to_job('41932400-0000-0000-0000-000000000041', 'RT-J-4',
    '41932400-0000-0000-0000-0000000000b2')
$sql$, 'already_converted');
select pg_temp.expect_refusal('a second job conversion under another key', $sql$
  select pg_temp.convert_to_job('41932400-0000-0000-0000-000000000040', 'RT-J-5',
    '41932400-0000-0000-0000-0000000000b9')
$sql$, 'already_converted');
select pg_temp.expect_refusal('a second job conversion without a key', $sql$
  select pg_temp.convert_to_job('41932400-0000-0000-0000-000000000040', 'RT-J-6', null)
$sql$, 'already_converted');
select pg_temp.expect_refusal('a job conversion retried as a Servicefall', $sql$
  select public.create_service_case('41932400-0000-0000-0000-000000000010',
    '41932400-0000-0000-0000-0000000000c9',
    '{"sourceRequestId":"41932400-0000-0000-0000-000000000040","chargeContext":"unknown","equipmentIds":[]}',
    '41932400-0000-0000-0000-000000000002', '41932400-0000-0000-0000-0000000000b1')
$sql$, 'service_case_request_already_converted');
select pg_temp.expect_refusal('a conversion of a closed request', $sql$
  select pg_temp.convert_to_job('41932400-0000-0000-0000-000000000044', 'RT-J-7',
    '41932400-0000-0000-0000-0000000000b3')
$sql$, 'already_converted');
do $$
begin
  if pg_temp.written_rows() is distinct from (select state from rows_before_refusals) then
    raise exception 'a refused conversion wrote: % then %',
      (select state from rows_before_refusals), pg_temp.written_rows();
  end if;
end;
$$;

-- A Servicefall conversion retried with the same case and key returns the
-- first case and writes no second history row.
do $$
declare
  v_payload constant jsonb :=
    '{"sourceRequestId":"41932400-0000-0000-0000-000000000042","chargeContext":"unknown","equipmentIds":[]}';
  v_first public.service_cases;
  v_retry public.service_cases;
  v_after_first text;
begin
  v_first := public.create_service_case('41932400-0000-0000-0000-000000000010',
    '41932400-0000-0000-0000-0000000000c1', v_payload,
    '41932400-0000-0000-0000-000000000002', '41932400-0000-0000-0000-0000000000c2');
  v_after_first := pg_temp.written_rows();
  v_retry := public.create_service_case('41932400-0000-0000-0000-000000000010',
    '41932400-0000-0000-0000-0000000000c1', v_payload,
    '41932400-0000-0000-0000-000000000002', '41932400-0000-0000-0000-0000000000c2');
  if v_retry.id is distinct from v_first.id or pg_temp.written_rows() is distinct from v_after_first then
    raise exception 'a repeated Servicefall conversion did not answer with the first case alone';
  end if;
end;
$$;

-- A promotion retried under its key returns the request with the customer it
-- created; another key finds the request matched and is refused.
do $$
declare
  v_key constant uuid := '41932400-0000-0000-0000-0000000000d1';
  v_first public.client_requests;
  v_retry public.client_requests;
  v_after_first text;
begin
  v_first := public.promote_client_request_caller('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000043',
    'Erika Musterfrau', 'privat', p_attempt_key => v_key);
  v_after_first := pg_temp.written_rows();
  v_retry := public.promote_client_request_caller('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000043',
    'Erika Musterfrau', 'privat', p_attempt_key => v_key);
  if v_first.client_id is null or v_retry.client_id is distinct from v_first.client_id
    or v_retry.site_id is distinct from v_first.site_id or v_retry.contact_id is distinct from v_first.contact_id
  then
    raise exception 'a retried promotion did not return the first customer: % then %',
      to_jsonb(v_first), to_jsonb(v_retry);
  end if;
  if pg_temp.written_rows() is distinct from v_after_first then
    raise exception 'a retried promotion wrote again: % then %', v_after_first, pg_temp.written_rows();
  end if;
end;
$$;
select pg_temp.expect_refusal('a second promotion under another key', $sql$
  select public.promote_client_request_caller('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000043',
    'Erika Musterfrau', 'privat', p_attempt_key => '41932400-0000-0000-0000-0000000000d9')
$sql$, 'already_matched');
select pg_temp.expect_refusal('a field worker''s retry of a promotion', $sql$
  select public.promote_client_request_caller('41932400-0000-0000-0000-000000000003',
    '41932400-0000-0000-0000-000000000010', '41932400-0000-0000-0000-000000000043',
    'Erika Musterfrau', 'privat', p_attempt_key => '41932400-0000-0000-0000-0000000000d1')
$sql$, 'not_authorized');

-- A conversion into an offer writes one draft for the request's customer at
-- the chosen Objekt and Ansprechpartner, carries the recipient the office
-- chose on the request, marks the request converted with the offer, links each
-- of its documents outside the trash to the offer and nothing else, and
-- records the history with its key. A retry under that key returns the first
-- offer and writes nothing.
do $$
declare
  v_buero constant uuid := '41932400-0000-0000-0000-000000000002';
  v_request_id constant uuid := '41932400-0000-0000-0000-000000000045';
  v_key constant uuid := '41932400-0000-0000-0000-0000000000e1';
  v_offer public.offers;
  v_retry public.offers;
  v_request public.client_requests;
  v_after_first text;
begin
  perform public.set_work_billing_parties(v_buero, '41932400-0000-0000-0000-000000000010', 'request',
    v_request_id, '41932400-0000-0000-0000-000000000020', '41932400-0000-0000-0000-000000000021',
    (app_private.current_work_billing_parties('41932400-0000-0000-0000-000000000010', v_request_id)).version);

  v_offer := pg_temp.convert_to_offer(v_buero, v_request_id, 'Badsanierung Lindenhof',
    '41932400-0000-0000-0000-000000000030', '41932400-0000-0000-0000-000000000035', v_key);
  v_after_first := pg_temp.written_rows();
  if v_offer.request_id is distinct from v_request_id
    or v_offer.client_id is distinct from '41932400-0000-0000-0000-000000000020'
    or v_offer.site_id is distinct from '41932400-0000-0000-0000-000000000030'
    or v_offer.contact_id is distinct from '41932400-0000-0000-0000-000000000035'
    or v_offer.title is distinct from 'Badsanierung Lindenhof'
    or v_offer.status is distinct from 'entwurf'
    or v_offer.recipient_client_id is distinct from '41932400-0000-0000-0000-000000000021'
    or v_offer.recipient_is_default is distinct from false
  then
    raise exception 'the offer did not carry the request: %', to_jsonb(v_offer);
  end if;
  select * into strict v_request from public.client_requests where id = v_request_id;
  if v_request.status is distinct from 'umgewandelt' or v_request.converted_offer_id is distinct from v_offer.id
    or v_request.converted_by is distinct from v_buero or v_request.converted_at is null
  then
    raise exception 'the request was not marked converted into the offer: %', to_jsonb(v_request);
  end if;
  if (select array_agg(link.document_id order by link.document_id) from public.document_links link
      where link.offer_id = v_offer.id)
      is distinct from array['41932400-0000-0000-0000-000000000080', '41932400-0000-0000-0000-000000000081']::uuid[]
    or exists (select 1 from public.document_links link
      where link.offer_id = v_offer.id
        and num_nonnulls(link.job_id, link.project_id, link.client_id, link.request_id) <> 0)
    or (select count(*) from public.document_links link
      where link.document_id in ('41932400-0000-0000-0000-000000000080', '41932400-0000-0000-0000-000000000081',
        '41932400-0000-0000-0000-000000000082'))
      is distinct from 8::bigint
  then
    raise exception 'the request''s documents were not linked to the offer alone';
  end if;
  if (select count(*) from public.document_audit_events event
      where event.event_type = 'linked' and event.event_payload ->> 'offerId' = v_offer.id::text
        and event.event_payload ->> 'requestId' = v_request_id::text) is distinct from 2::bigint
  then
    raise exception 'the offer links were written without their audit events';
  end if;
  if (select event.event_payload from public.client_request_events event
      where event.request_id = v_request_id and event.event_type = 'converted')
    is distinct from jsonb_build_object('target', 'offer', 'offerId', v_offer.id,
      'offerNumber', v_offer.offer_number, 'attemptKey', v_key)
  then
    raise exception 'the conversion into an offer wrote no history row with its key';
  end if;

  -- The retry may carry another title: the first conversion stands.
  v_retry := pg_temp.convert_to_offer(v_buero, v_request_id, 'Badsanierung, zweiter Versuch',
    null, null, v_key);
  if v_retry.id is distinct from v_offer.id or v_retry.title is distinct from 'Badsanierung Lindenhof' then
    raise exception 'a repeated conversion did not return the first offer: %', to_jsonb(v_retry);
  end if;
  if pg_temp.written_rows() is distinct from v_after_first then
    raise exception 'a repeated conversion into an offer wrote again: % then %',
      v_after_first, pg_temp.written_rows();
  end if;

  -- A free offer under key e5, which a conversion below sends again.
  perform public.create_offer(v_buero, '41932400-0000-0000-0000-000000000010',
    '41932400-0000-0000-0000-0000000000e5', 'Freies Angebot', '41932400-0000-0000-0000-000000000020',
    null, null, null, null);
end;
$$;

-- A request converted into an offer refuses every other target, and a request
-- converted into work refuses an offer; none writes.
create temporary table rows_before_offer_refusals as select pg_temp.written_rows() as state;
grant select on rows_before_offer_refusals to service_role;
select pg_temp.expect_refusal('an offer conversion retried as a job', $sql$
  select pg_temp.convert_to_job('41932400-0000-0000-0000-000000000045', 'RT-J-8',
    '41932400-0000-0000-0000-0000000000e1')
$sql$, 'already_converted');
select pg_temp.expect_refusal('an offer conversion retried as a project', $sql$
  select pg_temp.convert_to_project('41932400-0000-0000-0000-000000000045', 'RT-P-8',
    '41932400-0000-0000-0000-0000000000e1')
$sql$, 'already_converted');
select pg_temp.expect_refusal('an offer conversion retried as a Servicefall', $sql$
  select public.create_service_case('41932400-0000-0000-0000-000000000010',
    '41932400-0000-0000-0000-0000000000c8',
    '{"sourceRequestId":"41932400-0000-0000-0000-000000000045","chargeContext":"unknown","equipmentIds":[]}',
    '41932400-0000-0000-0000-000000000002', '41932400-0000-0000-0000-0000000000e1')
$sql$, 'service_case_request_already_converted');
select pg_temp.expect_refusal('a second offer conversion under another key', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000045', 'Zweites Angebot', null, null,
    '41932400-0000-0000-0000-0000000000e9')
$sql$, 'already_converted');
select pg_temp.expect_refusal('a job conversion retried as an offer', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000040', 'Heizung kalt', null, null,
    '41932400-0000-0000-0000-0000000000b1')
$sql$, 'already_converted');
select pg_temp.expect_refusal('an offer conversion of a closed request', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000044', 'Erledigt', null, null,
    '41932400-0000-0000-0000-0000000000e2')
$sql$, 'already_converted');

-- The boundary: a field worker, a member of another organization, another
-- organization's request, another customer's Objekt or Ansprechpartner, a
-- request without a customer and a blank title are refused; none writes.
select pg_temp.expect_refusal('a field worker''s offer conversion', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000003',
    '41932400-0000-0000-0000-000000000047', 'Heizung tauschen', null, null, '41932400-0000-0000-0000-0000000000e3')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('another organization''s member converting into an offer', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000004',
    '41932400-0000-0000-0000-000000000047', 'Heizung tauschen', null, null, '41932400-0000-0000-0000-0000000000e3')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('another organization''s request converted into an offer', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000048', 'Fremdes Angebot', null, null,
    '41932400-0000-0000-0000-0000000000e3')
$sql$, 'request_not_found');
select pg_temp.expect_refusal('another customer''s Objekt on the offer', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000047', 'Heizung tauschen', '41932400-0000-0000-0000-000000000031', null,
    '41932400-0000-0000-0000-0000000000e3')
$sql$, 'site_not_found');
select pg_temp.expect_refusal('another customer''s Ansprechpartner on the offer', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000047', 'Heizung tauschen', null, '41932400-0000-0000-0000-000000000036',
    '41932400-0000-0000-0000-0000000000e3')
$sql$, 'contact_not_found');
select pg_temp.expect_refusal('an offer for a request without a customer', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000046', 'Angebot ohne Kunde', null, null,
    '41932400-0000-0000-0000-0000000000e4')
$sql$, 'client_required');
select pg_temp.expect_refusal('an offer without a title', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000047', '  ', null, null, '41932400-0000-0000-0000-0000000000e3')
$sql$, 'title_required');
select pg_temp.expect_refusal('an offer conversion under the key of a free offer', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000047', 'Heizung tauschen', null, null,
    '41932400-0000-0000-0000-0000000000e5')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('an offer conversion without a key', $sql$
  select pg_temp.convert_to_offer('41932400-0000-0000-0000-000000000002',
    '41932400-0000-0000-0000-000000000047', 'Heizung tauschen', null, null, null)
$sql$, 'invalid_input');
do $$
begin
  if pg_temp.written_rows() is distinct from (select state from rows_before_offer_refusals) then
    raise exception 'a refused offer conversion wrote: % then %',
      (select state from rows_before_offer_refusals), pg_temp.written_rows();
  end if;
end;
$$;

-- The conversion is the server's: no client role may call it.
do $$
begin
  if has_function_privilege('authenticated',
      'public.convert_client_request_to_offer(uuid,uuid,uuid,uuid,text,uuid,uuid)', 'EXECUTE')
    or has_function_privilege('anon',
      'public.convert_client_request_to_offer(uuid,uuid,uuid,uuid,text,uuid,uuid)', 'EXECUTE')
  then
    raise exception 'a client role may convert a request into an offer';
  end if;
end;
$$;

reset role;

-- A field worker who reads a file through the assigned job reads its job
-- link but not its offer link; a manager reads both.
create function pg_temp.visible_links_of_photo() returns text language sql as $$
  select concat_ws('/',
    (select count(*) from public.document_links
     where document_id = '41932400-0000-0000-0000-000000000080' and job_id is not null),
    (select count(*) from public.document_links
     where document_id = '41932400-0000-0000-0000-000000000080' and offer_id is not null));
$$;
grant execute on function pg_temp.visible_links_of_photo() to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', '41932400-0000-0000-0000-000000000003', true);
do $$
begin
  if pg_temp.visible_links_of_photo() is distinct from '1/0' then
    raise exception 'a field worker read the links % (job/offer) of a job document', pg_temp.visible_links_of_photo();
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '41932400-0000-0000-0000-000000000002', true);
do $$
begin
  if pg_temp.visible_links_of_photo() is distinct from '1/1' then
    raise exception 'a manager read the links % (job/offer) of a job document', pg_temp.visible_links_of_photo();
  end if;
end;
$$;
reset role;

rollback;
