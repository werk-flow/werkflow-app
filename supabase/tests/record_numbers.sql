-- Record number generators: a fresh organization starts at -001, the 1000th
-- number of a year (or MA-1000) is generated in full instead of truncated to
-- three digits, and the readers that parse the previous number keep counting
-- past 999. Rows are seeded with the trigger guards off because only the
-- generators are under test. Runs inside one transaction and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('1d000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
 'authenticated', 'record-numbers@example.test', '', now(), '{}',
 '{"first_name":"Record","last_name":"Numbers"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('1d000000-0000-0000-0000-000000000010', 'Record numbers SQL', '1d000000-0000-0000-0000-000000000001', 'RECNUMA'),
('1d000000-0000-0000-0000-000000000011', 'Record numbers fresh SQL', '1d000000-0000-0000-0000-000000000001', 'RECNUMB');

-- A fresh organization starts every sequence at 001.
do $$
declare
  v_org uuid := '1d000000-0000-0000-0000-000000000011';
  v_utc_year text := extract(year from now())::text;
  v_berlin_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
  v_numbers text[] := array[
    public.generate_job_number(v_org),
    public.generate_request_number(v_org),
    public.generate_project_number(v_org),
    public.generate_personnel_number(v_org),
    app_private.next_installed_equipment_number(v_org),
    app_private.next_service_case_number(v_org),
    app_private.next_maintenance_number(v_org, 'coverage'),
    app_private.next_maintenance_number(v_org, 'plan')
  ];
  v_expected text[] := array[
    'AUF-' || v_utc_year || '-001',
    'ANF-' || v_utc_year || '-001',
    'PRJ-' || v_utc_year || '-001',
    'MA-001',
    'ANL-' || v_berlin_year || '-001',
    'SRV-' || v_berlin_year || '-001',
    'WDV-' || v_berlin_year || '-001',
    'WPL-' || v_berlin_year || '-001'
  ];
begin
  if v_numbers is distinct from v_expected then
    raise exception 'a fresh organization does not start at 001: got %, expected %', v_numbers, v_expected;
  end if;
end;
$$;

insert into public.clients (id, organization_id, name) values
('1d000000-0000-0000-0000-000000000020', '1d000000-0000-0000-0000-000000000010', 'Record numbers Kunde');
insert into public.client_sites (id, organization_id, client_id, name, is_primary, created_by) values
('1d000000-0000-0000-0000-000000000021', '1d000000-0000-0000-0000-000000000010',
 '1d000000-0000-0000-0000-000000000020', 'Heizzentrale', true, '1d000000-0000-0000-0000-000000000001');

-- Seed the 999th record of the year for every generator.
set local session_replication_role = replica;
do $$
declare
  v_org uuid := '1d000000-0000-0000-0000-000000000010';
  v_user uuid := '1d000000-0000-0000-0000-000000000001';
  v_client uuid := '1d000000-0000-0000-0000-000000000020';
  v_site uuid := '1d000000-0000-0000-0000-000000000021';
  v_utc_year text := extract(year from now())::text;
  v_berlin_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
begin
  insert into public.jobs (organization_id, created_by, title, job_number)
  values (v_org, v_user, 'Auftrag 999', 'AUF-' || v_utc_year || '-999');
  insert into public.client_requests (organization_id, summary, request_number)
  values (v_org, 'Anfrage 999', 'ANF-' || v_utc_year || '-999');
  insert into public.projects (organization_id, created_by, name, project_number)
  values (v_org, v_user, 'Projekt 999', 'PRJ-' || v_utc_year || '-999');
  insert into public.employee_records (organization_id, employee_number)
  values (v_org, 'MA-999');
  insert into public.installed_equipment (
    organization_id, client_id, site_id, equipment_number, name, category, state, created_by, updated_by
  ) values (
    v_org, v_client, v_site, 'ANL-' || v_berlin_year || '-999', 'Anlage 999',
    'heat_generation', 'active', v_user, v_user
  );
  insert into public.service_cases (
    id, organization_id, case_number, intake_type, client_id, site_id,
    original_statement, summary, created_by, updated_by
  ) values (
    gen_random_uuid(), v_org, 'SRV-' || v_berlin_year || '-999',
    'direct',
    v_client, v_site, 'Servicefall 999', 'Servicefall 999', v_user, v_user
  );
  insert into public.maintenance_coverages (
    id, organization_id, coverage_number, client_id, site_id, created_by, updated_by
  ) values (gen_random_uuid(), v_org, 'WDV-' || v_berlin_year || '-999', v_client, v_site, v_user, v_user);
  insert into public.maintenance_plans (
    id, organization_id, plan_number, client_id, site_id, created_by, updated_by
  ) values (gen_random_uuid(), v_org, 'WPL-' || v_berlin_year || '-999', v_client, v_site, v_user, v_user);
end;
$$;
set local session_replication_role = origin;

-- The 1000th number keeps all four digits.
do $$
declare
  v_org uuid := '1d000000-0000-0000-0000-000000000010';
  v_utc_year text := extract(year from now())::text;
  v_berlin_year text := to_char(timezone('Europe/Berlin', now()), 'YYYY');
begin
  if public.generate_job_number(v_org) is distinct from 'AUF-' || v_utc_year || '-1000' then
    raise exception 'the 1000th Auftrag number is %, expected AUF-%-1000',
      public.generate_job_number(v_org), v_utc_year;
  end if;
  if public.generate_request_number(v_org) is distinct from 'ANF-' || v_utc_year || '-1000' then
    raise exception 'the 1000th Anfrage number is %, expected ANF-%-1000',
      public.generate_request_number(v_org), v_utc_year;
  end if;
  if public.generate_project_number(v_org) is distinct from 'PRJ-' || v_utc_year || '-1000' then
    raise exception 'the 1000th Projekt number is %, expected PRJ-%-1000',
      public.generate_project_number(v_org), v_utc_year;
  end if;
  if public.generate_personnel_number(v_org) is distinct from 'MA-1000' then
    raise exception 'the 1000th personnel number is %, expected MA-1000',
      public.generate_personnel_number(v_org);
  end if;
  if app_private.next_installed_equipment_number(v_org) is distinct from 'ANL-' || v_berlin_year || '-1000' then
    raise exception 'the 1000th Anlage number is %, expected ANL-%-1000',
      app_private.next_installed_equipment_number(v_org), v_berlin_year;
  end if;
  if app_private.next_service_case_number(v_org) is distinct from 'SRV-' || v_berlin_year || '-1000' then
    raise exception 'the 1000th Servicefall number is %, expected SRV-%-1000',
      app_private.next_service_case_number(v_org), v_berlin_year;
  end if;
  if app_private.next_maintenance_number(v_org, 'coverage') is distinct from 'WDV-' || v_berlin_year || '-1000' then
    raise exception 'the 1000th Wartungsvertrag number is %, expected WDV-%-1000',
      app_private.next_maintenance_number(v_org, 'coverage'), v_berlin_year;
  end if;
  if app_private.next_maintenance_number(v_org, 'plan') is distinct from 'WPL-' || v_berlin_year || '-1000' then
    raise exception 'the 1000th Wartungsplan number is %, expected WPL-%-1000',
      app_private.next_maintenance_number(v_org, 'plan'), v_berlin_year;
  end if;
end;
$$;

-- The parsers read four-digit numbers: after 1000 comes 1001, not a restart.
set local session_replication_role = replica;
insert into public.jobs (organization_id, created_by, title, job_number)
values ('1d000000-0000-0000-0000-000000000010', '1d000000-0000-0000-0000-000000000001', 'Auftrag 1000',
        'AUF-' || extract(year from now())::text || '-1000');
insert into public.client_requests (organization_id, summary, request_number)
values ('1d000000-0000-0000-0000-000000000010', 'Anfrage 1000',
        'ANF-' || extract(year from now())::text || '-1000');
insert into public.employee_records (organization_id, employee_number)
values ('1d000000-0000-0000-0000-000000000010', 'MA-1000');
set local session_replication_role = origin;

do $$
declare
  v_org uuid := '1d000000-0000-0000-0000-000000000010';
  v_utc_year text := extract(year from now())::text;
begin
  if public.generate_job_number(v_org) is distinct from 'AUF-' || v_utc_year || '-1001' then
    raise exception 'the Auftrag number after AUF-%-1000 is %, expected AUF-%-1001',
      v_utc_year, public.generate_job_number(v_org), v_utc_year;
  end if;
  if public.generate_request_number(v_org) is distinct from 'ANF-' || v_utc_year || '-1001' then
    raise exception 'the Anfrage number after ANF-%-1000 is %, expected ANF-%-1001',
      v_utc_year, public.generate_request_number(v_org), v_utc_year;
  end if;
  if public.generate_personnel_number(v_org) is distinct from 'MA-1001' then
    raise exception 'the personnel number after MA-1000 is %, expected MA-1001',
      public.generate_personnel_number(v_org);
  end if;
end;
$$;

rollback;
