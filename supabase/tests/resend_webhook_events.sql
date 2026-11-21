-- Resend's delivery signals (20261221100009_mark_bounced_billing_mails.sql,
-- werk-flow/werkflow-planning#496): no client role reads or writes
-- resend_webhook_events or runs its functions, including the organization's
-- own Admin; the service role writes only through them; a Svix id is recorded
-- once and a second record changes nothing; a bounce or complaint marks every
-- sent billing mail with its message id once, keeps the first problem, and
-- answers no row for a message the ledger never sent; the alarm kind
-- `alarm.mail_bounced` is a mail kind.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1a20000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'resend-signal-admin@example.test', '', now(),
  '{}', '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()
);
insert into public.organizations (id, name, admin_id, unique_code)
values ('b1a20000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
  'b1a20000-0000-4000-8000-000000000001', 'RSNDSIG');

-- Grants: client roles hold nothing; the service role reads and executes only.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(api_role, 'public.resend_webhook_events',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(api_role, 'public.resend_webhook_events', 'SELECT,INSERT,UPDATE') then
      raise exception '% holds a privilege on resend_webhook_events', api_role;
    end if;
    if has_function_privilege(api_role,
        'public.record_resend_webhook_event(text, text, text, timestamptz, text)', 'execute')
      or has_function_privilege(api_role,
        'public.mark_werkflow_billing_mail_undelivered(text, text)', 'execute') then
      raise exception '% may execute a Resend signal function', api_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.resend_webhook_events', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'service_role may write resend_webhook_events directly';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.resend_webhook_events'::regclass) then
    raise exception 'resend_webhook_events has a client policy';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.resend_webhook_events'::regclass) then
    raise exception 'resend_webhook_events has no row level security';
  end if;
end;
$$;

-- The organization's own Admin, signed in, meets the same denial.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"b1a20000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$
begin
  begin
    perform 1 from public.resend_webhook_events;
    raise exception 'the Admin read resend_webhook_events directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mark_werkflow_billing_mail_undelivered('resend-probe', 'bounced');
    raise exception 'the Admin executed mark_werkflow_billing_mail_undelivered';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_resend_webhook_event('msg_probe', 'email.bounced', null, now(), null);
    raise exception 'the Admin executed record_resend_webhook_event';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role service_role;
do $$
declare
  v_org constant uuid := 'b1a20000-0000-4000-8000-000000000010';
  v_mail uuid;
  v_card uuid;
  v_alarm uuid;
  v_row public.werkflow_billing_mails;
  v_first timestamptz;
  v_event public.resend_webhook_events;
  v_count integer;
