-- P1-13 database rules for versioned work templates: manager-only RPCs,
-- immutable published versions and history, snapshot application without
-- stock or schedule side effects, atomic failure on retired references,
-- project-direct application, and organization/role read boundaries.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('13130000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-13-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"P113"}', now(), now()),
('13130000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-13-buero@example.test', '', now(), '{}',
 '{"first_name":"Buero","last_name":"P113"}', now(), now()),
('13130000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-13-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"P113"}', now(), now()),
('13130000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'p1-13-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"P113"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('13130000-0000-0000-0000-000000000010', 'P1-13 SQL',
 '13130000-0000-0000-0000-000000000001', 'P113SQL'),
('13130000-0000-0000-0000-000000000011', 'P1-13 SQL Outsider',
 '13130000-0000-0000-0000-000000000004', 'P113OUT');
insert into public.organization_members (organization_id, user_id, role) values
('13130000-0000-0000-0000-000000000010', '13130000-0000-0000-0000-000000000002', 'buero'),
('13130000-0000-0000-0000-000000000010', '13130000-0000-0000-0000-000000000003', 'employee');

insert into public.jobs (id, organization_id, title, job_number, created_by) values
('13130000-0000-0000-0000-000000000020', '13130000-0000-0000-0000-000000000010',
 'Vorlagenauftrag', 'P113-SQL-1', '13130000-0000-0000-0000-000000000001'),
('13130000-0000-0000-0000-000000000021', '13130000-0000-0000-0000-000000000010',
 'Referenzauftrag', 'P113-SQL-2', '13130000-0000-0000-0000-000000000001');
insert into public.projects (id, organization_id, name, project_number, created_by) values
('13130000-0000-0000-0000-000000000030', '13130000-0000-0000-0000-000000000010',
 'Vorlagenprojekt', 'P113-SQL-P', '13130000-0000-0000-0000-000000000001');
insert into public.organization_capabilities (id, organization_id, kind, name, created_by) values
('13130000-0000-0000-0000-000000000040', '13130000-0000-0000-0000-000000000010',
 'certification', 'Gasprüfung P113', '13130000-0000-0000-0000-000000000001');

set local role service_role;

do $$
declare
  v_org constant uuid := '13130000-0000-0000-0000-000000000010';
  v_admin constant uuid := '13130000-0000-0000-0000-000000000001';
  v_employee constant uuid := '13130000-0000-0000-0000-000000000003';
  v_job constant uuid := '13130000-0000-0000-0000-000000000020';
  v_reference_job constant uuid := '13130000-0000-0000-0000-000000000021';
  v_project constant uuid := '13130000-0000-0000-0000-000000000030';
  v_capability constant uuid := '13130000-0000-0000-0000-000000000040';
  v_check_item constant uuid := '13130000-0000-0000-0000-000000000101';
  v_note_item constant uuid := '13130000-0000-0000-0000-000000000102';
  v_template uuid;
  v_first_version uuid;
  v_second_version uuid;
  v_reference_template uuid;
  v_reference_version uuid;
  v_project_template uuid;
  v_project_version uuid;
  v_result jsonb;
  v_application uuid;
  v_count integer;
begin
  -- Only managers may author templates.
  begin
    perform public.create_work_template(v_org, 'job', 'Unerlaubt', v_employee);
    raise exception 'employee created a work template';
  exception when raise_exception then
    if sqlerrm <> 'work_template_not_authorized' then raise; end if;
  end;

  v_template := public.create_work_template(v_org, 'job', 'Wartung', v_admin);
  perform public.save_work_template_draft(
    v_org, v_template, v_admin, 'Wartung', null,
    jsonb_build_array(
      jsonb_build_object('id', v_check_item, 'item_kind', 'task', 'content', 'Anlage prüfen',
        'requirement_state', 'required', 'group_label', null, 'notes', null, 'sort_order', 0),
      jsonb_build_object('id', v_note_item, 'item_kind', 'checklist', 'content', 'Messwerte notieren',
        'requirement_state', 'optional', 'group_label', 'Abschluss', 'notes', null, 'sort_order', 1)
    ),
    jsonb_build_array(jsonb_build_object('id', '13130000-0000-0000-0000-000000000111',
      'template_item_id', v_check_item, 'description', 'Foto der Messwerte',
      'document_category', 'photo', 'sort_order', 0)),
    jsonb_build_array(jsonb_build_object('id', '13130000-0000-0000-0000-000000000121',
      'predecessor_item_id', v_check_item, 'dependent_item_id', v_note_item))
  );

  -- A cycle is refused while the draft is saved.
  begin
    perform public.save_work_template_draft(
      v_org, v_template, v_admin, 'Wartung', null,
      jsonb_build_array(
        jsonb_build_object('id', v_check_item, 'item_kind', 'task', 'content', 'Anlage prüfen',
          'requirement_state', 'required', 'sort_order', 0),
        jsonb_build_object('id', v_note_item, 'item_kind', 'task', 'content', 'Messwerte notieren',
          'requirement_state', 'required', 'sort_order', 1)
      ),
      '[]'::jsonb,
      jsonb_build_array(
        jsonb_build_object('id', '13130000-0000-0000-0000-000000000122',
          'predecessor_item_id', v_check_item, 'dependent_item_id', v_note_item),
        jsonb_build_object('id', '13130000-0000-0000-0000-000000000123',
          'predecessor_item_id', v_note_item, 'dependent_item_id', v_check_item)
      )
    );
    raise exception 'a dependency cycle was saved';
  exception when raise_exception then
    if sqlerrm <> 'work_template_dependency_cycle' then raise; end if;
  end;

  v_first_version := public.publish_work_template(v_org, v_template, v_admin);
  if not exists (
    select 1 from public.work_templates
    where id = v_template and draft_version_id is null and current_published_version_id = v_first_version
  ) or (select status from public.work_template_versions where id = v_first_version) <> 'published'
  then raise exception 'publishing did not make version 1 the current published version'; end if;
  if (select array_agg(event_type order by created_at, event_type) from public.work_template_events
      where template_id = v_template) <> array['created', 'draft_saved', 'published']
  then raise exception 'template history is not created, draft_saved, published'; end if;

  -- A published version and its children are immutable; history is append-only.
  begin
    update public.work_template_versions set name = 'Umbenannt' where id = v_first_version;
    raise exception 'a published version was renamed';
  exception when raise_exception then
    if sqlerrm <> 'published_work_template_version_immutable' then raise; end if;
  end;
  begin
    update public.work_template_items set content = 'Geändert' where id = v_check_item;
    raise exception 'a published item was changed';
  exception when raise_exception then
    if sqlerrm <> 'published_work_template_version_immutable' then raise; end if;
  end;
  begin
    delete from public.work_template_events where template_id = v_template;
    raise exception 'template history was deleted';
  exception when raise_exception then
    if sqlerrm <> 'work_template_history_immutable' then raise; end if;
  end;

  -- Application materializes the snapshot without stock or schedule effects.
  v_result := public.apply_work_template(v_org, v_first_version, v_admin, 'p113-sql-apply-1', p_job_id => v_job);
  v_application := (v_result->>'applicationId')::uuid;
  if v_application is null or (v_result->>'wasCreated')::boolean is not true
  then raise exception 'applying version 1 did not create an application'; end if;
  if (select array_agg(content order by sort_order) from public.job_instruction_items
      where job_id = v_job and work_template_application_id = v_application)
     <> array['Anlage prüfen', 'Messwerte notieren']
  then raise exception 'the applied job does not carry the version 1 items'; end if;
  if (select count(*) from public.job_instruction_item_evidence_requirements evidence
      join public.job_instruction_items item on item.id = evidence.instruction_item_id
      where item.job_id = v_job and evidence.source_work_template_evidence_id is not null) <> 1
  then raise exception 'the evidence expectation was not copied with its origin'; end if;
  if (select count(*) from public.job_instruction_item_dependencies dependency
      join public.job_instruction_items item on item.id = dependency.dependent_item_id
      where item.job_id = v_job) <> 1
  then raise exception 'the item dependency was not copied'; end if;
  if exists (select 1 from public.inventory_movements where job_id = v_job)
    or exists (select 1 from public.planning_occurrences where job_id = v_job)
  then raise exception 'applying a template moved stock or created a schedule'; end if;
  if (select count(*) from public.work_template_events
      where template_id = v_template and event_type = 'applied' and application_id = v_application) <> 1
  then raise exception 'the application is missing from template history'; end if;
  begin
    update public.work_template_applications set idempotency_key = 'p113-sql-rewritten' where id = v_application;
    raise exception 'an application was rewritten';
  exception when raise_exception then
    if sqlerrm <> 'work_template_history_immutable' then raise; end if;
  end;

  -- The same request replays; the same version is not applied twice.
  v_result := public.apply_work_template(v_org, v_first_version, v_admin, 'p113-sql-apply-1', p_job_id => v_job);
  if (v_result->>'applicationId')::uuid <> v_application or (v_result->>'wasCreated')::boolean
  then raise exception 'an idempotent replay created a second application'; end if;
  begin
    perform public.apply_work_template(v_org, v_first_version, v_admin, 'p113-sql-apply-2', p_job_id => v_job);
    raise exception 'the same version was applied twice';
  exception when raise_exception then
    if sqlerrm <> 'work_template_already_applied' then raise; end if;
  end;

  -- A new version leaves version 1 and the applied job untouched.
  v_second_version := public.create_work_template_draft(v_org, v_template, v_admin);
  perform public.save_work_template_draft(
    v_org, v_template, v_admin, 'Wartung', null,
    jsonb_build_array(jsonb_build_object('id', '13130000-0000-0000-0000-000000000103',
      'item_kind', 'task', 'content', 'Anlage vollständig prüfen',
      'requirement_state', 'required', 'sort_order', 0))
  );
  perform public.publish_work_template(v_org, v_template, v_admin);
  if (select array_agg(content order by sort_order) from public.work_template_items
      where version_id = v_first_version) <> array['Anlage prüfen', 'Messwerte notieren']
  then raise exception 'version 2 rewrote the version 1 items'; end if;
  if exists (select 1 from public.job_instruction_items
      where job_id = v_job and content = 'Anlage vollständig prüfen')
  then raise exception 'version 2 reached a job created from version 1'; end if;
  begin
    perform public.apply_work_template(v_org, v_second_version, v_admin, 'p113-sql-apply-3', p_job_id => v_job);
    raise exception 'an additional template was applied without confirmation';
  exception when raise_exception then
    if sqlerrm <> 'work_template_additional_confirmation_required' then raise; end if;
  end;

  -- A retired capability makes application fail without any partial row.
  v_reference_template := public.create_work_template(v_org, 'job', 'Gasprüfung', v_admin);
  perform public.save_work_template_draft(
    v_org, v_reference_template, v_admin, 'Gasprüfung', null,
    jsonb_build_array(jsonb_build_object('id', '13130000-0000-0000-0000-000000000104',
      'item_kind', 'task', 'content', 'Gasleitung prüfen', 'requirement_state', 'required', 'sort_order', 0)),
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
    jsonb_build_array(jsonb_build_object('id', '13130000-0000-0000-0000-000000000131',
      'capability_id', v_capability, 'require_confirmation', true, 'sort_order', 0))
  );
  v_reference_version := public.publish_work_template(v_org, v_reference_template, v_admin);
  update public.organization_capabilities set retired_at = now() where id = v_capability;
  begin
    perform public.apply_work_template(v_org, v_reference_version, v_admin, 'p113-sql-apply-4',
      p_job_id => v_reference_job);
    raise exception 'a template with a retired capability was applied';
  exception when raise_exception then
    if sqlerrm <> 'work_template_capability_reference_unavailable' then raise; end if;
  end;
  if exists (select 1 from public.work_template_applications where job_id = v_reference_job)
    or exists (select 1 from public.job_instruction_items where job_id = v_reference_job)
    or exists (select 1 from public.job_capability_requirements where job_id = v_reference_job)
  then raise exception 'a failed application left partial rows'; end if;

  -- An archived template offers no version to apply.
  perform public.set_work_template_archived(v_org, v_template, v_admin, true);
  begin
    perform public.apply_work_template(v_org, v_second_version, v_admin, 'p113-sql-apply-5',
      p_job_id => v_reference_job);
    raise exception 'an archived template was applied';
  exception when raise_exception then
    if sqlerrm <> 'work_template_version_unavailable' then raise; end if;
  end;

  -- A project template writes directly onto the project and creates no child job.
  v_project_template := public.create_work_template(v_org, 'project', 'Sanierung', v_admin);
  perform public.save_work_template_draft(
    v_org, v_project_template, v_admin, 'Sanierung', null,
    jsonb_build_array(jsonb_build_object('id', '13130000-0000-0000-0000-000000000105',
      'item_kind', 'task', 'content', 'Baustelle vorbereiten', 'requirement_state', 'required', 'sort_order', 0))
  );
  v_project_version := public.publish_work_template(v_org, v_project_template, v_admin);
  begin
    perform public.apply_work_template(v_org, v_project_version, v_admin, 'p113-sql-apply-6',
      p_job_id => v_reference_job);
    raise exception 'a project template was applied to a job';
  exception when raise_exception then
    if sqlerrm <> 'work_template_target_mismatch' then raise; end if;
  end;
  perform public.apply_work_template(v_org, v_project_version, v_admin, 'p113-sql-apply-7',
    p_project_id => v_project);
  select count(*) into v_count from public.job_instruction_items
  where project_id = v_project and job_id is null and content = 'Baustelle vorbereiten';
  if v_count <> 1 then raise exception 'the project template did not write onto the project'; end if;
  if exists (select 1 from public.jobs where project_id = v_project)
  then raise exception 'a project template created a child job'; end if;
end;
$$;

-- Only managers of the organization read templates; employees and other
-- organizations see none.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"13130000-0000-0000-0000-000000000003","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.work_templates)
    or exists (select 1 from public.work_template_versions)
    or exists (select 1 from public.work_template_applications)
  then raise exception 'an employee can read work templates'; end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"13130000-0000-0000-0000-000000000004","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.work_templates where organization_id = '13130000-0000-0000-0000-000000000010')
    or exists (select 1 from public.job_instruction_items where organization_id = '13130000-0000-0000-0000-000000000010')
  then raise exception 'another organization can read work templates or applied items'; end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"13130000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.work_templates where organization_id = '13130000-0000-0000-0000-000000000010') <> 3
  then raise exception 'the office manager cannot read the organization templates'; end if;
end;
$$;

rollback;
