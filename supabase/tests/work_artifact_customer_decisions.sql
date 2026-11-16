-- The customer's decision and signature on a customer-facing Arbeitsnachweis
-- revision are recorded in one call, or not at all
-- (20261126090000_record_customer_decision_with_signature.sql,
-- werk-flow/werkflow-planning#157). A revision holds one decision and one
-- signature: a second recording is refused, also through the single-action
-- path. The call refuses another organization's artifact, a colleague outside
-- the assigned job and an internal revision. The review actions stay with the
-- responsible reviewer. Only the service role executes the function.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('15700000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-decision-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Decision"}', now(), now()),
('15700000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-decision-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Decision"}', now(), now()),
('15700000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-decision-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"Decision"}', now(), now()),
('15700000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'customer-decision-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Decision"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('15700000-0000-0000-0000-000000000010', 'Customer decision SQL',
 '15700000-0000-0000-0000-000000000001', 'CUSTDECA'),
('15700000-0000-0000-0000-000000000011', 'Customer decision SQL outsider',
 '15700000-0000-0000-0000-000000000004', 'CUSTDECB');
insert into public.organization_members (organization_id, user_id, role) values
('15700000-0000-0000-0000-000000000010', '15700000-0000-0000-0000-000000000002', 'employee'),
('15700000-0000-0000-0000-000000000010', '15700000-0000-0000-0000-000000000003', 'employee');

insert into public.jobs (id, organization_id, title, job_number, created_by) values
('15700000-0000-0000-0000-000000000020', '15700000-0000-0000-0000-000000000010',
 'Kundenentscheidung', 'CUSTDEC-1', '15700000-0000-0000-0000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('15700000-0000-0000-0000-000000000010', '15700000-0000-0000-0000-000000000020',
 '15700000-0000-0000-0000-000000000002', '15700000-0000-0000-0000-000000000001');

-- Runs one call and requires the named refusal.
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

-- The signer context the server action builds.
create function pg_temp.signer(p_name text) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'signerName', p_name, 'signerRole', 'Objektleitung', 'signerRelationship', 'Ansprechperson vor Ort',
    'captureMethod', 'Unterschrift auf dem Gerät', 'wordingSnapshot', 'Die erfasste Bestätigung gilt dieser Version.')
$$;
grant execute on function pg_temp.signer(text) to service_role;

-- The decision call for the fixture artifact, with the artifact's current version.
create function pg_temp.decide(
  p_organization_id uuid, p_actor_id uuid, p_artifact_id uuid, p_revision_id uuid,
  p_decision_action_id uuid, p_decision public.work_artifact_action_type, p_reason text,
  p_signature_action_id uuid, p_signature_document_id uuid
) returns jsonb
language sql as $$
  select public.record_work_artifact_customer_decision(
    p_organization_id, p_actor_id, p_artifact_id, p_revision_id,
    coalesce((select version from public.work_artifacts where id = p_artifact_id), 1),
    p_decision_action_id, p_decision, p_reason, pg_temp.signer('Erika Beispiel'),
    p_signature_action_id, p_signature_document_id)
$$;
grant execute on function pg_temp.decide(uuid, uuid, uuid, uuid, uuid, public.work_artifact_action_type, text, uuid, uuid)
  to service_role;

set local role service_role;

do $$
declare
  v_org constant uuid := '15700000-0000-0000-0000-000000000010';
  v_admin constant uuid := '15700000-0000-0000-0000-000000000001';
  v_employee constant uuid := '15700000-0000-0000-0000-000000000002';
  v_content constant jsonb := '{"summary":"Anlage geprüft","performedWork":"Brenner gereinigt","visitStartedAt":"2026-09-01T06:00:00Z","visitEndedAt":"2026-09-01T07:00:00Z"}';
