begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('24000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-24-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"P124"}', now(), now()),
('24000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-24-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"P124"}', now(), now()),
('24000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-24-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"P124"}', now(), now()),
('24000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-24-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"P124"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('24000000-0000-0000-0000-000000000010', 'P1-24 SQL',
 '24000000-0000-0000-0000-000000000001', 'P124SQL'),
('24000000-0000-0000-0000-000000000011', 'P1-24 Other',
 '24000000-0000-0000-0000-000000000004', 'P124OTHER');

insert into public.organization_members (organization_id, user_id, role) values
('24000000-0000-0000-0000-000000000010', '24000000-0000-0000-0000-000000000002', 'buero'),
('24000000-0000-0000-0000-000000000010', '24000000-0000-0000-0000-000000000003', 'employee'),
('24000000-0000-0000-0000-000000000011', '24000000-0000-0000-0000-000000000003', 'employee');

-- Organizations, members and their employee records that exist before anyone
-- acts get no lifecycle, onboarding, document or operation row: they stay
-- "not controlled". Scoped to this test's organizations because every worktree
-- shares the stack, and a retained or running browser world holds its own rows.
do $$
declare
  table_name text;
  business_row_count bigint;
begin
  foreach table_name in array array[
    'personnel_access_lifecycles',
    'personnel_access_transitions',
    'personnel_employment_lifecycles',
    'personnel_employment_transitions',
    'personnel_documents',
    'personnel_document_releases',
    'personnel_onboarding_templates',
    'personnel_onboarding_template_versions',
    'personnel_onboarding_template_items',
    'personnel_onboarding_plans',
    'personnel_onboarding_requirements',
    'personnel_requirement_references',
    'personnel_acknowledgements',
    'personnel_lifecycle_operations'
  ] loop
    execute format(
      'select count(*) from public.%I where organization_id = any($1)', table_name
    ) into business_row_count using array[
      '24000000-0000-0000-0000-000000000010',
      '24000000-0000-0000-0000-000000000011'
    ]::uuid[];
    if business_row_count is distinct from 0 then
      raise exception 'deploy-day table % contains % rows', table_name, business_row_count;
    end if;
  end loop;
end;
$$;

set local role service_role;

do $$
declare
  test_organization_id constant uuid := '24000000-0000-0000-0000-000000000010';
  actor_id constant uuid := '24000000-0000-0000-0000-000000000001';
  employee_user_id constant uuid := '24000000-0000-0000-0000-000000000003';
  employee_id uuid;
  access_id uuid;
  replayed_access_id uuid;
  employment_id uuid;
  plan_id uuid;
  requirement_id uuid;
  personnel_document_id uuid;
  test_document_id constant uuid := '24000000-0000-0000-0000-000000000020';
  release_id uuid;
  acknowledgement_id uuid;
  template_id uuid;
