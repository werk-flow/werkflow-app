-- A report draft a phone wrote without signal is attached once, with its
-- photos, in one call or not at all
-- (20261201100002_attach_a_report_draft_with_its_photos_once.sql,
-- werk-flow/werkflow-planning#320). A resend answers the first result as
-- replayed and writes nothing; the same operation id with other content or
-- from another person is refused. The call refuses another organization's
-- job, a job the person is not assigned to, a removed member and a photo that
-- is not the person's own upload on that job, and a refused photo leaves no
-- revision behind. The draft is never submitted. Only the service role
-- executes the function and reads the operations.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('32000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'draft-attach-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Draft"}', now(), now()),
('32000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'draft-attach-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Draft"}', now(), now()),
('32000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'draft-attach-colleague@example.test', '', now(), '{}',
 '{"first_name":"Colleague","last_name":"Draft"}', now(), now()),
('32000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'draft-attach-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Draft"}', now(), now()),
('32000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'draft-attach-removed@example.test', '', now(), '{}',
 '{"first_name":"Removed","last_name":"Draft"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('32000000-0000-0000-0000-000000000010', 'Draft attach SQL',
 '32000000-0000-0000-0000-000000000001', 'DRAFTATA'),
('32000000-0000-0000-0000-000000000011', 'Draft attach SQL outsider',
 '32000000-0000-0000-0000-000000000004', 'DRAFTATB');
insert into public.organization_members (organization_id, user_id, role) values
('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000002', 'employee'),
('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000003', 'employee');

-- 20: the field worker's job; 21: a job of the same organization they are not
-- assigned to; 22: another organization's job; 20 also keeps the assignment of
-- a person who is no member any more.
insert into public.jobs (id, organization_id, title, job_number, created_by) values
('32000000-0000-0000-0000-000000000020', '32000000-0000-0000-0000-000000000010',
 'Entwurf anhängen', 'DRAFTAT-1', '32000000-0000-0000-0000-000000000001'),
('32000000-0000-0000-0000-000000000021', '32000000-0000-0000-0000-000000000010',
 'Nicht zugewiesen', 'DRAFTAT-2', '32000000-0000-0000-0000-000000000001'),
('32000000-0000-0000-0000-000000000022', '32000000-0000-0000-0000-000000000011',
 'Fremder Auftrag', 'DRAFTAT-3', '32000000-0000-0000-0000-000000000004');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000020',
 '32000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000001'),
('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000020',
 '32000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000001');

-- Runs one call and requires the named refusal.
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

-- The attach call as the server sends it: a work report draft with the named photos.
create function pg_temp.attach(
  p_organization_id uuid, p_actor_id uuid, p_operation_id uuid, p_request_hash text,
  p_artifact_id uuid, p_revision_id uuid, p_job_id uuid, p_photos jsonb
) returns jsonb
language sql as $$
  select public.attach_work_artifact_draft(
    p_organization_id, p_actor_id, p_operation_id, p_request_hash,
    '2037-11-09T07:00:00Z', '2037-11-09T09:00:00Z', p_artifact_id, p_revision_id, p_job_id,
    'work_report', 'internal_only', '2037-11-09T07:00:00Z', 'Heizung gewartet',
    '{"performedWork":"Brenner gereinigt"}'::jsonb, p_photos)
$$;
grant execute on function pg_temp.attach(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb) to service_role;

set local role service_role;

-- 60 and 61: the field worker's two photos on their job. 62: a colleague's
-- photo on the same job. 63: the field worker's upload on the other job.
do $$
declare
  v_org constant uuid := '32000000-0000-0000-0000-000000000010';
  v_employee constant uuid := '32000000-0000-0000-0000-000000000002';
begin
  perform public.finalize_document_upload(v_employee, v_org, '32000000-0000-0000-0000-000000000060',
    null, v_org || '/60/foto-1.jpg', 'Foto 1.jpg', 'Foto 1.jpg', 'photo', 'image/jpeg', 20,
    'job', '32000000-0000-0000-0000-000000000020');
  perform public.finalize_document_upload(v_employee, v_org, '32000000-0000-0000-0000-000000000061',
    null, v_org || '/61/foto-2.jpg', 'Foto 2.jpg', 'Foto 2.jpg', 'photo', 'image/jpeg', 20,
    'job', '32000000-0000-0000-0000-000000000020');
  perform public.finalize_document_upload('32000000-0000-0000-0000-000000000003', v_org,
    '32000000-0000-0000-0000-000000000062', null, v_org || '/62/foto-kollege.jpg', 'Kollege.jpg',
    'Kollege.jpg', 'photo', 'image/jpeg', 20, 'job', '32000000-0000-0000-0000-000000000020');
  perform public.finalize_document_upload('32000000-0000-0000-0000-000000000001', v_org,
    '32000000-0000-0000-0000-000000000063', null, v_org || '/63/foto-anderer-auftrag.jpg', 'Anderer.jpg',
    'Anderer.jpg', 'photo', 'image/jpeg', 20, 'job', '32000000-0000-0000-0000-000000000021');
end;
$$;

-- Each refusal writes nothing: no artifact, no revision, no link, no operation.
do $$
declare
  v_org constant uuid := '32000000-0000-0000-0000-000000000010';
  v_employee constant uuid := '32000000-0000-0000-0000-000000000002';
  v_hash constant text := repeat('a', 64);
  v_two_photos constant jsonb := '[{"linkId":"32000000-0000-0000-0000-000000000070","documentId":"32000000-0000-0000-0000-000000000060"},{"linkId":"32000000-0000-0000-0000-000000000071","documentId":"32000000-0000-0000-0000-000000000061"}]';
  v_attach constant text := $sql$
    select pg_temp.attach(%L, %L, '32000000-0000-0000-0000-000000000080', %L,
      '32000000-0000-0000-0000-000000000030', '32000000-0000-0000-0000-000000000031', %L, %L)
  $sql$;
begin
  perform pg_temp.expect_refusal('a draft on another organization''s job',
    format(v_attach, v_org, v_employee, v_hash, '32000000-0000-0000-0000-000000000022', '[]'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('a draft on a job the person is not assigned to',
    format(v_attach, v_org, v_employee, v_hash, '32000000-0000-0000-0000-000000000021', '[]'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('a draft by a person who is no member',
    format(v_attach, v_org, '32000000-0000-0000-0000-000000000005', v_hash,
      '32000000-0000-0000-0000-000000000020', '[]'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('a draft by a member of another organization',
    format(v_attach, v_org, '32000000-0000-0000-0000-000000000004', v_hash,
      '32000000-0000-0000-0000-000000000020', '[]'),
    'work_artifact_not_authorized');
  perform pg_temp.expect_refusal('a draft with a colleague''s photo',
    format(v_attach, v_org, v_employee, v_hash, '32000000-0000-0000-0000-000000000020',
      '[{"linkId":"32000000-0000-0000-0000-000000000070","documentId":"32000000-0000-0000-0000-000000000060"},{"linkId":"32000000-0000-0000-0000-000000000072","documentId":"32000000-0000-0000-0000-000000000062"}]'),
    'work_artifact_draft_photo_invalid');
  perform pg_temp.expect_refusal('a draft with a photo of another job',
    format(v_attach, v_org, v_employee, v_hash, '32000000-0000-0000-0000-000000000020',
      '[{"linkId":"32000000-0000-0000-0000-000000000073","documentId":"32000000-0000-0000-0000-000000000063"}]'),
    'work_artifact_draft_photo_invalid');
  perform pg_temp.expect_refusal('a draft with an unusable request hash',
    format(v_attach, v_org, v_employee, 'not-a-hash', '32000000-0000-0000-0000-000000000020', v_two_photos),
    'work_artifact_draft_invalid_input');
  if exists (select 1 from public.work_artifacts where id = '32000000-0000-0000-0000-000000000030')
    or exists (select 1 from public.work_artifact_revisions where id = '32000000-0000-0000-0000-000000000031')
    or exists (select 1 from public.work_artifact_revision_documents
      where revision_id = '32000000-0000-0000-0000-000000000031')
    or exists (select 1 from public.work_artifact_draft_operations where organization_id = v_org)
  then raise exception 'a refused draft attach left rows behind'; end if;
end;
$$;

-- The attach writes one draft revision with two photos, and a resend replays it.
do $$
declare
  v_org constant uuid := '32000000-0000-0000-0000-000000000010';
  v_employee constant uuid := '32000000-0000-0000-0000-000000000002';
  v_hash constant text := repeat('a', 64);
  v_two_photos constant jsonb := '[{"linkId":"32000000-0000-0000-0000-000000000070","documentId":"32000000-0000-0000-0000-000000000060"},{"linkId":"32000000-0000-0000-0000-000000000071","documentId":"32000000-0000-0000-0000-000000000061"}]';
  v_attach constant text := $sql$
    select pg_temp.attach(%L, %L, '32000000-0000-0000-0000-000000000080', %L,
      '32000000-0000-0000-0000-000000000030', '32000000-0000-0000-0000-000000000031', %L, %L)
  $sql$;
  v_first jsonb;
  v_again jsonb;
begin
  v_first := pg_temp.attach(v_org, v_employee, '32000000-0000-0000-0000-000000000080', v_hash,
    '32000000-0000-0000-0000-000000000030', '32000000-0000-0000-0000-000000000031',
    '32000000-0000-0000-0000-000000000020', v_two_photos);
  if v_first <> jsonb_build_object('artifactId', '32000000-0000-0000-0000-000000000030',
    'revisionId', '32000000-0000-0000-0000-000000000031', 'version', 3, 'replayed', false)
  then raise exception 'the first attach answered %', v_first; end if;
  if (select status from public.work_artifacts where id = '32000000-0000-0000-0000-000000000030') <> 'draft'
    or exists (select 1 from public.work_artifact_actions
      where artifact_id = '32000000-0000-0000-0000-000000000030')
  then raise exception 'an attached draft did not stay a draft'; end if;

  -- The office takes the job from the field worker; the resend still learns that the draft arrived.
  delete from public.job_assignments
  where job_id = '32000000-0000-0000-0000-000000000020' and user_id = v_employee;
  v_again := pg_temp.attach(v_org, v_employee, '32000000-0000-0000-0000-000000000080', v_hash,
    '32000000-0000-0000-0000-000000000030', '32000000-0000-0000-0000-000000000031',
    '32000000-0000-0000-0000-000000000020', v_two_photos);
  if v_again <> v_first || jsonb_build_object('replayed', true)
  then raise exception 'the resend answered %', v_again; end if;
  if (select count(*) from public.work_artifact_revisions
      where artifact_id = '32000000-0000-0000-0000-000000000030') <> 1
    or (select count(*) from public.work_artifact_revision_documents
      where revision_id = '32000000-0000-0000-0000-000000000031') <> 2
    or (select version from public.work_artifacts where id = '32000000-0000-0000-0000-000000000030') <> 3
    or (select count(*) from public.work_artifact_draft_operations where organization_id = v_org) <> 1
  then raise exception 'a replayed attach wrote again'; end if;

  -- The same operation id with other content, or from another person, is refused.
  perform pg_temp.expect_refusal('the operation id with other content',
    format(v_attach, v_org, v_employee, repeat('b', 64), '32000000-0000-0000-0000-000000000020', v_two_photos),
    'work_artifact_draft_idempotency_conflict');
  perform pg_temp.expect_refusal('the operation id from another person',
    format(v_attach, v_org, '32000000-0000-0000-0000-000000000003', v_hash,
      '32000000-0000-0000-0000-000000000020', v_two_photos),
    'work_artifact_draft_idempotency_conflict');
  -- A new operation never writes over an Arbeitsnachweis that exists, and a
  -- new one without the assignment is refused.
  perform pg_temp.expect_refusal('a second draft operation on the same Arbeitsnachweis', $sql$
    select pg_temp.attach('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000003',
      '32000000-0000-0000-0000-000000000081', repeat('c', 64), '32000000-0000-0000-0000-000000000030',
      '32000000-0000-0000-0000-000000000032', '32000000-0000-0000-0000-000000000020', '[]')
  $sql$, 'work_artifact_stale_version');
  perform pg_temp.expect_refusal('a new draft after the assignment was removed', $sql$
    select pg_temp.attach('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000002',
      '32000000-0000-0000-0000-000000000082', repeat('d', 64), '32000000-0000-0000-0000-000000000033',
      '32000000-0000-0000-0000-000000000034', '32000000-0000-0000-0000-000000000020', '[]')
  $sql$, 'work_artifact_not_authorized');
end;
$$;

-- The online save of a new draft committed, but its answer was lost: the phone then sends the same
-- draft (same Arbeitsnachweis and revision id) as an operation. The attach adopts the saved
-- revision only when it was written from this very state of the draft: the same author and
-- organization and the draft's last-change time (`draft_changed_at`, the envelope's capturedAt).
-- It then answers `replayed`, records the operation and writes no second revision. Any other
-- revision under the id, a null marker included, is a version conflict and nothing is overwritten.
do $$
declare
  v_org constant uuid := '32000000-0000-0000-0000-000000000010';
  v_employee constant uuid := '32000000-0000-0000-0000-000000000003';
  v_answer jsonb;
begin
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_actor_id => v_employee,
    p_artifact_id => '32000000-0000-0000-0000-000000000090',
    p_revision_id => '32000000-0000-0000-0000-000000000091',
    p_expected_version => null, p_job_id => '32000000-0000-0000-0000-000000000020', p_project_id => null,
    p_kind => 'work_report', p_visibility => 'internal_only', p_captured_at => '2037-11-09T07:00:00Z',
    p_title => 'Heizung gewartet', p_content => '{"performedWork":"Brenner gereinigt"}'::jsonb,
    p_corrects_revision_id => null, p_correction_reason => null, p_submit => false, p_submit_action_id => null,
    p_draft_changed_at => '2037-11-09T07:00:00Z');
  v_answer := pg_temp.attach(v_org, v_employee, '32000000-0000-0000-0000-000000000092', repeat('e', 64),
    '32000000-0000-0000-0000-000000000090', '32000000-0000-0000-0000-000000000091',
    '32000000-0000-0000-0000-000000000020', '[]');
  if (v_answer->>'replayed')::boolean is distinct from true then
    raise exception 'the attach after a committed online save answered %', v_answer;
  end if;
  if (select count(*) from public.work_artifact_revisions
      where artifact_id = '32000000-0000-0000-0000-000000000090') <> 1
    or not exists (select 1 from public.work_artifact_draft_operations
      where organization_id = v_org and id = '32000000-0000-0000-0000-000000000092')
  then raise exception 'the attach after a committed online save wrote again or kept no operation'; end if;
  -- A resend of that operation replays it too.
  v_answer := pg_temp.attach(v_org, v_employee, '32000000-0000-0000-0000-000000000092', repeat('e', 64),
    '32000000-0000-0000-0000-000000000090', '32000000-0000-0000-0000-000000000091',
    '32000000-0000-0000-0000-000000000020', '[]');
  if (v_answer->>'replayed')::boolean is distinct from true then raise exception 'the resend answered %', v_answer; end if;
  -- Another person never adopts a revision the author's online save wrote.
  perform pg_temp.expect_refusal('another person adopting the saved revision', $sql$
    select pg_temp.attach('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000001',
      '32000000-0000-0000-0000-000000000093', repeat('f', 64), '32000000-0000-0000-0000-000000000090',
      '32000000-0000-0000-0000-000000000091', '32000000-0000-0000-0000-000000000020', '[]')
  $sql$, 'work_artifact_stale_version');
  -- Another organization never reaches the revision: its id belongs to this Arbeitsnachweis.
  perform pg_temp.expect_refusal('another organization adopting the saved revision', $sql$
    select pg_temp.attach('32000000-0000-0000-0000-000000000011', '32000000-0000-0000-0000-000000000003',
      '32000000-0000-0000-0000-000000000094', repeat('f', 64), '32000000-0000-0000-0000-000000000090',
      '32000000-0000-0000-0000-000000000091', '32000000-0000-0000-0000-000000000020', '[]')
  $sql$, 'work_artifact_not_authorized');
  if (select count(*) from public.work_artifact_revisions
      where artifact_id = '32000000-0000-0000-0000-000000000090') <> 1
  then raise exception 'a refused adoption wrote a revision'; end if;
end;
$$;

-- A draft changed after its online save, or a revision written without a draft's marker, is never
-- adopted: the device keeps the draft as a conflict.
do $$
declare
  v_org constant uuid := '32000000-0000-0000-0000-000000000010';
  v_employee constant uuid := '32000000-0000-0000-0000-000000000003';
begin
  -- 95/96: saved from an earlier state of the draft (06:00); the draft sent was changed at 07:00.
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_actor_id => v_employee,
    p_artifact_id => '32000000-0000-0000-0000-000000000095',
    p_revision_id => '32000000-0000-0000-0000-000000000096',
    p_expected_version => null, p_job_id => '32000000-0000-0000-0000-000000000020', p_project_id => null,
    p_kind => 'work_report', p_visibility => 'internal_only', p_captured_at => '2037-11-09T07:00:00Z',
    p_title => 'Heizung gewartet', p_content => '{"performedWork":"Brenner"}'::jsonb,
    p_corrects_revision_id => null, p_correction_reason => null, p_submit => false, p_submit_action_id => null,
    p_draft_changed_at => '2037-11-09T06:00:00Z');
  perform pg_temp.expect_refusal('a draft changed after its online save', $sql$
    select pg_temp.attach('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000003',
      '32000000-0000-0000-0000-000000000097', repeat('f', 64), '32000000-0000-0000-0000-000000000095',
      '32000000-0000-0000-0000-000000000096', '32000000-0000-0000-0000-000000000020', '[]')
  $sql$, 'work_artifact_stale_version');
  -- 98/99: a revision written without a draft's marker (the existing callers' null).
  perform public.create_work_artifact_revision(
    p_organization_id => v_org, p_actor_id => v_employee,
    p_artifact_id => '32000000-0000-0000-0000-000000000098',
    p_revision_id => '32000000-0000-0000-0000-000000000099',
    p_expected_version => null, p_job_id => '32000000-0000-0000-0000-000000000020', p_project_id => null,
    p_kind => 'work_report', p_visibility => 'internal_only', p_captured_at => '2037-11-09T07:00:00Z',
    p_title => 'Heizung gewartet', p_content => '{"performedWork":"Brenner gereinigt"}'::jsonb,
    p_corrects_revision_id => null, p_correction_reason => null, p_submit => false, p_submit_action_id => null);
  if (select draft_changed_at from public.work_artifact_revisions
      where id = '32000000-0000-0000-0000-000000000099') is not null
  then raise exception 'a revision written without a draft carries a draft marker'; end if;
  perform pg_temp.expect_refusal('a revision without a draft marker', $sql$
    select pg_temp.attach('32000000-0000-0000-0000-000000000010', '32000000-0000-0000-0000-000000000003',
      '32000000-0000-0000-0000-00000000009a', repeat('f', 64), '32000000-0000-0000-0000-000000000098',
      '32000000-0000-0000-0000-000000000099', '32000000-0000-0000-0000-000000000020', '[]')
  $sql$, 'work_artifact_stale_version');
  if exists (select 1 from public.work_artifact_draft_operations
      where organization_id = v_org and id in (
        '32000000-0000-0000-0000-000000000097', '32000000-0000-0000-0000-00000000009a'))
  then raise exception 'a refused adoption recorded its operation'; end if;
end;
$$;

reset role;

-- Only the service role executes the function and reaches the operations; RLS is on.
do $$
declare
  v_function constant text := 'public.attach_work_artifact_draft(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, uuid, uuid, public.work_artifact_kind, public.work_artifact_visibility, timestamptz, text, jsonb, jsonb)';
  v_table constant text := 'public.work_artifact_draft_operations';
begin
  if not has_function_privilege('service_role', v_function, 'execute') then
    raise exception 'attach_work_artifact_draft lost its service_role grant';
  end if;
  if has_function_privilege('anon', v_function, 'execute')
    or has_function_privilege('authenticated', v_function, 'execute')
    or has_function_privilege('public', v_function, 'execute')
  then raise exception 'a client role executes attach_work_artifact_draft'; end if;
  if has_table_privilege('anon', v_table, 'select')
    or has_table_privilege('authenticated', v_table, 'select')
    or has_table_privilege('service_role', v_table, 'update')
    or has_table_privilege('service_role', v_table, 'delete')
  then raise exception 'work_artifact_draft_operations is granted beyond select and insert for the service role'; end if;
  if not (select relrowsecurity from pg_class where oid = v_table::regclass) then
    raise exception 'work_artifact_draft_operations has no row level security';
  end if;
end;
$$;

rollback;