begin
  begin
    insert into public.resend_webhook_events (svix_id, event_type, occurred_at)
    values ('msg_direct', 'email.bounced', now());
    raise exception 'service_role inserted into resend_webhook_events directly';
  exception when insufficient_privilege then null;
  end;

  -- A Svix id is recorded once; the second record answers false and keeps the first.
  if public.record_resend_webhook_event('msg_test0001', 'email.bounced', 'resend-0001',
      '2026-03-02T07:59:58Z', 'werkflow_billing_mails') is distinct from true then
    raise exception 'the first record of a signal was not written';
  end if;
  if public.record_resend_webhook_event('msg_test0001', 'email.complained', null, now(), null)
      is distinct from false then
    raise exception 'a second record of one Svix id was written';
  end if;
  select * into v_event from public.resend_webhook_events where svix_id = 'msg_test0001';
  if v_event.event_type is distinct from 'email.bounced' or v_event.provider_message_id is distinct from 'resend-0001'
    or v_event.ledger is distinct from 'werkflow_billing_mails' then
    raise exception 'a second record changed the first';
  end if;
  -- An unknown message and a signal without one are recorded without a ledger.
  perform public.record_resend_webhook_event('msg_test0002', 'email.bounced', 'resend-unknown', now(), null);
  perform public.record_resend_webhook_event('msg_test0003', 'domain.updated', null, now(), null);
  begin
    perform public.record_resend_webhook_event('msg_test0004', 'domain.updated', null, now(), 'werkflow_billing_mails');
    raise exception 'a ledger was recorded without a message';
  exception when check_violation then null;
  end;
  begin
    perform public.record_resend_webhook_event('msg_test0005', 'email.bounced', 'resend-0001', now(), 'document_deliveries');
    raise exception 'a ledger outside the check was recorded';
  exception when check_violation then null;
  end;
  begin
    perform public.record_resend_webhook_event('msg test', 'email.bounced', null, now(), null);
    raise exception 'a malformed Svix id was recorded';
  exception when check_violation then null;
  end;

  -- Two sent customer mails and a sent alarm.
  v_mail := public.claim_werkflow_billing_mail('payment_failed', v_org, 'rechnung@sonnenberg.example', 'in_test_0001');
  perform public.settle_werkflow_billing_mail(v_mail, v_org, 'sent', 'resend-0001');
  v_card := public.claim_werkflow_billing_mail('card_problem', v_org, 'rechnung@sonnenberg.example', 'in_test_0002');
  perform public.settle_werkflow_billing_mail(v_card, v_org, 'sent', 'resend-0002');
  v_alarm := public.claim_werkflow_billing_mail('alarm.debit_failed', null, 'alarm@example.test', 'in_test_0001');
  perform public.settle_werkflow_billing_mail(v_alarm, null, 'sent', 'resend-0003');

  -- A bounce marks its mail and answers the row; the state stays sent.
  select count(*) into v_count
  from public.mark_werkflow_billing_mail_undelivered('resend-0001', 'bounced') marked
  where marked.kind = 'payment_failed' and marked.organization_id = v_org
    and marked.stripe_object_id = 'in_test_0001' and marked.delivery_problem = 'bounced';
  if v_count is distinct from 1 then
    raise exception 'a bounce did not answer its marked mail';
  end if;
  select * into v_row from public.werkflow_billing_mails where id = v_mail;
  if v_row.state is distinct from 'sent' or v_row.delivery_problem is distinct from 'bounced'
    or v_row.delivery_problem_at is null then
    raise exception 'a bounce did not mark its sent mail';
  end if;
  v_first := v_row.delivery_problem_at;

  -- A later complaint for the same mail keeps the first problem and its time.
  select count(*) into v_count
  from public.mark_werkflow_billing_mail_undelivered('resend-0001', 'complained') marked
  where marked.delivery_problem = 'bounced';
  select * into v_row from public.werkflow_billing_mails where id = v_mail;
  if v_count is distinct from 1 or v_row.delivery_problem is distinct from 'bounced'
    or v_row.delivery_problem_at is distinct from v_first then
    raise exception 'a second signal changed the first problem';
  end if;
  -- The other mail stays unmarked; an alarm row is marked like any other.
  if (select delivery_problem from public.werkflow_billing_mails where id = v_card) is not null then
    raise exception 'a bounce marked another mail';
  end if;
  select count(*) into v_count
  from public.mark_werkflow_billing_mail_undelivered('resend-0003', 'complained') marked
  where marked.organization_id is null and marked.kind = 'alarm.debit_failed';
  if v_count is distinct from 1 then
    raise exception 'a complaint did not mark its alarm';
  end if;

  -- A message the ledger never sent answers no row and changes nothing.
  if exists (select 1 from public.mark_werkflow_billing_mail_undelivered('resend-unknown', 'bounced')) then
    raise exception 'an unknown message answered a mail';
  end if;
  begin
    perform public.mark_werkflow_billing_mail_undelivered('resend-0002', 'opened');
    raise exception 'an unknown delivery problem was accepted';
  exception when sqlstate '22023' then null;
  end;

  -- The bounce alarm is a mail kind; a problem never sits on a mail without a message id.
  v_alarm := public.claim_werkflow_billing_mail('alarm.mail_bounced', null, 'alarm@example.test',
    'payment_failed_in_test_0001');
  if v_alarm is null then
    raise exception 'the bounce alarm could not be claimed';
  end if;
end;
$$;
reset role;

do $$
begin
  update public.werkflow_billing_mails set delivery_problem = 'bounced', delivery_problem_at = now()
  where kind = 'alarm.mail_bounced';
  raise exception 'a problem was recorded on a mail without a message id';
exception when check_violation then null;
end;
$$;

rollback;