begin
  select id into employee_id from public.employee_records
  where organization_id = test_organization_id and user_id = employee_user_id;
  if employee_id is null then raise exception 'employee record prerequisite missing'; end if;

  access_id := public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, 0, 'schedule_suspension',
    clock_timestamp() + interval '1 day', 'Geplante Sperre',
    '24000000-0000-0000-0000-000000000030', repeat('a', 64)
  );
  if (select state from public.personnel_access_lifecycles where id = access_id) is distinct from 'active'
     or (select scheduled_state from public.personnel_access_lifecycles where id = access_id) is distinct from 'suspended'
  then raise exception 'scheduled suspension changed current access early'; end if;
  replayed_access_id := public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, 0, 'schedule_suspension',
    clock_timestamp() + interval '2 days', 'Ignored replay payload',
    '24000000-0000-0000-0000-000000000030', repeat('a', 64)
  );
  if replayed_access_id is distinct from access_id then raise exception 'access replay changed identity'; end if;
  begin
    perform public.set_personnel_access_transition(
      actor_id, test_organization_id, employee_id, 1, 'suspend_now',
      clock_timestamp(), 'Conflicting replay',
      '24000000-0000-0000-0000-000000000030', repeat('b', 64)
    );
    raise exception 'idempotency conflict was accepted';
  exception when others then
    if sqlerrm not like '%operation_id_conflict%' then raise; end if;
  end;
  begin
    perform public.set_personnel_access_transition(
      actor_id, test_organization_id, employee_id, 0, 'suspend_now',
      clock_timestamp(), 'Stale Änderung',
      '24000000-0000-0000-0000-000000000031', repeat('c', 64)
    );
    raise exception 'stale access version was accepted';
  exception when others then
    if sqlerrm not like '%stale_version%' then raise; end if;
  end;
  perform public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, 1, 'suspend_now',
    clock_timestamp(), 'Sofortige Sperre',
    '24000000-0000-0000-0000-000000000032', repeat('d', 64)
  );
  if app_private.p1_24_has_effective_access(test_organization_id, employee_user_id)
    then raise exception 'suspended user retained organization access'; end if;
  if not app_private.p1_24_has_effective_access(
    '24000000-0000-0000-0000-000000000011', employee_user_id
  ) then raise exception 'organization suspension disabled access elsewhere'; end if;
  perform public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, 2, 'reactivate',
    clock_timestamp(), 'Zugang wiederhergestellt',
    '24000000-0000-0000-0000-000000000033', repeat('e', 64)
  );

  employment_id := public.set_personnel_employment_transition(
    actor_id, test_organization_id, employee_id, 0, 'record_notice',
    current_date, 'Austritt vorgemerkt', '[]'::jsonb,
    '24000000-0000-0000-0000-000000000034', repeat('f', 64)
  );
  if (select state from public.personnel_employment_lifecycles where id = employment_id) is distinct from 'notice'
    then raise exception 'employment notice was not recorded'; end if;
  begin
    perform public.set_personnel_employment_transition(
      actor_id, test_organization_id, employee_id, 0, 'exit',
      current_date, 'Stale Austritt', '[]'::jsonb,
      '24000000-0000-0000-0000-000000000035', repeat('0', 64)
    );
    raise exception 'stale employment version was accepted';
  exception when others then
    if sqlerrm not like '%stale_version%' then raise; end if;
  end;

  plan_id := public.create_personnel_onboarding_plan(
    actor_id, test_organization_id, employee_id, null, 'Eintritt ohne Vorlage',
    current_date + 7, '24000000-0000-0000-0000-000000000036', repeat('1', 64)
  );
  requirement_id := public.save_personnel_onboarding_requirement(
    actor_id, test_organization_id, plan_id, null, 0, 'acknowledgement',
    'Betriebsordnung bestätigen', 'Bitte lesen und bestätigen.', true, true,
    employee_id, current_date + 3, 'pending', null,
    '24000000-0000-0000-0000-000000000037', repeat('2', 64)
  );
  if public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, 2, 'reactivate',
    clock_timestamp(), 'Zugang wiederhergestellt',
    '24000000-0000-0000-0000-000000000033', repeat('e', 64)
  ) is distinct from access_id then
    raise exception 'access replay was blocked by newer requirements';
  end if;
  if (select state from public.personnel_onboarding_plans where id = plan_id) is distinct from 'in_progress'
    then raise exception 'incomplete plan was presented as ready'; end if;
  begin
    perform public.set_personnel_access_transition(
      actor_id, test_organization_id, employee_id, 3, 'activate_now',
      clock_timestamp(), 'Blockierte Aktivierung',
      '24000000-0000-0000-0000-000000000041', repeat('7', 64)
    );
    raise exception 'unresolved access blocker was ignored';
  exception when others then
    if sqlerrm not like '%access_requirements_incomplete%' then raise; end if;
  end;
  update public.personnel_access_lifecycles
  set state = 'scheduled', scheduled_state = 'active',
      scheduled_for = clock_timestamp() - interval '1 minute'
  where id = access_id;
  if app_private.p1_24_effective_access_state(test_organization_id, employee_user_id) is distinct from 'scheduled'
     or not app_private.p1_24_has_prestart_access(test_organization_id, employee_user_id)
     or app_private.p1_24_has_effective_access(test_organization_id, employee_user_id)
  then raise exception 'due activation bypassed unresolved access blocker'; end if;

  perform public.finalize_personnel_document_metadata(
    actor_id, test_organization_id, employee_id, test_document_id,
    'organization-documents',
    test_organization_id::text || '/' || test_document_id::text || '/test.pdf',
    'test.pdf', 'Personalunterlage', 'other', 'application/pdf', 42,
    'vertrag', 'personnel_standard', 'valid', null,
    '24000000-0000-0000-0000-000000000038', repeat('3', 64)
  );
  select id into personnel_document_id from public.personnel_documents
    where document_id = test_document_id;
  begin
    perform public.finalize_personnel_document_metadata(
      actor_id, test_organization_id, employee_id,
      '24000000-0000-0000-0000-000000000021',
      'organization-documents', test_organization_id::text || '/wrong/test.pdf',
      'wrong.pdf', 'Ungültige Personalunterlage', 'other', 'application/pdf', 42,
      'vertrag', 'personnel_standard', 'valid', null,
      '24000000-0000-0000-0000-000000000042', repeat('8', 64)
    );
    raise exception 'invalid personnel document storage path was accepted';
  exception when others then
    if sqlerrm not like '%invalid_document_storage_path%' then raise; end if;
  end;
  begin
    perform public.finalize_personnel_document_metadata(
      actor_id, test_organization_id, employee_id,
      '24000000-0000-0000-0000-000000000022',
      'wrong-bucket',
      test_organization_id::text || '/24000000-0000-0000-0000-000000000022/test.pdf',
      'wrong.pdf', 'Ungültige Personalunterlage', 'other', 'application/pdf', 42,
      'vertrag', 'personnel_standard', 'valid', null,
      '24000000-0000-0000-0000-000000000052', repeat('e', 64)
    );
    raise exception 'invalid personnel document bucket was accepted';
  exception when others then
    if sqlerrm not like '%invalid_document_storage_path%' then raise; end if;
  end;
  begin
    insert into public.document_links(
      organization_id, document_id, employee_id, created_by
    ) values (
      test_organization_id, test_document_id, employee_user_id, actor_id
    );
    raise exception 'protected document was linked as an ordinary employee document';
  exception when others then
    if sqlerrm not like '%protected_personnel_document_cannot_be_linked%' then raise; end if;
  end;
  insert into public.document_versions(
    organization_id, document_id, version_number, storage_bucket, storage_path,
    original_file_name, mime_type, size_bytes, uploaded_by
  ) values (
    test_organization_id, test_document_id, 1, 'organization-documents',
    test_organization_id::text || '/' || test_document_id::text || '/versions/1-test.pdf',
    'test.pdf', 'application/pdf', 42, actor_id
  );
  release_id := public.set_personnel_document_release(
    actor_id, test_organization_id, personnel_document_id, 1, true, null,
    '24000000-0000-0000-0000-000000000039', repeat('4', 64)
  );
  if release_id is null then raise exception 'document release was not created'; end if;
  acknowledgement_id := public.acknowledge_personnel_item(
    employee_user_id, test_organization_id, 'requirement_completed',
    null, null, requirement_id, 1, 'Gelesen und erledigt.',
    '24000000-0000-0000-0000-000000000040', repeat('5', 64)
  );
  if acknowledgement_id is null
     or (select state from public.personnel_onboarding_requirements where id = requirement_id) is distinct from 'fulfilled'
     or (select state from public.personnel_onboarding_plans where id = plan_id) is distinct from 'ready'
  then raise exception 'acknowledgement did not complete the requirement projection'; end if;
  if public.acknowledge_personnel_item(
    employee_user_id, test_organization_id, 'requirement_completed',
    null, null, requirement_id, 1, 'Gelesen und erledigt.',
    '24000000-0000-0000-0000-000000000040', repeat('5', 64)
  ) is distinct from acknowledgement_id then
    raise exception 'acknowledgement replay changed result identity';
  end if;
  begin
    perform public.acknowledge_personnel_item(
      employee_user_id, test_organization_id, 'requirement_completed',
      null, null, requirement_id, 2, 'Doppelt bestätigt.',
      '24000000-0000-0000-0000-000000000043', repeat('9', 64)
    );
    raise exception 'fulfilled requirement was acknowledged again';
  exception when others then
    if sqlerrm not like '%requirement_not_open%' then raise; end if;
  end;

  template_id := public.publish_personnel_onboarding_template(
    actor_id,
    test_organization_id,
    null,
    0,
    'Replay-Vorlage',
    null,
    '[{"requirementType":"manual","title":"Prüfen","isRequired":true,"blocksAccess":false}]'::jsonb,
    '24000000-0000-0000-0000-000000000048',
    repeat('f', 64)
  );
  update public.personnel_onboarding_templates
  set state = 'archived'
  where id = template_id;
  if public.publish_personnel_onboarding_template(
    actor_id,
    test_organization_id,
    null,
    0,
    'Replay-Vorlage',
    null,
    '[{"requirementType":"manual","title":"Prüfen","isRequired":true,"blocksAccess":false}]'::jsonb,
    '24000000-0000-0000-0000-000000000048',
    repeat('f', 64)
  ) is distinct from template_id then
    raise exception 'template replay was blocked by the archived current state';
  end if;

  begin
    update public.personnel_acknowledgements set statement = 'Verändert'
    where id = acknowledgement_id;
    raise exception 'immutable acknowledgement was updated';
  exception when others then
    if sqlerrm not like '%p1_24_history_is_immutable%' then raise; end if;
  end;
  begin
    delete from public.documents where id = test_document_id;
    raise exception 'protected document was permanently deleted';
  exception when others then
    if sqlerrm not like '%protected_personnel_document_delete_blocked%' then raise; end if;
  end;
  if not exists (
    select 1 from public.employee_record_events
    where employee_record_id = employee_id and event_type = 'access_transition'
  ) or not exists (
    select 1 from public.employee_record_events
    where employee_record_id = employee_id and event_type = 'personnel_document_uploaded'
  ) then raise exception 'access transition or protected upload left no personnel history event'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000003', true);

