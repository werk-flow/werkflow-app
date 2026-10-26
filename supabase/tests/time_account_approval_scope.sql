-- Time-account decisions: a proposer never decides their own adjustment, and
-- the database applies the holder scope of lib/responsibilities/resolution.ts
-- (canHolderApproveTarget). One rolled-back transaction.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select person.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  person.email, '', now(), '{}', jsonb_build_object('first_name', person.first_name, 'last_name', 'Vier'),
  now(), now()
from (values
  ('4e000000-0000-4000-8000-000000000001'::uuid, 'four-eyes-admin@example.test', 'Admin'),
  ('4e000000-0000-4000-8000-000000000003'::uuid, 'four-eyes-buero@example.test', 'Buero'),
  ('4e000000-0000-4000-8000-000000000004'::uuid, 'four-eyes-buero-two@example.test', 'Zweitbuero'),
  ('4e000000-0000-4000-8000-000000000005'::uuid, 'four-eyes-employee@example.test', 'Mitarbeiter'),
  ('4e000000-0000-4000-8000-000000000006'::uuid, 'four-eyes-former@example.test', 'Ehemalig')
) as person(id, email, first_name);

insert into public.organizations (id, name, admin_id, unique_code)
values ('4e000000-0000-4000-8000-000000000010', 'Vier Augen',
  '4e000000-0000-4000-8000-000000000001', 'VIERAUG');
insert into public.organization_members (organization_id, user_id, role) values
  ('4e000000-0000-4000-8000-000000000010', '4e000000-0000-4000-8000-000000000003', 'buero'),
  ('4e000000-0000-4000-8000-000000000010', '4e000000-0000-4000-8000-000000000004', 'buero'),
  ('4e000000-0000-4000-8000-000000000010', '4e000000-0000-4000-8000-000000000005', 'employee');
-- A person without a login, and a former member whose record keeps the login.
insert into public.employee_records (id, organization_id, user_id, first_name, last_name) values
  ('4e000000-0000-4000-8000-000000000020', '4e000000-0000-4000-8000-000000000010', null, 'Ohne', 'Login'),
  ('4e000000-0000-4000-8000-000000000021', '4e000000-0000-4000-8000-000000000010',
   '4e000000-0000-4000-8000-000000000006', 'Ehemalig', 'Vier');

create function pg_temp.record_of(p_user_id uuid) returns uuid language sql as $$
  select id from public.employee_records
  where organization_id = '4e000000-0000-4000-8000-000000000010' and user_id = p_user_id;
$$;

create function pg_temp.expect_approval(
  p_label text, p_actor_id uuid, p_employee_record_id uuid, p_expected boolean
) returns void language plpgsql as $$
begin
  if app_private.can_p1_23_approve_employee(
    '4e000000-0000-4000-8000-000000000010', p_actor_id, p_employee_record_id
  ) is distinct from p_expected then
    raise exception 'approval scope: %', p_label;
  end if;
end;
$$;

create function pg_temp.expect_decision_refused(
  p_label text, p_request_id uuid, p_actor_id uuid, p_decision public.time_period_finding_decision,
  p_code text
) returns void language plpgsql as $$
begin
  perform public.decide_time_account_adjustment(
    '4e000000-0000-4000-8000-000000000010', p_request_id,
    (select version from public.time_account_adjustment_requests where id = p_request_id),
    p_decision, 'Geprüft', p_actor_id, gen_random_uuid());
  raise exception 'decision refusal: %', p_label;
exception when others then
  if sqlerrm <> p_code then raise; end if;
end;
$$;

grant execute on all functions in schema pg_temp to service_role;

-- Without a configuration, Admin decides for everyone but themselves and Büro
-- decides for employees only. A person without a login counts as an employee;
-- a login without a current membership has no known role.
do $$
declare
  admin uuid := '4e000000-0000-4000-8000-000000000001';
  buero_one uuid := '4e000000-0000-4000-8000-000000000003';
  buero_two uuid := '4e000000-0000-4000-8000-000000000004';
  employee uuid := '4e000000-0000-4000-8000-000000000005';
  no_login_record uuid := '4e000000-0000-4000-8000-000000000020';
  former_record uuid := '4e000000-0000-4000-8000-000000000021';
