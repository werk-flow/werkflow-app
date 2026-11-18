-- „Stornieren“ and „Korrigieren“ issue a Stornorechnung with the series' next
-- number, leave the original untouched but Storniert, and link the chain
-- (migration 20261216120000_cancel_and_correct_issued_invoices.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38080000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'cancel-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38080000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'cancel-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38080000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'cancel-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38080000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'cancel-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38080000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Storno', '38080000-0000-4000-8000-000000000001', 'CANSQLA'),
('38080000-0000-4000-8000-000000000011', 'Fremde Haustechnik Storno', '38080000-0000-4000-8000-000000000004', 'CANSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000002', 'buero'),
('38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000003', 'employee');
insert into public.clients (id, organization_id, name, client_type, address) values
('38080000-0000-4000-8000-000000000020', '38080000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin');
insert into public.jobs (id, organization_id, title, job_number, client_id, status, created_by) values
('38080000-0000-4000-8000-000000000050', '38080000-0000-4000-8000-000000000010', 'Heizung tauschen',
 'S-80', '38080000-0000-4000-8000-000000000020', 'nicht_bearbeitet', '38080000-0000-4000-8000-000000000002');

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

-- Grants: the cancel is server-only.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.cancel_invoice(uuid,uuid,uuid,uuid,text,boolean,text,date)', 'EXECUTE')
      or has_function_privilege(v_role, 'app_private.invoice_chain(uuid,uuid)', 'EXECUTE') then
      raise exception '% reaches the cancel', v_role;
    end if;
  end loop;
end;
$$;

create temp table ids (name text primary key, id uuid) on commit drop;
grant select, insert on ids to service_role;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
grant execute on function pg_temp.id(text) to service_role;

set local role service_role;

-- Four issued invoices of one job: two lines each, one a credit, at two rates.
insert into ids
select name, public.create_invoice('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
  gen_random_uuid(), '38080000-0000-4000-8000-000000000020', 'job', '38080000-0000-4000-8000-000000000050')
from unnest(array['cancelled', 'corrected', 'kept', 'draft']) as name;
create function pg_temp.fill(p_name text) returns integer language sql as $$
  select public.save_invoice_draft('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
    pg_temp.id(p_name), 1, gen_random_uuid(),
    '{"serviceStart":"2037-11-02","serviceEnd":"2037-11-06","paymentDueDays":30,"discountDays":7,
      "discountBasisPoints":200,"orderReference":"BE-4711","buyerReference":"Objekt Hofweg",
      "openingText":"Vielen Dank.","closingText":"Gruß"}',
    '[{"name":"Monteurstunde","description":"Heizung","quantity":"1.5","unit":"hour","unitPriceCents":7200,
       "priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":1900,"netCents":10800},
      {"name":"Gutschrift Anfahrt","description":"","quantity":"-1","unit":"flat_rate","unitPriceCents":3500,
       "priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":700,"netCents":-3500}]',
    '{"lineNetCents":7300,"taxCents":1807,"grossCents":9107}')
$$;
select pg_temp.fill(name) from unnest(array['cancelled', 'corrected', 'kept', 'draft']) as name;
-- Issues under the series' next number and the Berlin day, as the server checks it.
create function pg_temp.issue(p_name text, p_version integer, p_snapshot jsonb) returns jsonb language sql as $$
  select public.issue_invoice('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
    pg_temp.id(p_name), p_version, gen_random_uuid(), p_snapshot,
    public.get_invoice_settings('38080000-0000-4000-8000-000000000010') ->> 'nextInvoiceNumber',
    (now() at time zone 'Europe/Berlin')::date)
$$;
-- One statement per issue, so each reads the number the one before left.
do $$
declare
  v_name text;
begin
  foreach v_name in array array['cancelled', 'corrected', 'kept'] loop
    perform pg_temp.issue(v_name, 2,
      '{"organizationName":"Haustechnik Sonnenberg","profile":{"companyName":"Haustechnik Sonnenberg GmbH"},
      "files":{"logo":{"path":"38080000-0000-4000-8000-000000000010/briefpapier/l/u/logo","mimeType":"image/png"},
      "stationery_first":null,"stationery_following":null},
      "buyer":{"name":"Hausverwaltung Lindenhof GmbH","address":{"lines":["Hofweg 1"],"postalCode":"10117",
      "city":"Berlin","countryCode":"DE"}}}');
  end loop;
