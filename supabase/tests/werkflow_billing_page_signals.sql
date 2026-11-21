-- The billing page's live signal (werk-flow/werkflow-planning#252). A change
-- to an organization's subscription row and a newly issued invoice touch the
-- organization's signal row; only that organization's Admin reads it, no
-- client writes it, and a subscription row whose organization does not exist
-- (a reservation, or a deleted organization) signals nothing and fails nothing.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('25200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-page-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Abo"}', now(), now()),
('25200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-page-office@example.test', '', now(), '{}',
 '{"first_name":"Office","last_name":"Abo"}', now(), now()),
('25200000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-page-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Abo"}', now(), now()),
('25200000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'billing-page-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Abo"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('25200000-0000-0000-0000-000000000010', 'Haustechnik Sonnenberg', '25200000-0000-0000-0000-000000000001', 'WFABOAA1'),
('25200000-0000-0000-0000-000000000011', 'Fremdfirma', '25200000-0000-0000-0000-000000000004', 'WFABOBB1');
insert into public.organization_members (organization_id, user_id, role) values
('25200000-0000-0000-0000-000000000010', '25200000-0000-0000-0000-000000000002', 'buero'),
('25200000-0000-0000-0000-000000000010', '25200000-0000-0000-0000-000000000003', 'employee');

create function pg_temp.signals(p_organization uuid) returns bigint language sql as $$
  select count(*) from public.werkflow_billing_page_signals where organization_id = p_organization;
$$;

-- A subscription row and its changes signal the organization; a reservation signals nothing.
insert into public.werkflow_subscriptions (organization_id, linked_at, stripe_customer_id) values
('25200000-0000-0000-0000-000000000010', now(), 'cus_test_page_0001'),
('25200000-0000-0000-0000-0000000000ff', null, 'cus_test_page_0002');
do $$
begin
  if pg_temp.signals('25200000-0000-0000-0000-000000000010') is distinct from 1 then
    raise exception 'a new subscription row did not signal its organization';
  end if;
  if exists (select 1 from public.werkflow_billing_page_signals
             where organization_id = '25200000-0000-0000-0000-0000000000ff') then
    raise exception 'a reservation signalled an organization that does not exist';
  end if;
end;
$$;

-- A later change touches the same row again: its time moves forward.
update public.werkflow_billing_page_signals set updated_at = now() - interval '1 hour';
set local role service_role;
select public.record_werkflow_subscription_state(
  '25200000-0000-0000-0000-000000000010', 'cus_test_page_0001', 'sub_test_page_0001', 'active', true,
  now(), null, now() + interval '1 month'
);
reset role;
do $$
begin
  if pg_temp.signals('25200000-0000-0000-0000-000000000010') is distinct from 1 then
    raise exception 'a recorded cancellation did not signal the billing page';
  end if;
  if exists (select 1 from public.werkflow_billing_page_signals
             where organization_id = '25200000-0000-0000-0000-000000000010'
               and updated_at < now()) then
    raise exception 'a recorded cancellation did not touch the existing signal row';
  end if;
end;
$$;

-- A newly issued invoice signals the organization.
delete from public.werkflow_billing_page_signals;
set local role service_role;
select public.issue_werkflow_invoice(
  '25200000-0000-0000-0000-000000000010', 'in_test_page_0001', 'cus_test_page_0001', 'evt_test_page_0001',
  'MUSTER-PAGE-0001', date '2037-11-15', '{"name":"Haustechnik Sonnenberg GmbH"}'::jsonb, 'direct-debit',
  49900, 0, 49900, 0, 49900,
  'werkflow-billing/invoices/in_test_page_0001/' || repeat('d', 64) || '.pdf', repeat('d', 64), 1024, '1.3.17'
);
reset role;
do $$
begin
  if pg_temp.signals('25200000-0000-0000-0000-000000000010') is distinct from 1 then
    raise exception 'an issued invoice did not signal the billing page';
  end if;
end;
$$;

-- Only the organization's Admin reads the signal; no client writes it.
create function pg_temp.visible_signals(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.werkflow_billing_page_signals;
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.visible_signals('25200000-0000-0000-0000-000000000001') is distinct from 1
    or pg_temp.visible_signals('25200000-0000-0000-0000-000000000002') is distinct from 0
    or pg_temp.visible_signals('25200000-0000-0000-0000-000000000003') is distinct from 0
    or pg_temp.visible_signals('25200000-0000-0000-0000-000000000004') is distinct from 0 then
    raise exception 'the billing page signal reached someone other than its Admin';
  end if;
  if has_table_privilege('authenticated', 'public.werkflow_billing_page_signals', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.werkflow_billing_page_signals', 'SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated', 'app_private.signal_werkflow_billing_page()', 'execute') then
    raise exception 'a client role writes the billing page signal';
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'werkflow_billing_page_signals') then
    raise exception 'the billing page signal is not published';
  end if;
end;
$$;

-- A change after the organization's deletion signals nothing and fails nothing.
set local role service_role;
select public.delete_organization(
  '25200000-0000-0000-0000-000000000010', '25200000-0000-0000-0000-000000000001', 'Haustechnik Sonnenberg'
);
select public.record_werkflow_subscription_state(
  '25200000-0000-0000-0000-000000000010', 'cus_test_page_0001', 'sub_test_page_0001', 'canceled', false,
  now() + interval '1 second', 'cancellation_requested', now() + interval '1 month'
);
reset role;
do $$
begin
  if pg_temp.signals('25200000-0000-0000-0000-000000000010') is distinct from 0 then
    raise exception 'a deleted organization kept or regained a billing page signal';
  end if;
end;
$$;

rollback;