begin
  -- 30: the field worker's customer-facing report; 40: an internal one;
  -- 50: a customer-facing report the Admin wrote and submitted for review.
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => '15700000-0000-0000-0000-000000000030',
    p_revision_id => '15700000-0000-0000-0000-000000000031', p_job_id => '15700000-0000-0000-0000-000000000020',
    p_project_id => null, p_kind => 'work_report', p_visibility => 'customer_facing', p_title => 'Kundenbericht',
    p_content => v_content, p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_employee);
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => '15700000-0000-0000-0000-000000000040',
    p_revision_id => '15700000-0000-0000-0000-000000000041', p_job_id => '15700000-0000-0000-0000-000000000020',
    p_project_id => null, p_kind => 'work_report', p_visibility => 'internal_only', p_title => 'Interner Bericht',
    p_content => v_content, p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => false, p_submit_action_id => null, p_actor_id => v_employee);
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_artifact_id => '15700000-0000-0000-0000-000000000050',
    p_revision_id => '15700000-0000-0000-0000-000000000051', p_job_id => '15700000-0000-0000-0000-000000000020',
    p_project_id => null, p_kind => 'work_report', p_visibility => 'customer_facing', p_title => 'Prüfbericht',
    p_content => v_content, p_captured_at => now(), p_correction_reason => null, p_corrects_revision_id => null,
    p_expected_version => null, p_submit => true, p_submit_action_id => '15700000-0000-0000-0000-000000000052',
    p_actor_id => v_admin);

  -- The drawn signature: an upload the server reserved for the field worker.
  perform public.reserve_work_artifact_signature_upload(v_employee, v_org,
    '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000060');
  perform public.finalize_document_upload(v_employee, v_org, '15700000-0000-0000-0000-000000000060',
    null, v_org || '/60/unterschrift.png', 'Unterschrift.png', 'Unterschrift.png', 'photo', 'image/png', 20,
    'job', '15700000-0000-0000-0000-000000000020');
end;
$$;

-- Another organization, a colleague outside the job and an internal revision
-- are refused, and nothing is recorded.
do $$
declare
  v_org constant uuid := '15700000-0000-0000-0000-000000000010';
begin
  perform pg_temp.expect_refusal('a decision on another organization''s artifact', format($sql$
    select pg_temp.decide(%L, %L, '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
      '15700000-0000-0000-0000-000000000070', 'customer_acknowledged', null, null, null)
  $sql$, '15700000-0000-0000-0000-000000000011', '15700000-0000-0000-0000-000000000004'),
    'work_artifact_not_found');
  perform pg_temp.expect_refusal('a decision by a colleague outside the job', format($sql$
    select pg_temp.decide(%L, %L, '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
      '15700000-0000-0000-0000-000000000070', 'customer_acknowledged', null, null, null)
  $sql$, v_org, '15700000-0000-0000-0000-000000000003'), 'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('a decision on an internal revision', format($sql$
    select pg_temp.decide(%L, %L, '15700000-0000-0000-0000-000000000040', '15700000-0000-0000-0000-000000000041',
      '15700000-0000-0000-0000-000000000070', 'customer_acknowledged', null, null, null)
  $sql$, v_org, '15700000-0000-0000-0000-000000000002'),
    'work_artifact_customer_action_requires_customer_visibility');
  perform pg_temp.expect_refusal('a decision with a signature action but no signature', format($sql$
    select pg_temp.decide(%L, %L, '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
      '15700000-0000-0000-0000-000000000070', 'customer_acknowledged', null,
      '15700000-0000-0000-0000-000000000071', null)
  $sql$, v_org, '15700000-0000-0000-0000-000000000002'), 'invalid_input');
  perform pg_temp.expect_refusal('a review action passed as the customer decision', format($sql$
    select pg_temp.decide(%L, %L, '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
      '15700000-0000-0000-0000-000000000070', 'internal_approved', null, null, null)
  $sql$, v_org, '15700000-0000-0000-0000-000000000001'), 'invalid_input');
  if exists (select 1 from public.work_artifact_actions where organization_id = v_org
      and action_type in ('customer_acknowledged', 'customer_refused', 'customer_reserved', 'signature_captured'))
  then raise exception 'a refused customer decision recorded an action'; end if;
end;
$$;

-- A refused signature step leaves no decision behind: the decision and the
-- signature are one write.
do $$
declare
  v_org constant uuid := '15700000-0000-0000-0000-000000000010';
