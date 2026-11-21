-- Anlagen and Aufträge carry the number the previous system gave them
-- (migration 20261218090000_carry_source_numbers_on_jobs_and_equipment.sql,
-- werk-flow/werkflow-planning#486).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('48600000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'source-admin@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('48600000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'source-buero@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('48600000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'source-employee@example.test', '', now(), '{}',
 '{"first_name":"Moritz","last_name":"Monteur"}', now(), now()),
('48600000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'source-outsider@example.test', '', now(), '{}',
 '{"first_name":"Olga","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('48600000-0000-0000-0000-000000000010', 'Haustechnik Sonnenberg GmbH', '48600000-0000-0000-0000-000000000001', 'SRCNUMA'),
('48600000-0000-0000-0000-000000000011', 'Fremde Haustechnik GmbH', '48600000-0000-0000-0000-000000000004', 'SRCNUMB');
insert into public.organization_members (organization_id, user_id, role) values
('48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000002', 'buero'),
('48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000003', 'employee');

insert into public.clients (id, organization_id, name, client_type) values
('48600000-0000-0000-0000-000000000020', '48600000-0000-0000-0000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich');
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city) values
('48600000-0000-0000-0000-000000000030', '48600000-0000-0000-0000-000000000010',
 '48600000-0000-0000-0000-000000000020', 'Haus Lindenhof', 'Lindenweg 3', '70173', 'Stuttgart');

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

-- 1. The column check: trimmed, 1 to 100 characters, null allowed. Not unique.
do $$
begin
  perform pg_temp.expect_refusal('job number with spaces',
    $sql$insert into public.jobs (organization_id, job_number, title, created_by, source_number)
      values ('48600000-0000-0000-0000-000000000010', 'SRC-CHECK-1', 'Prüfung',
        '48600000-0000-0000-0000-000000000001', ' A-1 ')$sql$,
    'new row for relation "jobs" violates check constraint "jobs_source_number_check"');
  perform pg_temp.expect_refusal('empty job number',
    $sql$insert into public.jobs (organization_id, job_number, title, created_by, source_number)
      values ('48600000-0000-0000-0000-000000000010', 'SRC-CHECK-2', 'Prüfung',
        '48600000-0000-0000-0000-000000000001', '')$sql$,
    'new row for relation "jobs" violates check constraint "jobs_source_number_check"');
  perform pg_temp.expect_refusal('job number over 100 characters',
    $sql$insert into public.jobs (organization_id, job_number, title, created_by, source_number)
      values ('48600000-0000-0000-0000-000000000010', 'SRC-CHECK-3', 'Prüfung',
        '48600000-0000-0000-0000-000000000001', repeat('9', 101))$sql$,
    'new row for relation "jobs" violates check constraint "jobs_source_number_check"');
  perform set_config('app.installed_equipment_write', 'true', true);
  perform pg_temp.expect_refusal('equipment number with spaces',
    $sql$insert into public.installed_equipment (organization_id, client_id, site_id, equipment_number,
        name, category, state, created_by, updated_by, source_number)
      values ('48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000020',
        '48600000-0000-0000-0000-000000000030', 'SRC-CHECK-A', 'Prüfung', 'heat_generation', 'active',
        '48600000-0000-0000-0000-000000000001', '48600000-0000-0000-0000-000000000001', 'ANL 7 ')$sql$,
    'new row for relation "installed_equipment" violates check constraint "installed_equipment_source_number_check"');
  perform set_config('app.installed_equipment_write', 'false', true);

  -- Two jobs may share an old number: uniqueness waits for the import's data.
  insert into public.jobs (organization_id, job_number, title, created_by, source_number) values
  ('48600000-0000-0000-0000-000000000010', 'SRC-SHARED-1', 'Erster', '48600000-0000-0000-0000-000000000001', repeat('9', 100)),
  ('48600000-0000-0000-0000-000000000010', 'SRC-SHARED-2', 'Zweiter', '48600000-0000-0000-0000-000000000001', repeat('9', 100));
end;
$$;

set local role service_role;

-- 2. The job save writes the old number; the edit changes and clears it.
do $$
declare
  v_job public.jobs;
