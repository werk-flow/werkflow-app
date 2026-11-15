-- A Stripe subscription per organization (20261215100003_keep_a_stripe_subscription_per_organization.sql,
-- werk-flow/werkflow-planning#248): no client role reads the table or runs
-- its functions, and the service role writes only through them; only an
-- organization's Admin stores its customer; a person holds one open
-- reservation; a signal of another customer, or a second subscription while
-- the first holds, is refused; an older read never overwrites a newer state;
-- a failed payment never ends the subscription; and only the payer creates
-- the reserved organization, with the reserved id, once, while the
-- subscription holds.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('41248000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'abo-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('41248000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'abo-buero@example.test', '', now(), '{}',
 '{"first_name":"Bruno","last_name":"Buero"}', now(), now()),
('41248000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'abo-neu@example.test', '', now(), '{}',
 '{"first_name":"Nina","last_name":"Neu"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('41248000-0000-0000-0000-000000000010', 'Haustechnik Sonnenberg GmbH',
  '41248000-0000-0000-0000-000000000001', 'ABOSQL01');
insert into public.organization_members (organization_id, user_id, role) values
('41248000-0000-0000-0000-000000000010', '41248000-0000-0000-0000-000000000002', 'buero');

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

-- Grants: client roles hold nothing; the service role reads and executes only.
do $$
declare
  api_role text;
  fn text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(api_role, 'public.werkflow_subscriptions',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(api_role, 'public.werkflow_subscriptions', 'SELECT,INSERT,UPDATE') then
      raise exception '% holds a privilege on werkflow_subscriptions', api_role;
    end if;
    foreach fn in array array[
      'public.werkflow_subscription_holds(text, text)',
      'public.reserve_werkflow_subscription(uuid, uuid, boolean, text)',
      'public.record_werkflow_subscription_state(uuid, text, text, text, boolean, timestamptz, text, timestamptz)',
      'public.create_organization_with_id(uuid, uuid, text, text)',
      'public.create_organization_from_subscription(uuid, text, text)'
    ] loop
      if has_function_privilege(api_role, fn, 'execute') then
        raise exception '% may execute %', api_role, fn;
      end if;
    end loop;
  end loop;
  if has_table_privilege('service_role', 'public.werkflow_subscriptions', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'service_role may write werkflow_subscriptions directly';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.werkflow_subscriptions'::regclass) then
    raise exception 'werkflow_subscriptions has a client policy';
  end if;
end;
$$;

set local role authenticated;
do $$
begin
  begin
    perform 1 from public.werkflow_subscriptions;
    raise exception 'authenticated read werkflow_subscriptions';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role service_role;

-- Only the organization's Admin stores its customer; a reservation never names an existing organization.
select pg_temp.expect_refusal('a Büro member subscribing', $sql$
  select public.reserve_werkflow_subscription('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000002', true, 'cus_test_buero')
$sql$, 'not_admin');
select pg_temp.expect_refusal('a reservation of an existing organization', $sql$
  select public.reserve_werkflow_subscription('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000003', false, 'cus_test_steal')
$sql$, 'invalid_input');

-- Each call is its own statement: Postgres evaluates the operands of OR in no fixed order.
do $$
declare
  v_row public.werkflow_subscriptions;
  v_answer text;
begin
  v_answer := public.reserve_werkflow_subscription('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg');
  if v_answer is distinct from 'cus_test_sonnenberg' then
    raise exception 'the first Checkout did not store its customer';
  end if;
  v_answer := public.reserve_werkflow_subscription('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_second');
  if v_answer is distinct from 'cus_test_sonnenberg' then
    raise exception 'a second Checkout did not keep the first customer';
  end if;
  select * into strict v_row from public.werkflow_subscriptions
  where organization_id = '41248000-0000-0000-0000-000000000010';
  if v_row.linked_at is null or v_row.holds_subscription then
    raise exception 'an existing organization''s row was not linked, or held before any payment';
  end if;

  -- A failed payment keeps the subscription holding, also when Stripe cancels it for that.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_1', 'past_due', false, '2037-01-01T10:00:01Z');
  if v_answer is distinct from 'recorded' or not (select holds_subscription from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010')
  then
    raise exception 'a past due subscription does not hold';
  end if;
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_sonnenberg',
    'sub_test_1', 'canceled', false, '2037-01-01T10:00:02Z', 'payment_failed', '2037-12-15T10:00:00Z');

  -- A slow handler's older read changes nothing.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_1', 'active', false, '2037-01-01T10:00:01Z');
  if v_answer is distinct from 'ignored' or (select status from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'canceled'
  then
    raise exception 'an older read overwrote a newer state';
  end if;
  if not (select holds_subscription from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') then
    raise exception 'a cancellation for a failed payment ended the subscription';
  end if;

  -- A second subscription while the first holds is refused; a stale one that no longer holds changes nothing.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_0', 'incomplete_expired', false, '2037-01-01T10:00:03Z');
  if v_answer is distinct from 'ignored' then
    raise exception 'a stale subscription that no longer holds was recorded';
  end if;
end;
$$;

select pg_temp.expect_refusal('a second subscription while the first holds', $sql$
  select public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_sonnenberg',
    'sub_test_2', 'active', false, '2037-01-01T10:00:04Z')
$sql$, 'subscription_conflict');
select pg_temp.expect_refusal('a signal of another customer', $sql$
  select public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_other',
    'sub_test_1', 'active', false, '2037-01-01T10:00:05Z')
$sql$, 'subscription_customer_mismatch');
select pg_temp.expect_refusal('a signal of an unknown organization', $sql$
  select public.record_werkflow_subscription_state('41248000-0000-0000-0000-0000000000ff', 'cus_test_sonnenberg',
    'sub_test_1', 'active', false, '2037-01-01T10:00:06Z')
$sql$, 'subscription_row_missing');

do $$
declare
  v_answer text;
begin
  -- A subscription cancelled on request no longer holds; a new one then replaces it.
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_sonnenberg',
    'sub_test_1', 'canceled', false, '2037-01-01T10:00:07Z', 'cancellation_requested');
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_2', 'active', false, '2037-01-01T10:00:08Z');
  if v_answer is distinct from 'recorded' or (select stripe_subscription_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'sub_test_2'
  then
    raise exception 'a new subscription did not replace one that ended on request';
  end if;

  -- A person holds one open reservation.
  v_answer := public.reserve_werkflow_subscription('41248000-0000-0000-0000-000000000020',
    '41248000-0000-0000-0000-000000000003', false, 'cus_test_neu');
  if v_answer is distinct from 'cus_test_neu' then
    raise exception 'the reservation did not store its customer';
  end if;
  v_answer := public.reserve_werkflow_subscription('41248000-0000-0000-0000-000000000021',
    '41248000-0000-0000-0000-000000000003', false, 'cus_test_neu_2');
  if v_answer is not null then
    raise exception 'a person held two open reservations';
  end if;
end;
$$;

-- Only the payer creates the reserved organization, and only while the subscription holds.
select pg_temp.expect_refusal('an unpaid reservation', $sql$
  select public.create_organization_from_subscription(
    '41248000-0000-0000-0000-000000000003', 'Neue Firma SQL', 'ABOSQL02')
$sql$, 'subscription_required');
select public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000020', 'cus_test_neu',
  'sub_test_3', 'active', false, '2037-01-01T10:00:09Z');
-- Another person, even an Admin with a held subscription of an existing organization, has no reservation.
select pg_temp.expect_refusal('another person creating an organization', $sql$
  select public.create_organization_from_subscription(
    '41248000-0000-0000-0000-000000000001', 'Fremde Firma SQL', 'ABOSQL03')
$sql$, 'subscription_required');

do $$
begin
  if public.create_organization_from_subscription(
      '41248000-0000-0000-0000-000000000003', 'Neue Firma SQL', 'ABOSQL04')
    is distinct from '41248000-0000-0000-0000-000000000020'
  then
    raise exception 'the organization did not take the reserved id';
  end if;
  if not exists (select 1 from public.organization_members
      where organization_id = '41248000-0000-0000-0000-000000000020'
        and user_id = '41248000-0000-0000-0000-000000000003' and role = 'admin')
    or not exists (select 1 from public.organization_settings
      where organization_id = '41248000-0000-0000-0000-000000000020')
    or (select linked_at from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000020') is null
  then
    raise exception 'the reserved organization lacks its owner, its settings or its link';
  end if;
end;
$$;

select pg_temp.expect_refusal('a second organization from one reservation', $sql$
  select public.create_organization_from_subscription(
    '41248000-0000-0000-0000-000000000003', 'Zweite Firma SQL', 'ABOSQL05')
$sql$, 'subscription_required');

-- The previous release's creation still works and draws its own id.
do $$
begin
  if public.create_organization_with_defaults('41248000-0000-0000-0000-000000000001', 'Ohne Abo SQL', 'ABOSQL06')
    is null
  then
    raise exception 'create_organization_with_defaults returned no id';
  end if;
end;
$$;

rollback;