end;
$$;

create temp table issued on commit drop as
select invoice.* from public.invoices invoice
where invoice.organization_id = '38080000-0000-4000-8000-000000000010' and invoice.status = 'ausgestellt';
create temp table issued_lines on commit drop as
select line.* from public.invoice_lines line join issued on issued.id = line.invoice_id;
grant select on issued, issued_lines to service_role;

create function pg_temp.cancel(p_actor uuid, p_org uuid, p_name text, p_attempt uuid, p_reason text, p_correct boolean)
returns jsonb language sql as $$
  select public.cancel_invoice(p_actor, p_org, pg_temp.id(p_name), p_attempt, p_reason, p_correct,
    public.get_invoice_settings(p_org) ->> 'nextInvoiceNumber', (now() at time zone 'Europe/Berlin')::date)
$$;

-- A refused cancel uses no number and changes nothing: a field worker, an
-- outsider, another organization, a draft, an empty reason, a moved number.
select pg_temp.expect_refusal(label, format('select pg_temp.cancel(%L, %L, %L, gen_random_uuid(), %L, false)',
  actor, org, invoice, reason), refusal)
from (values
  ('employee', '38080000-0000-4000-8000-000000000003', '38080000-0000-4000-8000-000000000010', 'cancelled',
   'Falscher Empfänger', 'not_authorized'),
  ('outsider', '38080000-0000-4000-8000-000000000004', '38080000-0000-4000-8000-000000000010', 'cancelled',
   'Falscher Empfänger', 'not_authorized'),
  ('another organization''s Admin', '38080000-0000-4000-8000-000000000004', '38080000-0000-4000-8000-000000000011',
   'cancelled', 'Falscher Empfänger', 'invoice_not_found'),
  ('a draft', '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010', 'draft',
   'Falscher Empfänger', 'invoice_not_issued'),
  ('an empty reason', '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010', 'cancelled',
   '   ', 'invalid_input'),
  ('a reason over 500 characters', '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
   'cancelled', repeat('x', 501), 'invalid_input')
) as cases(label, actor, org, invoice, reason, refusal);
-- A Stornorechnung checked under another number or day than the series gives it now is refused, so
-- the original's head is never rendered under a number nobody checked.
select pg_temp.expect_refusal(label, format('select public.cancel_invoice(%L, %L, %L, gen_random_uuid(), ''Falsch'',
  false, %L, %L)', '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
  pg_temp.id('cancelled'), expected_number, expected_day), 'invoice_number_moved')
from (values
  ('a number another issue took', 'RE-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY') || '-003',
   (now() at time zone 'Europe/Berlin')::date),
  ('another day', 'RE-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY') || '-004',
   (now() at time zone 'Europe/Berlin')::date - 1)
) as cases(label, expected_number, expected_day);
do $$
begin
  if (select next_number from public.invoice_settings
      where organization_id = '38080000-0000-4000-8000-000000000010') is distinct from 4
    or exists (select 1 from public.invoices where organization_id = '38080000-0000-4000-8000-000000000010'
      and (status = 'storniert' or cancels_invoice_id is not null)) then
    raise exception 'a refused cancel used a number or cancelled';
  end if;
end;
$$;

-- „Stornieren“: the Stornorechnung takes the series' next number, negates every line and every total,
-- names the original and its reason; the original keeps every value and reads Storniert, with history.
do $$
declare
  v_year text := to_char(now() at time zone 'Europe/Berlin', 'YYYY');
  v_answer jsonb := pg_temp.cancel('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
    'cancelled', '38080000-0000-4000-8000-000000000301', '  Falscher Rechnungsempfänger ', false);
  v_original public.invoices;
  v_before issued;
  v_storno public.invoices;
