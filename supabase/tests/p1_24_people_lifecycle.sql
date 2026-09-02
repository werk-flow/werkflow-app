begin;

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
    execute format('select count(*) from public.%I', table_name)
      into business_row_count;
    if business_row_count <> 0 then
      raise exception 'deploy-day table % contains % rows', table_name, business_row_count;
    end if;
  end loop;
end;
$$;

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
  if (select state from public.personnel_access_lifecycles where id = access_id) <> 'active'
     or (select scheduled_state from public.personnel_access_lifecycles where id = access_id) <> 'suspended'
  then raise exception 'scheduled suspension changed current access early'; end if;
  replayed_access_id := public.set_personnel_access_transition(
    actor_id, test_organization_id, employee_id, 0, 'schedule_suspension',
    clock_timestamp() + interval '2 days', 'Ignored replay payload',
    '24000000-0000-0000-0000-000000000030', repeat('a', 64)
  );
  if replayed_access_id <> access_id then raise exception 'access replay changed identity'; end if;
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
  if (select state from public.personnel_employment_lifecycles where id = employment_id) <> 'notice'
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
  ) <> access_id then
    raise exception 'access replay was blocked by newer requirements';
  end if;
  if (select state from public.personnel_onboarding_plans where id = plan_id) <> 'in_progress'
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
  if app_private.p1_24_effective_access_state(test_organization_id, employee_user_id) <> 'scheduled'
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
     or (select state from public.personnel_onboarding_requirements where id = requirement_id) <> 'fulfilled'
     or (select state from public.personnel_onboarding_plans where id = plan_id) <> 'ready'
  then raise exception 'acknowledgement did not complete the requirement projection'; end if;
  if public.acknowledge_personnel_item(
    employee_user_id, test_organization_id, 'requirement_completed',
    null, null, requirement_id, 1, 'Gelesen und erledigt.',
    '24000000-0000-0000-0000-000000000040', repeat('5', 64)
  ) <> acknowledgement_id then
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
  ) <> template_id then
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
    'personnel_onboarding_plans',
    'personnel_onboarding_requirements',
    'personnel_acknowledgements'
  ] loop
    execute format(
      'select count(*) from public.%I where organization_id = $1', table_name
    ) into visible_count using '24000000-0000-0000-0000-000000000010'::uuid;
    if visible_count <> 0 then
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
    if remaining_count <> 0 then
      raise exception 'organization teardown left rows in %', table_name;
    end if;
  end loop;
end;
$$;

rollback;
