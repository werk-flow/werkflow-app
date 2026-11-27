-- „Ausstellen“ gives a checked draft the next gapless number, freezes it and
-- registers its original once (migration
-- 20270205090000_issue_invoices_with_gapless_numbers.sql). Two concurrent
-- issues: invoice_issue_concurrency.sql.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38060000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'issue-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38060000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'issue-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38060000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'issue-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38060000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'issue-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38060000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Ausstellen', '38060000-0000-4000-8000-000000000001', 'ISSSQLA'),
('38060000-0000-4000-8000-000000000011', 'Fremde Haustechnik Ausstellen', '38060000-0000-4000-8000-000000000004', 'ISSSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000002', 'buero'),
('38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000003', 'employee');
insert into public.clients (id, organization_id, name, client_type, address) values
('38060000-0000-4000-8000-000000000020', '38060000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin');
insert into public.jobs (id, organization_id, title, job_number, client_id, status, created_by) values
('38060000-0000-4000-8000-000000000050', '38060000-0000-4000-8000-000000000010', 'Heizung tauschen',
 'I-80', '38060000-0000-4000-8000-000000000020', 'nicht_bearbeitet', '38060000-0000-4000-8000-000000000002'),
('38060000-0000-4000-8000-000000000051', '38060000-0000-4000-8000-000000000010', 'Zähler tauschen',
 'I-81', '38060000-0000-4000-8000-000000000020', 'nicht_bearbeitet', '38060000-0000-4000-8000-000000000002');

-- The field worker works on the second job, which the first invoice's original must never open to them.
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000051',
 '38060000-0000-4000-8000-000000000003', '38060000-0000-4000-8000-000000000002');
-- A plan on that job, which the field worker reads.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by
) values
('38060000-0000-4000-8000-000000000310', '38060000-0000-4000-8000-000000000010',
 '38060000-0000-4000-8000-000000000010/38060000-0000-4000-8000-000000000310/plan.pdf', 'plan.pdf', 'plan.pdf',
 'other', 10, '38060000-0000-4000-8000-000000000002');
insert into public.document_links (organization_id, document_id, job_id, created_by) values
('38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000310',
 '38060000-0000-4000-8000-000000000051', '38060000-0000-4000-8000-000000000002');

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

