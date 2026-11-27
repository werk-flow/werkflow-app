-- „Stornieren“ and „Korrigieren“ issue a Stornorechnung with the series' next
-- number, leave the original untouched but Storniert, and link the chain
-- (migration 20270310090000_cancel_and_correct_issued_invoices.sql).
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
-- The Leistung the first line of each invoice was added from.
insert into public.leistungen (id, organization_id, leistung_number, name, kind, unit, tax_rate_basis_points) values
('38080000-0000-4000-8000-000000000060', '38080000-0000-4000-8000-000000000010', 'L-1', 'Monteurstunde',
 'arbeit', 'hour', 1900);

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
    if has_function_privilege(v_role, 'public.cancel_invoice(uuid,uuid,uuid,uuid,text,boolean,text,date,uuid,text,text,bigint,text)', 'EXECUTE')
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
       "priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":1900,"netCents":10800,
       "source":{"kind":"leistung","id":"38080000-0000-4000-8000-000000000060"}},
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

-- With p_original, the Stornorechnung's issue registers the original the server stored under that document id,
-- named per document as the server names it per number.
create function pg_temp.cancel(p_actor uuid, p_org uuid, p_name text, p_attempt uuid, p_reason text, p_correct boolean,
  p_original uuid default null)
returns jsonb language sql as $$
  select public.cancel_invoice(p_actor, p_org, pg_temp.id(p_name), p_attempt, p_reason, p_correct,
    public.get_invoice_settings(p_org) ->> 'nextInvoiceNumber', (now() at time zone 'Europe/Berlin')::date,
    p_original,
    case when p_original is not null then p_org || '/' || p_original || '/Stornorechnung-' || p_original || '.pdf' end,
    case when p_original is not null then 'Stornorechnung-' || p_original || '.pdf' end,
    case when p_original is not null then 4096 end,
    case when p_original is not null then repeat('d', 64) end)
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
-- A used-up series has no number for the Stornorechnung: the server sends an empty one, and the cancel
-- is refused as used up, not as a moved number the server would check again. Only an issue moves the
-- series, so the seed passes its guard and puts it back.
reset role;
set local session_replication_role = replica;
update public.invoice_settings set next_number = 999999999
where organization_id = '38080000-0000-4000-8000-000000000010';
set local session_replication_role = origin;
set local role service_role;
select pg_temp.expect_refusal('a used-up series', format('select public.cancel_invoice(%L, %L, %L,
  gen_random_uuid(), ''Falsch'', false, '''', %L)', '38080000-0000-4000-8000-000000000002',
  '38080000-0000-4000-8000-000000000010', pg_temp.id('cancelled'), (now() at time zone 'Europe/Berlin')::date),
  'invoice_numbers_exhausted');
reset role;
set local session_replication_role = replica;
update public.invoice_settings set next_number = 4
where organization_id = '38080000-0000-4000-8000-000000000010';
set local session_replication_role = origin;
set local role service_role;
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
    or v_answer -> 'correctionId' is distinct from 'null'::jsonb
    -- Cancelled without a stored original, as when the storage was unreachable: pending, no document.
    or v_answer -> 'originalDocumentId' is distinct from 'null'::jsonb or v_storno.original_document_id is not null then
    raise exception 'the Stornorechnung is % (answer %)', to_jsonb(v_storno), v_answer;
  end if;
  if (select array_agg((line.position, line.name, line.description, line.quantity, line.unit, line.unit_price_cents,
        line.price_quantity, line.tax_category, line.tax_rate_basis_points, line.net_cents, line.leistung_id,
        line.item_id)::text order by line.position)
      from public.invoice_lines line where line.invoice_id = v_storno.id)
    is distinct from (select array_agg((line.position, line.name, line.description, -line.quantity, line.unit,
        line.unit_price_cents, line.price_quantity, line.tax_category, line.tax_rate_basis_points, -line.net_cents,
        line.leistung_id, line.item_id)::text order by line.position)
      from issued_lines line where line.invoice_id = v_original.id)
    or (select count(*) from public.invoice_lines line where line.invoice_id = v_storno.id
        and line.leistung_id = '38080000-0000-4000-8000-000000000060') <> 1 then
    raise exception 'the Stornorechnung''s lines are not the original''s negated with their sources';
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
    -- Also with the empty number the server sends once the series is used up.
    or public.cancel_invoice('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
      v_original.id, '38080000-0000-4000-8000-000000000301', 'Falscher Rechnungsempfänger', false, '',
      (now() at time zone 'Europe/Berlin')::date) is distinct from v_answer
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
  -- The guard checks the rows a cancel leaves, not cancel_invoice's former flag: a link needs the cancel's
  -- history entry naming it, so under the flag a Stornorechnung or a correction is refused as before.
  ('a second Stornorechnung under the former cancel flag', format($insert$insert into public.invoices (organization_id,
    client_id, recipient_client_id, cancels_invoice_id, cancellation_reason)
    select %1$L, %2$L, %2$L, %3$L, 'Nochmal' where set_config('app.invoice_cancel', %3$L, true) is not null$insert$,
    '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020', pg_temp.id('cancelled')),
    'invoice_link_fixed'),
  ('a Stornorechnung under the former cancel flag', format($insert$insert into public.invoices (organization_id,
    client_id, recipient_client_id, cancels_invoice_id, cancellation_reason)
    select %1$L, %2$L, %2$L, %3$L, 'Nochmal' where set_config('app.invoice_cancel', %3$L, true) is not null$insert$,
    '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020', pg_temp.id('kept')),
    'invoice_link_fixed'),
  ('a correction of a cancelled invoice under the former cancel flag', format($insert$insert into public.invoices (
    organization_id, client_id, recipient_client_id, corrects_invoice_id)
    select %1$L, %2$L, %2$L, %3$L where set_config('app.invoice_cancel', %3$L, true) is not null$insert$,
    '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020', pg_temp.id('cancelled')),
    'invoice_link_fixed'),
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
  -- Storniert only beside its issued Stornorechnung, which the cancel's history entry names.
  ('mark an invoice Storniert directly', format('update public.invoices set status = ''storniert'' where id = %L',
    pg_temp.id('kept')), 'invoice_issued'),
  ('mark it Storniert under the cancel flag without a Stornorechnung', format('update public.invoices
    set status = ''storniert'' where id = %1$L and set_config(''app.invoice_cancel'', %1$L, true) is not null',
    pg_temp.id('kept')), 'invoice_issued')
) as cases(label, statement, refusal);

-- „Korrigieren“: the Stornorechnung takes the next number, and a new draft carries the original's
-- terms and lines, linked to it; the chain reads original, Stornorechnung, correction from each of them.
-- The Stornorechnung's stored original is registered and filed in the cancel's own transaction.
do $$
declare
  v_year text := to_char(now() at time zone 'Europe/Berlin', 'YYYY');
  v_answer jsonb := pg_temp.cancel('38080000-0000-4000-8000-000000000001', '38080000-0000-4000-8000-000000000010',
    'corrected', '38080000-0000-4000-8000-000000000302', 'Menge falsch', true, '38080000-0000-4000-8000-000000000401');
  v_original public.invoices;
  v_correction public.invoices;
  v_document public.documents;
  v_chain jsonb;
  v_name text;
begin
  select * into v_document from public.documents where id = '38080000-0000-4000-8000-000000000401';
  if v_answer ->> 'originalDocumentId' is distinct from '38080000-0000-4000-8000-000000000401'
    or (select original_document_id from public.invoices where id = (v_answer ->> 'stornoId')::uuid)
      is distinct from '38080000-0000-4000-8000-000000000401'
    or v_document.category is distinct from 'invoice' or v_document.retention_class is distinct from 'ten_years'
    or v_document.filed_at is null or v_document.filed_by is distinct from '38080000-0000-4000-8000-000000000001'
    or v_document.metadata ->> 'invoiceId' is distinct from v_answer ->> 'stornoId' then
    raise exception 'the cancel answered % with the Stornorechnung''s original %', v_answer, to_jsonb(v_document);
  end if;
  -- The Stornorechnung names the job, but its original is linked to the customer alone: a job link
  -- would open it to every employee assigned there (guard_invoice_original_links).
  if (select count(*) from public.document_links link where link.document_id = v_document.id) <> 1
    or not exists (select 1 from public.document_links link where link.document_id = v_document.id
      and link.client_id = '38080000-0000-4000-8000-000000000020'
      and num_nonnulls(link.job_id, link.project_id, link.employee_id, link.request_id, link.equipment_id,
        link.service_case_id, link.maintenance_coverage_id) = 0) then
    raise exception 'the Stornorechnung''s original is not linked to its customer alone';
  end if;
  perform pg_temp.expect_refusal('link the Stornorechnung''s original to its job', format(
    'insert into public.document_links (organization_id, document_id, job_id, created_by) values (%L, %L, %L, %L)',
    '38080000-0000-4000-8000-000000000010', v_document.id, '38080000-0000-4000-8000-000000000050',
    '38080000-0000-4000-8000-000000000002'), 'document_is_invoice_original');
  -- A retry under the same key registers nothing: it answers the first cancel and its registered original.
  if pg_temp.cancel('38080000-0000-4000-8000-000000000001', '38080000-0000-4000-8000-000000000010', 'corrected',
      '38080000-0000-4000-8000-000000000302', 'Menge falsch', true, '38080000-0000-4000-8000-000000000402')
      is distinct from v_answer
    or exists (select 1 from public.documents where id = '38080000-0000-4000-8000-000000000402') then
    raise exception 'a retried cancel registered another original';
  end if;
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
    or (select array_agg((line.position, line.name, line.quantity, line.net_cents, line.leistung_id, line.item_id)::text
        order by line.position) from public.invoice_lines line where line.invoice_id = v_correction.id)
      is distinct from (select array_agg((line.position, line.name, line.quantity, line.net_cents, line.leistung_id,
        line.item_id)::text order by line.position) from issued_lines line where line.invoice_id = v_original.id) then
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

-- Every insert is a draft without an original, also under the former cancel flag, since only
-- issue_invoice issues and only the registration names an original. Each half is refused on its own: an
-- issued Stornorechnung without an original, and a draft that names a filed invoice document.
select pg_temp.expect_refusal('an issued Stornorechnung written under the cancel flag', format(
  $insert$insert into public.invoices (organization_id, client_id, recipient_client_id, cancels_invoice_id,
    cancellation_reason, status, invoice_number, issue_date, issued_at, issue_snapshot)
    select %1$L, %2$L, %2$L, %3$L, 'Nochmal', 'ausgestellt', 'X-1', current_date, now(), '{}'
    where set_config('app.invoice_cancel', %3$L, true) is not null$insert$,
  '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020', pg_temp.id('kept')),
  'invoice_issued');
select pg_temp.expect_refusal('a Stornorechnung draft with an original written under the cancel flag', format(
  $insert$insert into public.invoices (organization_id, client_id, recipient_client_id, cancels_invoice_id,
    cancellation_reason, original_document_id)
    select %1$L, %2$L, %2$L, %3$L, 'Nochmal', %4$L
    where set_config('app.invoice_cancel', %3$L, true) is not null$insert$,
  '38080000-0000-4000-8000-000000000010', '38080000-0000-4000-8000-000000000020', pg_temp.id('kept'),
  '38080000-0000-4000-8000-000000000401'), 'invoice_issued');

-- A cancel that fails late leaves nothing: the Stornorechnung's original names a document id already in
-- use, so its registration fails inside issue_invoice, after the series gave out the number. The number
-- stays free, „kept“ stays Ausgestellt, and no Stornorechnung, correction or history stays; a retry under
-- the same key with a fresh document id cancels under that same number (rolled back again here).
do $$
declare
  v_next integer := (select next_number from public.invoice_settings
    where organization_id = '38080000-0000-4000-8000-000000000010');
  v_number text := public.get_invoice_settings('38080000-0000-4000-8000-000000000010') ->> 'nextInvoiceNumber';
  v_retry jsonb;
begin
  perform pg_temp.expect_refusal('a cancel whose original''s registration fails', format(
    'select pg_temp.cancel(%L, %L, ''kept'', %L, ''Menge falsch'', true, %L)',
    '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
    '38080000-0000-4000-8000-000000000303', '38080000-0000-4000-8000-000000000401'), '23505');
  if (select next_number from public.invoice_settings
      where organization_id = '38080000-0000-4000-8000-000000000010') is distinct from v_next
    or (select status from public.invoices where id = pg_temp.id('kept')) is distinct from 'ausgestellt'
    or exists (select 1 from public.invoices where invoice_number = v_number
      and organization_id = '38080000-0000-4000-8000-000000000010')
    or exists (select 1 from public.invoices where organization_id = '38080000-0000-4000-8000-000000000010'
      and pg_temp.id('kept') in (cancels_invoice_id, corrects_invoice_id))
    or exists (select 1 from public.invoice_events where invoice_id = pg_temp.id('kept') and event_type = 'cancelled')
    or exists (select 1 from public.invoice_events where attempt_key = '38080000-0000-4000-8000-000000000303') then
    raise exception 'a cancel that failed in its original''s registration left part of itself';
  end if;
  begin
    v_retry := pg_temp.cancel('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
      'kept', '38080000-0000-4000-8000-000000000303', 'Menge falsch', true, '38080000-0000-4000-8000-000000000403');
    if v_retry ->> 'stornoNumber' is distinct from v_number
      or v_retry ->> 'originalDocumentId' is distinct from '38080000-0000-4000-8000-000000000403' then
      raise exception 'the retry after a failed registration answered %', v_retry;
    end if;
    raise exception 'retry_rolled_back';
  exception when others then
    if sqlerrm is distinct from 'retry_rolled_back' then raise; end if;
  end;
end;
$$;

-- The guard checks the rows a cancel leaves, never a session setting. „kept“ gets a Stornorechnung beside
-- a cancel: seeded past the link guard as a draft that negates it, then issued through issue_invoice.
insert into ids values ('kept storno', gen_random_uuid());
reset role;
set local session_replication_role = replica;
insert into public.invoices (id, organization_id, client_id, recipient_client_id, job_id, service_start,
  service_end, payment_due_days, order_reference, buyer_reference, line_net_cents, tax_cents, gross_cents,
  cancels_invoice_id, cancellation_reason, created_by, updated_by)
select pg_temp.id('kept storno'), organization_id, client_id, recipient_client_id, job_id, service_start,
  service_end, 0, order_reference, buyer_reference, -line_net_cents, -tax_cents, -gross_cents, id, 'Probe',
  created_by, created_by
from issued where id = pg_temp.id('kept');
insert into public.invoice_lines (organization_id, invoice_id, position, name, description, quantity, unit,
  unit_price_cents, price_quantity, tax_category, tax_rate_basis_points, net_cents, leistung_id, item_id)
select organization_id, pg_temp.id('kept storno'), position, name, description, -quantity, unit, unit_price_cents,
  price_quantity, tax_category, tax_rate_basis_points, -net_cents, leistung_id, item_id
from issued_lines where invoice_id = pg_temp.id('kept');
set local session_replication_role = origin;
set local role service_role;
create function pg_temp.issue_kept_storno() returns jsonb language sql as $$
  select public.issue_invoice('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
    pg_temp.id('kept storno'), 1, gen_random_uuid(), (select issue_snapshot from issued where id = pg_temp.id('kept')),
    public.get_invoice_settings('38080000-0000-4000-8000-000000000010') ->> 'nextInvoiceNumber',
    (now() at time zone 'Europe/Berlin')::date)
$$;
-- A Stornorechnung is issued only as the exact negation of the invoice it cancels.
select pg_temp.expect_refusal(label, format('do $x$ begin %s; perform pg_temp.issue_kept_storno(); end $x$',
  statement), 'invoice_issued')
from (values
  ('a Stornorechnung with a line more', format($line$insert into public.invoice_lines (organization_id, invoice_id,
    position, name, quantity, unit, unit_price_cents, tax_category, tax_rate_basis_points, net_cents)
    values (%L, %L, 9, 'Nachtrag', 1, 'piece', 0, 'S', 1900, 0)$line$, '38080000-0000-4000-8000-000000000010',
    pg_temp.id('kept storno'))),
  ('a Stornorechnung line without its catalog source', format($line$delete from public.invoice_lines
      where invoice_id = %1$L and position = 1;
    insert into public.invoice_lines (organization_id, invoice_id, position, name, description, quantity, unit,
      unit_price_cents, price_quantity, tax_category, tax_rate_basis_points, net_cents)
    select organization_id, %1$L, position, name, description, -quantity, unit, unit_price_cents, price_quantity,
      tax_category, tax_rate_basis_points, -net_cents
    from issued_lines where invoice_id = %2$L and position = 1$line$, pg_temp.id('kept storno'), pg_temp.id('kept'))),
  ('a Stornorechnung without a line of the original', format(
    'delete from public.invoice_lines where invoice_id = %L and position = 2', pg_temp.id('kept storno'))),
  ('a Stornorechnung with another Leistungszeitraum', format(
    'update public.invoices set service_end = service_end + 1 where id = %L', pg_temp.id('kept storno'))),
  ('a Stornorechnung with another order reference', format(
    'update public.invoices set order_reference = ''BE-0815'' where id = %L', pg_temp.id('kept storno'))),
  ('a Stornorechnung with something due', format(
    'update public.invoices set payment_due_days = 14 where id = %L', pg_temp.id('kept storno')))
) as cases(label, statement);
-- An issue that inserts no history entry still meets the commit-time check: beside a matching `issued` entry
-- written before (seeded past the triggers), the Stornorechnung issued directly while its original stays
-- Ausgestellt is refused at commit (here at once).
savepoint seeded_issue_entry;
reset role;
set local session_replication_role = replica;
insert into public.invoice_events (organization_id, invoice_id, event_type, status, version, payload, actor_id,
  attempt_key)
select storno.organization_id, storno.id, 'issued', 'ausgestellt', 2,
  jsonb_build_object('invoiceNumber', public.get_invoice_settings(storno.organization_id) ->> 'nextInvoiceNumber',
    'issueDate', (now() at time zone 'Europe/Berlin')::date, 'grossCents', storno.gross_cents),
  '38080000-0000-4000-8000-000000000002', gen_random_uuid()
from public.invoices storno where storno.id = pg_temp.id('kept storno');
set local session_replication_role = origin;
set local role service_role;
select pg_temp.expect_refusal('a Stornorechnung issued beside an earlier issue entry, its original Ausgestellt',
  format($sql$do $x$ begin
    update public.invoices storno set status = 'ausgestellt', version = 2, issued_at = now(),
      issue_date = (now() at time zone 'Europe/Berlin')::date, issued_by = %1$L, updated_by = %1$L,
      invoice_number = public.get_invoice_settings(storno.organization_id) ->> 'nextInvoiceNumber',
      issue_snapshot = kept.issue_snapshot, logo_storage_path = kept.logo_storage_path,
      stationery_first_storage_path = kept.stationery_first_storage_path,
      stationery_following_storage_path = kept.stationery_following_storage_path
    from issued kept where storno.id = %2$L and kept.id = %3$L;
    set constraints all immediate;
  end $x$$sql$, '38080000-0000-4000-8000-000000000002', pg_temp.id('kept storno'), pg_temp.id('kept')),
  'invoice_history_unkept');
rollback to savepoint seeded_issue_entry;
release savepoint seeded_issue_entry;
set constraints invoice_history_kept, storno_original_cancelled deferred;
select pg_temp.issue_kept_storno();
-- At commit (here at once) no issued Stornorechnung stands beside an original still Ausgestellt.
select pg_temp.expect_refusal('a Stornorechnung issued beside an original still Ausgestellt',
  'do $x$ begin set constraints invoice_history_kept immediate; end $x$', 'invoice_history_unkept');
set constraints invoice_history_kept deferred;
-- Beside its issued Stornorechnung, even under the former cancel flag, „kept“ stays Ausgestellt while no
-- cancel's history entry names that Stornorechnung.
select pg_temp.expect_refusal(label, format(statement, pg_temp.id('kept')), 'invoice_issued')
from (values
  ('Storniert beside its Stornorechnung', 'update public.invoices set status = ''storniert'' where id = %L'),
  ('Storniert beside its Stornorechnung under the former cancel flag', 'update public.invoices
    set status = ''storniert'' where id = %1$L and set_config(''app.invoice_cancel'', %1$L, true) is not null')
) as cases(label, statement);
-- A cancel's history entry stands only beside its finished cancel, checked at commit (here at once): with
-- „kept“ still Ausgestellt the transaction is refused.
create function pg_temp.kept_cancelled_event(p_correction uuid default null) returns text language sql as $$
  select format($sql$insert into public.invoice_events (organization_id, invoice_id, event_type, status, version,
      payload, actor_id, attempt_key)
    select original.organization_id, original.id, 'cancelled', 'storniert', original.version,
      jsonb_build_object('stornoId', storno.id, 'stornoNumber', storno.invoice_number, 'issueDate', storno.issue_date,
        'correctionId', %L::uuid), %L, gen_random_uuid()
    from public.invoices original join public.invoices storno on storno.cancels_invoice_id = original.id
    where original.id = %L$sql$, p_correction, '38080000-0000-4000-8000-000000000002', pg_temp.id('kept'))
$$;
select pg_temp.expect_refusal('a cancel''s history entry beside an unfinished cancel', format(
  'do $x$ begin %s; set constraints invoice_history_kept immediate; end $x$', pg_temp.kept_cancelled_event()),
  'invoice_history_unkept');
-- A correction the entry names carries the original's terms and lines: one with other terms and no lines
-- is refused at commit, though the rest of the cancel is finished.
select pg_temp.expect_refusal('a cancel whose correction lacks the original''s terms and lines', format(
  $sql$do $x$ begin
    %s;
    insert into public.invoices (id, organization_id, client_id, recipient_client_id, payment_due_days,
      corrects_invoice_id, created_by, updated_by)
    values (%L, %L, %L, %L, 99, %L, %L, %L);
    update public.invoices set status = 'storniert' where id = %L;
    set constraints invoice_history_kept immediate;
  end $x$$sql$, pg_temp.kept_cancelled_event('38080000-0000-4000-8000-000000000501'),
  '38080000-0000-4000-8000-000000000501', '38080000-0000-4000-8000-000000000010',
  '38080000-0000-4000-8000-000000000020', '38080000-0000-4000-8000-000000000020', pg_temp.id('kept'),
  '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000002', pg_temp.id('kept')),
  'invoice_history_unkept');
set constraints invoice_history_kept deferred;
-- With that history entry the status alone turns, whoever writes: these are the rows a cancel leaves.
do $$
begin
  execute pg_temp.kept_cancelled_event();
end;
$$;
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

-- Only the cancel's own transaction links a correction: an entry from an earlier transaction names no new one.
select pg_temp.expect_refusal('a correction named by an earlier cancel''s entry', format($sql$do $x$ begin
    insert into public.invoice_events (organization_id, invoice_id, event_type, status, version, payload, actor_id,
      attempt_key, created_at)
    values (%1$L, %2$L, 'cancelled', 'storniert', 3, jsonb_build_object('correctionId', %3$L::uuid), %4$L,
      gen_random_uuid(), now() - interval '1 day');
    insert into public.invoices (id, organization_id, client_id, recipient_client_id, corrects_invoice_id)
    values (%3$L, %1$L, %5$L, %5$L, %2$L);
  end $x$$sql$, '38080000-0000-4000-8000-000000000010', pg_temp.id('cancelled'), '38080000-0000-4000-8000-000000000502',
  '38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000020'), 'invoice_link_fixed');

-- The correction is a draft like any: it is edited, and deleted with its link.
select pg_temp.expect_refusal('move the correction to another invoice',
  format('update public.invoices set corrects_invoice_id = %L where id = %L', pg_temp.id('kept'),
    pg_temp.id('correction')), 'invoice_link_fixed');
-- Every issue's and cancel's history entry stands beside its finished issue or cancel, as at commit.
set constraints invoice_history_kept, storno_original_cancelled immediate;
reset role;

-- An employee and another organization read neither the Stornorechnung nor the correction; the office reads both.
create function pg_temp.invoices_seen_by(p_user uuid, p_id uuid default null) returns bigint
language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.invoices
  where organization_id = '38080000-0000-4000-8000-000000000010' and (p_id is null or id = p_id);
  execute 'reset role';
  return v_count;
end;
$$;
-- While the correction draft exists, so a policy that exposed only correction drafts would show here.
do $$
declare
  v_correction uuid := (select id from ids where name = 'correction');
begin
  if pg_temp.invoices_seen_by('38080000-0000-4000-8000-000000000002', v_correction) is distinct from 1::bigint
    or pg_temp.invoices_seen_by('38080000-0000-4000-8000-000000000003', v_correction) is distinct from 0::bigint
    or pg_temp.invoices_seen_by('38080000-0000-4000-8000-000000000004', v_correction) is distinct from 0::bigint then
    raise exception 'the correction draft''s read crossed a role or an organization';
  end if;
end;
$$;
set local role service_role;
select public.delete_invoice_draft('38080000-0000-4000-8000-000000000002', '38080000-0000-4000-8000-000000000010',
  pg_temp.id('correction'), 1, gen_random_uuid());
reset role;

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
