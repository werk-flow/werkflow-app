-- Admin and Büro draft a Rechnung with its lines, terms and totals
-- (migration 20261219100000_keep_invoice_drafts_with_their_lines_and_totals.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38050000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'invoice-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38050000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'invoice-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38050000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'invoice-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38050000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'invoice-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38050000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Rechnungen', '38050000-0000-4000-8000-000000000001', 'INVSQLA'),
('38050000-0000-4000-8000-000000000011', 'Fremde Haustechnik Rechnungen', '38050000-0000-4000-8000-000000000004', 'INVSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('38050000-0000-4000-8000-000000000010', '38050000-0000-4000-8000-000000000002', 'buero'),
('38050000-0000-4000-8000-000000000010', '38050000-0000-4000-8000-000000000003', 'employee');

-- 20: the customer, 21: its Hausverwaltung, 22: archived, 29: another organization's.
insert into public.clients (id, organization_id, name, client_type, address, archived_at) values
('38050000-0000-4000-8000-000000000020', '38050000-0000-4000-8000-000000000010',
 'WEG Lindenstraße 5', 'gewerblich', 'Lindenstraße 5, 10115 Berlin', null),
('38050000-0000-4000-8000-000000000021', '38050000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin', null),
('38050000-0000-4000-8000-000000000022', '38050000-0000-4000-8000-000000000010',
 'Alte Kundin', 'privat', null, now()),
('38050000-0000-4000-8000-000000000029', '38050000-0000-4000-8000-000000000011',
 'Fremde Kundin', 'privat', null, null);
-- 50: the customer's job, 51: the Hausverwaltung's, 59: another organization's.
insert into public.jobs (id, organization_id, title, job_number, client_id, status, created_by) values
('38050000-0000-4000-8000-000000000050', '38050000-0000-4000-8000-000000000010', 'Heizung tauschen',
 'R-80', '38050000-0000-4000-8000-000000000020', 'nicht_bearbeitet', '38050000-0000-4000-8000-000000000002'),
('38050000-0000-4000-8000-000000000051', '38050000-0000-4000-8000-000000000010', 'Zähler ablesen',
 'R-81', '38050000-0000-4000-8000-000000000021', 'nicht_bearbeitet', '38050000-0000-4000-8000-000000000002'),
('38050000-0000-4000-8000-000000000059', '38050000-0000-4000-8000-000000000011', 'Fremder Auftrag',
 'R-89', '38050000-0000-4000-8000-000000000029', 'nicht_bearbeitet', '38050000-0000-4000-8000-000000000004');
-- The office chose the Hausverwaltung as the job's Rechnungsempfänger (E10).
select app_private.record_work_billing_parties('38050000-0000-4000-8000-000000000010', 'job',
  '38050000-0000-4000-8000-000000000050', '38050000-0000-4000-8000-000000000020',
  '38050000-0000-4000-8000-000000000021', 'buero', '38050000-0000-4000-8000-000000000002');

create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm is distinct from p_refusal and sqlstate is distinct from p_refusal then
      raise exception '% refused with % (%) instead of %', p_label, sqlerrm, sqlstate, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role, authenticated;

-- Grants: lines, history and every function are server-only; a signed-in role may only select invoices.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.invoices', 'INSERT')
      or has_table_privilege(v_role, 'public.invoices', 'UPDATE')
      or has_table_privilege(v_role, 'public.invoices', 'DELETE')
      or has_table_privilege(v_role, 'public.invoice_lines', 'SELECT')
      or has_table_privilege(v_role, 'public.invoice_lines', 'INSERT')
      or has_table_privilege(v_role, 'public.invoice_events', 'SELECT')
      or has_table_privilege(v_role, 'public.invoice_events', 'INSERT') then
      raise exception '% holds a write, line or history privilege on invoices', v_role;
    end if;
    if has_function_privilege(v_role, 'public.create_invoice(uuid,uuid,uuid,uuid,text,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.save_invoice_draft(uuid,uuid,uuid,integer,uuid,jsonb,jsonb,jsonb)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.delete_invoice_draft(uuid,uuid,uuid,integer,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_invoice_page(uuid,text,text,integer,integer)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.get_invoice(uuid,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'app_private.invoice_attempt(uuid,uuid,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'app_private.lock_invoice_draft(uuid,uuid,integer)', 'EXECUTE') then
      raise exception '% can execute an invoice function', v_role;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.invoices', 'SELECT') then
    raise exception 'anon can select invoices';
  end if;
  if has_table_privilege('service_role', 'public.invoice_events', 'UPDATE')
    or has_table_privilege('service_role', 'public.invoice_events', 'DELETE')
    or has_table_privilege('service_role', 'public.invoice_lines', 'UPDATE') then
    raise exception 'service_role can rewrite invoice lines or history';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.invoices'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.invoice_lines'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.invoice_events'::regclass) then
    raise exception 'an invoice table runs without RLS';
  end if;
end;
$$;

set local role service_role;

-- A draft for a job takes the job's current Rechnungsempfänger; one without
-- a work takes the customer.
select public.create_invoice('38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
  '38050000-0000-4000-8000-000000000101', '38050000-0000-4000-8000-000000000020', 'job',
  '38050000-0000-4000-8000-000000000050');
select public.create_invoice('38050000-0000-4000-8000-000000000001', '38050000-0000-4000-8000-000000000010',
  '38050000-0000-4000-8000-000000000102', '38050000-0000-4000-8000-000000000020', null, null);
create temp table ids on commit drop as
select
  (select invoice_id from public.invoice_events where attempt_key = '38050000-0000-4000-8000-000000000101') as job_draft,
  (select invoice_id from public.invoice_events where attempt_key = '38050000-0000-4000-8000-000000000102') as free_draft;
grant select on ids to service_role, authenticated;

do $$
declare
  v_job public.invoices;
  v_free public.invoices;
begin
  select * into v_job from public.invoices where id = (select job_draft from ids);
  select * into v_free from public.invoices where id = (select free_draft from ids);
  if v_job.status is distinct from 'entwurf' or v_job.invoice_number is not null
    or v_job.client_id is distinct from '38050000-0000-4000-8000-000000000020'::uuid
    or v_job.recipient_client_id is distinct from '38050000-0000-4000-8000-000000000021'::uuid
    or v_job.job_id is distinct from '38050000-0000-4000-8000-000000000050'::uuid
    or v_job.payment_due_days is distinct from 14 or v_job.gross_cents is distinct from 0::bigint
    or v_job.version is distinct from 1 then
    raise exception 'the job draft is %', to_jsonb(v_job);
  end if;
  if v_free.recipient_client_id is distinct from '38050000-0000-4000-8000-000000000020'::uuid
    or num_nonnulls(v_free.job_id, v_free.project_id, v_free.service_case_id) is distinct from 0 then
    raise exception 'the draft without a work is %', to_jsonb(v_free);
  end if;
  if (select count(*) from public.invoice_events where organization_id = '38050000-0000-4000-8000-000000000010'
      and event_type = 'created') is distinct from 2::bigint then
    raise exception 'a create wrote no created event';
  end if;
  -- A retried create under the same key returns the first draft and writes nothing.
  if public.create_invoice('38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
      '38050000-0000-4000-8000-000000000101', '38050000-0000-4000-8000-000000000020', 'job',
      '38050000-0000-4000-8000-000000000050') is distinct from v_job.id
    or (select count(*) from public.invoices where organization_id = '38050000-0000-4000-8000-000000000010')
      is distinct from 2::bigint then
    raise exception 'a retried create wrote a second draft';
  end if;
end;
$$;

-- Refusals write nothing: another organization's customer or job, another
-- customer's job, an archived customer, an employee, an outsider, Büro of
-- another organization, a key another call used.
select pg_temp.expect_refusal(label, format(
  'select public.create_invoice(%L, %L, %L, %L, %L, %L)', actor, org, attempt, client, work_kind, work_id), refusal)
from (values
  ('foreign customer', '38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
   gen_random_uuid(), '38050000-0000-4000-8000-000000000029', null, null, 'client_not_found'),
  ('foreign job', '38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
   gen_random_uuid(), '38050000-0000-4000-8000-000000000020', 'job', '38050000-0000-4000-8000-000000000059', 'work_not_found'),
  ('another customer''s job', '38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
   gen_random_uuid(), '38050000-0000-4000-8000-000000000020', 'job', '38050000-0000-4000-8000-000000000051', 'work_not_found'),
  ('archived customer', '38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
   gen_random_uuid(), '38050000-0000-4000-8000-000000000022', null, null, 'client_archived'),
  ('employee', '38050000-0000-4000-8000-000000000003', '38050000-0000-4000-8000-000000000010',
   gen_random_uuid(), '38050000-0000-4000-8000-000000000020', null, null, 'not_authorized'),
  ('outsider', '38050000-0000-4000-8000-000000000004', '38050000-0000-4000-8000-000000000010',
   gen_random_uuid(), '38050000-0000-4000-8000-000000000020', null, null, 'not_authorized'),
  ('Büro in another organization', '38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000011',
   gen_random_uuid(), '38050000-0000-4000-8000-000000000029', null, null, 'not_authorized'),
  ('a key of another actor', '38050000-0000-4000-8000-000000000001', '38050000-0000-4000-8000-000000000010',
   '38050000-0000-4000-8000-000000000101', '38050000-0000-4000-8000-000000000020', null, null, 'invalid_input')
) as cases(label, actor, org, attempt, client, work_kind, work_id, refusal);
do $$
begin
  if (select count(*) from public.invoices where organization_id in
      ('38050000-0000-4000-8000-000000000010', '38050000-0000-4000-8000-000000000011')) is distinct from 2::bigint
    or (select count(*) from public.invoice_events where organization_id in
      ('38050000-0000-4000-8000-000000000010', '38050000-0000-4000-8000-000000000011')) is distinct from 2::bigint then
    raise exception 'a refused create wrote a row';
  end if;
end;
$$;

-- A save stores the terms, the lines and the totals the server computed, as sent.
create function pg_temp.save_job_draft(p_actor uuid, p_org uuid, p_version integer, p_attempt uuid) returns integer
language sql as $$
  select public.save_invoice_draft(p_actor, p_org, (select job_draft from ids), p_version, p_attempt,
    '{"serviceStart":"2037-11-02","serviceEnd":"2037-11-06","paymentDueDays":14,"discountDays":7,
      "discountBasisPoints":200,"orderReference":"BE-4711","buyerReference":"KST 12",
      "openingText":"Vielen Dank für deinen Auftrag.","closingText":"Mit freundlichen Grüßen"}',
    '[{"name":"Monteurstunde","description":"","quantity":"1.5","unit":"hour","unitPriceCents":7200,
       "priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":1900,"netCents":10800},
      {"name":"Dichtung","description":"DN 20","quantity":"0.125","unit":"piece","unitPriceCents":4000,
       "priceQuantity":100,"taxCategory":"S","taxRateBasisPoints":700,"netCents":0},
      {"name":"Gutschrift Anfahrt","description":"","quantity":"-1","unit":"flat_rate","unitPriceCents":4500,
       "priceQuantity":1,"taxCategory":"Z","taxRateBasisPoints":0,"netCents":-4500}]',
    '{"lineNetCents":6300,"taxCents":2052,"grossCents":8352}');