do $$
begin
  if (select count(*) from public.personnel_documents) <> 1
    then raise exception 'affected employee cannot view released personnel document'; end if;
  if (select count(*) from public.personnel_onboarding_requirements) <> 1
    then raise exception 'affected employee cannot view own requirements'; end if;
  if (select count(*) from public.document_audit_events
      where document_id = '24000000-0000-0000-0000-000000000020') <> 0
    then raise exception 'affected employee can inspect protected document history'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000002', true);

do $$
begin
  if (select count(*) from public.personnel_documents) <> 1
    then raise exception 'Büro cannot view standard personnel document'; end if;
end;
$$;

set local role service_role;
update public.personnel_documents set access_class = 'admin_restricted'
where document_id = '24000000-0000-0000-0000-000000000020';

set local role authenticated;
select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000002', true);
do $$
begin
  if (select count(*) from public.personnel_documents) <> 0
    then raise exception 'Büro can view admin-restricted personnel metadata'; end if;
  if (select count(*) from public.document_versions
      where document_id = '24000000-0000-0000-0000-000000000020') <> 0
    then raise exception 'Büro can view an admin-restricted personnel version'; end if;
  if (select count(*) from public.document_audit_events
      where document_id = '24000000-0000-0000-0000-000000000020') <> 0
    then raise exception 'Büro can inspect admin-restricted personnel history'; end if;
