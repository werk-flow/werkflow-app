-- Service database rules for installed equipment (P1-18), reactive service
-- (P1-19) and maintenance (P1-20): identity and duplicate rules, the history
-- rows each guarded write appends, and the manager-only read boundary.
-- The browser specs keep what a user sees; this file owns the rules.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('18000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'service-admin@example.test', '', now(), '{}',
 '{"first_name":"Service","last_name":"Admin"}', now(), now()),
('18000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'service-buero@example.test', '', now(), '{}',
 '{"first_name":"Service","last_name":"Buero"}', now(), now()),
('18000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'service-employee@example.test', '', now(), '{}',
 '{"first_name":"Service","last_name":"Employee"}', now(), now()),
('18000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'service-outsider@example.test', '', now(), '{}',
 '{"first_name":"Service","last_name":"Outsider"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('18000000-0000-0000-0000-000000000010', 'Service SQL', '18000000-0000-0000-0000-000000000001', 'SRVSQLA'),
('18000000-0000-0000-0000-000000000011', 'Service outsider SQL', '18000000-0000-0000-0000-000000000004', 'SRVSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000002', 'buero'),
('18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000003', 'employee');

insert into public.clients (id, organization_id, name) values
('18000000-0000-0000-0000-000000000020', '18000000-0000-0000-0000-000000000010', 'Service SQL Kunde');
insert into public.client_sites (id, organization_id, client_id, name, is_primary, created_by) values
('18000000-0000-0000-0000-000000000021', '18000000-0000-0000-0000-000000000010',
 '18000000-0000-0000-0000-000000000020', 'Heizzentrale', true, '18000000-0000-0000-0000-000000000001'),
('18000000-0000-0000-0000-000000000022', '18000000-0000-0000-0000-000000000010',
 '18000000-0000-0000-0000-000000000020', 'Außenstelle', false, '18000000-0000-0000-0000-000000000001');
-- The employee is assigned to this job, which keeps the equipment, case and
-- maintenance reads below honest about assignment not widening manager data.
insert into public.jobs (id, organization_id, created_by, client_id, site_id, job_number, title) values
('18000000-0000-0000-0000-000000000030', '18000000-0000-0000-0000-000000000010',
 '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000020',
 '18000000-0000-0000-0000-000000000021', 'AUF-SRV-SQL', 'Service SQL Einsatz');
insert into public.job_assignments (job_id, organization_id, assigned_by, user_id) values
('18000000-0000-0000-0000-000000000030', '18000000-0000-0000-0000-000000000010',
 '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000003');

set local role service_role;

-- P1-18: identity, duplicate identifiers, component site, manager-only writes, history.
do $$
declare
  v_root public.installed_equipment%rowtype;
  v_component public.installed_equipment%rowtype;
  v_root_payload jsonb := jsonb_build_object(
    'clientId', '18000000-0000-0000-0000-000000000020',
    'siteId', '18000000-0000-0000-0000-000000000021',
    'name', 'Wärmeerzeuger SQL', 'category', 'heat_generation', 'state', 'active',
    'manufacturer', 'Hersteller SQL',
    'identifiers', jsonb_build_array(jsonb_build_object(
      'identifierType', 'serial_number', 'value', 'SER-SQL-18', 'issuer', 'Hersteller SQL'))
  );
begin
  v_root := public.create_installed_equipment(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000040',
    v_root_payload, '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000041'
  );
  if v_root.equipment_number !~ '^ANL-\d{4}-\d{3}$' then
    raise exception 'equipment number does not follow ANL-YYYY-NNN: %', v_root.equipment_number;
  end if;
  if (select array_agg(event_type::text) from public.installed_equipment_events
      where equipment_id = v_root.id) is distinct from array['registered'] then
    raise exception 'registration did not append exactly one registered event';
  end if;

  -- A replayed create returns the first row instead of a second identity.
  if (public.create_installed_equipment(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000040',
    v_root_payload, '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000041'
  )).equipment_number <> v_root.equipment_number
    or (select count(*) from public.installed_equipment
        where organization_id = '18000000-0000-0000-0000-000000000010') <> 1 then
    raise exception 'replayed equipment create was not idempotent';
  end if;

  begin
    perform public.create_installed_equipment(
      '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000042',
      jsonb_set(v_root_payload, '{name}', '"Duplikat SQL"'),
      '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000043'
    );
    raise exception 'duplicate_serial_accepted';
  exception when others then
    if sqlerrm = 'duplicate_serial_accepted' or sqlstate <> '23505' then
      raise exception 'a serial number of the same issuer was registered twice: %', sqlerrm;
    end if;
  end;

  begin
    perform public.create_installed_equipment(
      '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000044',
      jsonb_build_object(
        'clientId', '18000000-0000-0000-0000-000000000020',
        'siteId', '18000000-0000-0000-0000-000000000022',
        'parentEquipmentId', v_root.id, 'name', 'Pumpe falscher Ort',
        'category', 'system_component', 'state', 'unknown', 'identifiers', '[]'::jsonb),
      '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000045'
    );
    raise exception 'component_on_other_site_accepted';
  exception when others then
    if sqlerrm <> 'installed_equipment_parent_invalid' then
      raise exception 'a component left its parent site: %', sqlerrm;
    end if;
  end;

  v_component := public.create_installed_equipment(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000046',
    jsonb_build_object(
      'clientId', '18000000-0000-0000-0000-000000000020',
      'siteId', '18000000-0000-0000-0000-000000000021',
      'parentEquipmentId', v_root.id, 'name', 'Umwälzpumpe SQL',
      'category', 'system_component', 'state', 'unknown', 'identifiers', '[]'::jsonb),
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000047'
  );
  if v_component.parent_equipment_id <> v_root.id
    or v_component.client_id <> v_root.client_id
    or v_component.site_id <> v_root.site_id
    or v_component.equipment_number = v_root.equipment_number then
    raise exception 'component does not keep its own number under the parent customer and site';
  end if;

  begin
    perform public.create_installed_equipment(
      '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000048',
      jsonb_set(v_root_payload, '{identifiers}', '[]'::jsonb),
      '18000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000049'
    );
    raise exception 'employee_equipment_create_accepted';
  exception when others then
    if sqlerrm <> 'installed_equipment_not_authorized' then
      raise exception 'an employee registered installed equipment: %', sqlerrm;
    end if;
  end;
end;
$$;

-- P1-19: identity, linked equipment, stale protection and the history each write appends.
do $$
declare
  v_case public.service_cases%rowtype;
  v_repeat public.service_cases%rowtype;
  v_converted public.service_cases%rowtype;
  v_update jsonb := jsonb_build_object(
    'summary', 'Heizung ausgefallen SQL', 'urgency', 'notfall', 'status', 'visit_required',
    'chargeContext', 'suspected_warranty', 'accessInstructions', 'Zugang über den Hof',
    'triageNote', 'Nur Verdacht', 'jobId', '18000000-0000-0000-0000-000000000030',
    'equipmentIds', jsonb_build_array('18000000-0000-0000-0000-000000000040'),
    'reason', 'Einsatz vorbereitet'
  );
begin
  v_case := public.create_service_case(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000050',
    jsonb_build_object(
      'clientId', '18000000-0000-0000-0000-000000000020',
      'siteId', '18000000-0000-0000-0000-000000000021',
      'originalStatement', 'Die Heizung bleibt kalt.', 'summary', 'Heizung ausgefallen SQL',
      'chargeContext', 'unknown',
      'equipmentIds', jsonb_build_array('18000000-0000-0000-0000-000000000040')),
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000051'
  );
  if v_case.case_number !~ '^SRV-\d{4}-\d{3}$' or v_case.intake_type <> 'direct'
    or v_case.source_request_id is not null then
    raise exception 'direct service case lost its identity: %', v_case.case_number;
  end if;
  if (select count(*) from public.service_case_equipment_links where service_case_id = v_case.id) <> 1 then
    raise exception 'direct service case did not keep exactly its selected equipment';
  end if;

  perform public.update_service_case(
    '18000000-0000-0000-0000-000000000010', v_case.id, 1, v_update, 'Einsatz vorbereitet',
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000052'
  );
  begin
    perform public.update_service_case(
      '18000000-0000-0000-0000-000000000010', v_case.id, 1,
      jsonb_set(v_update, '{triageNote}', '"Veralteter Stand"'), 'Parallele Prüfung',
      '18000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000053'
    );
    raise exception 'stale_service_case_update_accepted';
  exception when others then
    if sqlerrm <> 'service_case_stale_version' then
      raise exception 'a stale service case update was not rejected: %', sqlerrm;
    end if;
  end;
  if (select triage_note from public.service_cases where id = v_case.id) <> 'Nur Verdacht' then
    raise exception 'a rejected stale update changed the service case';
  end if;

  v_repeat := public.create_service_case(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000054',
    jsonb_build_object(
      'clientId', '18000000-0000-0000-0000-000000000020',
      'siteId', '18000000-0000-0000-0000-000000000021',
      'originalStatement', 'Dasselbe Geräusch wie beim letzten Besuch.',
      'summary', 'Wiederholungsfall SQL', 'chargeContext', 'suspected_rework', 'equipmentIds', '[]'::jsonb),
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000055'
  );
  if exists (select 1 from public.service_case_equipment_links where service_case_id = v_repeat.id) then
    raise exception 'a service case without selected equipment received an inferred link';
  end if;
  perform public.link_service_case_relation(
    '18000000-0000-0000-0000-000000000010', v_case.id, v_repeat.id, 'continuation_of', 2,
    'Wiederkehrendes Fehlerbild', '18000000-0000-0000-0000-000000000001',
    '18000000-0000-0000-0000-000000000056'
  );
  if not (select array_agg(event_type::text) from public.service_case_events where service_case_id = v_case.id)
    @> array['created', 'status_changed', 'relation_linked'] then
    raise exception 'service case history lacks created, status_changed or relation_linked';
  end if;

  -- A converted request keeps its wording, details and urgency, and converts only once.
  insert into public.client_requests (
    id, organization_id, client_id, site_id, created_by, summary, details, urgency, request_number
  ) values (
    '18000000-0000-0000-0000-000000000057', '18000000-0000-0000-0000-000000000010',
    '18000000-0000-0000-0000-000000000020', '18000000-0000-0000-0000-000000000021',
    '18000000-0000-0000-0000-000000000001', 'Heizung kalt SQL', 'Kalte Heizkörper seit dem Morgen.',
    'hoch', 'ANF-SQL-19'
  );
  v_converted := public.create_service_case(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000058',
    jsonb_build_object('sourceRequestId', '18000000-0000-0000-0000-000000000057',
      'chargeContext', 'unknown', 'equipmentIds', '[]'::jsonb),
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000059'
  );
  if v_converted.intake_type <> 'request'
    or v_converted.source_request_id <> '18000000-0000-0000-0000-000000000057'
    or v_converted.original_statement <> 'Heizung kalt SQL'
    or v_converted.original_details <> 'Kalte Heizkörper seit dem Morgen.'
    or v_converted.urgency <> 'hoch'
    or (select status from public.client_requests where id = '18000000-0000-0000-0000-000000000057') <> 'umgewandelt'
    or exists (select 1 from public.service_case_equipment_links where service_case_id = v_converted.id) then
    raise exception 'request conversion did not keep the request wording, urgency and empty equipment scope';
  end if;
  begin
    perform public.create_service_case(
      '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-00000000005a',
      jsonb_build_object('sourceRequestId', '18000000-0000-0000-0000-000000000057',
        'chargeContext', 'unknown', 'equipmentIds', '[]'::jsonb),
      '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-00000000005b'
    );
    raise exception 'second_conversion_accepted';
  exception when others then
    if sqlerrm <> 'service_case_request_already_converted' then
      raise exception 'a request was converted twice: %', sqlerrm;
    end if;
  end;

  insert into public.client_follow_ups (
    organization_id, client_id, source_type, source_id, title, owner_user_id, due_at, created_by, updated_by
  ) values (
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000020', 'service_case',
    v_case.id, 'Gewährleistung prüfen', '18000000-0000-0000-0000-000000000002', now() + interval '1 day',
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001'
  );
end;
$$;

-- P1-20: plan creation, horizon, overlap reason and history.
do $$
declare
  v_template_id uuid;
  v_version_id uuid;
  v_plan public.maintenance_plans%rowtype;
  v_plan_payload jsonb;
begin
  v_template_id := public.create_work_template(
    '18000000-0000-0000-0000-000000000010', 'job', 'Wartung SQL', '18000000-0000-0000-0000-000000000001'
  );
  perform public.save_work_template_draft(
    p_organization_id => '18000000-0000-0000-0000-000000000010', p_template_id => v_template_id,
    p_actor_id => '18000000-0000-0000-0000-000000000001', p_name => 'Wartung SQL',
    p_items => jsonb_build_array(jsonb_build_object(
      'id', '18000000-0000-0000-0000-000000000060', 'item_kind', 'checklist', 'content', 'Anlage warten',
      'requirement_state', 'required', 'group_label', null, 'notes', null, 'sort_order', 0))
  );
  v_version_id := public.publish_work_template(
    '18000000-0000-0000-0000-000000000010', v_template_id, '18000000-0000-0000-0000-000000000001'
  );

  perform public.create_maintenance_coverage(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000061',
    jsonb_build_object(
      'coverageId', '18000000-0000-0000-0000-000000000061',
      'clientId', '18000000-0000-0000-0000-000000000020',
      'siteId', '18000000-0000-0000-0000-000000000021',
      'reference', 'VERTRAG-SQL', 'description', null, 'status', 'active',
      'validFrom', '2026-01-01', 'validUntil', '2027-12-31', 'noticeDate', null, 'renewalDate', null,
      'reviewDueDate', null, 'operationalNote', 'Nur operative Abdeckung',
      'idempotencyKey', '18000000-0000-0000-0000-000000000062'),
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000062'
  );

  v_plan_payload := jsonb_build_object(
    'planId', '18000000-0000-0000-0000-000000000070',
    'revisionId', '18000000-0000-0000-0000-000000000071',
    'clientId', '18000000-0000-0000-0000-000000000020',
    'siteId', '18000000-0000-0000-0000-000000000021',
    'maintenanceCoverageId', '18000000-0000-0000-0000-000000000061',
    'status', 'active', 'templateVersionId', v_version_id,
    'effectiveFromDate', '2026-01-01', 'firstDueDate', '2026-02-01', 'intervalMonths', 6,
    'dueWindowBeforeDays', 14, 'dueWindowAfterDays', 14, 'plannedDurationMinutes', 120,
    'nextDueBasis', 'planned_due_date', 'operationalInstructions', 'Messwerte erfassen',
    'overlapReason', null, 'reason', 'Wartungsplan angelegt',
    'equipmentIds', jsonb_build_array('18000000-0000-0000-0000-000000000040'),
    'idempotencyKey', '18000000-0000-0000-0000-000000000072'
  );
  v_plan := public.create_maintenance_plan(
    '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000070',
    '18000000-0000-0000-0000-000000000071', v_plan_payload,
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000072'
  );
  perform public.generate_maintenance_due_work(
    '18000000-0000-0000-0000-000000000010', v_plan.id, v_plan.version, '2027-06-30',
    '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000072'
  );
  if (select count(*) from public.maintenance_due_work where maintenance_plan_id = v_plan.id) < 3
    or exists (select 1 from public.maintenance_due_work where maintenance_plan_id = v_plan.id
      and (job_id is not null or planning_occurrence_id is not null or status <> 'open')) then
    raise exception 'plan horizon did not create open due work without jobs or occurrences';
  end if;
  if not (select array_agg(event_type::text) from public.maintenance_plan_events
      where maintenance_plan_id = v_plan.id) @> array['created', 'horizon_extended'] then
    raise exception 'maintenance plan history lacks created or horizon_extended';
  end if;
  if not exists (select 1 from public.maintenance_coverage_events
      where maintenance_coverage_id = '18000000-0000-0000-0000-000000000061' and event_type::text = 'created') then
    raise exception 'maintenance coverage history lacks created';
  end if;

  begin
    perform public.create_maintenance_plan(
      '18000000-0000-0000-0000-000000000010', '18000000-0000-0000-0000-000000000073',
      '18000000-0000-0000-0000-000000000074',
      v_plan_payload || jsonb_build_object(
        'planId', '18000000-0000-0000-0000-000000000073',
        'revisionId', '18000000-0000-0000-0000-000000000074',
        'idempotencyKey', '18000000-0000-0000-0000-000000000075'),
      '18000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000075'
    );
    raise exception 'overlap_without_reason_accepted';
  exception when others then
    if sqlerrm not like '%maintenance_overlap_reason_required%' then
      raise exception 'an overlapping active plan was accepted without a reason: %', sqlerrm;
    end if;
  end;
end;
$$;

-- Managers read every service table of their organization.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"18000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
do $$
declare v_table text; v_count integer;
begin
  foreach v_table in array array[
    'installed_equipment', 'installed_equipment_identifiers', 'installed_equipment_events',
    'service_cases', 'service_case_events', 'service_case_equipment_links', 'service_case_relations',
    'maintenance_coverages', 'maintenance_plans', 'maintenance_plan_revisions', 'maintenance_plan_events',
    'maintenance_due_work', 'client_follow_ups'
  ] loop
    execute format('select count(*) from public.%I where organization_id = $1', v_table)
      into v_count using '18000000-0000-0000-0000-000000000010'::uuid;
    if v_count = 0 then raise exception 'buero manager cannot read %', v_table; end if;
  end loop;
end;
$$;

-- An employee (even one assigned to the linked job) and an outsider read none of them.
do $$
declare v_user text; v_table text; v_count integer;
begin
  foreach v_user in array array[
    '18000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000004'
  ] loop
    perform set_config('request.jwt.claims',
      format('{"sub":"%s","role":"authenticated"}', v_user), true);
    foreach v_table in array array[
      'installed_equipment', 'installed_equipment_identifiers', 'installed_equipment_events',
      'installed_equipment_event_links', 'installed_equipment_work_links',
      'service_cases', 'service_case_events', 'service_case_equipment_links', 'service_case_relations',
      'service_case_evidence_links',
      'maintenance_coverages', 'maintenance_plans', 'maintenance_plan_revisions', 'maintenance_plan_events',
      'maintenance_due_work', 'maintenance_due_work_events', 'client_follow_ups'
    ] loop
      execute format('select count(*) from public.%I where organization_id = $1', v_table)
        into v_count using '18000000-0000-0000-0000-000000000010'::uuid;
      if v_count <> 0 then raise exception '% read % rows of %', v_user, v_count, v_table; end if;
    end loop;
  end loop;
end;
$$;

rollback;