$$;
grant execute on function pg_temp.save_job_draft(uuid, uuid, integer, uuid) to service_role;
do $$
declare
  v_invoice public.invoices;
  v_version integer;
begin
  v_version := pg_temp.save_job_draft('38050000-0000-4000-8000-000000000002',
    '38050000-0000-4000-8000-000000000010', 1, '38050000-0000-4000-8000-000000000201');
  select * into v_invoice from public.invoices where id = (select job_draft from ids);
  if v_version is distinct from 2 or v_invoice.version is distinct from 2
    or v_invoice.service_start is distinct from '2037-11-02'::date or v_invoice.service_end is distinct from '2037-11-06'::date
    or v_invoice.discount_days is distinct from 7 or v_invoice.discount_basis_points is distinct from 200
    or v_invoice.order_reference is distinct from 'BE-4711' or v_invoice.buyer_reference is distinct from 'KST 12'
    or v_invoice.line_net_cents is distinct from 6300::bigint or v_invoice.tax_cents is distinct from 2052::bigint
    or v_invoice.gross_cents is distinct from 8352::bigint
    or v_invoice.updated_by is distinct from '38050000-0000-4000-8000-000000000002'::uuid then
    raise exception 'the saved draft is %', to_jsonb(v_invoice);
  end if;
  if (select jsonb_agg(jsonb_build_array(line.position, line.quantity::text, line.tax_category, line.net_cents)
        order by line.position) from public.invoice_lines line where line.invoice_id = v_invoice.id)
      is distinct from '[[1,"1.500","S",10800],[2,"0.125","S",0],[3,"-1.000","Z",-4500]]'::jsonb then
    raise exception 'the saved lines are not the sent ones';
  end if;
  if (public.get_invoice('38050000-0000-4000-8000-000000000010', v_invoice.id) ->> 'grossCents') is distinct from '8352' then
    raise exception 'the reader does not answer the stored totals';
  end if;
  if (select count(*) from public.invoice_events where invoice_id = v_invoice.id and event_type = 'saved'
      and version = 2 and payload ->> 'grossCents' = '8352') is distinct from 1::bigint then
    raise exception 'the save wrote no saved event';
  end if;
  -- A retried save under the same key answers its version and writes nothing.
  if pg_temp.save_job_draft('38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010', 1,
      '38050000-0000-4000-8000-000000000201') is distinct from 2
    or (select version from public.invoices where id = v_invoice.id) is distinct from 2 then
    raise exception 'a retried save saved again';
  end if;
