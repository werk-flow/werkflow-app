-- A field worker proposes a corrected access contact for office review
-- (migration 20261201100004_propose_site_access_corrections.sql).
begin;

-- 01 admin, 02 buero, 03 the assigned employee, 04 an unassigned employee,
-- 05 another organization's admin.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('46000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'access-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Zugang"}', now(), now()),
('46000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'access-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Zugang"}', now(), now()),
('46000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'access-assigned@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Monteur"}', now(), now()),
('46000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'access-unassigned@example.test', '', now(), '{}',
 '{"first_name":"Uwe","last_name":"Unbeteiligt"}', now(), now()),
('46000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'access-outsider@example.test', '', now(), '{}',
 '{"first_name":"Fremd","last_name":"Zugang"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('46000000-0000-0000-0000-000000000010', 'Access SQL', '46000000-0000-0000-0000-000000000001', 'ACCSQL'),
('46000000-0000-0000-0000-000000000011', 'Access SQL other', '46000000-0000-0000-0000-000000000005', 'ACCSQLO');
insert into public.organization_members (organization_id, user_id, role) values
('46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000002', 'buero'),
('46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000003', 'employee'),
('46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000004', 'employee');

insert into public.clients (id, organization_id, name, client_type) values
('46000000-0000-0000-0000-000000000020', '46000000-0000-0000-0000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich'),
('46000000-0000-0000-0000-000000000029', '46000000-0000-0000-0000-000000000011',
 'Fremde Verwaltung', 'gewerblich');
-- 40: the job's Einsatzort; 41: another Einsatzort of the same customer;
-- 49: another organization's.
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city, access_notes) values
('46000000-0000-0000-0000-000000000040', '46000000-0000-0000-0000-000000000010',
 '46000000-0000-0000-0000-000000000020', 'Haus Lindenstraße', 'Lindenstraße 5', '10115', 'Berlin',
 'Schlüssel beim Hausmeister'),
('46000000-0000-0000-0000-000000000041', '46000000-0000-0000-0000-000000000010',
 '46000000-0000-0000-0000-000000000020', 'Haus Birkenweg', 'Birkenweg 2', '10115', 'Berlin', null),
('46000000-0000-0000-0000-000000000049', '46000000-0000-0000-0000-000000000011',
 '46000000-0000-0000-0000-000000000029', 'Fremdes Haus', 'Fremdweg 1', '10115', 'Berlin', null);
-- 50: the Zugangskontakt of 40; 51: the Zugangskontakt of 41.
insert into public.client_contacts (id, organization_id, client_id, name, phone, notes, site_id, site_role) values
('46000000-0000-0000-0000-000000000050', '46000000-0000-0000-0000-000000000010',
 '46000000-0000-0000-0000-000000000020', 'Herr Alt', '030 111', 'Hausmeister',
 '46000000-0000-0000-0000-000000000040', 'zugangskontakt'),
('46000000-0000-0000-0000-000000000051', '46000000-0000-0000-0000-000000000010',
 '46000000-0000-0000-0000-000000000020', 'Frau Birke', '030 222', null,
 '46000000-0000-0000-0000-000000000041', 'zugangskontakt');
-- 30: the job at 40 with employee 03; 31 and 32: two more of their jobs at
-- 40; 39: another organization's job.
insert into public.jobs (id, organization_id, title, job_number, client_id, site_id, created_by) values
('46000000-0000-0000-0000-000000000030', '46000000-0000-0000-0000-000000000010',
 'Heizung warten', 'ACC-1', '46000000-0000-0000-0000-000000000020',
 '46000000-0000-0000-0000-000000000040', '46000000-0000-0000-0000-000000000001'),
('46000000-0000-0000-0000-000000000031', '46000000-0000-0000-0000-000000000010',
 'Bad sanieren', 'ACC-2', '46000000-0000-0000-0000-000000000020',
 '46000000-0000-0000-0000-000000000040', '46000000-0000-0000-0000-000000000001'),
('46000000-0000-0000-0000-000000000032', '46000000-0000-0000-0000-000000000010',
 'Rohrbruch', 'ACC-3', '46000000-0000-0000-0000-000000000020',
 '46000000-0000-0000-0000-000000000040', '46000000-0000-0000-0000-000000000001'),
('46000000-0000-0000-0000-000000000039', '46000000-0000-0000-0000-000000000011',
 'Fremder Auftrag', 'ACC-9', '46000000-0000-0000-0000-000000000029',
 '46000000-0000-0000-0000-000000000049', '46000000-0000-0000-0000-000000000005');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
 '46000000-0000-0000-0000-000000000003', '46000000-0000-0000-0000-000000000001'),
('46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000031',
 '46000000-0000-0000-0000-000000000003', '46000000-0000-0000-0000-000000000001'),
('46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000032',
 '46000000-0000-0000-0000-000000000003', '46000000-0000-0000-0000-000000000001');

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

-- A proposal by the given actor on job 30 at Einsatzort 40.
create function pg_temp.propose(p_actor text, p_name text, p_phone text, p_note text, p_access text)
returns text language sql as $$
  select format($sql$select public.propose_site_access(%L, '46000000-0000-0000-0000-000000000010',
    '46000000-0000-0000-0000-000000000030', '46000000-0000-0000-0000-000000000040', %L, %L, %L, %L)$sql$,
    p_actor, p_name, p_phone, p_note, p_access);
$$;
grant execute on function pg_temp.propose(text, text, text, text, text) to service_role;

-- Browser roles reach no function and no proposed value.
do $$
begin
  if has_table_privilege('anon', 'public.site_access_proposals', 'SELECT')
    or has_table_privilege('authenticated', 'public.site_access_proposals', 'INSERT')
    or has_table_privilege('authenticated', 'public.site_access_proposals', 'UPDATE')
    or has_table_privilege('service_role', 'public.site_access_proposals', 'DELETE')
  then raise exception 'a role can write or delete access proposals outside the functions'; end if;
  if has_column_privilege('authenticated', 'public.site_access_proposals', 'contact_name', 'SELECT')
    or has_column_privilege('authenticated', 'public.site_access_proposals', 'contact_phone', 'SELECT')
    or has_column_privilege('authenticated', 'public.site_access_proposals', 'access_notes', 'SELECT')
    or has_column_privilege('authenticated', 'public.site_access_proposals', 'rejection_reason', 'SELECT')
  then raise exception 'a browser session can read a proposed value'; end if;
  if has_function_privilege('authenticated', 'public.propose_site_access(uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.accept_site_access_proposal(uuid,uuid,uuid,integer,text,uuid,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reject_site_access_proposal(uuid,uuid,uuid,integer,text)', 'EXECUTE')
    or has_function_privilege('anon', 'public.propose_site_access(uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.read_manager_attention_sets(uuid,integer)', 'EXECUTE')
  then raise exception 'a browser role can run an access proposal function'; end if;
end;
$$;

set local role service_role;

-- Only a field worker assigned to the job proposes, only for the job's
-- Einsatzort, only inside the organization.
select pg_temp.expect_refusal('an unassigned employee proposing',
  pg_temp.propose('46000000-0000-0000-0000-000000000004', 'Frau Neu', null, null, null), 'not_authorized');
select pg_temp.expect_refusal('another organization''s member proposing',
  pg_temp.propose('46000000-0000-0000-0000-000000000005', 'Frau Neu', null, null, null), 'not_authorized');
select pg_temp.expect_refusal('a proposal for another organization''s job',
  $sql$select public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000039',
    '46000000-0000-0000-0000-000000000049', 'Frau Neu', null, null, null)$sql$,
  'job_not_found');
