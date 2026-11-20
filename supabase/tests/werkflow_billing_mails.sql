-- WerkFlow's billing mails and alarms (20261215100002_record_each_billing_mail_once.sql,
-- werk-flow/werkflow-planning#251): no client role reads or writes the table
-- or runs its functions, including the organization's own Admin; the service
-- role writes only through them; a customer mail names its organization and
-- an alarm none; one row per kind and Stripe object; a failed send keeps its
-- code and is claimed again; a sent row is never claimed or changed again; an
-- organization's deletion removes its mail rows.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1a10000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'billing-mail-admin@example.test', '', now(),
  '{}', '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()
);
insert into public.organizations (id, name, admin_id, unique_code)
values ('b1a10000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
  'b1a10000-0000-4000-8000-000000000001', 'BILMAIL');

-- Grants: client roles hold nothing; the service role reads and executes only.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(api_role, 'public.werkflow_billing_mails',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(api_role, 'public.werkflow_billing_mails', 'SELECT,INSERT,UPDATE') then
      raise exception '% holds a privilege on werkflow_billing_mails', api_role;
    end if;
    if has_function_privilege(api_role, 'public.claim_werkflow_billing_mail(text, uuid, text, text)', 'execute')
      or has_function_privilege(api_role,
        'public.settle_werkflow_billing_mail(uuid, uuid, text, text, text)', 'execute') then
      raise exception '% may execute a billing mail function', api_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.werkflow_billing_mails', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'service_role may write werkflow_billing_mails directly';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.werkflow_billing_mails'::regclass) then
    raise exception 'werkflow_billing_mails has a client policy';
  end if;
end;
$$;

-- The organization's own Admin, signed in, meets the same denial.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1a10000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  begin
    perform 1 from public.werkflow_billing_mails;
    raise exception 'the Admin read werkflow_billing_mails directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_werkflow_billing_mail('payment_failed', 'b1a10000-0000-4000-8000-000000000010',
      'rechnung@sonnenberg.example', 'in_test_client_probe');
    raise exception 'the Admin executed claim_werkflow_billing_mail';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role service_role;
do $$
declare
  v_org constant uuid := 'b1a10000-0000-4000-8000-000000000010';
  v_mail uuid;
  v_alarm uuid;
  v_retry uuid;
  v_before public.werkflow_billing_mails;
  v_after public.werkflow_billing_mails;
begin
  begin
    insert into public.werkflow_billing_mails (kind, organization_id, recipient, stripe_object_id)
    values ('payment_failed', v_org, 'rechnung@sonnenberg.example', 'in_test_service_probe');
    raise exception 'service_role inserted into werkflow_billing_mails directly';
  exception when insufficient_privilege then null;
  end;

  -- The organization rule: a customer mail names one, an alarm none.
  begin
    perform public.claim_werkflow_billing_mail('payment_failed', null, 'rechnung@sonnenberg.example', 'in_test_0001');
    raise exception 'a customer mail was claimed without its organization';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.claim_werkflow_billing_mail('alarm.debit_failed', v_org, 'alarm@example.test', 'in_test_0001');
    raise exception 'an alarm was claimed with an organization';
  exception when sqlstate '22023' then null;
  end;

  -- First claim, a refused send, the claim after it, the sent settle.
  v_mail := public.claim_werkflow_billing_mail('payment_failed', v_org, 'rechnung@sonnenberg.example', 'in_test_0001');
  if v_mail is null then
    raise exception 'the first claim answered no mail to send';
  end if;
  if public.settle_werkflow_billing_mail(v_mail, v_org, 'failed', null, 'email_daily_quota_exceeded')
      is distinct from true then
    raise exception 'a refused send was not recorded';
  end if;
  select * into v_after from public.werkflow_billing_mails where id = v_mail;
  if v_after.state is distinct from 'failed' or v_after.failure_code is distinct from 'email_daily_quota_exceeded' then
    raise exception 'a refused send lost its state or reason';
  end if;

  v_retry := public.claim_werkflow_billing_mail('payment_failed', v_org, 'neu@sonnenberg.example', 'in_test_0001');
  if v_retry is distinct from v_mail then
    raise exception 'the retry did not claim the same failed mail';
  end if;
  if public.settle_werkflow_billing_mail(v_mail, v_org, 'sent', 'resend-0001') is distinct from true then
    raise exception 'the retried send was not recorded as sent';
  end if;
  select * into v_before from public.werkflow_billing_mails where id = v_mail;
  if v_before.state is distinct from 'sent' or v_before.attempts is distinct from 2
    or v_before.recipient is distinct from 'neu@sonnenberg.example' or v_before.failure_code is not null
    or v_before.sent_at is null then
    raise exception 'the sent mail did not keep its attempts, newest recipient and message id';
  end if;

  -- A sent mail is never claimed for sending or changed again.
  if public.claim_werkflow_billing_mail('payment_failed', v_org, 'dritte@sonnenberg.example', 'in_test_0001')
      is not null then
    raise exception 'a sent mail was claimed again';
  end if;
  if public.settle_werkflow_billing_mail(v_mail, v_org, 'failed', null, 'late_failure') is distinct from false then
    raise exception 'a late settle changed a sent mail';
  end if;
  select * into v_after from public.werkflow_billing_mails where id = v_mail;
  if v_after is distinct from v_before then
    raise exception 'a sent mail changed its row';
  end if;

  -- An alarm has no organization; another organization's id settles nothing.
  v_alarm := public.claim_werkflow_billing_mail('alarm.debit_failed', null, 'alarm@example.test', 'in_test_0001');
  if public.settle_werkflow_billing_mail(v_alarm, v_org, 'sent', 'resend-0002') is distinct from false then
    raise exception 'an alarm was settled under an organization';
  end if;
  begin
    perform public.settle_werkflow_billing_mail(v_alarm, null, 'sent', null);
    raise exception 'a sent outcome without a message id was accepted';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.claim_werkflow_billing_mail('newsletter', v_org, 'rechnung@sonnenberg.example', 'in_test_0001');
    raise exception 'an unknown mail kind was accepted';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

-- An organization's deletion removes its mail rows; alarms stay.
delete from public.organizations where id = 'b1a10000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.werkflow_billing_mails
      where organization_id = 'b1a10000-0000-4000-8000-000000000010')
    or not exists (select 1 from public.werkflow_billing_mails
      where organization_id is not distinct from null and stripe_object_id = 'in_test_0001') then
    raise exception 'the deletion kept a customer mail row or removed an alarm';
  end if;
end;
$$;

rollback;
