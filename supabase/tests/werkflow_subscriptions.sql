-- A Stripe subscription per organization (20261218100003_keep_a_stripe_subscription_per_organization.sql,
-- werk-flow/werkflow-planning#248): no client role reads the table or runs
-- its functions, and the service role writes only through them; only an
-- organization's Admin stores its customer; a person holds one open
-- reservation; an organization has one payable Checkout, which every start
-- answers while it stays open, and only one start at a time creates the next;
-- a signal of another customer, or a second subscription while the first
-- holds, is refused, and one refused after fresh reads is marked a duplicate
-- that never becomes the organization's subscription; a read no newer than its own subscription's last read
-- changes nothing, also of a subscription the row does not follow, and a
-- holding replacement beats an ended predecessor whatever the read times; a failed payment never ends the subscription; and only the payer creates
-- the reserved organization, with the reserved id, once, while the
-- subscription holds. With 20261221100012 (werk-flow/werkflow-planning#495):
-- one Stripe ended after a failed first debit holds but no longer runs, so a
-- new Checkout starts and its subscription replaces the ended one; a marked
-- duplicate answers 'duplicate' until its cleanup is settled, also once
-- cancelled; a failed refund is recorded once against its duplicate; a
-- running subscription of a deleted organization or account is marked a
-- duplicate; and the mail ledger takes the two new alarms.
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
      'public.begin_werkflow_checkout(uuid, uuid, boolean, text, text)',
      'public.finish_werkflow_checkout(uuid, integer, text, text, timestamptz)',
      'public.record_werkflow_subscription_state(uuid, text, text, text, boolean, timestamptz, text, timestamptz, boolean)',
      'public.create_organization_with_id(uuid, uuid, text, text)',
      'public.create_organization_from_subscription(uuid, text, text)',
      'public.werkflow_subscription_runs(text)',
      'public.settle_werkflow_duplicate_subscription(uuid, text)',
      'public.record_werkflow_refund_failure(uuid, text, text, text)'
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
  select public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000002', true, 'cus_test_buero')
$sql$, 'not_admin');
select pg_temp.expect_refusal('a reservation of an existing organization', $sql$
  select public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000003', false, 'cus_test_steal')
$sql$, 'invalid_input');

-- Each call is its own statement: Postgres evaluates the operands of OR in no fixed order.
do $$
declare
  v_row public.werkflow_subscriptions;
  v_begun record;
  v_answer text;
begin
  -- The first start stores the customer and claims attempt 1; a second start
  -- meanwhile keeps that customer and creates nothing.
  select * into strict v_begun from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg');
  if (v_begun.result, v_begun.stripe_customer_id, v_begun.attempt, v_begun.session_id)
    is distinct from ('claimed'::text, 'cus_test_sonnenberg'::text, 1, null::text)
  then
    raise exception 'the first Checkout start did not store its customer and claim attempt 1: %', v_begun;
  end if;
  select * into strict v_begun from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_second');
  if (v_begun.result, v_begun.stripe_customer_id) is distinct from ('busy'::text, 'cus_test_sonnenberg'::text) then
    raise exception 'a parallel start was not busy, or replaced the customer: %', v_begun;
  end if;
  select * into strict v_row from public.werkflow_subscriptions
  where organization_id = '41248000-0000-0000-0000-000000000010';
  if v_row.linked_at is null or v_row.holds_subscription then
    raise exception 'an existing organization''s row was not linked, or held before any payment';
  end if;

  -- The attempt stores its session; every later start answers it while it stays open.
  if not public.finish_werkflow_checkout('41248000-0000-0000-0000-000000000010', 1,
      'cs_test_1', 'https://checkout.stripe.com/c/pay/cs_test_1', now() + interval '1 day') then
    raise exception 'the claimed attempt could not store its session';
  end if;
  select * into strict v_begun from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg');
  if (v_begun.result, v_begun.session_id, v_begun.session_url)
    is distinct from ('open'::text, 'cs_test_1'::text, 'https://checkout.stripe.com/c/pay/cs_test_1'::text)
  then
    raise exception 'a start while the Checkout is open did not answer it: %', v_begun;
  end if;

  -- A start that read the stored session closed at Stripe claims the next
  -- attempt and names that session; closing another session changes nothing.
  select * into strict v_begun from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg', 'cs_test_other');
  if v_begun.result is distinct from 'open' then
    raise exception 'a start that read another session closed did not answer the stored one: %', v_begun;
  end if;
  select * into strict v_begun from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg', 'cs_test_1');
  if (v_begun.result, v_begun.attempt, v_begun.session_id) is distinct from ('claimed'::text, 2, 'cs_test_1'::text) then
    raise exception 'a start that read the stored session closed did not claim attempt 2 to close it: %', v_begun;
  end if;
  if not public.finish_werkflow_checkout('41248000-0000-0000-0000-000000000010', 2) then
    raise exception 'the attempt after a closed session did not end its claim';
  end if;

end;
$$;

-- The service role writes no row directly; the test moves the clock of the stored session as the owner.
reset role;
update public.werkflow_subscriptions set checkout_expires_at = now() + interval '10 minutes'
where organization_id = '41248000-0000-0000-0000-000000000010';
set local role service_role;

do $$
declare
  v_begun record;
begin
  -- Near its expiry the next start claims attempt 2 and names the session to close.
  select * into strict v_begun from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg');
  if (v_begun.result, v_begun.attempt, v_begun.session_id) is distinct from ('claimed'::text, 3, 'cs_test_1'::text) then
    raise exception 'a start near the expiry did not claim attempt 3 with the session to close: %', v_begun;
  end if;
  -- A failed attempt ends its claim and keeps the stored session; a stale attempt stores nothing.
  if not public.finish_werkflow_checkout('41248000-0000-0000-0000-000000000010', 3) then
    raise exception 'a failed attempt did not end its claim';
  end if;
  select * into strict v_begun from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg');
  if (v_begun.result, v_begun.attempt, v_begun.session_id) is distinct from ('claimed'::text, 4, 'cs_test_1'::text) then
    raise exception 'a start after a failed attempt did not claim a new attempt: %', v_begun;
  end if;
  if public.finish_werkflow_checkout('41248000-0000-0000-0000-000000000010', 3,
      'cs_test_2', 'https://checkout.stripe.com/c/pay/cs_test_2', now() + interval '1 day') then
    raise exception 'a stale attempt stored its session';
  end if;
end;
$$;

reset role;
update public.werkflow_subscriptions set checkout_claimed_until = now() - interval '1 second'
where organization_id = '41248000-0000-0000-0000-000000000010';
set local role service_role;

do $$
declare
  v_answer text;
begin
  if public.finish_werkflow_checkout('41248000-0000-0000-0000-000000000010', 4,
      'cs_test_3', 'https://checkout.stripe.com/c/pay/cs_test_3', now() + interval '1 day') then
    raise exception 'an attempt whose claim lapsed stored its session';
  end if;
  if (select checkout_session_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'cs_test_1'
  then
    raise exception 'a refused attempt replaced the stored session';
  end if;

  -- A failed payment keeps the subscription holding.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_1', 'past_due', false, '2037-01-01T10:00:01Z');
  if v_answer is distinct from 'recorded' or not (select holds_subscription from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010')
  then
    raise exception 'a past due subscription does not hold';
  end if;
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_sonnenberg',
    'sub_test_1', 'unpaid', false, '2037-01-01T10:00:02Z', null, '2037-12-15T10:00:00Z');

  -- A slow handler's older read changes nothing.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_1', 'active', false, '2037-01-01T10:00:01Z');
  if v_answer is distinct from 'ignored' or (select status from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'unpaid'
  then
    raise exception 'an older read overwrote a newer state';
  end if;
  if not (select holds_subscription from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') then
    raise exception 'an unpaid subscription stopped holding';
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
  -- Fresh reads found both holding: the refusal marks the newcomer a duplicate under the row lock.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_3', 'active', false, '2037-01-01T10:00:06.5Z',
    p_refuse_as_duplicate => true);
  if v_answer is distinct from 'duplicate' or (select stripe_subscription_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'sub_test_1'
  then
    raise exception 'a duplicate refused after fresh reads was not marked, or replaced the holding subscription';
  end if;

  -- A subscription cancelled on request no longer holds; a new one then replaces it.
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_sonnenberg',
    'sub_test_1', 'canceled', false, '2037-01-01T10:00:07Z', 'cancellation_requested');

  -- Before the marked duplicate is cancelled, a fresh read finds the first ended:
  -- the duplicate still never becomes the subscription the organization keeps.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_3', 'active', false, '2037-01-01T10:00:07.5Z');
  if v_answer is distinct from 'duplicate' or (select stripe_subscription_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'sub_test_1'
  then
    raise exception 'a subscription marked for cancellation became the replacement';
  end if;
  -- Cancelled, but its cleanup not settled: it still answers 'duplicate', so the cleanup resumes.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_3', 'canceled', false, '2037-01-01T10:00:07.6Z', 'cancellation_requested');
  if v_answer is distinct from 'duplicate' then
    raise exception 'a cancelled duplicate with its cleanup outstanding was not answered duplicate: %', v_answer;
  end if;
  perform public.settle_werkflow_duplicate_subscription('41248000-0000-0000-0000-000000000010', 'sub_test_3');
  perform public.settle_werkflow_duplicate_subscription('41248000-0000-0000-0000-000000000010', 'sub_test_3');
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_3', 'canceled', false, '2037-01-01T10:00:07.7Z', 'cancellation_requested');
  if v_answer is distinct from 'ignored' then
    raise exception 'a settled duplicate was not ignored: %', v_answer;
  end if;
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_2', 'active', false, '2037-01-01T10:00:08Z');
  if v_answer is distinct from 'recorded' or (select stripe_subscription_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'sub_test_2'
  then
    raise exception 'a new subscription did not replace one that ended on request';
  end if;

  -- Read times order the reads of one subscription only: a later re-read of
  -- the ended sub_test_2 does not hide the replacement sub_test_4 whose read
  -- started earlier, and an old read of the ended one never comes back.
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_sonnenberg',
    'sub_test_2', 'canceled', false, '2037-01-01T10:00:20Z', 'cancellation_requested');
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_4', 'active', false, '2037-01-01T10:00:15Z');
  if v_answer is distinct from 'recorded' or (select stripe_subscription_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'sub_test_4'
  then
    raise exception 'a later read of an ended subscription hid its holding replacement';
  end if;
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_2', 'canceled', false, '2037-01-01T10:00:30Z', 'cancellation_requested');
  if v_answer is distinct from 'ignored' or (select stripe_subscription_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010') is distinct from 'sub_test_4'
  then
    raise exception 'an ended predecessor replaced its holding successor';
  end if;
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_4', 'past_due', false, '2037-01-01T10:00:14Z');
  if v_answer is distinct from 'ignored' then
    raise exception 'an older read of the followed subscription overwrote a newer one';
  end if;

  -- A holding subscription answers every start with 'subscribed'.
  if (select result from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000010',
      '41248000-0000-0000-0000-000000000001', true, 'cus_test_sonnenberg')) is distinct from 'subscribed'
  then
    raise exception 'a start while the subscription holds was not answered subscribed';
  end if;

  -- Each subscription keeps its own read time: once sub_test_4 ended, the
  -- cancellation of sub_test_5 arrives before its own earlier active read,
  -- and that stale read never makes the organization look subscribed.
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010', 'cus_test_sonnenberg',
    'sub_test_4', 'canceled', false, '2037-01-01T10:00:40Z', 'cancellation_requested');
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_5', 'canceled', false, '2037-01-01T10:00:50Z', 'cancellation_requested');
  if v_answer is distinct from 'ignored' then
    raise exception 'an ended subscription the row does not follow was recorded';
  end if;
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000010',
    'cus_test_sonnenberg', 'sub_test_5', 'active', false, '2037-01-01T10:00:45Z');
  if v_answer is distinct from 'ignored' or (select holds_subscription from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000010')
  then
    raise exception 'a stale active read brought back a cancelled subscription';
  end if;

  -- A reservation stores its customer.
  if (select stripe_customer_id from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000020',
      '41248000-0000-0000-0000-000000000003', false, 'cus_test_neu')) is distinct from 'cus_test_neu'
  then
    raise exception 'the reservation did not store its customer';
  end if;
end;
$$;

-- A person holds one open reservation.
select pg_temp.expect_refusal('a second open reservation', $sql$
  select public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000021',
    '41248000-0000-0000-0000-000000000003', false, 'cus_test_neu_2')
$sql$, 'reservation_refused');

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

-- werk-flow/werkflow-planning#495: a restart after a failed first debit, the
-- duplicate cleanup's records, and subscriptions whose owner is gone.
reset role;
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('41248000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'abo-weg@example.test', '', now(), '{}',
 '{"first_name":"Willi","last_name":"Weg"}', now(), now());
insert into public.organizations (id, name, admin_id, unique_code) values
('41248000-0000-0000-0000-000000000030', 'Heizungsbau Talblick GmbH',
  '41248000-0000-0000-0000-000000000001', 'ABOSQL07');

set local role service_role;
do $$
declare
  v_answer text;
begin
  perform public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000030',
    '41248000-0000-0000-0000-000000000001', true, 'cus_test_talblick');
  perform public.finish_werkflow_checkout('41248000-0000-0000-0000-000000000030', 1);
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000030',
    'cus_test_talblick', 'sub_test_r1', 'active', false, '2037-01-01T11:00:01Z');
  if not (select runs_subscription from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000030') then
    raise exception 'an active subscription does not run';
  end if;
  -- Stripe ends the subscription after its first debit failed: it holds, no longer runs, and blocks no Checkout.
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000030',
    'cus_test_talblick', 'sub_test_r1', 'canceled', false, '2037-01-01T11:00:02Z', 'payment_failed');
  if (select (holds_subscription, runs_subscription) from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000030') is distinct from (true, false)
  then
    raise exception 'a subscription ended after a failed first debit did not hold without running';
  end if;
  if (select result from public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000030',
      '41248000-0000-0000-0000-000000000001', true, 'cus_test_talblick')) is distinct from 'claimed'
  then
    raise exception 'a start after a failed first debit did not claim a new Checkout';
  end if;
  -- Its restart replaces it; a third subscription while the restart runs is refused.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000030',
    'cus_test_talblick', 'sub_test_r2', 'active', false, '2037-01-01T11:00:03Z');
  if v_answer is distinct from 'recorded' or (select stripe_subscription_id from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000030') is distinct from 'sub_test_r2'
  then
    raise exception 'the restart after a failed first debit did not replace the ended subscription';
  end if;
  begin
    perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000030',
      'cus_test_talblick', 'sub_test_r3', 'active', false, '2037-01-01T11:00:04Z');
    raise exception 'a second subscription while the restart runs was not refused';
  exception when others then
    if sqlerrm is distinct from 'subscription_conflict' then raise; end if;
  end;

  -- A refund of a marked duplicate that failed is recorded once, against the duplicate and its payment.
  perform public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000030',
    'cus_test_talblick', 'sub_test_r3', 'active', false, '2037-01-01T11:00:05Z', p_refuse_as_duplicate => true);
  if not public.record_werkflow_refund_failure('41248000-0000-0000-0000-000000000030',
      'sub_test_r3', 're_test_1', 'pi_test_1')
    or public.record_werkflow_refund_failure('41248000-0000-0000-0000-000000000030',
      'sub_test_r3', 're_test_1', 'pi_test_1')
  then
    raise exception 'a failed refund was not recorded exactly once';
  end if;
  if (select failed_duplicate_refunds -> 0 ->> 'payment_intent' from public.werkflow_subscriptions
      where organization_id = '41248000-0000-0000-0000-000000000030') is distinct from 'pi_test_1'
  then
    raise exception 'a failed refund was not recorded against its payment';
  end if;