select pg_temp.expect_refusal('a proposal for another Einsatzort than the job''s',
  $sql$select public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
    '46000000-0000-0000-0000-000000000041', 'Frau Neu', null, null, null)$sql$,
  'site_not_on_job');
select pg_temp.expect_refusal('an empty proposal',
  pg_temp.propose('46000000-0000-0000-0000-000000000003', ' ', null, null, ' '), 'invalid_input');
select pg_temp.expect_refusal('a phone without a name',
  pg_temp.propose('46000000-0000-0000-0000-000000000003', null, '0171 555', null, 'Hintereingang'),
  'invalid_input');
reset role;
do $$
begin
  if exists (select 1 from public.site_access_proposals where organization_id = '46000000-0000-0000-0000-000000000010')
  then raise exception 'a refused proposal wrote a row'; end if;
end;
$$;

-- A proposal never changes the Einsatzort; a second one on the job replaces
-- the open one.
set local role service_role;
do $$
declare
  v_first public.site_access_proposals;
  v_second public.site_access_proposals;
begin
  v_first := public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
    '46000000-0000-0000-0000-000000000040', ' Frau Neu ', '0171 555', null, null);
  if v_first.status <> 'open' or v_first.contact_name <> 'Frau Neu' or v_first.client_id <> '46000000-0000-0000-0000-000000000020'
    or v_first.proposed_by <> '46000000-0000-0000-0000-000000000003'
  then raise exception 'the proposal was not recorded as given: %', row_to_json(v_first); end if;
  v_second := public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
    '46000000-0000-0000-0000-000000000040', 'Frau Neumann', '0171 556', 'Klingel 3', 'Seiteneingang, Code beim Büro');
  if v_second.id <> v_first.id or v_second.contact_name <> 'Frau Neumann' or v_second.access_notes is null
    or (select count(*) from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030') <> 1
  then raise exception 'a second proposal did not replace the open one'; end if;
  if (select access_notes from public.client_sites where id = '46000000-0000-0000-0000-000000000040')
      <> 'Schlüssel beim Hausmeister'
    or (select name from public.client_contacts where id = '46000000-0000-0000-0000-000000000050') <> 'Herr Alt'
  then raise exception 'a proposal changed the Einsatzort by itself'; end if;
end;
$$;

-- One read returns the open requests as list_open_request_attention does and
-- the open proposals, for the organization only.
do $$
declare
  v_sets jsonb;
begin
  insert into public.client_requests (organization_id, summary, created_by)
  values ('46000000-0000-0000-0000-000000000010', 'Heizung kalt', '46000000-0000-0000-0000-000000000002');
  v_sets := public.read_manager_attention_sets('46000000-0000-0000-0000-000000000010', 100);
  if jsonb_array_length(v_sets -> 'access_proposals') <> 1
    or (v_sets -> 'access_proposals' -> 0) ? 'contact_name'
    or (v_sets -> 'requests') <> (
      select jsonb_agg(to_jsonb(request) order by request.received_at, request.id)
      from public.list_open_request_attention('46000000-0000-0000-0000-000000000010') request
    )
  then raise exception 'the combined read differs from the open requests and proposals: %', v_sets; end if;
  if jsonb_array_length(public.read_manager_attention_sets('46000000-0000-0000-0000-000000000011', 100) -> 'access_proposals') <> 0
    or jsonb_array_length(public.read_manager_attention_sets('46000000-0000-0000-0000-000000000010', 0) -> 'requests') <> 1
  then raise exception 'the combined read crosses the organization or cuts below its limit plus one'; end if;
end;
$$;

-- A decision names the revision its manager reviewed: a replacement since
-- then is refused and changes nothing.
do $$
declare
  v_reviewed public.site_access_proposals;
begin
  select * into v_reviewed from public.site_access_proposals
  where job_id = '46000000-0000-0000-0000-000000000030' and status = 'open';
  perform public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
    '46000000-0000-0000-0000-000000000040', 'Frau Neumann', '0171 556', 'Klingel 3', 'Seiteneingang, Code beim Büro');
  if (select revision from public.site_access_proposals where id = v_reviewed.id) <> v_reviewed.revision + 1
  then raise exception 'a replacement kept the revision'; end if;
  begin
    perform public.accept_site_access_proposal('46000000-0000-0000-0000-000000000002',
      '46000000-0000-0000-0000-000000000010', v_reviewed.id, v_reviewed.revision, 'Schlüssel beim Hausmeister');
    raise exception 'accepting a replaced proposal was not refused';
  exception when others then
    if sqlerrm <> 'proposal_changed' then raise; end if;
  end;
  begin
    perform public.reject_site_access_proposal('46000000-0000-0000-0000-000000000002',
      '46000000-0000-0000-0000-000000000010', v_reviewed.id, v_reviewed.revision, 'Passt nicht');
    raise exception 'rejecting a replaced proposal was not refused';
  exception when others then
    if sqlerrm <> 'proposal_changed' then raise; end if;
  end;
  if (select status from public.site_access_proposals where id = v_reviewed.id) <> 'open'
    or exists (select 1 from public.client_contacts where name = 'Frau Neumann')
  then raise exception 'a refused stale decision changed a row'; end if;