end;
$$;

set local role service_role;
update public.personnel_documents set access_class = 'personnel_standard'
where document_id = '24000000-0000-0000-0000-000000000020';

set local role authenticated;

select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000004', true);

do $$
declare
  table_name text;
  visible_count bigint;
begin
  foreach table_name in array array[
    'personnel_access_lifecycles',
    'personnel_employment_lifecycles',
    'personnel_documents',
    'personnel_document_releases',
    'personnel_onboarding_plans',
    'personnel_onboarding_requirements',
    'personnel_acknowledgements'
  ] loop
    execute format(
      'select count(*) from public.%I where organization_id = $1', table_name
    ) into visible_count using '24000000-0000-0000-0000-000000000010'::uuid;
    if visible_count is distinct from 0 then
      raise exception 'outsider can read %', table_name;
    end if;
  end loop;
  if has_function_privilege(
      'authenticated',
      'public.set_personnel_access_transition(uuid,uuid,uuid,bigint,public.personnel_access_transition_kind,timestamptz,text,uuid,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'anon',
      'public.set_personnel_access_transition(uuid,uuid,uuid,bigint,public.personnel_access_transition_kind,timestamptz,text,uuid,text)',
      'EXECUTE'
    ) then raise exception 'application role retained lifecycle mutation execution'; end if;
  if has_function_privilege(
      'authenticated',
      'app_private.p1_24_is_manager(uuid,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'app_private.p1_24_is_admin(uuid,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'app_private.p1_24_is_self(uuid,uuid,uuid,boolean)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'app_private.can_access_personnel_document(uuid,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'app_private.can_access_personnel_document_version(uuid,integer,uuid)',
      'EXECUTE'
    ) or has_function_privilege(
      'authenticated',
      'app_private.can_access_personnel_document_history(uuid,uuid)',
      'EXECUTE'
    ) then raise exception 'authenticated retained caller-parameterized helper execution'; end if;
  if not has_function_privilege(
      'authenticated',
      'app_private.p1_24_current_user_is_manager(uuid)',
      'EXECUTE'
    ) or not has_function_privilege(
      'authenticated',
      'app_private.p1_24_current_user_is_self(uuid,uuid,boolean)',
      'EXECUTE'
    ) or not has_function_privilege(
      'authenticated',
      'app_private.current_user_can_access_personnel_document(uuid)',
      'EXECUTE'
    ) or not has_function_privilege(
      'authenticated',
      'app_private.current_user_can_access_personnel_document_version(uuid,integer)',
      'EXECUTE'
    ) or not has_function_privilege(
      'authenticated',
      'app_private.current_user_can_access_personnel_document_history(uuid)',
      'EXECUTE'
    ) or not has_function_privilege(
      'authenticated',
      'app_private.p1_24_is_protected_document(uuid)',
      'EXECUTE'
    ) then raise exception 'authenticated cannot execute an auth-bound RLS helper'; end if;
  if has_function_privilege(
      'service_role',
      'public.set_personnel_access_transition_p1_24_base(uuid,uuid,uuid,bigint,public.personnel_access_transition_kind,timestamptz,text,uuid,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.set_personnel_access_transition_review_base(uuid,uuid,uuid,bigint,public.personnel_access_transition_kind,timestamptz,text,uuid,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.publish_personnel_onboarding_template_base(uuid,uuid,uuid,bigint,text,text,jsonb,uuid,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.finalize_personnel_document_metadata_base(uuid,uuid,uuid,uuid,text,text,text,text,text,text,bigint,text,public.personnel_document_access_class,public.personnel_document_evidence_state,date,uuid,text)',
      'EXECUTE'
    ) or has_function_privilege(
      'service_role',
      'public.acknowledge_personnel_item_review_base(uuid,uuid,public.personnel_acknowledgement_kind,uuid,integer,uuid,bigint,text,uuid,text)',
      'EXECUTE'
    ) then raise exception 'service role can bypass a guarded P1-24 wrapper'; end if;
end;
$$;

set local role service_role;
do $$
begin
  if exists (
    select 1 from public.ordinary_documents
    where id = '24000000-0000-0000-0000-000000000020'
  ) then raise exception 'protected document leaked through ordinary document view'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000003', true);
do $$
begin
  if not exists (
    select 1 from public.document_versions
    where document_id = '24000000-0000-0000-0000-000000000020'
  ) then raise exception 'employee cannot read an active released protected document version'; end if;
end;
$$;

set local role service_role;
update public.documents set deleted_at = clock_timestamp()
where id = '24000000-0000-0000-0000-000000000020';

set local role authenticated;
select set_config('request.jwt.claim.sub', '24000000-0000-0000-0000-000000000003', true);
do $$
begin
  if exists (
    select 1 from public.document_versions
    where document_id = '24000000-0000-0000-0000-000000000020'
  ) then raise exception 'employee can read a trashed protected document version'; end if;
end;
$$;

set local role service_role;
update public.documents set deleted_at = null
where id = '24000000-0000-0000-0000-000000000020';

-- An employee confirms only acknowledgement requirements; Admin or Büro
-- completes every other type.
do $$
declare
  test_organization_id constant uuid := '24000000-0000-0000-0000-000000000010';
  actor_id constant uuid := '24000000-0000-0000-0000-000000000001';
  employee_user_id constant uuid := '24000000-0000-0000-0000-000000000003';
  employee_id uuid;
  self_plan_id uuid;
  self_requirement_id uuid;
  refused_type public.personnel_requirement_type;
begin
  select id into employee_id from public.employee_records
  where organization_id = test_organization_id and user_id = employee_user_id;
  self_plan_id := public.create_personnel_onboarding_plan(
    actor_id, test_organization_id, employee_id, null, 'Selbstbestätigung',
    current_date + 7, gen_random_uuid(), repeat('3', 64)
  );
  foreach refused_type in array enum_range(null::public.personnel_requirement_type) loop
    continue when refused_type = 'acknowledgement';
    self_requirement_id := public.save_personnel_onboarding_requirement(
      actor_id, test_organization_id, self_plan_id, null, 0, refused_type,
      'Vom Büro zu prüfen', null, true, true, employee_id, current_date + 3,
      'missing', null, gen_random_uuid(), repeat('4', 64)
    );
    begin
      perform public.acknowledge_personnel_item(
        employee_user_id, test_organization_id, 'requirement_completed',
        null, null, self_requirement_id, 1, 'Selbst erledigt.',
        gen_random_uuid(), repeat('5', 64)
      );
      raise exception 'employee self-confirmed a % requirement', refused_type;
    exception when others then
      if sqlerrm not like '%forbidden%' then raise; end if;
    end;
  end loop;

  self_requirement_id := public.save_personnel_onboarding_requirement(
    actor_id, test_organization_id, self_plan_id, null, 0, 'acknowledgement',
    'Unterweisung bestätigen', null, true, true, employee_id, current_date + 3,
    'missing', null, gen_random_uuid(), repeat('6', 64)
  );
  perform public.acknowledge_personnel_item(
    employee_user_id, test_organization_id, 'requirement_completed',
    null, null, self_requirement_id, 1, 'Gelesen.',
    gen_random_uuid(), repeat('7', 64)
  );
  if (select state from public.personnel_onboarding_requirements
      where id = self_requirement_id) is distinct from 'fulfilled'
    then raise exception 'employee could not confirm an acknowledgement requirement'; end if;
  if exists (
    select 1 from public.personnel_onboarding_requirements
    where plan_id = self_plan_id and requirement_type <> 'acknowledgement'
      and state <> 'missing'
  ) then raise exception 'a refused self-confirmation changed its requirement'; end if;
end;
$$;

do $$
declare
  test_organization_id constant uuid := '24000000-0000-0000-0000-000000000010';
  actor_id constant uuid := '24000000-0000-0000-0000-000000000001';
  employee_id uuid;
  current_version bigint;
begin
  select id into employee_id from public.employee_records
  where organization_id = test_organization_id
    and user_id = '24000000-0000-0000-0000-000000000003';
  select version into current_version from public.personnel_access_lifecycles
  where employee_record_id = employee_id;
  begin
    perform public.set_personnel_access_transition(
      actor_id, test_organization_id, employee_id, current_version, 'end_access',
      clock_timestamp() + interval '1 day', 'Ungültiges geplantes Ende',
      '24000000-0000-0000-0000-000000000044', repeat('a', 64)
    );
    raise exception 'future end_access was accepted';
  exception when others then
    if sqlerrm not like '%immediate_effective_at_required%' then raise; end if;
  end;
  perform public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, current_version, 'end_access',
    clock_timestamp(), 'Zugang beendet',
    '24000000-0000-0000-0000-000000000045', repeat('b', 64)
  );
  perform public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, current_version + 1,
    'schedule_activation', clock_timestamp() + interval '1 day',
    'Zugang geplant', '24000000-0000-0000-0000-000000000046', repeat('c', 64)
  );
  perform public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, current_version + 2,
    'cancel_scheduled', clock_timestamp(), 'Planung zurückgenommen',
    '24000000-0000-0000-0000-000000000047', repeat('d', 64)
  );
  if not exists (
    select 1 from public.personnel_access_lifecycles
    where employee_record_id = employee_id
      and state = 'not_configured'
      and scheduled_state is null
      and scheduled_for is null
  ) then raise exception 'cancelled activation did not restore not_configured'; end if;

  perform public.save_personnel_onboarding_requirement(
    actor_id,
    test_organization_id,
    (select id from public.personnel_onboarding_plans
      where employee_record_id = employee_id limit 1),
    null,
    0,
    'manual',
    'Zugangsblocker für Abbruch',
    null,
    true,
    true,
    employee_id,
    current_date,
    'missing',
    null,
    '24000000-0000-0000-0000-000000000049',
    repeat('0', 64)
  );
  select version into current_version
  from public.personnel_access_lifecycles
  where employee_record_id = employee_id;
  perform public.set_personnel_access_transition(
    actor_id,
    test_organization_id,
    employee_id,
    current_version,
    'schedule_activation',
    clock_timestamp() + interval '1 day',
    'Blockierte Aktivierung geplant',
    '24000000-0000-0000-0000-000000000050',
    repeat('1', 64)
  );
  update public.personnel_access_lifecycles
  set scheduled_for = clock_timestamp() - interval '1 minute'
  where employee_record_id = employee_id;
  perform public.set_personnel_access_transition(
    actor_id,
    test_organization_id,
    employee_id,
    current_version + 1,
    'cancel_scheduled',
    clock_timestamp(),
    'Blockierte Aktivierung zurückgenommen',
    '24000000-0000-0000-0000-000000000051',
    repeat('2', 64)
  );
  if exists (
    select 1 from public.personnel_access_lifecycles
    where employee_record_id = employee_id
      and scheduled_state is not null
  ) then raise exception 'due blocked activation could not be cancelled'; end if;
