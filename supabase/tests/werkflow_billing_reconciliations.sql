-- The invoice mails and the daily comparison
-- (20261215100004_mail_werkflow_invoices_and_compare_daily.sql,
-- werk-flow/werkflow-planning#492): the mail ledger takes the debit notice,
-- the invoice, the receipt and the five new alarms, and still refuses an
-- unknown kind; no client role reads or writes the comparison's runs, and the
-- service role only reads them and adds one.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'b1a20000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'billing-run-admin@example.test', '', now(),
  '{}', '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()
);
insert into public.organizations (id, name, admin_id, unique_code)
values ('b1a20000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg GmbH',
  'b1a20000-0000-4000-8000-000000000001', 'BILRUN');

do $$
declare api_role text;
begin
  foreach api_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(api_role, 'public.werkflow_billing_reconciliations',
        'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
      raise exception '% holds a privilege on werkflow_billing_reconciliations', api_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.werkflow_billing_reconciliations', 'UPDATE,DELETE,TRUNCATE')
    or not has_table_privilege('service_role', 'public.werkflow_billing_reconciliations', 'SELECT,INSERT') then
    raise exception 'service_role must only read and add comparison runs';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.werkflow_billing_reconciliations'::regclass)
    or exists (select 1 from pg_policy where polrelid = 'public.werkflow_billing_reconciliations'::regclass) then
    raise exception 'werkflow_billing_reconciliations needs RLS without a client policy';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  v_org constant uuid := 'b1a20000-0000-4000-8000-000000000010';
  v_kind text;
begin
  foreach v_kind in array array['debit_notice', 'invoice', 'receipt'] loop
    if public.claim_werkflow_billing_mail(v_kind, v_org, 'rechnung@sonnenberg.example', 'in_test_run_0001') is null then
      raise exception 'the % mail was not claimed', v_kind;
    end if;
  end loop;
  foreach v_kind in array array['alarm.invoice_undelivered', 'alarm.debit_notice_late', 'alarm.mail_undelivered',
      'alarm.signals_quiet', 'alarm.reconciliation_missed'] loop
    if public.claim_werkflow_billing_mail(v_kind, null, 'alarm@example.test', 'in_test_run_0001') is null then
      raise exception 'the % alarm was not claimed', v_kind;
    end if;
  end loop;
  begin
    perform public.claim_werkflow_billing_mail('refund', v_org, 'rechnung@sonnenberg.example', 'in_test_run_0002');
    raise exception 'an unknown mail kind was claimed';
  exception when check_violation then null;
  end;

  insert into public.werkflow_billing_reconciliations (invoices_compared, mails_resent, alarms_raised, complete)
  values (3, 1, 2, true);
  begin
    update public.werkflow_billing_reconciliations set complete = false;
    raise exception 'service_role changed a recorded run';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

rollback;