-- Grants: settings and every new function are server-only.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.invoice_settings', 'SELECT')
      or has_table_privilege(v_role, 'public.invoice_settings', 'INSERT')
      or has_table_privilege(v_role, 'public.invoice_settings', 'UPDATE')
      or has_function_privilege(v_role,
        'public.issue_invoice(uuid,uuid,uuid,integer,uuid,jsonb,text,date,uuid,text,text,bigint,text)', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.register_invoice_original(uuid,uuid,uuid,uuid,text,text,bigint,text)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.save_invoice_settings(uuid,uuid,integer,jsonb)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.get_invoice_settings(uuid)', 'EXECUTE') then
      raise exception '% reaches the invoice settings or an issue function', v_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.invoice_settings', 'DELETE') then
    raise exception 'service_role can delete a number series';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.invoice_settings'::regclass) then
    raise exception 'invoice_settings runs without RLS';
  end if;
end;
$$;

create temp table ids (name text primary key, id uuid) on commit drop;
grant select, insert on ids to service_role;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
grant execute on function pg_temp.id(text) to service_role;

set local role service_role;

-- The settings start at the default series; only an Admin saves them.
do $$
declare
  v_year text := to_char(now() at time zone 'Europe/Berlin', 'YYYY');
  v_settings jsonb := public.get_invoice_settings('38060000-0000-4000-8000-000000000010');
begin
  if v_settings ->> 'version' is distinct from '0' or v_settings ->> 'nextInvoiceNumber' is distinct from 'RE-' || v_year || '-001'
    or v_settings ->> 'numberYear' is distinct from v_year or (v_settings ->> 'numbersFixed')::boolean then
    raise exception 'the default settings read %', v_settings;
  end if;
end;
$$;
-- A year-based series read in another year (a form opened before New Year's midnight) is read again,
-- so that year's next number never carries into the new one, where the series restarts at 1.
select pg_temp.expect_refusal('a year-based series read last year', format($sql$
  select public.save_invoice_settings('38060000-0000-4000-8000-000000000001', '38060000-0000-4000-8000-000000000010', 0,
    '{"numberPrefix":"RE-","numberWithYear":true,"numberMinDigits":3,"nextNumber":57,"numberYear":%s,
      "paymentDueDays":14,"discountDays":null,"discountBasisPoints":null}')
$sql$, extract(year from now() at time zone 'Europe/Berlin')::integer - 1), 'invoice_year_changed');
select pg_temp.expect_refusal('Büro saves the series', $sql$
  select public.save_invoice_settings('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010', 0,
    '{"numberPrefix":"X","numberWithYear":false,"numberMinDigits":1,"nextNumber":5,"paymentDueDays":14,
      "discountDays":null,"discountBasisPoints":null}')
$sql$, 'not_authorized');
select pg_temp.expect_refusal('another organization''s Admin saves it', $sql$
  select public.save_invoice_settings('38060000-0000-4000-8000-000000000004', '38060000-0000-4000-8000-000000000010', 0,
    '{"numberPrefix":"X","numberWithYear":false,"numberMinDigits":1,"nextNumber":5,"paymentDueDays":14,
      "discountDays":null,"discountBasisPoints":null}')
$sql$, 'not_authorized');
-- The Admin continues the previous software's series: RG10234, 30 days, 2 % Skonto in 7 days.
select public.save_invoice_settings('38060000-0000-4000-8000-000000000001', '38060000-0000-4000-8000-000000000010', 0,
  '{"numberPrefix":"RG","numberWithYear":false,"numberMinDigits":5,"nextNumber":10234,"paymentDueDays":30,
    "discountDays":7,"discountBasisPoints":200}');
select pg_temp.expect_refusal('a save from an older version', $sql$
  select public.save_invoice_settings('38060000-0000-4000-8000-000000000001', '38060000-0000-4000-8000-000000000010', 0,
    '{"numberPrefix":"X","numberWithYear":false,"numberMinDigits":1,"nextNumber":5,"paymentDueDays":14,
      "discountDays":null,"discountBasisPoints":null}')
$sql$, 'stale_version');
do $$
begin
  if public.get_invoice_settings('38060000-0000-4000-8000-000000000010') ->> 'nextInvoiceNumber' is distinct from 'RG10234' then
    raise exception 'the saved series reads %', public.get_invoice_settings('38060000-0000-4000-8000-000000000010');
  end if;
end;
$$;

-- A new draft starts with the default terms. Three drafts: two complete, one without lines.
insert into ids values
  ('first', public.create_invoice('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    gen_random_uuid(), '38060000-0000-4000-8000-000000000020', 'job', '38060000-0000-4000-8000-000000000050')),
  ('second', public.create_invoice('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    gen_random_uuid(), '38060000-0000-4000-8000-000000000020', null, null)),
  ('empty', public.create_invoice('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    gen_random_uuid(), '38060000-0000-4000-8000-000000000020', null, null));
do $$
begin
  if exists (select 1 from public.invoices where id = pg_temp.id('first')
      and (payment_due_days, discount_days, discount_basis_points) is distinct from (30, 7, 200)) then
    raise exception 'a new draft did not take the default terms';
  end if;
end;
$$;
create function pg_temp.fill(p_name text) returns integer language sql as $$
  select public.save_invoice_draft('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    pg_temp.id(p_name), 1, gen_random_uuid(),
    '{"serviceStart":"2037-11-02","serviceEnd":"2037-11-02","paymentDueDays":30,"discountDays":7,
      "discountBasisPoints":200,"orderReference":"BE-4711","buyerReference":"","openingText":"","closingText":""}',
    '[{"name":"Monteurstunde","description":"","quantity":"1.5","unit":"hour","unitPriceCents":7200,
       "priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":1900,"netCents":10800}]',
    '{"lineNetCents":10800,"taxCents":2052,"grossCents":12852}')
$$;
select pg_temp.fill('first'), pg_temp.fill('second');

-- Issues under p_number and p_day: by default the series' next number and the Berlin day, as the server checks it.
-- The day is the clock's when the call starts, not the transaction's: issue_invoice reads the clock after its
-- lock, so a run that crosses Berlin midnight still issues on the day it checked.
-- With p_original, the issue registers the original the server stored under that document id (hash p_hash).
create function pg_temp.issue(p_actor uuid, p_org uuid, p_name text, p_version integer, p_attempt uuid,
  p_number text default null, p_day date default null, p_original uuid default null, p_hash text default null)
returns jsonb language sql as $$
  select public.issue_invoice(p_actor, p_org, pg_temp.id(p_name), p_version, p_attempt,
    '{"organizationName":"Haustechnik Sonnenberg","profile":{"companyName":"Haustechnik Sonnenberg GmbH"},
      "files":{"logo":{"path":"38060000-0000-4000-8000-000000000010/briefpapier/l/u/logo","mimeType":"image/png"},
               "stationery_first":null,"stationery_following":null},
      "buyer":{"name":"Hausverwaltung Lindenhof GmbH","address":{"lines":["Hofweg 1"],"postalCode":"10117",
               "city":"Berlin","countryCode":"DE"}}}',
    coalesce(p_number, public.get_invoice_settings(p_org) ->> 'nextInvoiceNumber'),
    coalesce(p_day, (clock_timestamp() at time zone 'Europe/Berlin')::date),
    p_original,
    case when p_original is not null then p_org || '/' || p_original || '/Rechnung.pdf' end,
    case when p_original is not null then 'Rechnung.pdf' end,
    case when p_original is not null then 4096 end,
    case when p_original is not null then coalesce(p_hash, repeat('c', 64)) end)
$$;

-- A refused issue uses no number: an incomplete draft, a field worker, an
-- outsider, another organization, an older version, a number or day other
-- than the one the series gives it now (the server checked the invoice under
-- it, and the original's head prints it).
select pg_temp.expect_refusal(label, format('select pg_temp.issue(%L, %L, %L, %s, gen_random_uuid())',
  actor, org, invoice, version), refusal)
from (values
  ('a draft without lines or Leistungsdatum', '38060000-0000-4000-8000-000000000002',
   '38060000-0000-4000-8000-000000000010', 'empty', 1, 'invoice_incomplete'),
  ('employee', '38060000-0000-4000-8000-000000000003', '38060000-0000-4000-8000-000000000010', 'first', 2,
   'not_authorized'),
  ('outsider', '38060000-0000-4000-8000-000000000004', '38060000-0000-4000-8000-000000000010', 'first', 2,
   'not_authorized'),
  ('another organization''s Admin', '38060000-0000-4000-8000-000000000004', '38060000-0000-4000-8000-000000000011',
   'first', 2, 'invoice_not_found'),
  ('an older version', '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010', 'first', 1,
   'stale_version')
) as cases(label, actor, org, invoice, version, refusal);
select pg_temp.expect_refusal(label, format('select pg_temp.issue(%L, %L, ''first'', 2, gen_random_uuid(), %L, %L)',
  '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010', expected_number, expected_day),
  'invoice_number_moved')
from (values
  ('a number another issue took meanwhile', 'RG10235', (now() at time zone 'Europe/Berlin')::date),
  -- What the server sends for a used-up series: never a number the series gives, so never an issue.
  ('no number', '', (now() at time zone 'Europe/Berlin')::date),
  ('another day', 'RG10234', (now() at time zone 'Europe/Berlin')::date - 1)
) as cases(label, expected_number, expected_day);
-- A refused issue registers none of the original it was passed; a refused
-- registration, the issue's last step, rolls back the number, status and history.
select pg_temp.expect_refusal('a moved number with its original', format(
  'select pg_temp.issue(%L, %L, ''first'', 2, gen_random_uuid(), ''RG10235'', null, %L)',
  '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
  '38060000-0000-4000-8000-000000000303'), 'invoice_number_moved');
select pg_temp.expect_refusal('the checked number with an original the registration refuses', format(
  'select pg_temp.issue(%L, %L, ''first'', 2, gen_random_uuid(), null, null, %L, ''no-hash'')',
  '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
  '38060000-0000-4000-8000-000000000305'), 'invalid_input');
do $$
begin
  if exists (select 1 from public.documents
      where id in ('38060000-0000-4000-8000-000000000303', '38060000-0000-4000-8000-000000000305')) then
    raise exception 'a refused issue registered its original';
  end if;
  if exists (select 1 from public.invoice_events where organization_id = '38060000-0000-4000-8000-000000000010'
      and event_type in ('issued', 'original_registered')) then
    raise exception 'a refused issue wrote history';
  end if;
  if exists (select 1 from public.invoices where organization_id = '38060000-0000-4000-8000-000000000010'
      and status is distinct from 'entwurf')
    or (select (next_number, first_issued_at is null) from public.invoice_settings
      where organization_id = '38060000-0000-4000-8000-000000000010') is distinct from (10234, true) then
    raise exception 'a refused issue used a number or issued a draft';
  end if;
end;
$$;

-- Issued: the next number, the Berlin day, the snapshot, frozen, with history.
do $$
declare
  v_issued jsonb := pg_temp.issue('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    'first', 2, '38060000-0000-4000-8000-000000000201');
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices where id = pg_temp.id('first');
  if v_issued ->> 'invoiceNumber' is distinct from 'RG10234' or v_invoice.invoice_number is distinct from 'RG10234'
    -- Issued without an original, as when the storage was unreachable: pending, no document.
    or v_issued -> 'originalDocumentId' is distinct from 'null'::jsonb or v_invoice.original_document_id is not null
    or v_invoice.status is distinct from 'ausgestellt' or v_invoice.version is distinct from 3
    or v_invoice.issue_date::text is distinct from v_issued ->> 'issueDate'
    or v_invoice.issue_date not between (now() at time zone 'Europe/Berlin')::date
      and (clock_timestamp() at time zone 'Europe/Berlin')::date
    or v_invoice.issued_by is distinct from '38060000-0000-4000-8000-000000000002'
    or v_invoice.issue_snapshot #>> '{buyer,name}' is distinct from 'Hausverwaltung Lindenhof GmbH'
    or v_invoice.logo_storage_path is distinct from '38060000-0000-4000-8000-000000000010/briefpapier/l/u/logo' then
    raise exception 'the issued invoice is % (answer %)', to_jsonb(v_invoice), v_issued;
  end if;
  if not exists (select 1 from public.invoice_events where invoice_id = v_invoice.id and event_type = 'issued'
      and payload ->> 'invoiceNumber' = 'RG10234') then
    raise exception 'the issue wrote no history';
  end if;
  -- A retry under the same key answers the first issue and uses no number. The original it
  -- passes may carry the next number (it read the series after the first issue), so it registers none.
  v_issued := pg_temp.issue('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    'first', 2, '38060000-0000-4000-8000-000000000201', 'RG10235', null, '38060000-0000-4000-8000-000000000306');
  if v_issued ->> 'invoiceNumber' is distinct from 'RG10234'
    or v_issued -> 'originalDocumentId' is distinct from 'null'::jsonb
    or exists (select 1 from public.documents where id = '38060000-0000-4000-8000-000000000306')
    or (select count(*) from public.invoice_events where invoice_id = v_invoice.id and event_type = 'issued') is distinct from 1 then
    raise exception 'a retried issue issued again or registered its original: %', v_issued;
  end if;
end;
$$;

-- An issue passed its original registers and files it in the issue's own transaction.
do $$
declare
  v_issued jsonb := pg_temp.issue('38060000-0000-4000-8000-000000000001', '38060000-0000-4000-8000-000000000010',
    'second', 2, gen_random_uuid(), null, null, '38060000-0000-4000-8000-000000000304');
  v_document public.documents;
begin
  select * into v_document from public.documents where id = '38060000-0000-4000-8000-000000000304';
  if v_issued ->> 'invoiceNumber' is distinct from 'RG10235'
    or v_issued ->> 'originalDocumentId' is distinct from '38060000-0000-4000-8000-000000000304'
    or (select original_document_id from public.invoices where id = pg_temp.id('second'))
      is distinct from '38060000-0000-4000-8000-000000000304'
    or v_document.retention_class is distinct from 'ten_years' or v_document.filed_at is null
    or v_document.filed_by is distinct from '38060000-0000-4000-8000-000000000001'
    or v_document.metadata ->> 'invoiceId' is distinct from pg_temp.id('second')::text then
    raise exception 'the second issue answered % with its original %', v_issued, to_jsonb(v_document);
  end if;
end;
$$;

-- A filed ten-year invoice document of the first invoice, linked to its customer
-- only, written directly: everything the registration leaves but its history entry.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  document_date, retention_class, metadata
) values (
  '38060000-0000-4000-8000-000000000305', '38060000-0000-4000-8000-000000000010',
  '38060000-0000-4000-8000-000000000010/38060000-0000-4000-8000-000000000305/Rechnung direkt.pdf',
  'Rechnung direkt.pdf', 'Rechnung direkt.pdf', 'invoice', 4096, '38060000-0000-4000-8000-000000000002',
  (select issue_date from public.invoices where id = pg_temp.id('first')), 'ten_years',
  jsonb_build_object('invoiceId', pg_temp.id('first'), 'contentHash', repeat('d', 64))
);
insert into public.document_links (organization_id, document_id, client_id, created_by) values
('38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000305',
 '38060000-0000-4000-8000-000000000020', '38060000-0000-4000-8000-000000000002');
select public.file_document('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
  '38060000-0000-4000-8000-000000000305');
-- Two more, each with a history entry written directly: one filed but without
-- its customer link, one linked but marked filed without a filing record.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  document_date, retention_class, metadata, filed_at, filed_by
)
select fixture.document_id, '38060000-0000-4000-8000-000000000010',
  '38060000-0000-4000-8000-000000000010/' || fixture.document_id || '/' || fixture.file_name,
  fixture.file_name, fixture.file_name, 'invoice', 4096, '38060000-0000-4000-8000-000000000002',
  (select issue_date from public.invoices where id = pg_temp.id('first')), 'ten_years',
  jsonb_build_object('invoiceId', pg_temp.id('first'), 'contentHash', repeat('d', 64)),
  fixture.filed_at, fixture.filed_by
from (values
  ('38060000-0000-4000-8000-000000000307'::uuid, 'Rechnung ohne Kunde.pdf', null::timestamptz, null::uuid),
  ('38060000-0000-4000-8000-000000000308'::uuid, 'Rechnung ohne Ablage.pdf', now(),
   '38060000-0000-4000-8000-000000000002'::uuid)
) as fixture(document_id, file_name, filed_at, filed_by);
insert into public.document_links (organization_id, document_id, client_id, created_by) values
('38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000308',
 '38060000-0000-4000-8000-000000000020', '38060000-0000-4000-8000-000000000002');
select public.file_document('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
  '38060000-0000-4000-8000-000000000307');
insert into public.invoice_events (
  organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
)
select invoice.organization_id, invoice.id, 'original_registered', invoice.status, invoice.version,
  jsonb_build_object('documentId', fixture.document_id, 'contentHash', repeat('d', 64)),
  '38060000-0000-4000-8000-000000000002', fixture.document_id
from public.invoices invoice
cross join (values ('38060000-0000-4000-8000-000000000307'::uuid), ('38060000-0000-4000-8000-000000000308'::uuid))
  as fixture(document_id)
where invoice.id = pg_temp.id('first');

-- An issued invoice refuses every change and delete, through the app's functions and directly.
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('save', format('select public.save_invoice_draft(%L, %L, %L, 3, gen_random_uuid(), ''{}'', ''[]'', ''{}'')',
    '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010', pg_temp.id('first')),
    'invoice_not_draft'),
  ('delete through the app', format('select public.delete_invoice_draft(%L, %L, %L, 3, gen_random_uuid())',
    '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010', pg_temp.id('first')),
    'invoice_not_draft'),
  ('issue again', format('select pg_temp.issue(%L, %L, ''first'', 3, gen_random_uuid())',
    '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010'), 'invoice_not_draft'),
  ('change an amount', format('update public.invoices set gross_cents = 0, tax_cents = 0, line_net_cents = 0 where id = %L',
    pg_temp.id('first')), 'invoice_issued'),
  ('change a reference', format('update public.invoices set order_reference = ''X'' where id = %L',
    pg_temp.id('first')), 'invoice_issued'),
  ('back to a draft', format('update public.invoices set status = ''entwurf'' where id = %L', pg_temp.id('first')),
    'invoice_issued'),
  ('another work', format('update public.invoices set job_id = %L where id = %L',
    '38060000-0000-4000-8000-000000000051', pg_temp.id('first')), 'invoice_issued'),
  ('delete directly', format('delete from public.invoices where id = %L', pg_temp.id('first')), 'invoice_issued'),
  ('delete a line', format('delete from public.invoice_lines where invoice_id = %L', pg_temp.id('first')),
    'invoice_issued'),
  ('add a line', format($line$insert into public.invoice_lines (organization_id, invoice_id, position, name,
    quantity, unit, unit_price_cents, tax_category, tax_rate_basis_points, net_cents)
    values (%L, %L, 9, 'Nachtrag', 1, 'piece', 100, 'S', 1900, 100)$line$,
    '38060000-0000-4000-8000-000000000010', pg_temp.id('first')), 'invoice_issued'),
  ('move the series', 'update public.invoice_settings set next_number = 1
    where organization_id = ''38060000-0000-4000-8000-000000000010''', 'invoice_numbers_fixed'),
  ('change the prefix', 'update public.invoice_settings set number_prefix = ''X''
    where organization_id = ''38060000-0000-4000-8000-000000000010''', 'invoice_numbers_fixed'),
  -- A reference clears only when its target is gone: the foreign key's set null.
  ('clear a live work', format('update public.invoices set job_id = null where id = %L', pg_temp.id('first')),
    'invoice_issued'),
  ('clear a live person', format('update public.invoices set issued_by = null where id = %L', pg_temp.id('first')),
    'invoice_issued'),
  -- Only register_invoice_original names the first original, after it filed it,
  -- also not a direct issue of a draft that names one in the same statement.
  ('name an original directly', format('update public.invoices set original_document_id = %L where id = %L',
    '38060000-0000-4000-8000-000000000304', pg_temp.id('first')), 'invoice_issued'),
  ('issue a draft with an original directly', format(
    'update public.invoices set status = ''ausgestellt'', invoice_number = ''X-1'', issue_date = current_date,
      issued_at = now(), issue_snapshot = ''{}'', original_document_id = %L where id = %L',
    '38060000-0000-4000-8000-000000000304', pg_temp.id('empty')), 'invoice_issued'),
  -- The guard checks the document, not a session setting: a direct write that
  -- raises the registration's former flag names neither a work's plan nor a
  -- filed invoice document without the registration's history entry.
  ('name a work''s plan under the old flag', format(
    'with flag as (select set_config(''app.invoice_original_write'', ''on'', true))
      update public.invoices set original_document_id = %L where id = %L and exists (select 1 from flag)',
    '38060000-0000-4000-8000-000000000310', pg_temp.id('first')), 'invoice_issued'),
  ('name a filed invoice document without its registration', format(
    'with flag as (select set_config(''app.invoice_original_write'', ''on'', true))
      update public.invoices set original_document_id = %L where id = %L and exists (select 1 from flag)',
    '38060000-0000-4000-8000-000000000305', pg_temp.id('first')), 'invoice_issued'),
  ('name a filed invoice document without its customer link', format(
    'update public.invoices set original_document_id = %L where id = %L',
    '38060000-0000-4000-8000-000000000307', pg_temp.id('first')), 'invoice_issued'),
  ('name an invoice document marked filed without its filing record', format(
    'update public.invoices set original_document_id = %L where id = %L',
    '38060000-0000-4000-8000-000000000308', pg_temp.id('first')), 'invoice_issued')
) as cases(label, statement, refusal);

-- Only an issue moves the series and issues a draft. The guards check the rows issue_invoice leaves, not a
-- session setting, so the series' former flag moves no number, and a complete draft written as issued,
-- under the series' next number and today's day, stays a draft without the issue's history entry or under
-- a number the series has not reached. Every insert is a draft.
insert into ids values ('direct', public.create_invoice('38060000-0000-4000-8000-000000000002',
  '38060000-0000-4000-8000-000000000010', gen_random_uuid(), '38060000-0000-4000-8000-000000000020', null, null));
select pg_temp.fill('direct');
create function pg_temp.issue_directly(p_number text) returns text language sql as $$
  select format($sql$update public.invoices invoice set status = 'ausgestellt', invoice_number = %L,
      issue_date = (clock_timestamp() at time zone 'Europe/Berlin')::date, issued_at = now(), issued_by = %L,
      updated_by = %L, version = invoice.version + 1, issue_snapshot = first.issue_snapshot,
      logo_storage_path = first.logo_storage_path
    from public.invoices first where invoice.id = %L and first.id = %L$sql$,
    p_number, '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000002',
    pg_temp.id('direct'), pg_temp.id('first'))
$$;
create function pg_temp.issued_event(p_number text) returns text language sql as $$
  select format($sql$insert into public.invoice_events (organization_id, invoice_id, event_type, status, version,
      payload, actor_id, attempt_key)
    select %L, %L, 'issued', 'ausgestellt', 3, jsonb_build_object('invoiceNumber', %L,
      'issueDate', (clock_timestamp() at time zone 'Europe/Berlin')::date, 'grossCents', 12852), %L,
      gen_random_uuid()$sql$,
    '38060000-0000-4000-8000-000000000010', pg_temp.id('direct'), p_number, '38060000-0000-4000-8000-000000000002')
$$;
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('step the series under its former flag', $sql$with flag as (select set_config('app.invoice_number_write', 'on', true))
    update public.invoice_settings set next_number = next_number + 1
    where organization_id = '38060000-0000-4000-8000-000000000010' and exists (select 1 from flag)$sql$,
    'invoice_numbers_fixed'),
  ('start a new year under its former flag', $sql$with flag as (select set_config('app.invoice_number_write', 'on', true))
    update public.invoice_settings set number_year = number_year + 1, next_number = 2
    where organization_id = '38060000-0000-4000-8000-000000000010' and exists (select 1 from flag)$sql$,
    'invoice_numbers_fixed'),
  ('move the series to another organization', $sql$update public.invoice_settings
    set organization_id = '38060000-0000-4000-8000-000000000011'
    where organization_id = '38060000-0000-4000-8000-000000000010'$sql$, 'invoice_numbers_fixed'),
  ('issue a draft directly under the series'' next number', pg_temp.issue_directly('RG10236'), 'invoice_issued'),
  ('issue a draft directly with its history entry under a number the series has not reached',
    format('do $x$ begin %s; %s; end $x$', pg_temp.issued_event('RG10237'), pg_temp.issue_directly('RG10237')),
    'invoice_number_moved'),
  -- The history entry stands only beside its issue, checked at commit (here at once).
  ('an issue''s history entry without its issue', format(
    'do $x$ begin %s; set constraints invoice_history_kept immediate; end $x$', pg_temp.issued_event('RG10236')),
    'invoice_history_unkept'),
  ('a second history entry of an issue', format($sql$do $x$ begin
      insert into public.invoice_events (organization_id, invoice_id, event_type, status, version, payload, actor_id,
        attempt_key)
      select organization_id, invoice_id, event_type, status, version, payload, actor_id, gen_random_uuid()
      from public.invoice_events where invoice_id = %L and event_type = 'issued';
      set constraints invoice_history_kept immediate;
    end $x$$sql$, pg_temp.id('first')), 'invoice_history_unkept'),
  ('insert an issued invoice', format($sql$insert into public.invoices (organization_id, client_id,
      recipient_client_id, status, invoice_number, issue_date, issued_at, issue_snapshot)
    values (%L, %L, %L, 'ausgestellt', 'RG10236', (now() at time zone 'Europe/Berlin')::date, now(), '{}')$sql$,
    '38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000020',
    '38060000-0000-4000-8000-000000000020'), 'invoice_issued')
) as cases(label, statement, refusal);
set constraints invoice_history_kept deferred;
-- The refused writes left the series, the draft and the history as they were, and an issue retried under its
-- first key answers the first issue even with the empty number the server sends for a used-up series.
do $$
begin
  if (select (next_number, number_year) from public.invoice_settings
      where organization_id = '38060000-0000-4000-8000-000000000010')
      is distinct from (10236, extract(year from now() at time zone 'Europe/Berlin')::integer)
    or (select status from public.invoices where id = pg_temp.id('direct')) is distinct from 'entwurf'
    or exists (select 1 from public.invoice_events where invoice_id = pg_temp.id('direct') and event_type = 'issued')
    or exists (select 1 from public.invoices where organization_id = '38060000-0000-4000-8000-000000000010'
      and invoice_number in ('RG10236', 'RG10237')) then
    raise exception 'a refused direct write moved the series or issued a draft';
  end if;
  if pg_temp.issue('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010', 'first', 2,
      '38060000-0000-4000-8000-000000000201', '') ->> 'invoiceNumber' is distinct from 'RG10234' then
    raise exception 'an issue retried with the empty number did not answer the first issue';
  end if;
  perform public.delete_invoice_draft('38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    pg_temp.id('direct'), 2, gen_random_uuid());
end;
$$;
-- A deleted work clears its reference only.
reset role;
do $$
declare
  v_before jsonb := to_jsonb((select invoice from public.invoices invoice where id = pg_temp.id('first')));
  v_after jsonb;
begin
  delete from public.jobs where id = '38060000-0000-4000-8000-000000000050';
  v_after := to_jsonb((select invoice from public.invoices invoice where id = pg_temp.id('first')));
  if v_after ->> 'job_id' is not null or v_after - 'job_id' is distinct from v_before - 'job_id' then
    raise exception 'deleting the work changed the issued invoice from % to %', v_before, v_after;
  end if;
end;
$$;
set local role service_role;

-- After the first issue a save keeps the series and changes only the terms.
select public.save_invoice_settings('38060000-0000-4000-8000-000000000001', '38060000-0000-4000-8000-000000000010',
  (select version from public.invoice_settings where organization_id = '38060000-0000-4000-8000-000000000010'),
  '{"numberPrefix":"X","numberWithYear":true,"numberMinDigits":1,"nextNumber":1,"paymentDueDays":10,
    "discountDays":null,"discountBasisPoints":null}');
do $$
begin
  if (select (number_prefix, number_with_year, next_number, payment_due_days)
      from public.invoice_settings where organization_id = '38060000-0000-4000-8000-000000000010')
      is distinct from ('RG'::text, false, 10236, 10) then
    raise exception 'a save after the first issue moved the series';
  end if;
end;
$$;

-- The original registers once, in the ten-year class, linked to the customer only.
select pg_temp.expect_refusal(label, format(
  'select public.register_invoice_original(%L, %L, %L, %L, %L, ''Rechnung.pdf'', 100, %L)',
  actor, org, invoice, document, org || '/' || document || '/Rechnung.pdf', repeat('a', 64)), refusal)
from (values
  ('a draft', '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
   pg_temp.id('empty'), gen_random_uuid(), 'invoice_not_issued'),
  ('employee', '38060000-0000-4000-8000-000000000003', '38060000-0000-4000-8000-000000000010',
   pg_temp.id('first'), gen_random_uuid(), 'not_authorized'),
  ('another organization', '38060000-0000-4000-8000-000000000004', '38060000-0000-4000-8000-000000000011',
   pg_temp.id('first'), gen_random_uuid(), 'invoice_not_found')
) as cases(label, actor, org, invoice, document, refusal);
insert into ids values ('original', '38060000-0000-4000-8000-000000000301');
do $$
declare
  v_first jsonb := public.register_invoice_original('38060000-0000-4000-8000-000000000002',
    '38060000-0000-4000-8000-000000000010', pg_temp.id('first'), '38060000-0000-4000-8000-000000000301',
    '38060000-0000-4000-8000-000000000010/38060000-0000-4000-8000-000000000301/Rechnung RG10234.pdf',
    'Rechnung RG10234.pdf', 4096, repeat('b', 64));
  v_again jsonb := public.register_invoice_original('38060000-0000-4000-8000-000000000002',
    '38060000-0000-4000-8000-000000000010', pg_temp.id('first'), '38060000-0000-4000-8000-000000000302',
    '38060000-0000-4000-8000-000000000010/38060000-0000-4000-8000-000000000302/Rechnung RG10234.pdf',
    'Rechnung RG10234.pdf', 4096, repeat('b', 64));
  v_document public.documents;
begin
  select * into v_document from public.documents where id = '38060000-0000-4000-8000-000000000301';
  if (v_first ->> 'replay')::boolean is distinct from false or v_document.category is distinct from 'invoice'
    or v_document.retention_class is distinct from 'ten_years'
    or v_document.document_date is distinct from (select issue_date from public.invoices where id = pg_temp.id('first'))
    or v_document.mime_type is distinct from 'application/pdf'
    -- Filed in the registration's transaction: no moment for a new version or another class.
    or v_document.filed_at is null or v_document.filed_by is distinct from '38060000-0000-4000-8000-000000000002' then
    raise exception 'the original registered as %', to_jsonb(v_document);
  end if;
  if (select array_agg(num_nonnulls(job_id, project_id, request_id, service_case_id, employee_id) || ':' || client_id)
      from public.document_links where document_id = v_document.id)
      is distinct from array['0:38060000-0000-4000-8000-000000000020'] then
    raise exception 'the original is linked to more than its customer';
  end if;
  if (v_again ->> 'replay')::boolean is distinct from true or v_again ->> 'documentId' is distinct from v_document.id::text
    or exists (select 1 from public.documents where id = '38060000-0000-4000-8000-000000000302') then
    raise exception 'a second registration registered again: %', v_again;
  end if;
  if (select original_document_id from public.invoices where id = pg_temp.id('first')) is distinct from v_document.id then
    raise exception 'the invoice does not name its original';
  end if;
end;
$$;

-- The invoice page reads through get_invoice_with_line_sources (lib/invoices/reads.ts): an issued
-- invoice read there keeps its number, its dates and its original beside the line sources.
do $$
declare
  v_read jsonb := public.get_invoice_with_line_sources('38060000-0000-4000-8000-000000000010',
    pg_temp.id('first'));
begin
  if v_read ->> 'status' is distinct from 'ausgestellt' or v_read ->> 'invoiceNumber' is distinct from 'RG10234'
    or v_read ->> 'issueDate' is distinct from (select issue_date from public.invoices where id = pg_temp.id('first'))::text
    or v_read ->> 'serviceStart' is distinct from '2037-11-02' or v_read ->> 'serviceEnd' is distinct from '2037-11-02'
    or v_read -> 'original' is distinct from
      jsonb_build_object('documentId', '38060000-0000-4000-8000-000000000301', 'filed', true)
    or v_read -> 'issueSnapshot' is null or v_read -> 'issueSnapshot' = 'null'::jsonb
    -- The one line pg_temp.fill saved, a free line: its source is null.
    or jsonb_array_length(v_read -> 'lines') is distinct from 1
    or v_read #>> '{lines,0,name}' is distinct from 'Monteurstunde' or v_read #>> '{lines,0,netCents}' is distinct from '10800'
    or v_read -> 'lineSources' is distinct from '[null]'::jsonb then
    raise exception 'the page reads the issued invoice as %', v_read;
  end if;
end;
$$;

-- No one links a work, customer or person to the original, through the app
-- or directly: a work link would open it to every employee assigned to that
-- work. Removal stays (below).
select pg_temp.expect_refusal(label, statement, 'document_is_invoice_original')
from (values
  ('link the original to a job', format(
    'select public.update_document_links(%L, %L, %L, null, %L, null, null, null, null, null, null)',
    '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    '38060000-0000-4000-8000-000000000301', '{38060000-0000-4000-8000-000000000051}')),
  ('link it to its customer again', format(
    'select public.update_document_links(%L, %L, %L, null, null, null, %L, null, null, null, null)',
    '38060000-0000-4000-8000-000000000002', '38060000-0000-4000-8000-000000000010',
    '38060000-0000-4000-8000-000000000301', '{38060000-0000-4000-8000-000000000020}')),
  ('insert a job link directly', $direct$insert into public.document_links
    (organization_id, document_id, job_id, created_by) values ('38060000-0000-4000-8000-000000000010',
    '38060000-0000-4000-8000-000000000301', '38060000-0000-4000-8000-000000000051',
    '38060000-0000-4000-8000-000000000002')$direct$),
  ('turn the customer link to a job', $direct$update public.document_links
    set client_id = null, job_id = '38060000-0000-4000-8000-000000000051'
    where document_id = '38060000-0000-4000-8000-000000000301'$direct$)
) as cases(label, statement);

-- Filed, the original is never deleted or replaced, and the invoice keeps it.
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('delete the original', 'delete from public.documents where id = ''38060000-0000-4000-8000-000000000301''',
    'document_filed'),
  ('replace its bytes', 'update public.documents set storage_path = ''38060000-0000-4000-8000-000000000010/x''
    where id = ''38060000-0000-4000-8000-000000000301''', 'document_filed'),
  ('point the invoice elsewhere', format('update public.invoices set original_document_id = null where id = %L',
    pg_temp.id('first')), 'invoice_issued')
) as cases(label, statement, refusal);
reset role;

-- A signed-in session reads no settings; an employee and another organization read no invoice.
create function pg_temp.invoices_seen_by(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
  v_first uuid := pg_temp.id('first');
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.invoices where organization_id = '38060000-0000-4000-8000-000000000010';
  perform pg_temp.expect_refusal('settings read', 'select count(*) from public.invoice_settings', '42501');
  perform pg_temp.expect_refusal('change an issued invoice',
    format('update public.invoices set order_reference = ''X'' where id = %L', v_first), '42501');
  execute 'reset role';
  return v_count;
end;
$$;
create function pg_temp.document_seen_by(p_user uuid, p_document uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.documents where id = p_document;
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.invoices_seen_by('38060000-0000-4000-8000-000000000001') is distinct from 3::bigint
    or pg_temp.invoices_seen_by('38060000-0000-4000-8000-000000000003') is distinct from 0::bigint
    or pg_temp.invoices_seen_by('38060000-0000-4000-8000-000000000004') is distinct from 0::bigint then
    raise exception 'an invoice read crossed a role or an organization';
  end if;
  -- The refused link left the field worker on the second job without the
  -- original, while they read that job's plan.
  if pg_temp.document_seen_by('38060000-0000-4000-8000-000000000003', '38060000-0000-4000-8000-000000000310')
      is distinct from 1::bigint
    or pg_temp.document_seen_by('38060000-0000-4000-8000-000000000001', '38060000-0000-4000-8000-000000000301')
      is distinct from 1::bigint
    or pg_temp.document_seen_by('38060000-0000-4000-8000-000000000003', '38060000-0000-4000-8000-000000000301')
      is distinct from 0::bigint then
    raise exception 'the assigned field worker reads the original, or the reads prove nothing';
  end if;
end;
$$;

-- A manager still removes the original's customer link; the filed original and the invoice's reference stay.
do $$
declare
  v_counts record;
begin
  select * into v_counts from public.update_document_links('38060000-0000-4000-8000-000000000002',
    '38060000-0000-4000-8000-000000000010', '38060000-0000-4000-8000-000000000301',
    array(select id from public.document_links where document_id = '38060000-0000-4000-8000-000000000301'),
    null, null, null, null, null, null, null);
  if v_counts.removed_count is distinct from 1
    or exists (select 1 from public.document_links where document_id = '38060000-0000-4000-8000-000000000301')
    or not exists (select 1 from public.documents
      where id = '38060000-0000-4000-8000-000000000301' and filed_at is not null and deleted_at is null)
    or (select original_document_id from public.invoices where id = pg_temp.id('first'))
      is distinct from '38060000-0000-4000-8000-000000000301' then
    raise exception 'removing the original''s customer link answered % or changed the original', v_counts;
  end if;
end;
$$;

-- With the year in the number, a new year starts at 1; the same year continues.
insert into public.invoice_settings (organization_id, number_prefix, number_with_year, number_min_digits, next_number,
  number_year)
values ('38060000-0000-4000-8000-000000000011', 'RE-', true, 3, 57,
  extract(year from now() at time zone 'Europe/Berlin')::integer - 1);
do $$
declare
  v_year text := to_char(now() at time zone 'Europe/Berlin', 'YYYY');
begin
  if public.get_invoice_settings('38060000-0000-4000-8000-000000000011') ->> 'nextInvoiceNumber'
      is distinct from 'RE-' || v_year || '-001' then
    raise exception 'a new year continued last year''s numbers';
  end if;
  update public.invoice_settings set number_year = v_year::integer
  where organization_id = '38060000-0000-4000-8000-000000000011';
  if public.get_invoice_settings('38060000-0000-4000-8000-000000000011') ->> 'nextInvoiceNumber'
      is distinct from 'RE-' || v_year || '-057' then
    raise exception 'the same year did not continue its numbers';
  end if;
  -- A used-up series advertises no number: issue_invoice refuses its next sequence.
  update public.invoice_settings set next_number = 999999999
  where organization_id = '38060000-0000-4000-8000-000000000011';
  if public.get_invoice_settings('38060000-0000-4000-8000-000000000011') -> 'nextInvoiceNumber'
      is distinct from 'null'::jsonb then
    raise exception 'a used-up series advertises %',
      public.get_invoice_settings('38060000-0000-4000-8000-000000000011') -> 'nextInvoiceNumber';
  end if;
end;
$$;

-- Every issue's history entry stands beside its issue.
set constraints invoice_history_kept immediate;

-- Deleting an organization removes its issued invoices, series and originals with it.
delete from public.organizations where id = '38060000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.invoices where organization_id = '38060000-0000-4000-8000-000000000010')
    or exists (select 1 from public.invoice_settings where organization_id = '38060000-0000-4000-8000-000000000010')
    -- The filed originals, the first one registered above among them.
    or exists (select 1 from public.documents
      where organization_id = '38060000-0000-4000-8000-000000000010' and category = 'invoice')
    or exists (select 1 from public.documents where id = '38060000-0000-4000-8000-000000000301') then
    raise exception 'organization teardown left invoice rows';
  end if;
end;
$$;

rollback;