begin
  begin
    perform pg_temp.decide(v_org, '15700000-0000-0000-0000-000000000002',
      '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
      '15700000-0000-0000-0000-000000000070', 'customer_acknowledged', null,
      '15700000-0000-0000-0000-000000000071', '15700000-0000-0000-0000-0000000000ff');
    raise exception 'a signature without its document was not refused';
  exception when others then
    if sqlerrm = 'a signature without its document was not refused' then raise; end if;
  end;
  if exists (select 1 from public.work_artifact_actions
      where revision_id = '15700000-0000-0000-0000-000000000031')
    or (select version from public.work_artifacts where id = '15700000-0000-0000-0000-000000000030') is distinct from 1
  then raise exception 'a refused signature left the decision or a new version behind'; end if;
end;
$$;

-- The field worker records the decision and the signature in one call; both
-- read back on the revision, with the signer and the signature document.
do $$
declare
  v_org constant uuid := '15700000-0000-0000-0000-000000000010';
  v_employee constant uuid := '15700000-0000-0000-0000-000000000002';
  v_result jsonb;
begin
  v_result := pg_temp.decide(v_org, v_employee,
    '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
    '15700000-0000-0000-0000-000000000072', 'customer_acknowledged', null,
    '15700000-0000-0000-0000-000000000073', '15700000-0000-0000-0000-000000000060');
  if (v_result->>'version')::bigint is distinct from 3 or (v_result->>'duplicate')::boolean then
    raise exception 'the decision with signature returned % instead of version 3', v_result;
  end if;
  if not exists (select 1 from public.work_artifact_actions
      where id = '15700000-0000-0000-0000-000000000072' and action_type = 'customer_acknowledged'
        and revision_id = '15700000-0000-0000-0000-000000000031' and created_by = v_employee
        and signer_name = 'Erika Beispiel' and signer_role = 'Objektleitung' and signature_document_id is null)
    or not exists (select 1 from public.work_artifact_actions
      where id = '15700000-0000-0000-0000-000000000073' and action_type = 'signature_captured'
        and revision_id = '15700000-0000-0000-0000-000000000031' and signer_name = 'Erika Beispiel'
        and signature_document_id = '15700000-0000-0000-0000-000000000060')
    or not exists (select 1 from public.work_artifact_revision_documents
      where revision_id = '15700000-0000-0000-0000-000000000031'
        and document_id = '15700000-0000-0000-0000-000000000060' and relation = 'signature_mark')
  then raise exception 'the decision and the signature did not both read back on the revision'; end if;
  -- The upload is now the recorded signature, so closing the dialog keeps it.
  perform pg_temp.expect_refusal('discard of the recorded signature', format($sql$
    select public.discard_work_artifact_signature_upload(%L, %L, '15700000-0000-0000-0000-000000000060')
  $sql$, v_employee, v_org), 'work_artifact_signature_in_use');

  -- The same call again, after a lost answer, returns the recorded result.
  v_result := pg_temp.decide(v_org, v_employee,
    '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
    '15700000-0000-0000-0000-000000000072', 'customer_acknowledged', null,
    '15700000-0000-0000-0000-000000000073', '15700000-0000-0000-0000-000000000060');
  if not (v_result->>'duplicate')::boolean
    or (select count(*) from public.work_artifact_actions
      where revision_id = '15700000-0000-0000-0000-000000000031') <> 2
  then raise exception 'a repeated decision call recorded again'; end if;
end;
$$;

-- A second recording on the same revision is refused for everyone, also as a
-- single action through the previous release's path.
do $$
declare
  v_org constant uuid := '15700000-0000-0000-0000-000000000010';