end;
$$;

select pg_temp.expect_refusal('a refund failure of a subscription not marked', $sql$
  select public.record_werkflow_refund_failure('41248000-0000-0000-0000-000000000030',
    'sub_test_r2', 're_test_2', 'pi_test_2')
$sql$, 'duplicate_unknown');
select pg_temp.expect_refusal('settling a subscription not marked', $sql$
  select public.settle_werkflow_duplicate_subscription('41248000-0000-0000-0000-000000000030', 'sub_test_r2')
$sql$, 'duplicate_unknown');

-- The two new alarms reach the mail ledger.
do $$
begin
  if public.claim_werkflow_billing_mail('alarm.duplicate_subscription_cancelled', null,
      'alarm@example.test', 'sub_test_r3') is null
    or public.claim_werkflow_billing_mail('alarm.refund_failed', null, 'alarm@example.test', 're_test_1') is null
  then
    raise exception 'the mail ledger refused a new alarm kind';
  end if;
end;
$$;

-- The organization and an account with a paid reservation are deleted.
set local role service_role;
select public.begin_werkflow_checkout('41248000-0000-0000-0000-000000000040',
  '41248000-0000-0000-0000-000000000004', false, 'cus_test_weg');
reset role;
delete from public.organizations where id = '41248000-0000-0000-0000-000000000030';
delete from auth.users where id = '41248000-0000-0000-0000-000000000004';
set local role service_role;

do $$
declare
  v_answer text;
begin
  -- The stored subscription, cancelled before the deletion, is recorded as usual.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000030',
    'cus_test_talblick', 'sub_test_r2', 'canceled', false, '2037-01-01T11:00:06Z', 'cancellation_requested');
  if v_answer is distinct from 'recorded' then
    raise exception 'the cancellation before the deletion was not recorded: %', v_answer;
  end if;
  -- A subscription that still runs for the deleted organization or account is marked a duplicate.
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000030',
    'cus_test_talblick', 'sub_test_r4', 'active', false, '2037-01-01T11:00:07Z');
  if v_answer is distinct from 'duplicate' then
    raise exception 'a subscription of a deleted organization was not marked a duplicate: %', v_answer;
  end if;
  v_answer := public.record_werkflow_subscription_state('41248000-0000-0000-0000-000000000040',
    'cus_test_weg', 'sub_test_r5', 'active', false, '2037-01-01T11:00:08Z');
  if v_answer is distinct from 'duplicate' then
    raise exception 'a subscription of a deleted account''s reservation was not marked a duplicate: %', v_answer;
  end if;
end;
$$;

rollback;