begin
  v_job := public.create_job_with_assignments(
    '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000002',
    '{"title":"Heizung warten","job_number":"SRC-AUF-1","source_number":"AUF-ALT-4711"}'::jsonb,
    null, null, null, null, null, null, null, null, false, null, false
  );
  if v_job.source_number is distinct from 'AUF-ALT-4711' then
    raise exception 'job creation must save the old number, saved %', v_job.source_number;
  end if;

  v_job := public.update_job_with_assignments(
    '48600000-0000-0000-0000-000000000010', v_job.id, '48600000-0000-0000-0000-000000000002',
    '{"source_number":"AUF-ALT-4712"}'::jsonb,
    false, null, null, null, null, null, null, null, null, false
  );
  if v_job.source_number is distinct from 'AUF-ALT-4712' then
    raise exception 'job edit must change the old number, saved %', v_job.source_number;
  end if;

  -- An edit that does not name the old number keeps it.
  v_job := public.update_job_with_assignments(
    '48600000-0000-0000-0000-000000000010', v_job.id, '48600000-0000-0000-0000-000000000002',
    '{"title":"Heizung warten und prüfen"}'::jsonb,
    false, null, null, null, null, null, null, null, null, false
  );
  if v_job.source_number is distinct from 'AUF-ALT-4712' then
    raise exception 'job edit without the old number must keep it, saved %', v_job.source_number;
  end if;

  -- Another organization's id finds no job to change.
  perform pg_temp.expect_refusal('foreign organization edits the old number',
    format($sql$select public.update_job_with_assignments(
      '48600000-0000-0000-0000-000000000011', %L, '48600000-0000-0000-0000-000000000004',
      '{"source_number":"FREMD-1"}'::jsonb, false, null, null, null, null, null, null, null, null, false)$sql$,
      v_job.id),
    'job_not_found');
  if (select job.source_number from public.jobs job
      where job.organization_id = '48600000-0000-0000-0000-000000000010' and job.id = v_job.id)
      is distinct from 'AUF-ALT-4712' then
    raise exception 'a refused foreign edit must leave the old number';
  end if;
end;
$$;

-- 3. The equipment save writes the old number into the record and its history.
do $$
declare
  v_equipment public.installed_equipment;
  v_event public.installed_equipment_events;
begin
  v_equipment := public.create_installed_equipment(
    '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000040',
    jsonb_build_object(
      'clientId', '48600000-0000-0000-0000-000000000020',
      'siteId', '48600000-0000-0000-0000-000000000030',
      'name', 'Gasbrennwerttherme Keller', 'category', 'heat_generation', 'state', 'active',
      'identifiers', '[]'::jsonb, 'sourceNumber', '  ANL-ALT-815 '
    ),
    '48600000-0000-0000-0000-000000000002', '48600000-0000-0000-0000-000000000041'
  );
  if v_equipment.source_number is distinct from 'ANL-ALT-815' then
    raise exception 'equipment creation must save the trimmed old number, saved %', v_equipment.source_number;
  end if;
  select * into v_event from public.installed_equipment_events event
  where event.organization_id = '48600000-0000-0000-0000-000000000010'
    and event.equipment_id = '48600000-0000-0000-0000-000000000040'
    and event.request_operation = 'create';
  if v_event.after_snapshot ->> 'source_number' is distinct from 'ANL-ALT-815' then
    raise exception 'the registration event must record the old number';
  end if;

  v_equipment := public.update_installed_equipment_details(
    '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000040', v_equipment.version,
    jsonb_build_object(
      'name', 'Gasbrennwerttherme Keller', 'category', 'heat_generation',
      'identifiers', '[]'::jsonb, 'sourceNumber', 'ANL-ALT-816', 'reason', 'Nummer korrigiert'
    ),
    '48600000-0000-0000-0000-000000000002', '48600000-0000-0000-0000-000000000042'
  );
  select * into v_event from public.installed_equipment_events event
  where event.organization_id = '48600000-0000-0000-0000-000000000010'
    and event.equipment_id = '48600000-0000-0000-0000-000000000040'
    and event.idempotency_key = '48600000-0000-0000-0000-000000000042';
  if v_event.before_snapshot ->> 'source_number' is distinct from 'ANL-ALT-815'
     or v_event.after_snapshot ->> 'source_number' is distinct from 'ANL-ALT-816' then
    raise exception 'the edit event must record the old number before and after, recorded % and %',
      v_event.before_snapshot ->> 'source_number', v_event.after_snapshot ->> 'source_number';
  end if;

  -- A payload without the old number (a build that never sends it) keeps it.
  v_equipment := public.update_installed_equipment_details(
    '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000040', v_equipment.version,
    jsonb_build_object(
      'name', 'Gasbrennwerttherme Keller', 'category', 'heat_generation',
      'identifiers', '[]'::jsonb, 'reason', 'Name bestätigt'
    ),
    '48600000-0000-0000-0000-000000000002', '48600000-0000-0000-0000-000000000043'
  );
  if v_equipment.source_number is distinct from 'ANL-ALT-816' then
    raise exception 'an edit without the old number must keep it, saved %', v_equipment.source_number;
  end if;

  -- An empty value clears it.
  v_equipment := public.update_installed_equipment_details(
    '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000040', v_equipment.version,
    jsonb_build_object(
      'name', 'Gasbrennwerttherme Keller', 'category', 'heat_generation',
      'identifiers', '[]'::jsonb, 'sourceNumber', ' ', 'reason', 'Nummer entfernt'
    ),
    '48600000-0000-0000-0000-000000000002', '48600000-0000-0000-0000-000000000044'
  );
  if v_equipment.source_number is not null then
    raise exception 'an empty old number must clear it, saved %', v_equipment.source_number;
  end if;

  -- An employee and another organization's admin may not write it.
  perform pg_temp.expect_refusal('employee edits the old number',
    format($sql$select public.update_installed_equipment_details(
      '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000040', %s,
      '{"name":"Therme","category":"heat_generation","identifiers":[],"sourceNumber":"X-1","reason":"Versuch"}'::jsonb,
      '48600000-0000-0000-0000-000000000003', '48600000-0000-0000-0000-000000000045')$sql$,
      v_equipment.version),
    'installed_equipment_not_authorized');
  perform pg_temp.expect_refusal('foreign admin edits the old number',
    format($sql$select public.update_installed_equipment_details(
      '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000040', %s,
      '{"name":"Therme","category":"heat_generation","identifiers":[],"sourceNumber":"X-2","reason":"Versuch"}'::jsonb,
      '48600000-0000-0000-0000-000000000004', '48600000-0000-0000-0000-000000000046')$sql$,
      v_equipment.version),
    'installed_equipment_not_authorized');
  perform pg_temp.expect_refusal('foreign admin edits through their own organization',
    format($sql$select public.update_installed_equipment_details(
      '48600000-0000-0000-0000-000000000011', '48600000-0000-0000-0000-000000000040', %s,
      '{"name":"Therme","category":"heat_generation","identifiers":[],"sourceNumber":"X-3","reason":"Versuch"}'::jsonb,
      '48600000-0000-0000-0000-000000000004', '48600000-0000-0000-0000-000000000047')$sql$,
      v_equipment.version),
    'installed_equipment_not_found');