begin
  perform pg_temp.expect_refusal('a second decision by the field worker', format($sql$
    select pg_temp.decide(%L, %L, '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
      '15700000-0000-0000-0000-000000000074', 'customer_refused', 'Kunde prüft selbst.', null, null)
  $sql$, v_org, '15700000-0000-0000-0000-000000000002'), 'work_artifact_customer_decision_recorded');
  perform pg_temp.expect_refusal('a second decision by the Admin', format($sql$
    select pg_temp.decide(%L, %L, '15700000-0000-0000-0000-000000000030', '15700000-0000-0000-0000-000000000031',
      '15700000-0000-0000-0000-000000000074', 'customer_reserved', 'Seriennummer fehlt.', null, null)
  $sql$, v_org, '15700000-0000-0000-0000-000000000001'), 'work_artifact_customer_decision_recorded');
  perform pg_temp.expect_refusal('a second decision as a single action', format($sql$
    select public.record_work_artifact_action(%L, %L, '15700000-0000-0000-0000-000000000030',
      '15700000-0000-0000-0000-000000000031', '15700000-0000-0000-0000-000000000075',
      (select version from public.work_artifacts where id = '15700000-0000-0000-0000-000000000030'),
      'customer_acknowledged', null, null, null, pg_temp.signer('Max Muster'), null)
  $sql$, v_org, '15700000-0000-0000-0000-000000000001'), 'work_artifact_customer_decision_recorded');
  perform pg_temp.expect_refusal('a second signature as a single action', format($sql$
    select public.record_work_artifact_action(%L, %L, '15700000-0000-0000-0000-000000000030',
      '15700000-0000-0000-0000-000000000031', '15700000-0000-0000-0000-000000000075',
      (select version from public.work_artifacts where id = '15700000-0000-0000-0000-000000000030'),
      'signature_captured', null, null, null, pg_temp.signer('Max Muster'),
      '15700000-0000-0000-0000-000000000060')
  $sql$, v_org, '15700000-0000-0000-0000-000000000002'), 'work_artifact_customer_decision_recorded');
  if (select count(*) from public.work_artifact_actions
      where revision_id = '15700000-0000-0000-0000-000000000031') <> 2
  then raise exception 'a refused second recording wrote an action'; end if;
end;
$$;

-- A decision without a signature records the decision alone: a refusal with
-- its reason, on the submitted report.
do $$
declare
  v_result jsonb;
begin
  v_result := pg_temp.decide('15700000-0000-0000-0000-000000000010', '15700000-0000-0000-0000-000000000002',
    '15700000-0000-0000-0000-000000000050', '15700000-0000-0000-0000-000000000051',
    '15700000-0000-0000-0000-000000000076', 'customer_refused', 'Kundin unterschreibt nicht digital.', null, null);
  if not exists (select 1 from public.work_artifact_actions
      where id = '15700000-0000-0000-0000-000000000076' and action_type = 'customer_refused'
        and reason = 'Kundin unterschreibt nicht digital.')
    or exists (select 1 from public.work_artifact_actions
      where revision_id = '15700000-0000-0000-0000-000000000051' and action_type = 'signature_captured')
    or (v_result->>'status') is distinct from 'submitted'
  then raise exception 'a decision without a signature was not recorded alone'; end if;
end;
$$;

-- The reviewer's reason fields belong to the responsible reviewer: an
-- employee's rejection or correction request is refused on the server.
do $$
declare
  v_org constant uuid := '15700000-0000-0000-0000-000000000010';
  v_type text;
begin
  foreach v_type in array array['internal_rejected', 'correction_requested'] loop
    perform pg_temp.expect_refusal(format('an employee''s %s', v_type), format($sql$
      select public.record_work_artifact_action(%L, %L, '15700000-0000-0000-0000-000000000050',
        '15700000-0000-0000-0000-000000000051', '15700000-0000-0000-0000-000000000077',
        (select version from public.work_artifacts where id = '15700000-0000-0000-0000-000000000050'),
        %L, 'Bitte Seriennummer ergänzen.', null, '{}'::jsonb, null, null)
    $sql$, v_org, '15700000-0000-0000-0000-000000000002', v_type), 'work_artifact_not_responsible');
  end loop;
  if exists (select 1 from public.work_artifact_actions where id = '15700000-0000-0000-0000-000000000077')
    or (select status from public.work_artifacts where id = '15700000-0000-0000-0000-000000000050') is distinct from 'submitted'
  then raise exception 'a refused review action by an employee changed the report'; end if;
end;
$$;

reset role;

-- Only the service role executes the decision function.
do $$
declare
  v_function constant text := 'public.record_work_artifact_customer_decision(uuid, uuid, uuid, uuid, bigint, uuid, public.work_artifact_action_type, text, jsonb, uuid, uuid)';
begin
  if not has_function_privilege('service_role', v_function, 'execute') then
    raise exception 'record_work_artifact_customer_decision lost its service_role grant';
  end if;
  if has_function_privilege('anon', v_function, 'execute')
    or has_function_privilege('authenticated', v_function, 'execute')
    or has_function_privilege('public', v_function, 'execute')
  then raise exception 'a client role executes record_work_artifact_customer_decision'; end if;
end;
$$;

rollback;