end;
$$;

-- A save refuses an older version, an employee, another organization, totals
-- that do not add up, and a line outside the limits; each writes nothing.
select pg_temp.expect_refusal(label, format('select pg_temp.save_job_draft(%L, %L, %s, gen_random_uuid())',
  actor, org, version), refusal)
from (values
  ('older version', '38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010', 1, 'stale_version'),
  ('employee', '38050000-0000-4000-8000-000000000003', '38050000-0000-4000-8000-000000000010', 2, 'not_authorized'),
  ('foreign admin', '38050000-0000-4000-8000-000000000004', '38050000-0000-4000-8000-000000000011', 2, 'invoice_not_found')
) as cases(label, actor, org, version, refusal);
select pg_temp.expect_refusal(label, format(
  'select public.save_invoice_draft(%L, %L, %L, 2, gen_random_uuid(), %L, %L, %L)',
  '38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010', (select job_draft from ids),
  terms, lines, totals), refusal)
from (values
  ('totals that do not add up', '{"paymentDueDays":14}', '[]', '{"lineNetCents":100,"taxCents":19,"grossCents":100}', '23514'),
  ('Skonto beyond the Zahlungsziel', '{"paymentDueDays":7,"discountDays":10,"discountBasisPoints":200}', '[]',
   '{"lineNetCents":0,"taxCents":0,"grossCents":0}', '23514'),
  ('a zero rate with a percentage', '{"paymentDueDays":14}',
   '[{"name":"X","quantity":"1","unit":"piece","unitPriceCents":1,"priceQuantity":1,"taxCategory":"Z","taxRateBasisPoints":700,"netCents":1}]',
   '{"lineNetCents":1,"taxCents":0,"grossCents":1}', '23514'),
  ('a quantity with four decimals', '{"paymentDueDays":14}',
   '[{"name":"X","quantity":"1.0001","unit":"piece","unitPriceCents":1,"priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":1900,"netCents":1}]',
   '{"lineNetCents":1,"taxCents":0,"grossCents":1}', 'invalid_input')
) as cases(label, terms, lines, totals, refusal);
do $$
begin
  if (select version from public.invoices where id = (select job_draft from ids)) is distinct from 2
    or (select count(*) from public.invoice_lines where invoice_id = (select job_draft from ids)) is distinct from 3::bigint then
    raise exception 'a refused save changed the draft';
  end if;
