-- Stripe's signals (20261215100000_record_each_stripe_signal_once.sql,
-- werk-flow/werkflow-planning#250): no client role reads or writes the table
-- or runs its functions, the service role writes only through them, a first
-- delivery claims the event, a second one while the claim holds is busy, a
-- failed attempt releases the claim for the next delivery, and a settled
-- event is never claimed again and keeps every column.
-- Runs inside one transaction against the local stack and rolls back.
begin;

-- Grants: client roles hold nothing; the service role reads and executes only.
do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(api_role, 'public.werkflow_billing_signals',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
      or has_any_column_privilege(api_role, 'public.werkflow_billing_signals', 'SELECT,INSERT,UPDATE') then
      raise exception '% holds a privilege on werkflow_billing_signals', api_role;
    end if;
    if has_function_privilege(api_role,
        'public.claim_werkflow_billing_signal(text, text, timestamptz)', 'execute') then
      raise exception '% may execute claim_werkflow_billing_signal', api_role;
    end if;
    if has_function_privilege(api_role,
        'public.settle_werkflow_billing_signal(text, text, text)', 'execute') then
      raise exception '% may execute settle_werkflow_billing_signal', api_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.werkflow_billing_signals', 'INSERT,UPDATE,DELETE,TRUNCATE') then
    raise exception 'service_role may write werkflow_billing_signals directly';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.werkflow_billing_signals'::regclass) then
    raise exception 'werkflow_billing_signals has a client policy';
  end if;
end;
$$;

-- The real denials, as the Data API roles would meet them.
set local role anon;
do $$
begin
  begin
    perform 1 from public.werkflow_billing_signals;
    raise exception 'anon read werkflow_billing_signals';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_werkflow_billing_signal('evt_test_client_probe', 'invoice.paid', now());
    raise exception 'anon executed claim_werkflow_billing_signal';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.werkflow_billing_signals;
    raise exception 'authenticated read werkflow_billing_signals';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.werkflow_billing_signals (stripe_event_id, event_type, stripe_created_at)
    values ('evt_test_client_probe', 'invoice.paid', now());
    raise exception 'authenticated inserted into werkflow_billing_signals';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_werkflow_billing_signal('evt_test_client_probe', 'invoice.paid', now());
    raise exception 'authenticated executed claim_werkflow_billing_signal';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.settle_werkflow_billing_signal('evt_test_client_probe', 'handled');
    raise exception 'authenticated executed settle_werkflow_billing_signal';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- The service role: claim, busy, failure, reclaim, settle, replay.
set local role service_role;
do $$
declare
  v_event constant text := 'evt_test_signal_once_1';
  v_created constant timestamptz := date_trunc('second', now()) - interval '1 hour';
  v_before public.werkflow_billing_signals;
  v_after public.werkflow_billing_signals;
begin
  begin
    insert into public.werkflow_billing_signals (stripe_event_id, event_type, stripe_created_at)
    values ('evt_test_service_probe', 'invoice.paid', now());
    raise exception 'service_role inserted into werkflow_billing_signals directly';
  exception when insufficient_privilege then null;
  end;

  if public.claim_werkflow_billing_signal(v_event, 'invoice.paid', v_created) is distinct from 'claimed' then
    raise exception 'the first delivery did not claim its event';
  end if;
  if public.claim_werkflow_billing_signal(v_event, 'invoice.paid', v_created) is distinct from 'busy' then
    raise exception 'a second delivery claimed an event while the first held it';
  end if;
  select * into v_after from public.werkflow_billing_signals where stripe_event_id = v_event;
  if v_after.attempts is distinct from 1 or v_after.state is distinct from 'pending'
    or v_after.stripe_created_at is distinct from v_created then
    raise exception 'a busy delivery changed the claimed event: % attempts, state %', v_after.attempts, v_after.state;
  end if;

  if public.settle_werkflow_billing_signal(v_event, 'failed', 'handler_failed') is distinct from true then
    raise exception 'a failed attempt did not release its claim';
  end if;
  select * into v_after from public.werkflow_billing_signals where stripe_event_id = v_event;
  if v_after.claimed_until is not null or v_after.last_failure_code is distinct from 'handler_failed'
    or v_after.settled_at is not null then
    raise exception 'a failed attempt left a claim, lost its code or settled the event';
  end if;

  if public.claim_werkflow_billing_signal(v_event, 'invoice.paid', v_created) is distinct from 'claimed' then
    raise exception 'the delivery after a failure did not claim the event again';
  end if;
  if public.settle_werkflow_billing_signal(v_event, 'handled') is distinct from true then
    raise exception 'the handled attempt did not settle its event';
  end if;

  select * into v_before from public.werkflow_billing_signals where stripe_event_id = v_event;
  if v_before.state is distinct from 'handled' or v_before.attempts is distinct from 2
    or v_before.settled_at is null or v_before.claimed_until is not null then
    raise exception 'the handled event did not record its outcome and attempts';
  end if;
  if public.claim_werkflow_billing_signal(v_event, 'invoice.paid', v_created) is distinct from 'settled' then
    raise exception 'a replayed handled event was claimed again';
  end if;
  if public.settle_werkflow_billing_signal(v_event, 'failed', 'late_failure') is distinct from false then
    raise exception 'a late settle changed a handled event';
  end if;
  select * into v_after from public.werkflow_billing_signals where stripe_event_id = v_event;
  if v_after is distinct from v_before then
    raise exception 'a replayed handled event changed its row';
  end if;

  if public.claim_werkflow_billing_signal('evt_test_signal_once_2', 'customer.created', v_created)
      is distinct from 'claimed'
    or public.settle_werkflow_billing_signal('evt_test_signal_once_2', 'ignored') is distinct from true
    or public.claim_werkflow_billing_signal('evt_test_signal_once_2', 'customer.created', v_created)
      is distinct from 'settled' then
    raise exception 'an ignored event was not settled for good';
  end if;

  begin
    perform public.settle_werkflow_billing_signal('evt_test_signal_once_2', 'handled', 'handler_failed');
    raise exception 'a handled outcome accepted a failure code';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.claim_werkflow_billing_signal('not-an-event', 'invoice.paid', v_created);
    raise exception 'the table accepted an id that is not a Stripe event id';
  exception when check_violation then null;
  end;
end;
$$;
reset role;

-- A claim that outlived its attempt ends, and the next delivery claims again.
do $$
declare v_event constant text := 'evt_test_signal_once_3';
begin
  perform public.claim_werkflow_billing_signal(v_event, 'invoice.paid', now());
  update public.werkflow_billing_signals set claimed_until = now() - interval '1 second'
  where stripe_event_id = v_event;
  if public.claim_werkflow_billing_signal(v_event, 'invoice.paid', now()) is distinct from 'claimed' then
    raise exception 'an expired claim kept the next delivery out';
  end if;
end;
$$;

rollback;