end;
$$;

-- Only a manager of the organization decides; a contact of another
-- Einsatzort is refused and nothing changes.
select pg_temp.expect_refusal('the proposing employee accepting',
  $sql$select public.accept_site_access_proposal('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    'Schlüssel beim Hausmeister')$sql$,
  'not_authorized');
select pg_temp.expect_refusal('another organization''s admin rejecting',
  $sql$select public.reject_site_access_proposal('46000000-0000-0000-0000-000000000005',
    '46000000-0000-0000-0000-000000000011',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'), 'Passt nicht')$sql$,
  'proposal_not_found');
select pg_temp.expect_refusal('correcting another Einsatzort''s Zugangskontakt',
  $sql$select public.accept_site_access_proposal('46000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    'Schlüssel beim Hausmeister', '46000000-0000-0000-0000-000000000051', 'Frau Birke', '030 222')$sql$,
  'contact_not_found');
reset role;
do $$
begin
  if (select status from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030') <> 'open'
    or (select name from public.client_contacts where id = '46000000-0000-0000-0000-000000000051') <> 'Frau Birke'
  then raise exception 'a refused acceptance changed a row'; end if;
end;
$$;

-- Accepting corrects the chosen Zugangskontakt and the access notes in one
-- call, the history names the manager, and the proposal keeps no value.
set local role service_role;
do $$
declare
  v_proposal public.site_access_proposals;
  v_contact public.client_contacts;
begin
  v_proposal := public.accept_site_access_proposal('46000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    'Schlüssel beim Hausmeister', '46000000-0000-0000-0000-000000000050', 'Herr Alt', '030 111');
  select * into v_contact from public.client_contacts where id = '46000000-0000-0000-0000-000000000050';
  if v_contact.name <> 'Frau Neumann' or v_contact.phone <> '0171 556' or v_contact.notes <> 'Klingel 3'
    or v_contact.site_role <> 'zugangskontakt'
  then raise exception 'acceptance did not correct the Zugangskontakt: %', row_to_json(v_contact); end if;
  if (select access_notes from public.client_sites where id = '46000000-0000-0000-0000-000000000040')
      <> 'Seiteneingang, Code beim Büro'
  then raise exception 'acceptance did not write the access notes'; end if;
  if (select count(*) from public.client_master_events
      where contact_id = '46000000-0000-0000-0000-000000000050' and event_type = 'changed'
        and actor_id = '46000000-0000-0000-0000-000000000002'
        and event_payload ->> 'field' in ('name', 'phone')) <> 2
  then raise exception 'the corrected contact has no history naming the manager'; end if;
  if v_proposal.status <> 'accepted' or v_proposal.decided_by <> '46000000-0000-0000-0000-000000000002'
    or v_proposal.proposed_by <> '46000000-0000-0000-0000-000000000003'
    or v_proposal.applied_contact_id <> '46000000-0000-0000-0000-000000000050' or not v_proposal.applied_access_notes
    or v_proposal.contact_name is not null or v_proposal.contact_phone is not null
    or v_proposal.contact_note is not null or v_proposal.access_notes is not null
  then raise exception 'the accepted proposal is not recorded as decided: %', row_to_json(v_proposal); end if;
end;
$$;
select pg_temp.expect_refusal('a second decision',
  $sql$select public.reject_site_access_proposal('46000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'), 'Zu spät')$sql$,
  'proposal_already_decided');

-- Without a contact to correct, acceptance adds a new Zugangskontakt at the
-- Einsatzort; access notes alone leave the contacts as they are.
do $$
declare
  v_proposal public.site_access_proposals;
  v_contact public.client_contacts;
begin
  perform public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
    '46000000-0000-0000-0000-000000000040', 'Herr Pförtner', null, null, null);
  v_proposal := public.accept_site_access_proposal('46000000-0000-0000-0000-000000000001',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'), null);
  select * into v_contact from public.client_contacts where id = v_proposal.applied_contact_id;
  if v_contact.client_id <> '46000000-0000-0000-0000-000000000020'
    or v_contact.site_id <> '46000000-0000-0000-0000-000000000040' or v_contact.site_role <> 'zugangskontakt'
    or v_contact.name <> 'Herr Pförtner' or v_contact.created_by <> '46000000-0000-0000-0000-000000000001'
    or v_proposal.applied_access_notes
  then raise exception 'acceptance did not add the Zugangskontakt: %', row_to_json(v_contact); end if;

  perform public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
    '46000000-0000-0000-0000-000000000040', null, null, null, 'Tor klemmt, fest drücken');
  v_proposal := public.accept_site_access_proposal('46000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'), 'Seiteneingang, Code beim Büro');
  if v_proposal.applied_contact_id is not null or not v_proposal.applied_access_notes
    or (select count(*) from public.client_contacts where site_id = '46000000-0000-0000-0000-000000000040') <> 2
  then raise exception 'access notes alone changed a contact'; end if;
end;
$$;

-- Rejecting needs a reason, keeps the decision, reason and proposer, and
-- clears the proposed values in the same call.
do $$ begin perform public.propose_site_access('46000000-0000-0000-0000-000000000003',
  '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
  '46000000-0000-0000-0000-000000000040', 'Erika Musterfrau', '0160 999', 'Nachbarin', 'Über den Hof'); end; $$;
select pg_temp.expect_refusal('a rejection without a reason',
  $sql$select public.reject_site_access_proposal('46000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'), ' x ')$sql$,
  'invalid_input');
do $$
declare
  v_proposal public.site_access_proposals;
begin
  v_proposal := public.reject_site_access_proposal('46000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000010',
    (select id from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'),
    (select revision from public.site_access_proposals where job_id = '46000000-0000-0000-0000-000000000030'
      and status = 'open'), ' Die Nachbarin hat keinen Schlüssel. ');
  if v_proposal.status <> 'rejected' or v_proposal.rejection_reason <> 'Die Nachbarin hat keinen Schlüssel.'
    or v_proposal.proposed_by <> '46000000-0000-0000-0000-000000000003'
    or v_proposal.decided_by <> '46000000-0000-0000-0000-000000000002' or v_proposal.decided_at is null
    or v_proposal.contact_name is not null or v_proposal.contact_phone is not null
    or v_proposal.contact_note is not null or v_proposal.access_notes is not null
  then raise exception 'the rejected proposal is not recorded as decided: %', row_to_json(v_proposal); end if;
  if exists (select 1 from public.client_contacts where name = 'Erika Musterfrau')
    or (select access_notes from public.client_sites where id = '46000000-0000-0000-0000-000000000040')
      <> 'Tor klemmt, fest drücken'
  then raise exception 'a rejection changed the Einsatzort'; end if;
end;
$$;
reset role;

-- A decision stays as it was; a rejected row never holds proposed values.
select pg_temp.expect_refusal('changing a decided proposal',
  $sql$update public.site_access_proposals set rejection_reason = 'Anders'
    where job_id = '46000000-0000-0000-0000-000000000030' and status = 'rejected'$sql$,
  'site_access_proposal_decided');
do $$
begin
  begin
    insert into public.site_access_proposals (
      organization_id, job_id, site_id, client_id, status, decided_at, rejection_reason, contact_name
    ) values (
      '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000030',
      '46000000-0000-0000-0000-000000000040', '46000000-0000-0000-0000-000000000020',
      'rejected', now(), 'Abgelehnt', 'Erika Musterfrau'
    );
  exception when check_violation then return;
  end;
  raise exception 'a rejected proposal kept a proposed name';
end;
$$;

-- Two open proposals from two jobs at one Einsatzort: accepting the first
-- changes what the second's review showed, so the second acceptance is
-- refused, whether it names the old access notes or the old contact, and
-- changes nothing.
set local role service_role;
do $$
declare
  v_notes text := (select access_notes from public.client_sites where id = '46000000-0000-0000-0000-000000000040');
  v_contact public.client_contacts;
  v_first public.site_access_proposals;
  v_second public.site_access_proposals;
begin
  select * into v_contact from public.client_contacts where id = '46000000-0000-0000-0000-000000000050';
  v_first := public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000031',
    '46000000-0000-0000-0000-000000000040', 'Frau Erste', '030 401', null, 'Code 1111');
  v_second := public.propose_site_access('46000000-0000-0000-0000-000000000003',
    '46000000-0000-0000-0000-000000000010', '46000000-0000-0000-0000-000000000032',
    '46000000-0000-0000-0000-000000000040', 'Herr Zweiter', '030 402', null, 'Code 2222');
  perform public.accept_site_access_proposal('46000000-0000-0000-0000-000000000002',
    '46000000-0000-0000-0000-000000000010', v_first.id, v_first.revision, v_notes,
    '46000000-0000-0000-0000-000000000050', v_contact.name, v_contact.phone);
  -- The old access notes, with the contact as it is now.
  begin
    perform public.accept_site_access_proposal('46000000-0000-0000-0000-000000000001',
      '46000000-0000-0000-0000-000000000010', v_second.id, v_second.revision, v_notes,
      '46000000-0000-0000-0000-000000000050', 'Frau Erste', '030 401');
    raise exception 'an acceptance over changed access notes was not refused';
  exception when others then
    if sqlerrm <> 'site_changed' then raise; end if;
  end;
  -- The access notes as they are now, with the old contact.
  begin
    perform public.accept_site_access_proposal('46000000-0000-0000-0000-000000000001',
      '46000000-0000-0000-0000-000000000010', v_second.id, v_second.revision, 'Code 1111',
      '46000000-0000-0000-0000-000000000050', v_contact.name, v_contact.phone);
    raise exception 'an acceptance over a changed contact was not refused';
  exception when others then
    if sqlerrm <> 'site_changed' then raise; end if;
  end;
  if (select access_notes from public.client_sites where id = '46000000-0000-0000-0000-000000000040') <> 'Code 1111'
    or (select name from public.client_contacts where id = '46000000-0000-0000-0000-000000000050') <> 'Frau Erste'
    or (select status from public.site_access_proposals where id = v_second.id) <> 'open'
  then raise exception 'a refused acceptance over a changed Einsatzort changed a row'; end if;
end;
$$;
reset role;

-- An acceptance is one call: when the Einsatzort's write fails after the
-- contact's, the contact, its history, the access notes and the open
-- proposal stay as they were.
create function public.test_refuse_site_update() returns trigger language plpgsql as $$
begin
  raise exception 'test_site_update_refused';
end;
$$;
create trigger test_refuse_site_update before update on public.client_sites
  for each row execute function public.test_refuse_site_update();
set local role service_role;
do $$
declare
  v_open public.site_access_proposals;
  v_events bigint := (select count(*) from public.client_master_events
    where contact_id = '46000000-0000-0000-0000-000000000050');
begin
  select * into v_open from public.site_access_proposals
  where job_id = '46000000-0000-0000-0000-000000000032' and status = 'open';
  begin
    perform public.accept_site_access_proposal('46000000-0000-0000-0000-000000000002',
      '46000000-0000-0000-0000-000000000010', v_open.id, v_open.revision, 'Code 1111',
      '46000000-0000-0000-0000-000000000050', 'Frau Erste', '030 401');
    raise exception 'the failing Einsatzort write did not fail the acceptance';
  exception when others then
    if sqlerrm <> 'test_site_update_refused' then raise; end if;
  end;
  if (select name from public.client_contacts where id = '46000000-0000-0000-0000-000000000050') <> 'Frau Erste'
    or (select count(*) from public.client_master_events
        where contact_id = '46000000-0000-0000-0000-000000000050') <> v_events
    or (select access_notes from public.client_sites where id = '46000000-0000-0000-0000-000000000040') <> 'Code 1111'
    or (select status from public.site_access_proposals where id = v_open.id) <> 'open'
  then raise exception 'a failed acceptance left a partial write'; end if;
end;
$$;
reset role;
alter table public.client_sites disable trigger test_refuse_site_update;

-- A session sees a proposal's signal columns as a manager of the
-- organization or on the job's team, and nobody else does.
create function pg_temp.visible_proposals(p_user uuid) returns bigint language plpgsql as $$
declare v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.site_access_proposals
  where job_id = '46000000-0000-0000-0000-000000000030';
  execute 'reset role';
  return v_count;
end;
$$;
grant execute on function pg_temp.visible_proposals(uuid) to authenticated;
do $$
begin
  if pg_temp.visible_proposals('46000000-0000-0000-0000-000000000002') <> 4
    or pg_temp.visible_proposals('46000000-0000-0000-0000-000000000003') <> 4
    or pg_temp.visible_proposals('46000000-0000-0000-0000-000000000004') <> 0
    or pg_temp.visible_proposals('46000000-0000-0000-0000-000000000005') <> 0
  then raise exception 'the proposal policy shows rows outside the managers and the job''s team'; end if;
end;
$$;

rollback;