end;
$$;

-- The list pages and searches the organization's invoices only.
do $$
declare
  v_page jsonb;
begin
  v_page := public.list_invoice_page('38050000-0000-4000-8000-000000000010', null, 'lindenhof', 1, 50);
  if (v_page ->> 'total') is distinct from '1' or (v_page #>> '{rows,0,grossCents}') is distinct from '8352'
    or (v_page #>> '{rows,0,recipientName}') is distinct from 'Hausverwaltung Lindenhof GmbH' then
    raise exception 'the recipient search gave %', v_page;
  end if;
  v_page := public.list_invoice_page('38050000-0000-4000-8000-000000000010', 'entwurf', '', 1, 1);
  if (v_page ->> 'total') is distinct from '2' or jsonb_array_length(v_page -> 'rows') is distinct from 1
    -- One transaction saves both at the same now(): the id breaks the tie.
    or (v_page #>> '{rows,0,id}')::uuid is distinct from (select invoice.id from public.invoices invoice
      where invoice.organization_id = '38050000-0000-4000-8000-000000000010'
      order by invoice.updated_at desc, invoice.id desc limit 1) then
    raise exception 'the first page of one gave %', v_page;
  end if;
  v_page := public.list_invoice_page('38050000-0000-4000-8000-000000000011', null, '', 1, 50);
  if (v_page ->> 'total') is distinct from '0' or (v_page ->> 'hasAny') is distinct from 'false' then
    raise exception 'another organization lists %', v_page;
  end if;
  if public.get_invoice('38050000-0000-4000-8000-000000000011', (select job_draft from ids)) is not null then
    raise exception 'another organization reads the draft';
  end if;
end;
$$;
reset role;

-- A signed-in session: the office reads its organization's invoices to hear
-- of a change; an employee and another organization read none, and nobody
-- reads lines or history.
create function pg_temp.invoices_seen_by(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.invoices where organization_id = '38050000-0000-4000-8000-000000000010';
  perform pg_temp.expect_refusal('line read', 'select count(*) from public.invoice_lines', '42501');
  perform pg_temp.expect_refusal('history read', 'select count(*) from public.invoice_events', '42501');
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.invoices_seen_by('38050000-0000-4000-8000-000000000002') is distinct from 2::bigint
    or pg_temp.invoices_seen_by('38050000-0000-4000-8000-000000000003') is distinct from 0::bigint
    or pg_temp.invoices_seen_by('38050000-0000-4000-8000-000000000004') is distinct from 0::bigint then
    raise exception 'an invoice read crossed a role or an organization';
  end if;
end;
$$;

-- A customer an invoice names, as buyer or Rechnungsempfänger, stays.
do $$
begin
  if (app_private.client_links('38050000-0000-4000-8000-000000000010', '38050000-0000-4000-8000-000000000021') ->> 'invoices')
      is distinct from '1'
    or (app_private.client_links('38050000-0000-4000-8000-000000000010', '38050000-0000-4000-8000-000000000020') ->> 'invoices')
      is distinct from '2' then
    raise exception 'an invoice does not keep its customers from deletion';
  end if;
end;
$$;
select pg_temp.expect_refusal('delete an invoiced customer',
  'delete from public.clients where id = ''38050000-0000-4000-8000-000000000021''', 'client_has_history');

-- Deleting a draft removes it with its lines; its history stays and names the deletion.
set local role service_role;
select pg_temp.expect_refusal('delete as employee', format(
  'select public.delete_invoice_draft(%L, %L, %L, 2, gen_random_uuid())', '38050000-0000-4000-8000-000000000003',
  '38050000-0000-4000-8000-000000000010', (select job_draft from ids)), 'not_authorized');
select pg_temp.expect_refusal('delete an older version', format(
  'select public.delete_invoice_draft(%L, %L, %L, 1, gen_random_uuid())', '38050000-0000-4000-8000-000000000002',
  '38050000-0000-4000-8000-000000000010', (select job_draft from ids)), 'stale_version');
select public.delete_invoice_draft('38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
  (select job_draft from ids), 2, '38050000-0000-4000-8000-000000000301');
do $$
begin
  if exists (select 1 from public.invoices where id = (select job_draft from ids))
    or exists (select 1 from public.invoice_lines where invoice_id = (select job_draft from ids)) then
    raise exception 'the deleted draft or its lines remain';
  end if;
  if (select count(*) from public.invoice_events where invoice_id = (select job_draft from ids))
      is distinct from 3::bigint
    or not exists (select 1 from public.invoice_events where invoice_id = (select job_draft from ids)
      and event_type = 'deleted' and payload ->> 'grossCents' = '8352') then
    raise exception 'the deleted draft lost its history';
  end if;
  -- A retried delete answers as the first did.
  perform public.delete_invoice_draft('38050000-0000-4000-8000-000000000002', '38050000-0000-4000-8000-000000000010',
    (select job_draft from ids), 2, '38050000-0000-4000-8000-000000000301');
end;
$$;
select pg_temp.expect_refusal('rewrite the history',
  'update public.invoice_events set payload = ''{}'' where organization_id = ''38050000-0000-4000-8000-000000000010''',
  '42501');
reset role;
select pg_temp.expect_refusal('delete the history as owner',
  'delete from public.invoice_events where organization_id = ''38050000-0000-4000-8000-000000000010''',
  'event_ledger_history_immutable');

-- Deleting an organization removes its invoices with their lines and history.
delete from public.organizations where id = '38050000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.invoices where organization_id = '38050000-0000-4000-8000-000000000010')
    or exists (select 1 from public.invoice_events where organization_id = '38050000-0000-4000-8000-000000000010') then
    raise exception 'organization cascade left invoice rows';
  end if;
end;
$$;

rollback;
