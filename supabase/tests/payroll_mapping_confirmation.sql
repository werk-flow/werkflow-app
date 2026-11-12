-- Confirming a payroll mapping from the version its table was read from
-- (migration 20261201090000_open_accounts_together_and_confirm_mapping_from_its_version.sql):
-- the first confirmation names no version, a later one names the current
-- version, a table read from an older version is refused and writes
-- nothing, an earlier version keeps its codes, and only an Admin of the
-- organization confirms.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('16900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'mapping-confirm-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Mapping"}', now(), now()),
('16900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'mapping-confirm-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Mapping"}', now(), now()),
('16900000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'mapping-confirm-foreign@example.test', '', now(), '{}',
 '{"first_name":"Foreign","last_name":"Mapping"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('16900000-0000-0000-0000-000000000010', 'Mapping confirmation SQL',
  '16900000-0000-0000-0000-000000000001', 'MAPCONF1'),
('16900000-0000-0000-0000-000000000011', 'Foreign mapping confirmation SQL',
  '16900000-0000-0000-0000-000000000003', 'MAPCONF2');
insert into public.organization_members (organization_id, user_id, role) values
('16900000-0000-0000-0000-000000000010', '16900000-0000-0000-0000-000000000002', 'employee');

-- Runs one statement and requires the refusal `p_message`.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_message text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_message then
      raise exception '%: expected %, got %', p_label, p_message, sqlerrm;
    end if;
    return;
  end;
  raise exception '%: the statement was accepted', p_label;
end;
$$;

-- One code row of a mapping version.
create function pg_temp.codes(p_overtime_code text) returns jsonb
language sql as $$
  select jsonb_build_array(
    jsonb_build_object('value_kind', 'overtime', 'activity_kind', null, 'output_code', p_overtime_code)
  );
$$;

grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;
grant execute on function pg_temp.codes(text) to service_role;

set local role service_role;

do $$
declare
  v_org constant uuid := '16900000-0000-0000-0000-000000000010';
  v_admin constant uuid := '16900000-0000-0000-0000-000000000001';
  v_employee constant uuid := '16900000-0000-0000-0000-000000000002';
  v_foreign_admin constant uuid := '16900000-0000-0000-0000-000000000003';
  v_first uuid;
  v_second uuid;
begin
  -- Who may confirm: only an Admin of the organization.
  perform pg_temp.expect_refusal('an employee confirmed a payroll mapping',
    format($sql$select public.confirm_payroll_mapping_version(%L, %L, null, '[]', pg_temp.codes('1000'), gen_random_uuid(), repeat('a', 64))$sql$,
      v_employee, v_org),
    'forbidden');
  perform pg_temp.expect_refusal('a foreign admin confirmed the organization''s payroll mapping',
    format($sql$select public.confirm_payroll_mapping_version(%L, %L, null, '[]', pg_temp.codes('1000'), gen_random_uuid(), repeat('a', 64))$sql$,
      v_foreign_admin, v_org),
    'forbidden');

  -- Before the first version the table names none; naming one is stale.
  perform pg_temp.expect_refusal('a first confirmation named a version that does not exist',
    format($sql$select public.confirm_payroll_mapping_version(%L, %L, 1, '[]', pg_temp.codes('1000'), gen_random_uuid(), repeat('a', 64))$sql$,
      v_admin, v_org),
    'stale_version');
  if exists (select 1 from public.payroll_mapping_versions where organization_id = v_org) then
    raise exception 'a refused confirmation wrote a mapping version';
  end if;
  v_first := public.confirm_payroll_mapping_version(
    v_admin, v_org, null, '[]', pg_temp.codes('1000'), gen_random_uuid(), repeat('a', 64));
  if (select version from public.payroll_mapping_versions where id = v_first) <> 1 then
    raise exception 'the first confirmation did not create version 1';
  end if;

  -- A table read from version 1 becomes version 2.
  v_second := public.confirm_payroll_mapping_version(
    v_admin, v_org, 1, '[]', pg_temp.codes('1200'), gen_random_uuid(), repeat('b', 64));
  if (select version from public.payroll_mapping_versions where id = v_second) <> 2
    or (select current_version_id from public.payroll_mapping_profiles where organization_id = v_org)
      is distinct from v_second then
    raise exception 'a confirmation from the current version did not become the current version 2';
  end if;

  -- Another table, still read from version 1 or from no version, is stale:
  -- it would undo the code version 2 saved.
  perform pg_temp.expect_refusal('a table read from an older version became the newest mapping',
    format($sql$select public.confirm_payroll_mapping_version(%L, %L, 1, '[]', pg_temp.codes('1000'), gen_random_uuid(), repeat('c', 64))$sql$,
      v_admin, v_org),
    'stale_version');
  perform pg_temp.expect_refusal('a table read before the first version became the newest mapping',
    format($sql$select public.confirm_payroll_mapping_version(%L, %L, null, '[]', pg_temp.codes('1000'), gen_random_uuid(), repeat('c', 64))$sql$,
      v_admin, v_org),
    'stale_version');
  if (select count(*) from public.payroll_mapping_versions where organization_id = v_org) <> 2
    or (select current_version_id from public.payroll_mapping_profiles where organization_id = v_org)
      is distinct from v_second then
    raise exception 'a stale confirmation wrote a mapping version or moved the current one';
  end if;

  -- Version 1 is history: it keeps its code beside version 2's.
  if (select output_code from public.payroll_code_mappings
      where organization_id = v_org and mapping_version_id = v_first) is distinct from '1000'
    or (select output_code from public.payroll_code_mappings
      where organization_id = v_org and mapping_version_id = v_second) is distinct from '1200' then
    raise exception 'a later mapping version changed the codes of an earlier one';
  end if;
end;
$$;

reset role;

-- Only the server calls the function, and it runs as its caller.
do $$
begin
  if has_function_privilege('authenticated',
      'public.confirm_payroll_mapping_version(uuid,uuid,integer,jsonb,jsonb,uuid,text)', 'EXECUTE')
    or has_function_privilege('anon',
      'public.confirm_payroll_mapping_version(uuid,uuid,integer,jsonb,jsonb,uuid,text)', 'EXECUTE')
  then raise exception 'a client role can confirm a payroll mapping'; end if;
  if not has_function_privilege('service_role',
      'public.confirm_payroll_mapping_version(uuid,uuid,integer,jsonb,jsonb,uuid,text)', 'EXECUTE')
  then raise exception 'the server cannot confirm a payroll mapping'; end if;
  if (select prosecdef from pg_proc
      where oid = 'public.confirm_payroll_mapping_version(uuid,uuid,integer,jsonb,jsonb,uuid,text)'::regprocedure)
  then raise exception 'the mapping confirmation runs with its owner''s rights'; end if;
  -- The version check holds only under the writer's own lock: a confirmation
  -- and a direct create_payroll_mapping_version then never interleave.
  if position(':p1-23-payroll-mapping' in (select prosrc from pg_proc
      where oid = 'public.confirm_payroll_mapping_version(uuid,uuid,integer,jsonb,jsonb,uuid,text)'::regprocedure)) = 0
    or position(':p1-23-payroll-mapping' in (select prosrc from pg_proc
      where oid = 'public.create_payroll_mapping_version(uuid,uuid,jsonb,jsonb,uuid,text)'::regprocedure)) = 0
  then raise exception 'the mapping confirmation and the mapping writer take different locks'; end if;
  if (select strpos(prosrc, ':p1-23-payroll-mapping') > strpos(prosrc, 'current_version_id') from pg_proc
      where oid = 'public.confirm_payroll_mapping_version(uuid,uuid,integer,jsonb,jsonb,uuid,text)'::regprocedure)
  then raise exception 'the mapping confirmation reads the current version before it holds the lock'; end if;
end;
$$;

rollback;