begin
  select * into v_original from public.invoices where id = pg_temp.id('cancelled');
  select * into v_before from issued where id = pg_temp.id('cancelled');
  select * into v_storno from public.invoices where id = (v_answer ->> 'stornoId')::uuid;
  if v_answer ->> 'stornoNumber' is distinct from 'RE-' || v_year || '-004'
    or v_storno.invoice_number is distinct from 'RE-' || v_year || '-004'
    or v_storno.status is distinct from 'ausgestellt'
    or v_storno.issue_date is distinct from (now() at time zone 'Europe/Berlin')::date
    or v_storno.cancels_invoice_id is distinct from v_original.id
    or v_storno.cancellation_reason is distinct from 'Falscher Rechnungsempfänger'
    or (v_storno.line_net_cents, v_storno.tax_cents, v_storno.gross_cents)
      is distinct from (-7300::bigint, -1807::bigint, -9107::bigint)
    or (v_storno.client_id, v_storno.recipient_client_id, v_storno.job_id, v_storno.service_start,
        v_storno.service_end, v_storno.order_reference, v_storno.buyer_reference)
      is distinct from (v_original.client_id, v_original.recipient_client_id, v_original.job_id,
        v_original.service_start, v_original.service_end, v_original.order_reference, v_original.buyer_reference)
    or (v_storno.payment_due_days, v_storno.discount_days, v_storno.opening_text, v_storno.closing_text)
      is distinct from (0, null::integer, '', '')
    or v_storno.issue_snapshot is distinct from v_original.issue_snapshot
    or v_storno.logo_storage_path is distinct from v_original.logo_storage_path
    or v_answer -> 'correctionId' is distinct from 'null'::jsonb then
    raise exception 'the Stornorechnung is % (answer %)', to_jsonb(v_storno), v_answer;
  end if;
  if (select array_agg((line.position, line.name, line.description, line.quantity, line.unit, line.unit_price_cents,
        line.price_quantity, line.tax_category, line.tax_rate_basis_points, line.net_cents)::text order by line.position)
      from public.invoice_lines line where line.invoice_id = v_storno.id)
    is distinct from (select array_agg((line.position, line.name, line.description, -line.quantity, line.unit,
        line.unit_price_cents, line.price_quantity, line.tax_category, line.tax_rate_basis_points, -line.net_cents)::text
        order by line.position)
      from issued_lines line where line.invoice_id = v_original.id) then
    raise exception 'the Stornorechnung''s lines are not the original''s negated';
  end if;
  -- The original is untouched: only its status moved; the cancel's actor and time are in its history.
  if to_jsonb(v_original) - 'status' is distinct from to_jsonb(v_before) - 'status'
    or v_original.status is distinct from 'storniert'
    or (select array_agg(to_jsonb(line) order by line.position) from public.invoice_lines line
        where line.invoice_id = v_original.id)
      is distinct from (select array_agg(to_jsonb(line) order by line.position) from issued_lines line
        where line.invoice_id = v_original.id) then
    raise exception 'the cancel changed the original: %', to_jsonb(v_original);
  end if;
  if not exists (select 1 from public.invoice_events where invoice_id = v_original.id and event_type = 'cancelled'
      and status = 'storniert' and payload ->> 'stornoId' = v_storno.id::text
      and actor_id = '38080000-0000-4000-8000-000000000002')
    or not exists (select 1 from public.invoice_events where invoice_id = v_storno.id and event_type = 'issued') then
    raise exception 'the cancel wrote no history';
  end if;
  -- A retry under the same key answers the first cancel and uses no number.
  if pg_temp.cancel('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010', 'cancelled',
      '38080000-0000-4000-8000-000000000301', 'Falscher Rechnungsempfänger', false) is distinct from v_answer
    or (select count(*) from public.invoices where cancels_invoice_id = v_original.id) <> 1 then
    raise exception 'a retried cancel cancelled again';
  end if;
  insert into ids values ('storno', v_storno.id);
end;
$$;