end;
$$;

-- 4. Each list search finds a record by its old number, regardless of case.
do $$
declare
  v_job_id uuid := (select job.id from public.jobs job
    where job.organization_id = '48600000-0000-0000-0000-000000000010' and job.job_number = 'SRC-AUF-1');
  v_page jsonb;
begin
  perform set_config('app.installed_equipment_write', 'true', true);
  update public.installed_equipment equipment set source_number = 'ANL-ALT-816'
  where equipment.organization_id = '48600000-0000-0000-0000-000000000010'
    and equipment.id = '48600000-0000-0000-0000-000000000040';
  perform set_config('app.installed_equipment_write', 'false', true);

  v_page := public.list_job_entries_page(
    '48600000-0000-0000-0000-000000000010', '48600000-0000-0000-0000-000000000001', true,
    '{"active":{"search":"auf-alt-4712"}}'::jsonb
  );
  if v_page -> 'active' -> 'entries' -> 0 ->> 'id' is distinct from v_job_id::text
     or (v_page -> 'active' ->> 'total')::integer is distinct from 1 then
    raise exception 'the job list search must find the job by its old number in lower case, found %', v_page;
  end if;

  v_page := public.list_equipment_page('48600000-0000-0000-0000-000000000010', 'anl-ALT-816');
  if v_page -> 'ids' -> 0 ->> 0 is distinct from '48600000-0000-0000-0000-000000000040'
     or (v_page ->> 'total')::integer is distinct from 1 then
    raise exception 'the Anlagen list search must find the Anlage by its old number in mixed case, found %', v_page;
  end if;

  -- Another organization's search does not find either.
  v_page := public.list_job_entries_page(
    '48600000-0000-0000-0000-000000000011', '48600000-0000-0000-0000-000000000004', true,
    '{"active":{"search":"AUF-ALT-4712"}}'::jsonb
  );
  if (v_page -> 'active' ->> 'total')::integer is distinct from 0 then
    raise exception 'another organization must not find the job by its old number';
  end if;
  v_page := public.list_equipment_page('48600000-0000-0000-0000-000000000011', 'ANL-ALT-816');
  if (v_page ->> 'total')::integer is distinct from 0 then
    raise exception 'another organization must not find the Anlage by its old number';
  end if;
end;
$$;

-- 5. A signed-in member writes neither column directly: no table write grant,
-- and the save functions run only for the service role.
reset role;
do $$
begin
  if has_table_privilege('authenticated', 'public.jobs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.installed_equipment', 'UPDATE')
     or has_function_privilege('authenticated',
       'public.update_job_with_assignments(uuid, uuid, uuid, jsonb, boolean, uuid[], date, uuid[], jsonb, jsonb, text, text, uuid, boolean)',
       'EXECUTE')
     or has_function_privilege('authenticated',
       'public.update_installed_equipment_details(uuid, uuid, bigint, jsonb, uuid, uuid)', 'EXECUTE') then
    raise exception 'a signed-in member must not write the old number directly';
  end if;
end;
$$;

rollback;