begin
  perform pg_temp.expect_approval('admin decides büro', admin, pg_temp.record_of(buero_one), true);
  perform pg_temp.expect_approval('admin decides a former member', admin, former_record, true);
  perform pg_temp.expect_approval('admin decides for themselves', admin, pg_temp.record_of(admin), false);
  perform pg_temp.expect_approval('büro decides an employee', buero_one, pg_temp.record_of(employee), true);
  perform pg_temp.expect_approval('büro decides a person without login', buero_one, no_login_record, true);
  perform pg_temp.expect_approval('büro decides büro', buero_one, pg_temp.record_of(buero_two), false);
  perform pg_temp.expect_approval('büro decides the admin', buero_one, pg_temp.record_of(admin), false);
  perform pg_temp.expect_approval('büro decides a former member', buero_one, former_record, false);
  perform pg_temp.expect_approval('büro decides for themselves', buero_one, pg_temp.record_of(buero_one), false);
  perform pg_temp.expect_approval('an employee decides', employee, no_login_record, false);
  perform pg_temp.expect_approval('a former member decides', '4e000000-0000-4000-8000-000000000006',
    no_login_record, false);
  perform pg_temp.expect_approval('a record of another organization', admin,
    (select id from public.employee_records where organization_id <> '4e000000-0000-4000-8000-000000000010'
     limit 1), false);
end;
$$;

-- The adjustment decision: the proposer decides nothing, and the scope above holds.
set local role service_role;

do $$
declare
  admin uuid := '4e000000-0000-4000-8000-000000000001';
  buero_one uuid := '4e000000-0000-4000-8000-000000000003';
  buero_two uuid := '4e000000-0000-4000-8000-000000000004';
  employee uuid := '4e000000-0000-4000-8000-000000000005';
  account_id uuid;
  request_id uuid;
begin
  -- Büro proposes for an employee; only another person decides.
  account_id := public.open_time_account(
    '4e000000-0000-4000-8000-000000000010', pg_temp.record_of(employee), 0, '2026-10-01',
    'Einführung', admin, gen_random_uuid(), repeat('a', 64));
  request_id := public.submit_time_account_adjustment(
    '4e000000-0000-4000-8000-000000000010', account_id,
    (select version from public.time_accounts where id = account_id),
    'manual_adjustment', 30, '2026-10-02', 'Nachtrag', buero_one, gen_random_uuid(), repeat('b', 64));
  perform pg_temp.expect_decision_refused('the proposer approves', request_id, buero_one, 'approved', 'own_proposal');
  perform pg_temp.expect_decision_refused('the proposer rejects', request_id, buero_one, 'rejected', 'own_proposal');
  if (select current_balance_minutes from public.time_accounts where id = account_id) <> 0
    or (select status from public.time_account_adjustment_requests where id = request_id) <> 'submitted'
    then raise exception 'a refused own decision changed the request or the balance'; end if;
  perform public.decide_time_account_adjustment(
    '4e000000-0000-4000-8000-000000000010', request_id,
    (select version from public.time_account_adjustment_requests where id = request_id),
    'approved', 'Geprüft', buero_two, gen_random_uuid());
  if (select current_balance_minutes from public.time_accounts where id = account_id) <> 30
    then raise exception 'a second Büro member could not approve an employee adjustment'; end if;

  -- A Büro member proposes for another: the proposer, the subject and Büro scope refuse; the Admin decides.
  account_id := public.open_time_account(
    '4e000000-0000-4000-8000-000000000010', pg_temp.record_of(buero_one), 0, '2026-10-01',
    'Einführung', admin, gen_random_uuid(), repeat('c', 64));
  request_id := public.submit_time_account_adjustment(
    '4e000000-0000-4000-8000-000000000010', account_id,
    (select version from public.time_accounts where id = account_id),
    'payout', -60, '2026-10-02', 'Auszahlung', buero_two, gen_random_uuid(), repeat('d', 64));
  perform pg_temp.expect_decision_refused('the proposing Büro member approves', request_id, buero_two, 'approved',
    'own_proposal');
  perform pg_temp.expect_decision_refused('the subject approves', request_id, buero_one, 'approved',
    'not_responsible_or_self_approval');
  perform public.decide_time_account_adjustment(
    '4e000000-0000-4000-8000-000000000010', request_id,
    (select version from public.time_account_adjustment_requests where id = request_id),
    'approved', 'Geprüft', admin, gen_random_uuid());
  if (select current_balance_minutes from public.time_accounts where id = account_id) <> -60
    then raise exception 'the Admin could not approve a Büro adjustment'; end if;

  -- A Büro member proposes for the Admin: the Admin is the subject, the other Büro member is out of scope.
  account_id := public.open_time_account(
    '4e000000-0000-4000-8000-000000000010', pg_temp.record_of(admin), 0, '2026-10-01',
    'Einführung', admin, gen_random_uuid(), repeat('e', 64));
  request_id := public.submit_time_account_adjustment(
    '4e000000-0000-4000-8000-000000000010', account_id,
    (select version from public.time_accounts where id = account_id),
    'manual_adjustment', 15, '2026-10-02', 'Nachtrag', buero_one, gen_random_uuid(), repeat('f', 64));
  perform pg_temp.expect_decision_refused('büro approves the admin', request_id, buero_two, 'approved',
    'not_responsible_or_self_approval');
  perform pg_temp.expect_decision_refused('the admin approves for themselves', request_id, admin, 'approved',
    'not_responsible_or_self_approval');