-- An invoice is cancelled at most once; a Stornorechnung is not cancelled; nothing of either changes.
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('a second cancel', format('select pg_temp.cancel(%L, %L, ''cancelled'', gen_random_uuid(), ''Nochmal'', true)',
    '38080000-0000-4000-8000-000000000001', '38080000-0000-4000-8000-000000000010'), 'invoice_cancelled'),
  ('cancel the Stornorechnung', format('select pg_temp.cancel(%L, %L, ''storno'', gen_random_uuid(), ''Nochmal'', false)',
    '38080000-0000-4000-8000-000000000001', '38080000-0000-4000-8000-000000000010'), 'invoice_is_storno'),
  -- Only cancel_invoice writes a link: a Stornorechnung or correction inserted directly is refused.
  ('a Stornorechnung written directly', format($insert$insert into public.invoices (organization_id, client_id,
    recipient_client_id, cancels_invoice_id, cancellation_reason) values (%L, %L, %L, %L, 'Nochmal')$insert$,
    '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020',
    '38080000-0000-4000-8000-000000000020', pg_temp.id('kept')), 'invoice_link_fixed'),
  ('a correction written directly', format($insert$insert into public.invoices (organization_id, client_id,
    recipient_client_id, corrects_invoice_id) values (%L, %L, %L, %L)$insert$,
    '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020',
    '38080000-0000-4000-8000-000000000020', pg_temp.id('kept')), 'invoice_link_fixed'),
  -- Even inside a cancel of that invoice, a second Stornorechnung is refused by the unique index.
  ('a second Stornorechnung', format($insert$insert into public.invoices (organization_id, client_id,
    recipient_client_id, cancels_invoice_id, cancellation_reason)
    select %1$L, %2$L, %2$L, %3$L, 'Nochmal' where set_config('app.invoice_cancel', %3$L, true) is not null$insert$,
    '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020', pg_temp.id('cancelled')),
    '23505'),
  ('back to Ausgestellt', format('update public.invoices set status = ''ausgestellt'' where id = %L',
    pg_temp.id('cancelled')), 'invoice_issued'),
  ('change the cancelled invoice', format('update public.invoices set order_reference = ''X'' where id = %L',
    pg_temp.id('cancelled')), 'invoice_issued'),
  ('change the Stornorechnung', format('update public.invoices set gross_cents = 0, tax_cents = 0, line_net_cents = 0
    where id = %L', pg_temp.id('storno')), 'invoice_issued'),
  ('change the reason', format('update public.invoices set cancellation_reason = ''Anders'' where id = %L',
    pg_temp.id('storno')), 'invoice_link_fixed'),
  ('delete the Stornorechnung', format('delete from public.invoices where id = %L', pg_temp.id('storno')),
    'invoice_issued'),
  ('delete a Storno line', format('delete from public.invoice_lines where invoice_id = %L', pg_temp.id('storno')),
    'invoice_issued'),
  -- Storniert only inside cancel_invoice for that invoice, and only beside its issued Stornorechnung.
  ('mark an invoice Storniert directly', format('update public.invoices set status = ''storniert'' where id = %L',
    pg_temp.id('kept')), 'invoice_issued'),
  ('mark it Storniert under the cancel flag without a Stornorechnung', format('update public.invoices
    set status = ''storniert'' where id = %1$L and set_config(''app.invoice_cancel'', %1$L, true) is not null',
    pg_temp.id('kept')), 'invoice_issued')
) as cases(label, statement, refusal);

-- „Korrigieren“: the Stornorechnung takes the next number, and a new draft carries the original's
-- terms and lines, linked to it; the chain reads original, Stornorechnung, correction from each of them.
do $$
declare
  v_year text := to_char(now() at time zone 'Europe/Berlin', 'YYYY');
  v_answer jsonb := pg_temp.cancel('38080000-0000-4000-8000-000000000001', '38080000-0000-4000-8000-000000000010',
    'corrected', gen_random_uuid(), 'Menge falsch', true);
  v_original public.invoices;
  v_correction public.invoices;
  v_chain jsonb;
  v_name text;
begin
  select * into v_original from public.invoices where id = pg_temp.id('corrected');
  select * into v_correction from public.invoices where id = (v_answer ->> 'correctionId')::uuid;
  if v_answer ->> 'stornoNumber' is distinct from 'RE-' || v_year || '-005'
    or v_original.status is distinct from 'storniert'
    or v_correction.status is distinct from 'entwurf' or v_correction.invoice_number is not null
    or v_correction.corrects_invoice_id is distinct from v_original.id or v_correction.version is distinct from 1
    or (v_correction.client_id, v_correction.recipient_client_id, v_correction.job_id, v_correction.service_start,
        v_correction.service_end, v_correction.payment_due_days, v_correction.discount_days,
        v_correction.discount_basis_points, v_correction.order_reference, v_correction.buyer_reference,
        v_correction.opening_text, v_correction.closing_text, v_correction.gross_cents)
      is distinct from (v_original.client_id, v_original.recipient_client_id, v_original.job_id,
        v_original.service_start, v_original.service_end, v_original.payment_due_days, v_original.discount_days,
        v_original.discount_basis_points, v_original.order_reference, v_original.buyer_reference,
        v_original.opening_text, v_original.closing_text, v_original.gross_cents)
    or (select array_agg((line.position, line.name, line.quantity, line.net_cents)::text order by line.position)
        from public.invoice_lines line where line.invoice_id = v_correction.id)
      is distinct from (select array_agg((line.position, line.name, line.quantity, line.net_cents)::text
        order by line.position) from issued_lines line where line.invoice_id = v_original.id) then
    raise exception 'the correction is % (answer %)', to_jsonb(v_correction), v_answer;
  end if;
  insert into ids values ('correction', v_correction.id);
  insert into ids values ('storno2', (v_answer ->> 'stornoId')::uuid);
  foreach v_name in array array['corrected', 'storno2', 'correction'] loop
    v_chain := public.get_invoice('38080000-0000-4000-8000-000000000010', pg_temp.id(v_name)) -> 'chain';
    if (select jsonb_agg(entry ->> 'kind' || ':' || coalesce(entry ->> 'invoiceNumber', '-') || ':' || (entry ->> 'status'))
        from jsonb_array_elements(v_chain) entry)
      is distinct from jsonb_build_array('rechnung:' || v_original.invoice_number || ':storniert',
        'storno:RE-' || v_year || '-005:ausgestellt', 'korrektur:-:entwurf') then
      raise exception 'the chain of % reads %', v_name, v_chain;
    end if;
  end loop;
  if public.get_invoice('38080000-0000-4000-8000-000000000010', (v_answer ->> 'stornoId')::uuid) -> 'cancels'
      is distinct from jsonb_build_object('id', v_original.id, 'invoiceNumber', v_original.invoice_number,
        'issueDate', v_original.issue_date)
    or jsonb_array_length(public.get_invoice('38080000-0000-4000-8000-000000000010', pg_temp.id('kept')) -> 'chain')
      is distinct from 1 then
    raise exception 'get_invoice misnames the links';
  end if;
  if (select jsonb_agg(row -> 'refersTo' order by row ->> 'invoiceNumber')
      from jsonb_array_elements(public.list_invoice_page('38080000-0000-4000-8000-000000000010', null,
        v_original.invoice_number) -> 'rows') row)
    is distinct from jsonb_build_array(null, jsonb_build_object('kind', 'storno', 'invoiceNumber',
      v_original.invoice_number), jsonb_build_object('kind', 'korrektur', 'invoiceNumber', v_original.invoice_number)) then
    raise exception 'the list does not find the chain by the original''s number';
  end if;
end;
$$;

-- The guard's one exception is narrow. Inside a cancel of „kept“ (the flag cancel_invoice raises), with
-- its issued Stornorechnung beside it, only its status may change; the bare transition passes.
do $$
declare
  v_storno uuid;
begin
  perform set_config('app.invoice_cancel', pg_temp.id('kept')::text, true);
  insert into public.invoices (organization_id, client_id, recipient_client_id, service_start, service_end,
    cancels_invoice_id, cancellation_reason)
  values ('38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020',
    '38080000-0000-4000-8000-000000000020', '2037-11-02', '2037-11-02', pg_temp.id('kept'), 'Probe')
  returning id into v_storno;
  insert into public.invoice_lines (organization_id, invoice_id, position, name, quantity, unit, unit_price_cents,
    tax_category, tax_rate_basis_points, net_cents)
  values ('38080000-0000-4000-8000-000000000010', v_storno, 1, 'Probe', 1, 'piece', 0, 'S', 1900, 0);
  perform public.issue_invoice('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
    v_storno, 1, gen_random_uuid(), (select issue_snapshot from issued where id = pg_temp.id('kept')),
    public.get_invoice_settings('38080000-0000-4000-8000-000000000010') ->> 'nextInvoiceNumber',
    (now() at time zone 'Europe/Berlin')::date);
  perform set_config('app.invoice_cancel', '', true);
end;
$$;
-- Beside its issued Stornorechnung but outside the cancel, the status stays.
select pg_temp.expect_refusal('Storniert beside its Stornorechnung without the cancel flag',
  format('update public.invoices set status = ''storniert'' where id = %L', pg_temp.id('kept')), 'invoice_issued');
select set_config('app.invoice_cancel', pg_temp.id('kept')::text, true);
select pg_temp.expect_refusal(label, format(statement, pg_temp.id('kept')), 'invoice_issued')
from (values
  ('Storniert with another change',
    'update public.invoices set status = ''storniert'', order_reference = ''X'' where id = %L'),
  ('Storniert with an amount',
    'update public.invoices set status = ''storniert'', gross_cents = 0, tax_cents = 0, line_net_cents = 0
      where id = %L'),
  ('Storniert with a new version', 'update public.invoices set status = ''storniert'', version = version + 1
    where id = %L'),
  ('back to a draft', 'update public.invoices set status = ''entwurf'' where id = %L')
) as cases(label, statement);
update public.invoices set status = 'storniert' where id = pg_temp.id('kept');
select set_config('app.invoice_cancel', '', true);

-- A credit (negative total) is not cancelled: its Stornorechnung would ask the customer to pay.
insert into ids values ('credit', public.create_invoice('38080000-0000-4000-8000-000000000002',
  '38080000-0000-4000-8000-000000000010', gen_random_uuid(), '38080000-0000-4000-8000-000000000020', null, null));
select public.save_invoice_draft('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
  pg_temp.id('credit'), 1, gen_random_uuid(),
  '{"serviceStart":"2037-11-02","serviceEnd":"2037-11-02","paymentDueDays":14,"discountDays":null,
    "discountBasisPoints":null,"orderReference":"","buyerReference":"","openingText":"","closingText":""}',
  '[{"name":"Gutschrift Anfahrt","description":"","quantity":"-1","unit":"flat_rate","unitPriceCents":3500,
     "priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":1900,"netCents":-3500}]',
  '{"lineNetCents":-3500,"taxCents":-665,"grossCents":-4165}');
