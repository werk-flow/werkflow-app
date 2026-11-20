-- WerkFlow's own invoice originals (werk-flow/werkflow-planning#249). Only the
-- service role issues one, once per Stripe invoice: a replay answers
-- 'already_issued' and changes nothing, an unknown organization is refused.
-- An issued row never changes: UPDATE, DELETE and TRUNCATE are refused, also
-- for the owner. The organization's Admin reads its rows; Büro, an employee
-- and another organization's Admin read none, and no client writes. The row
-- is kept until the end of the tenth year after its issue year, and deleting
-- the organization keeps it.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('24900000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'werkflow-invoice-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Rechnung"}', now(), now()),
('24900000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'werkflow-invoice-office@example.test', '', now(), '{}',
 '{"first_name":"Office","last_name":"Rechnung"}', now(), now()),
('24900000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'werkflow-invoice-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Rechnung"}', now(), now()),
('24900000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'werkflow-invoice-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Rechnung"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('24900000-0000-0000-0000-000000000010', 'Haustechnik Sonnenberg', '24900000-0000-0000-0000-000000000001', 'WFINVAA1'),
('24900000-0000-0000-0000-000000000011', 'Fremdfirma', '24900000-0000-0000-0000-000000000004', 'WFINVBB1');
insert into public.organization_members (organization_id, user_id, role) values
('24900000-0000-0000-0000-000000000010', '24900000-0000-0000-0000-000000000002', 'buero'),
('24900000-0000-0000-0000-000000000010', '24900000-0000-0000-0000-000000000003', 'employee');

create function pg_temp.issue(p_organization uuid, p_invoice text, p_number text) returns text
language sql as $$
  select public.issue_werkflow_invoice(
    p_organization, p_invoice, 'cus_test_0001', 'evt_test_0001', p_number, date '2037-11-15',
    '{"name":"Haustechnik Sonnenberg GmbH"}'::jsonb, 'direct-debit', 49900, 0, 49900, 0, 49900,
    'werkflow-billing/invoices/' || p_invoice || '/' || repeat('a', 64) || '.pdf', repeat('a', 64), 1024, '1.3.17'
  );
$$;

create function pg_temp.expect_refusal(p_label text, p_sql text, p_message text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception '% was accepted', p_label;
exception when others then
  if sqlerrm not like '%' || p_message || '%' then
    raise exception '% failed with "%" instead of "%"', p_label, sqlerrm, p_message;
  end if;
end;
$$;
grant execute on function pg_temp.issue(uuid, text, text) to service_role;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- Only the service role issues, once per Stripe invoice.
set local role service_role;
do $$
begin
  if pg_temp.issue('24900000-0000-0000-0000-000000000010', 'in_test_0001', 'MUSTER-0001') is distinct from 'issued' then
    raise exception 'the first issue did not issue';
  end if;
  if pg_temp.issue('24900000-0000-0000-0000-000000000010', 'in_test_0001', 'MUSTER-0001') is distinct from 'already_issued' then
    raise exception 'a replayed issue did not answer already_issued';
  end if;
  if (select count(*) from public.werkflow_invoices where stripe_invoice_id = 'in_test_0001') is distinct from 1 then
    raise exception 'a replayed issue wrote a second row';
  end if;
  perform pg_temp.expect_refusal('an unknown organization',
    $sql$select pg_temp.issue('24900000-0000-0000-0000-0000000000ff', 'in_test_0002', 'MUSTER-0002')$sql$,
    'werkflow_invoice_organization_unknown');
  perform pg_temp.expect_refusal('a second invoice with the same number',
    $sql$select pg_temp.issue('24900000-0000-0000-0000-000000000010', 'in_test_0003', 'MUSTER-0001')$sql$,
    'werkflow_invoices_number_key');
  perform pg_temp.expect_refusal('a service-role update',
    'update public.werkflow_invoices set gross_cents = 1', 'permission denied');
  perform pg_temp.expect_refusal('a service-role delete',
    'delete from public.werkflow_invoices', 'permission denied');
end;
$$;
reset role;

-- The guard holds for the owner too.
do $$
begin
  perform pg_temp.expect_refusal('an owner update',
    $sql$update public.werkflow_invoices set number = 'MUSTER-9999'$sql$, 'werkflow_invoice_immutable');
  perform pg_temp.expect_refusal('an owner delete',
    'delete from public.werkflow_invoices', 'werkflow_invoice_immutable');
  perform pg_temp.expect_refusal('an owner truncate',
    'truncate public.werkflow_invoices', 'werkflow_invoice_immutable');
  if (select retain_until from public.werkflow_invoices where stripe_invoice_id = 'in_test_0001')
    is distinct from date '2047-12-31' then
    raise exception 'an invoice of 2037 is not kept until the end of 2047';
  end if;
end;
$$;

-- The Admin reads the organization's rows; nobody else, and no client writes or issues.
create function pg_temp.visible_invoices(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.werkflow_invoices;
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.visible_invoices('24900000-0000-0000-0000-000000000001') is distinct from 1
    or pg_temp.visible_invoices('24900000-0000-0000-0000-000000000002') is distinct from 0
    or pg_temp.visible_invoices('24900000-0000-0000-0000-000000000003') is distinct from 0
    or pg_temp.visible_invoices('24900000-0000-0000-0000-000000000004') is distinct from 0 then
    raise exception 'a WerkFlow invoice reached someone other than its Admin';
  end if;
  if has_table_privilege('authenticated', 'public.werkflow_invoices', 'INSERT,UPDATE,DELETE')
    or has_table_privilege('anon', 'public.werkflow_invoices', 'SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege('authenticated',
      'public.issue_werkflow_invoice(uuid, text, text, text, text, date, jsonb, text, bigint, bigint, bigint, bigint, bigint, text, text, integer, text)',
      'execute')
    or has_function_privilege('anon',
      'public.issue_werkflow_invoice(uuid, text, text, text, text, date, jsonb, text, bigint, bigint, bigint, bigint, bigint, text, text, integer, text)',
      'execute') then
    raise exception 'a client role writes or issues WerkFlow invoices';
  end if;
end;
$$;

-- Deleting the customer's organization keeps WerkFlow's books.
set local role service_role;
select public.delete_organization(
  '24900000-0000-0000-0000-000000000010', '24900000-0000-0000-0000-000000000001', 'Haustechnik Sonnenberg'
);
reset role;
do $$
begin
  if exists (select 1 from public.organizations where id = '24900000-0000-0000-0000-000000000010') then
    raise exception 'the organization was not deleted';
  end if;
  if (select count(*) from public.werkflow_invoices
      where organization_id = '24900000-0000-0000-0000-000000000010') is distinct from 1 then
    raise exception 'deleting the organization removed its WerkFlow invoice';
  end if;
end;
$$;

rollback;