end;
$$;

-- Employment dates (werk-flow/werkflow-planning#350): withdrawing a planned
-- step restores the entry and exit dates it wrote, and a step that acts at
-- once refuses a future date. Replay (werk-flow/werkflow-planning#352): the
-- stored request hash decides, the open-work inventory does not.
insert into public.employee_records (id, organization_id, first_name, last_name, entry_date, exit_date) values
('24000000-0000-0000-0000-000000000060', '24000000-0000-0000-0000-000000000010', 'Geplant', 'Austritt', '2024-01-01', null),
('24000000-0000-0000-0000-000000000061', '24000000-0000-0000-0000-000000000010', 'Wieder', 'Eintritt', '2020-01-01', '2025-06-30'),
('24000000-0000-0000-0000-000000000062', '24000000-0000-0000-0000-000000000010', 'Sofort', 'Schritt', '2024-01-01', null),
('24000000-0000-0000-0000-000000000063', '24000000-0000-0000-0000-000000000010', 'Geändert', 'Austritt', '2024-01-01', null),
('24000000-0000-0000-0000-000000000064', '24000000-0000-0000-0000-000000000010', 'Neu', 'Geplant', '2024-01-01', null),
('24000000-0000-0000-0000-000000000065', '24000000-0000-0000-0000-000000000010', 'Überholt', 'Austritt', '2024-01-01',
 (clock_timestamp() at time zone 'Europe/Berlin')::date + 20);

do $$
declare
  test_organization_id constant uuid := '24000000-0000-0000-0000-000000000010';
  actor_id constant uuid := '24000000-0000-0000-0000-000000000001';
  leaver_id constant uuid := '24000000-0000-0000-0000-000000000060';
  rehire_id constant uuid := '24000000-0000-0000-0000-000000000061';
  immediate_id constant uuid := '24000000-0000-0000-0000-000000000062';
  edited_id constant uuid := '24000000-0000-0000-0000-000000000063';
  replanned_id constant uuid := '24000000-0000-0000-0000-000000000064';
  overtaken_id constant uuid := '24000000-0000-0000-0000-000000000065';
  buero_record_id uuid;
  configuration_id uuid;
  today constant date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  lifecycle_id uuid;
  replayed_id uuid;
  kind public.personnel_employment_transition_kind;
begin
  -- A withdrawn planned exit leaves no exit date behind, also after a second plan moved it.
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, leaver_id, 0, 'plan_exit', today + 30,
    'Austritt geplant', '[]'::jsonb, '24000000-0000-0000-0000-000000000070', repeat('a', 64)
  );
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, leaver_id, 1, 'plan_exit', today + 40,
    'Austritt verschoben', '[]'::jsonb, '24000000-0000-0000-0000-000000000071', repeat('b', 64)
  );
  if (select exit_date from public.employee_records where id = leaver_id) is distinct from today + 40
    then raise exception 'planned exit did not write its exit date'; end if;
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, leaver_id, 2, 'cancel_scheduled', today,
    'Austritt zurückgenommen', '[]'::jsonb, '24000000-0000-0000-0000-000000000072', repeat('c', 64)
  );
  if (select exit_date from public.employee_records where id = leaver_id) is not null
    then raise exception 'withdrawn planned exit kept its exit date'; end if;
  if (select entry_date from public.employee_records where id = leaver_id) is distinct from '2024-01-01'::date
    then raise exception 'withdrawn planned exit changed the entry date'; end if;

  -- A withdrawn planned return restores the earlier entry and exit dates.
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, rehire_id, 0, 'plan_start', today + 14,
    'Wiedereintritt geplant', '[]'::jsonb, '24000000-0000-0000-0000-000000000073', repeat('d', 64)
  );
  if exists (
    select 1 from public.employee_records
    where id = rehire_id and (entry_date is distinct from today + 14 or exit_date is not null)
  ) then raise exception 'planned start did not write its entry date'; end if;
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, rehire_id, 1, 'cancel_scheduled', today,
    'Wiedereintritt zurückgenommen', '[]'::jsonb, '24000000-0000-0000-0000-000000000074', repeat('e', 64)
  );
  if exists (
    select 1 from public.employee_records
    where id = rehire_id
      and (entry_date is distinct from '2020-01-01'::date or exit_date is distinct from '2025-06-30'::date)
  ) then raise exception 'withdrawn planned start kept its dates'; end if;

  -- A date the office changed on the record after the plan stays when the plan is withdrawn.
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, edited_id, 0, 'plan_exit', today + 30,
    'Austritt geplant', '[]'::jsonb, '24000000-0000-0000-0000-000000000075', repeat('f', 64)
  );
  update public.employee_records set exit_date = today + 60 where id = edited_id;
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, edited_id, 1, 'cancel_scheduled', today,
    'Austritt zurückgenommen', '[]'::jsonb, '24000000-0000-0000-0000-000000000076', repeat('0', 64)
  );
  if (select exit_date from public.employee_records where id = edited_id) is distinct from today + 60
    then raise exception 'withdrawing a plan overwrote an exit date changed after it'; end if;

  -- An edit between two plans is what the second plan replaced, and what its withdrawal restores.
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, replanned_id, 0, 'plan_exit', today + 30,
    'Austritt geplant', '[]'::jsonb, '24000000-0000-0000-0000-000000000078', repeat('4', 64)
  );
  update public.employee_records set exit_date = today + 60 where id = replanned_id;
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, replanned_id, 1, 'plan_exit', today + 40,
    'Austritt neu geplant', '[]'::jsonb, '24000000-0000-0000-0000-000000000079', repeat('5', 64)
  );
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, replanned_id, 2, 'cancel_scheduled', today,
    'Austritt zurückgenommen', '[]'::jsonb, '24000000-0000-0000-0000-00000000007a', repeat('6', 64)
  );
  if (select exit_date from public.employee_records where id = replanned_id) is distinct from today + 60
    then raise exception 'withdrawing a second plan dropped the exit date edited before it'; end if;

  -- An earlier exit that an edited entry date overtook does not return, and the withdrawal still succeeds.
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, overtaken_id, 0, 'plan_exit', today + 30,
    'Austritt geplant', '[]'::jsonb, '24000000-0000-0000-0000-00000000007b', repeat('7', 64)
  );
  update public.employee_records set entry_date = today + 25 where id = overtaken_id;
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, overtaken_id, 1, 'cancel_scheduled', today,
    'Austritt zurückgenommen', '[]'::jsonb, '24000000-0000-0000-0000-00000000007c', repeat('8', 64)
  );
  if exists (
    select 1 from public.employee_records
    where id = overtaken_id and (entry_date is distinct from today + 25 or exit_date is not null)
  ) then raise exception 'withdrawing a plan restored an exit before the edited entry date'; end if;

  -- Withdrawing a planned return restores the exit date, so it may not leave a selected group without a holder.
  select id into buero_record_id from public.employee_records
  where organization_id = test_organization_id and user_id = '24000000-0000-0000-0000-000000000002';
  update public.employee_records set entry_date = '2020-01-01', exit_date = '2025-06-30'
  where id = buero_record_id;
  perform public.set_personnel_employment_transition(
    actor_id, test_organization_id, buero_record_id, 0, 'plan_start', today + 14,
    'Rückkehr geplant', '[]'::jsonb, '24000000-0000-0000-0000-00000000007d', repeat('9', 64)
  );
  -- After the organization's role-default configurations this transaction created.
  insert into public.organization_responsibility_configurations (
    organization_id, responsibility, mode, created_by, effective_from
  ) values (test_organization_id, 'time_approval', 'selected', actor_id, clock_timestamp())
  returning id into configuration_id;
  insert into public.organization_responsibility_assignments (organization_id, configuration_id, employee_record_id, source)
  values (test_organization_id, configuration_id, buero_record_id, 'direct');
  begin
    perform public.set_personnel_employment_transition(
      actor_id, test_organization_id, buero_record_id, 1, 'cancel_scheduled', today,
      'Rückkehr zurückgenommen', '[]'::jsonb, '24000000-0000-0000-0000-00000000007e', repeat('a', 64)
    );
    raise exception 'withdrawing a planned return left a selected group without a holder';
  exception when others then
    if sqlerrm not like '%last_responsibility_holder%' then raise; end if;
  end;
  if (select exit_date from public.employee_records where id = buero_record_id) is not null
    then raise exception 'a refused withdrawal restored the exit date'; end if;

  -- A step that acts at once refuses a future date and changes nothing.
  foreach kind in array array['start', 'mark_inactive', 'exit', 'reactivate']::public.personnel_employment_transition_kind[] loop
    begin
      perform public.set_personnel_employment_transition(
        actor_id, test_organization_id, immediate_id, 0, kind, today + 1,
        'Sofortiger Schritt in der Zukunft', '[]'::jsonb, gen_random_uuid(), repeat('1', 64)
      );
      raise exception 'immediate step % accepted a future date', kind;
    exception when others then
      if sqlerrm not like '%immediate_effective_date_required%' then raise; end if;
    end;
  end loop;
  -- A planned step takes only a later date.
  begin
    perform public.set_personnel_employment_transition(
      actor_id, test_organization_id, immediate_id, 0, 'plan_exit', today,
      'Geplanter Austritt heute', '[]'::jsonb, gen_random_uuid(), repeat('1', 64)
    );
    raise exception 'planned exit accepted today';
  exception when others then
    if sqlerrm not like '%future_effective_date_required%' then raise; end if;
  end;
  if exists (select 1 from public.personnel_employment_lifecycles where employee_record_id = immediate_id)
     or (select exit_date from public.employee_records where id = immediate_id) is not null
    then raise exception 'a refused immediate step changed the employment'; end if;
  lifecycle_id := public.set_personnel_employment_transition(
    actor_id, test_organization_id, immediate_id, 0, 'exit', today,
    'Austritt heute', '[{"kind":"job_assignment","id":"a"}]'::jsonb,
    '24000000-0000-0000-0000-000000000077', repeat('2', 64)
  );
  if (select exit_date from public.employee_records where id = immediate_id) is distinct from today
    then raise exception 'an exit of today was not recorded'; end if;

  -- The identical retry returns the stored result although the open work changed since.
  replayed_id := public.set_personnel_employment_transition(
    actor_id, test_organization_id, immediate_id, 0, 'exit', today,
    'Austritt heute', '[]'::jsonb,
    '24000000-0000-0000-0000-000000000077', repeat('2', 64)
  );
  if replayed_id is distinct from lifecycle_id then raise exception 'employment replay changed identity'; end if;
  if (
    select count(*) from public.personnel_employment_transitions
    where employee_record_id = immediate_id and organization_id = test_organization_id
  ) <> 1 then raise exception 'employment replay recorded a second transition'; end if;
  -- The same operation with another request is refused.
  begin
    perform public.set_personnel_employment_transition(
      actor_id, test_organization_id, immediate_id, 1, 'reactivate', today,
      'Anderer Schritt', '[]'::jsonb,
      '24000000-0000-0000-0000-000000000077', repeat('3', 64)
    );
    raise exception 'employment idempotency conflict was accepted';
  exception when others then
    if sqlerrm not like '%operation_id_conflict%' then raise; end if;
  end;
end;
$$;

delete from public.organizations where id = '24000000-0000-0000-0000-000000000010';

do $$
declare
  table_name text;
  remaining_count bigint;
begin
  foreach table_name in array array[
    'personnel_access_lifecycles',
    'personnel_access_transitions',
    'personnel_employment_lifecycles',
    'personnel_employment_transitions',
    'personnel_documents',
    'personnel_document_releases',
    'personnel_onboarding_plans',
    'personnel_onboarding_requirements',
    'personnel_acknowledgements',
    'personnel_lifecycle_operations'
  ] loop
    execute format(
      'select count(*) from public.%I where organization_id = $1', table_name
    ) into remaining_count using '24000000-0000-0000-0000-000000000010'::uuid;
    if remaining_count is distinct from 0 then
      raise exception 'organization teardown left rows in %', table_name;
    end if;
  end loop;
end;
$$;

rollback;