select pg_temp.issue('credit', 2, (select issue_snapshot from issued where id = pg_temp.id('kept')));
select pg_temp.expect_refusal('cancel a credit', format(
  'select pg_temp.cancel(%L, %L, ''credit'', gen_random_uuid(), ''Falsch'', false)',
  '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010'), 'invoice_not_cancellable');

-- The correction is a draft like any: it is edited, and deleted with its link.
select pg_temp.expect_refusal('move the correction to another invoice',
  format('update public.invoices set corrects_invoice_id = %L where id = %L', pg_temp.id('kept'),
    pg_temp.id('correction')), 'invoice_link_fixed');
select public.delete_invoice_draft('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
  pg_temp.id('correction'), 1, gen_random_uuid());
reset role;

-- An employee and another organization read neither the Stornorechnung nor the correction.
create function pg_temp.invoices_seen_by(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.invoices where organization_id = '38080000-0000-4000-8000-000000000010';
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.invoices_seen_by('38080000-0000-4000-8000-000000000002') is distinct from 8::bigint
    or pg_temp.invoices_seen_by('38080000-0000-4000-8000-000000000003') is distinct from 0::bigint
    or pg_temp.invoices_seen_by('38080000-0000-4000-8000-000000000004') is distinct from 0::bigint then
    raise exception 'an invoice read crossed a role or an organization';
  end if;
end;
$$;

-- Deleting an organization removes its invoices and their links with it.
delete from public.organizations where id = '38080000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.invoices where organization_id = '38080000-0000-4000-8000-000000000010') then
    raise exception 'organization teardown left invoice rows';
  end if;
end;
$$;

rollback;