end;
$$;

reset role;

-- A substitute inherits the scope of the holder they stand in for; the newest
-- effective delegation counts first, as the server orders them.
do $$
declare
  admin uuid := '4e000000-0000-4000-8000-000000000001';
  buero_one uuid := '4e000000-0000-4000-8000-000000000003';
  buero_two uuid := '4e000000-0000-4000-8000-000000000004';
  employee uuid := '4e000000-0000-4000-8000-000000000005';
  today date := (current_timestamp at time zone 'Europe/Berlin')::date;
begin
  insert into public.organization_responsibility_delegations (
    organization_id, responsibility, delegator_employee_record_id, substitute_employee_record_id,
    valid_from, valid_until
  ) values ('4e000000-0000-4000-8000-000000000010', 'time_approval',
    pg_temp.record_of(buero_one), pg_temp.record_of(employee), today - 5, today + 5);
  perform pg_temp.expect_approval('a Büro substitute decides an employee', employee,
    '4e000000-0000-4000-8000-000000000020', true);
  perform pg_temp.expect_approval('a Büro substitute decides büro', employee, pg_temp.record_of(buero_two), false);
  perform pg_temp.expect_approval('a substitute decides for themselves', employee, pg_temp.record_of(employee), false);

  insert into public.organization_responsibility_delegations (
    organization_id, responsibility, delegator_employee_record_id, substitute_employee_record_id,
    valid_from, valid_until
  ) values ('4e000000-0000-4000-8000-000000000010', 'time_approval',
    pg_temp.record_of(admin), pg_temp.record_of(employee), today - 1, today + 5);
  perform pg_temp.expect_approval('the newest delegation, from the Admin, counts', employee,
    pg_temp.record_of(buero_two), true);

end;
$$;

-- Named holders replace the role defaults: a direct assignment decides for
-- everyone but the holder, an Admin snapshot keeps the Admin scope, and an
-- Admin the newest configuration does not name decides nothing.
do $$
declare
  admin uuid := '4e000000-0000-4000-8000-000000000001';
  buero_one uuid := '4e000000-0000-4000-8000-000000000003';
  buero_two uuid := '4e000000-0000-4000-8000-000000000004';
  employee uuid := '4e000000-0000-4000-8000-000000000005';
  older_configuration_id uuid;
  newer_configuration_id uuid;
begin
  delete from public.organization_responsibility_delegations
  where organization_id = '4e000000-0000-4000-8000-000000000010';
  insert into public.organization_responsibility_configurations (
    organization_id, responsibility, mode, effective_from
  ) values ('4e000000-0000-4000-8000-000000000010', 'time_approval', 'selected', now() - interval '1 hour')
  returning id into older_configuration_id;
  insert into public.organization_responsibility_assignments (
    organization_id, configuration_id, employee_record_id, source, role_snapshot
  ) values
    ('4e000000-0000-4000-8000-000000000010', older_configuration_id, pg_temp.record_of(buero_one), 'direct', null),
    ('4e000000-0000-4000-8000-000000000010', older_configuration_id, pg_temp.record_of(admin), 'role_default', 'admin');
  perform pg_temp.expect_approval('a direct holder decides the admin', buero_one, pg_temp.record_of(admin), true);
  perform pg_temp.expect_approval('a direct holder decides for themselves', buero_one,
    pg_temp.record_of(buero_one), false);
  perform pg_temp.expect_approval('a named admin decides büro', admin, pg_temp.record_of(buero_two), true);
  perform pg_temp.expect_approval('an unnamed Büro member decides', buero_two, pg_temp.record_of(employee), false);

  insert into public.organization_responsibility_configurations (organization_id, responsibility, mode)
  values ('4e000000-0000-4000-8000-000000000010', 'time_approval', 'selected')
  returning id into newer_configuration_id;
  insert into public.organization_responsibility_assignments (
    organization_id, configuration_id, employee_record_id, source, role_snapshot
  ) values
    ('4e000000-0000-4000-8000-000000000010', newer_configuration_id, pg_temp.record_of(buero_one), 'direct', null);
  perform pg_temp.expect_approval('an admin the newest configuration does not name decides', admin,
    pg_temp.record_of(employee), false);

  -- A suspended holder holds nothing.
  insert into public.personnel_access_lifecycles (organization_id, employee_record_id, state, state_effective_at)
  values ('4e000000-0000-4000-8000-000000000010', pg_temp.record_of(buero_one), 'suspended', now());
  perform pg_temp.expect_approval('a suspended direct holder decides', buero_one, pg_temp.record_of(admin), false);
end;
$$;

rollback;
