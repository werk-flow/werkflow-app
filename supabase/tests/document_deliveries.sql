-- Deliveries of filed documents (20261219140000_record_document_deliveries.sql,
-- werk-flow/werkflow-planning#458): no client role writes a delivery or runs a
-- function, and a session reads only the id, subject and state of its
-- organization's rows as Admin or Büro; an employee, an outsider and another
-- organization are refused; only the issued invoice's own filed original is
-- attached, never another organization's document; a repeated request sends
-- nothing again; a failed attempt is retried once, a sent one never; manual
-- sending is recorded once; an attempt without the provider's answer marks
-- the delivery for good, past a later failure of another kind; the history
-- and that mark refuse changes.
-- Runs inside one transaction against the local stack and rolls back.
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38070000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'delivery-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38070000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'delivery-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38070000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'delivery-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38070000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'delivery-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38070000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Versand', '38070000-0000-4000-8000-000000000001', 'DELSQLA'),
('38070000-0000-4000-8000-000000000011', 'Fremde Haustechnik Versand', '38070000-0000-4000-8000-000000000004', 'DELSQLB');
insert into public.organization_members (organization_id, user_id, role) values
('38070000-0000-4000-8000-000000000010', '38070000-0000-4000-8000-000000000002', 'buero'),
('38070000-0000-4000-8000-000000000010', '38070000-0000-4000-8000-000000000003', 'employee');
insert into public.clients (id, organization_id, name, client_type, address) values
('38070000-0000-4000-8000-000000000020', '38070000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin'),
('38070000-0000-4000-8000-000000000021', '38070000-0000-4000-8000-000000000011',
 'Hausverwaltung Fremd GmbH', 'gewerblich', 'Hofweg 2, 10117 Berlin');
-- A filed document of the organization that is no invoice's original.
insert into public.documents (
  id, organization_id, storage_path, original_file_name, display_name, category, size_bytes, uploaded_by,
  metadata, filed_at, filed_by
) values
('38070000-0000-4000-8000-000000000310', '38070000-0000-4000-8000-000000000010',
 '38070000-0000-4000-8000-000000000010/38070000-0000-4000-8000-000000000310/plan.pdf', 'plan.pdf', 'plan.pdf',
 'other', 10, '38070000-0000-4000-8000-000000000002', jsonb_build_object('contentHash', repeat('e', 64)),
 now(), '38070000-0000-4000-8000-000000000002');

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

-- Grants: no client role runs a function or writes a row; a session reads
-- only the signal columns, and no history.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.document_deliveries', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
      or has_any_column_privilege(v_role, 'public.document_deliveries', 'INSERT,UPDATE')
      or has_any_column_privilege(v_role, 'public.document_delivery_events', 'SELECT,INSERT,UPDATE')
      or has_column_privilege(v_role, 'public.document_deliveries', 'recipient_email', 'SELECT')
      or has_column_privilege(v_role, 'public.document_deliveries', 'message_text', 'SELECT')
      or has_column_privilege(v_role, 'public.document_deliveries', 'note', 'SELECT')
      or has_function_privilege(v_role,
        'public.request_document_delivery(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text,text,text)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.retry_document_delivery(uuid,uuid,uuid,integer)', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.settle_document_delivery(uuid,uuid,uuid,integer,text,text,text)', 'EXECUTE')
      or has_function_privilege(v_role,
        'public.record_manual_delivery(uuid,uuid,uuid,text,uuid,uuid,text)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_document_deliveries(uuid,text,uuid,integer)', 'EXECUTE')
    then
      raise exception '% reaches a delivery row, column or function', v_role;
    end if;
  end loop;
  -- A session reads exactly the signal columns, anon none.
  if (select array_agg(attribute.attname::text order by attribute.attname::text) from pg_attribute attribute
      where attribute.attrelid = 'public.document_deliveries'::regclass and attribute.attnum > 0
        and not attribute.attisdropped
        and has_column_privilege('authenticated', 'public.document_deliveries', attribute.attname, 'SELECT'))
    is distinct from array['id', 'invoice_id', 'organization_id', 'state', 'subject_kind', 'updated_at']
    or has_any_column_privilege('anon', 'public.document_deliveries', 'SELECT') then
    raise exception 'a client role reads delivery columns beyond the signal';
  end if;
  if has_table_privilege('service_role', 'public.document_deliveries', 'DELETE')
    or has_table_privilege('service_role', 'public.document_delivery_events', 'UPDATE,DELETE') then
    raise exception 'service_role may delete a delivery or change its history';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.document_deliveries'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.document_delivery_events'::regclass) then
    raise exception 'a delivery table runs without RLS';
  end if;
end;
$$;

create temp table ids (name text primary key, id uuid) on commit drop;
grant select, insert on ids to service_role;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
grant execute on function pg_temp.id(text) to service_role;

set local role service_role;

-- One issued invoice with its filed original in each organization, and a draft.
create function pg_temp.issued(p_name text, p_actor uuid, p_org uuid, p_client uuid, p_original uuid, p_hash text)
returns void language plpgsql as $$
declare
  v_id uuid := public.create_invoice(p_actor, p_org, gen_random_uuid(), p_client, null, null);
begin
  insert into ids values (p_name, v_id);
  perform public.save_invoice_draft(p_actor, p_org, v_id, 1, gen_random_uuid(),
    '{"serviceStart":"2037-11-02","serviceEnd":"2037-11-02","paymentDueDays":14,"discountDays":null,
      "discountBasisPoints":null,"orderReference":"","buyerReference":"","openingText":"","closingText":""}',
    '[{"name":"Monteurstunde","description":"","quantity":"1.5","unit":"hour","unitPriceCents":7200,
       "priceQuantity":1,"taxCategory":"S","taxRateBasisPoints":1900,"netCents":10800}]',
    '{"lineNetCents":10800,"taxCents":2052,"grossCents":12852}');
  if p_original is null then return; end if;
  perform public.issue_invoice(p_actor, p_org, v_id, 2, gen_random_uuid(),
    '{"organizationName":"Haustechnik Sonnenberg","profile":{"companyName":"Haustechnik Sonnenberg GmbH"},
      "files":{"logo":null,"stationery_first":null,"stationery_following":null},
      "buyer":{"name":"Hausverwaltung Lindenhof GmbH","address":{"lines":["Hofweg 1"],"postalCode":"10117",
               "city":"Berlin","countryCode":"DE"}}}',
    public.get_invoice_settings(p_org) ->> 'nextInvoiceNumber', (now() at time zone 'Europe/Berlin')::date,
    p_original, p_org || '/' || p_original || '/Rechnung.pdf', 'Rechnung.pdf', 4096, p_hash);
end;
$$;
select pg_temp.issued('invoice', '38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
  '38070000-0000-4000-8000-000000000020', '38070000-0000-4000-8000-000000000301', repeat('a', 64));
select pg_temp.issued('foreign', '38070000-0000-4000-8000-000000000004', '38070000-0000-4000-8000-000000000011',
  '38070000-0000-4000-8000-000000000021', '38070000-0000-4000-8000-000000000302', repeat('b', 64));
select pg_temp.issued('draft', '38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
  '38070000-0000-4000-8000-000000000020', null, null);

-- Requests an email delivery of p_name's invoice with document p_document under attempt p_attempt.
create function pg_temp.request(p_actor uuid, p_org uuid, p_name text, p_document uuid, p_attempt uuid,
  p_recipient text default 'erika.musterfrau@example.com')
returns jsonb language sql as $$
  select public.request_document_delivery(p_actor, p_org, p_attempt, 'invoice', pg_temp.id(p_name), p_document,
    p_recipient, 'Rechnung RE-1', 'Guten Tag, anbei die Rechnung.', 'Haustechnik Sonnenberg GmbH',
    '"Haustechnik Sonnenberg GmbH" <rechnung@werkflow.example>', 'buero@example.com')
$$;

-- Refused, and nothing recorded: a field worker, an outsider, another
-- organization, a draft, another organization's document, a document that
-- is not the invoice's original, an address the check refuses.
select pg_temp.expect_refusal(label, format('select pg_temp.request(%L, %L, %L, %L, gen_random_uuid(), %L)',
  actor, org, invoice, document, recipient), refusal)
from (values
  ('employee', '38070000-0000-4000-8000-000000000003', '38070000-0000-4000-8000-000000000010', 'invoice',
   '38070000-0000-4000-8000-000000000301', 'erika.musterfrau@example.com', 'not_authorized'),
  ('outsider', '38070000-0000-4000-8000-000000000004', '38070000-0000-4000-8000-000000000010', 'invoice',
   '38070000-0000-4000-8000-000000000301', 'erika.musterfrau@example.com', 'not_authorized'),
  ('another organization''s Admin', '38070000-0000-4000-8000-000000000004',
   '38070000-0000-4000-8000-000000000011', 'invoice', '38070000-0000-4000-8000-000000000301',
   'erika.musterfrau@example.com', 'invoice_not_found'),
  ('a draft', '38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010', 'draft',
   '38070000-0000-4000-8000-000000000301', 'erika.musterfrau@example.com', 'invoice_not_issued'),
  ('another organization''s original', '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', 'invoice', '38070000-0000-4000-8000-000000000302',
   'erika.musterfrau@example.com', 'document_not_found'),
  ('a document that is no original', '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', 'invoice', '38070000-0000-4000-8000-000000000310',
   'erika.musterfrau@example.com', 'document_not_found'),
  ('an address with two recipients', '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', 'invoice', '38070000-0000-4000-8000-000000000301',
   'erika@example.com, otto@example.com', 'invalid_input')
) as cases(label, actor, org, invoice, document, recipient, refusal);
do $$
begin
  if exists (select 1 from public.document_deliveries where organization_id = '38070000-0000-4000-8000-000000000010')
    or exists (select 1 from public.document_delivery_events
      where organization_id = '38070000-0000-4000-8000-000000000010') then
    raise exception 'a refused request recorded a delivery';
  end if;
end;
$$;

-- Requested: sending, with the original's hash and history; the same attempt
-- answers it again without a claim; the same key with other content is refused.
do $$
declare
  v_first jsonb := pg_temp.request('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    'invoice', '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000401');
  v_again jsonb := pg_temp.request('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    'invoice', '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000401');
begin
  insert into ids values ('delivery', (v_first ->> 'deliveryId')::uuid);
  if (v_first ->> 'claimed')::boolean is distinct from true or v_first ->> 'state' is distinct from 'sending'
    or (v_first ->> 'attempt')::integer is distinct from 1 or v_first ->> 'contentHash' is distinct from repeat('a', 64)
    or v_first ->> 'storagePath' is distinct from
      '38070000-0000-4000-8000-000000000010/38070000-0000-4000-8000-000000000301/Rechnung.pdf'
    or v_first ->> 'replyTo' is distinct from 'buero@example.com'
    or v_first ->> 'fromHeader' is distinct from '"Haustechnik Sonnenberg GmbH" <rechnung@werkflow.example>' then
    raise exception 'the request answered %', v_first;
  end if;
  if (v_again ->> 'claimed')::boolean is distinct from false or v_again ->> 'deliveryId' is distinct from v_first ->> 'deliveryId'
    or (select count(*) from public.document_deliveries
      where organization_id = '38070000-0000-4000-8000-000000000010') is distinct from 1::bigint
    or (select count(*) from public.document_delivery_events
      where organization_id = '38070000-0000-4000-8000-000000000010' and event_type = 'requested')
      is distinct from 1::bigint then
    raise exception 'a repeated request recorded or claimed again: %', v_again;
  end if;
end;
$$;
select pg_temp.expect_refusal('the same attempt key with another recipient', $sql$
  select pg_temp.request('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    'invoice', '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000401', 'otto@example.com')
$sql$, 'invalid_input');

-- Settle and retry: a failure keeps its code; only the sending attempt
-- settles; a retry while sending, after the send, or repeated after its own
-- failure (an older expected attempt) claims nothing.
create function pg_temp.settle(p_attempt integer, p_outcome text, p_message text, p_code text) returns boolean
language sql as $$
  select public.settle_document_delivery('38070000-0000-4000-8000-000000000002',
    '38070000-0000-4000-8000-000000000010', pg_temp.id('delivery'), p_attempt, p_outcome, p_message, p_code)
$$;
create function pg_temp.retry(p_expected integer, p_actor uuid default '38070000-0000-4000-8000-000000000002')
returns jsonb language sql as $$
  select public.retry_document_delivery(p_actor, '38070000-0000-4000-8000-000000000010', pg_temp.id('delivery'),
    p_expected)
$$;
do $$
declare
  v_retry jsonb;
begin
  if pg_temp.retry(1) ->> 'claimed' is distinct from 'false' then
    raise exception 'a retry claimed a delivery that is sending';
  end if;
  if not pg_temp.settle(1, 'failed', null, 'email_provider_unreachable') then
    raise exception 'the failure was not settled';
  end if;
  if pg_temp.settle(1, 'failed', null, 'email_provider_unreachable') then
    raise exception 'a settled attempt settled again';
  end if;
  v_retry := pg_temp.retry(1);
  if (v_retry ->> 'claimed')::boolean is distinct from true or (v_retry ->> 'attempt')::integer is distinct from 2
    or v_retry ->> 'recipient' is distinct from 'erika.musterfrau@example.com' then
    raise exception 'the retry answered %', v_retry;
  end if;
  if pg_temp.retry(1) ->> 'claimed' is distinct from 'false' then
    raise exception 'a second retry claimed the attempt in flight';
  end if;
  if not pg_temp.settle(2, 'failed', null, 'email_provider_503') then
    raise exception 'the retry''s failure was not settled';
  end if;
  if pg_temp.retry(1) ->> 'claimed' is distinct from 'false' then
    raise exception 'the first retry, pressed again after its failure, claimed a third attempt';
  end if;
  if (pg_temp.retry(2) ->> 'attempt')::integer is distinct from 3 then
    raise exception 'a retry of the second attempt was not claimed';
  end if;
  if pg_temp.settle(2, 'sent', 'old-attempt', null) then
    raise exception 'the second attempt''s late answer settled the third';
  end if;
  if not pg_temp.settle(3, 'sent', '4ef9a417-02e9-4d39-ad75-9611e0fcc33c', null) then
    raise exception 'the send was not settled';
  end if;
  if pg_temp.retry(3) ->> 'claimed' is distinct from 'false' or pg_temp.settle(3, 'failed', null, 'email_provider_503') then
    raise exception 'a sent delivery was claimed or changed again';
  end if;
  if (select (state, provider_message_id, failure_code, attempts, sent_at is not null)
      from public.document_deliveries where id = pg_temp.id('delivery'))
    is distinct from ('sent'::text, '4ef9a417-02e9-4d39-ad75-9611e0fcc33c'::text, null::text, 3, true) then
    raise exception 'the sent delivery reads wrong';
  end if;
  -- One transaction gives every entry the same time, so the history compares sorted.
  if (select array_agg(event_type || ':' || attempt order by event_type || ':' || attempt)
      from public.document_delivery_events where delivery_id = pg_temp.id('delivery'))
    is distinct from array['failed:1', 'failed:2', 'requested:1', 'retried:2', 'retried:3', 'sent:3'] then
    raise exception 'the history reads %', (select array_agg(event_type || ':' || attempt)
      from public.document_delivery_events where delivery_id = pg_temp.id('delivery'));
  end if;
end;
$$;
select pg_temp.expect_refusal(label, statement, refusal)
from (values
  ('a retry by a field worker', 'select pg_temp.retry(3, ''38070000-0000-4000-8000-000000000003'')',
   'not_authorized'),
  ('a retry in another organization', format(
    'select public.retry_document_delivery(%L, %L, %L, 3)', '38070000-0000-4000-8000-000000000004',
    '38070000-0000-4000-8000-000000000011', pg_temp.id('delivery')), 'delivery_not_found'),
  ('a sent result without its message id', 'select pg_temp.settle(3, ''sent'', null, null)', 'invalid_input')
) as cases(label, statement, refusal);

-- An attempt whose process ended without an answer is claimed after ten
-- minutes; a failed delivery requested 23 hours ago or earlier is not
-- retried, because the provider's key may have expired.
do $$
declare
  v_stale jsonb := pg_temp.request('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    'invoice', '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000402');
  v_old jsonb := pg_temp.request('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    'invoice', '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000404');
  v_retry jsonb;
begin
  update public.document_deliveries set updated_at = now() - interval '11 minutes'
  where id = (v_stale ->> 'deliveryId')::uuid;
  v_retry := public.retry_document_delivery('38070000-0000-4000-8000-000000000001',
    '38070000-0000-4000-8000-000000000010', (v_stale ->> 'deliveryId')::uuid, 1);
  if (v_retry ->> 'claimed')::boolean is distinct from true or (v_retry ->> 'attempt')::integer is distinct from 2 then
    raise exception 'a stale attempt was not claimed: %', v_retry;
  end if;
  insert into ids values ('old', (v_old ->> 'deliveryId')::uuid);
  perform public.settle_document_delivery('38070000-0000-4000-8000-000000000002',
    '38070000-0000-4000-8000-000000000010', pg_temp.id('old'), 1, 'failed', null, 'email_provider_unreachable');
  update public.document_deliveries set created_at = now() - interval '23 hours'
  where id = pg_temp.id('old');
end;
$$;
select pg_temp.expect_refusal('a retry 23 hours after the request', format(
  'select public.retry_document_delivery(%L, %L, %L, 1)', '38070000-0000-4000-8000-000000000002',
  '38070000-0000-4000-8000-000000000010', pg_temp.id('old')), 'delivery_retry_expired');

-- Manual sending: recorded once as sent, with its note; never retried.
create function pg_temp.manual(p_actor uuid, p_org uuid, p_document uuid, p_note text) returns uuid language sql as $$
  select public.record_manual_delivery(p_actor, p_org, '38070000-0000-4000-8000-000000000403', 'invoice',
    pg_temp.id('invoice'), p_document, p_note)
$$;
select pg_temp.expect_refusal(label, format('select pg_temp.manual(%L, %L, %L, ''per Post'')', actor, org, document),
  refusal)
from (values
  ('a manual send by a field worker', '38070000-0000-4000-8000-000000000003', '38070000-0000-4000-8000-000000000010',
   '38070000-0000-4000-8000-000000000301', 'not_authorized'),
  ('a manual send of another organization''s document', '38070000-0000-4000-8000-000000000002',
   '38070000-0000-4000-8000-000000000010', '38070000-0000-4000-8000-000000000302', 'document_not_found')
) as cases(label, actor, org, document, refusal);
do $$
declare
  v_manual uuid := pg_temp.manual('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    '38070000-0000-4000-8000-000000000301', 'per Post am 20.11.');
begin
  insert into ids values ('manual', v_manual);
  if pg_temp.manual('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
      '38070000-0000-4000-8000-000000000301', 'per Post am 20.11.') is distinct from v_manual
    or (select count(*) from public.document_delivery_events where delivery_id = v_manual) <> 1 then
    raise exception 'a repeated manual send recorded again';
  end if;
  if (select (channel, state, note, recipient_email, attachment_content_hash)
      from public.document_deliveries where id = v_manual)
    is distinct from ('manual'::text, 'sent'::text, 'per Post am 20.11.'::text, null::text, repeat('a', 64)) then
    raise exception 'the manual send reads wrong';
  end if;
end;
$$;
select pg_temp.expect_refusal('the same manual key with another note', $sql$
  select pg_temp.manual('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    '38070000-0000-4000-8000-000000000301', 'per Bote')
$sql$, 'invalid_input');
select pg_temp.expect_refusal('a retry of a manual send', format(
  'select public.retry_document_delivery(%L, %L, %L, 1)', '38070000-0000-4000-8000-000000000002',
  '38070000-0000-4000-8000-000000000010', pg_temp.id('manual')), 'delivery_not_retryable');

-- The list: its total beside the rows it holds, who sent, and what may be
-- retried; another organization reads none.
do $$
declare
  v_list jsonb := public.list_document_deliveries('38070000-0000-4000-8000-000000000010', 'invoice',
    pg_temp.id('invoice'), 50);
  v_manual jsonb := (select row_data from jsonb_array_elements(v_list -> 'rows') row_data
    where row_data ->> 'id' = pg_temp.id('manual')::text);
  v_foreign jsonb := public.list_document_deliveries('38070000-0000-4000-8000-000000000011', 'invoice',
    pg_temp.id('invoice'), 50);
begin
  if (v_list ->> 'total')::integer is distinct from 4 or jsonb_array_length(v_list -> 'rows') is distinct from 4
    or v_manual ->> 'channel' is distinct from 'manual'
    or v_manual ->> 'createdBy' is distinct from 'Max Mustermann'
    or v_manual ->> 'retryFrom' is not null or v_manual ->> 'retryUntil' is not null
    or exists (select 1 from jsonb_array_elements(v_list -> 'rows') row_data
      where (row_data ->> 'retryFrom')::timestamptz <= now() and (row_data ->> 'retryUntil')::timestamptz > now())
    or (select (row_data ->> 'retryUntil')::timestamptz from jsonb_array_elements(v_list -> 'rows') row_data
      where row_data ->> 'id' = pg_temp.id('old')::text) is distinct from now()
  then
    raise exception 'the list reads %', v_list;
  end if;
  if jsonb_array_length(public.list_document_deliveries('38070000-0000-4000-8000-000000000010', 'invoice',
      pg_temp.id('invoice'), 1) -> 'rows') is distinct from 1 then
    raise exception 'the list passed its limit';
  end if;
  if (v_foreign ->> 'total')::integer is distinct from 0 then
    raise exception 'another organization listed the deliveries';
  end if;
end;
$$;

-- An unknown outcome stays on the delivery: an attempt without the
-- provider's answer, then a retry that fails before the provider (the
-- original unreadable), still lists the delivery as unknown; a taken-over
-- unanswered attempt marks it too, a later send keeps the mark, and a
-- failure the provider answered marks nothing.
do $$
declare
  v_unknown uuid := (pg_temp.request('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    'invoice', '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000405') ->> 'deliveryId')::uuid;
  v_refused uuid := (pg_temp.request('38070000-0000-4000-8000-000000000002', '38070000-0000-4000-8000-000000000010',
    'invoice', '38070000-0000-4000-8000-000000000301', '38070000-0000-4000-8000-000000000406') ->> 'deliveryId')::uuid;
  v_rows jsonb;
begin
  insert into ids values ('unknown', v_unknown);
  if not public.settle_document_delivery('38070000-0000-4000-8000-000000000002',
      '38070000-0000-4000-8000-000000000010', v_unknown, 1, 'failed', null, 'email_provider_unreachable')
    or (public.retry_document_delivery('38070000-0000-4000-8000-000000000002',
      '38070000-0000-4000-8000-000000000010', v_unknown, 1) ->> 'claimed')::boolean is distinct from true
    or not public.settle_document_delivery('38070000-0000-4000-8000-000000000002',
      '38070000-0000-4000-8000-000000000010', v_unknown, 2, 'failed', null, 'attachment_unavailable')
    or not public.settle_document_delivery('38070000-0000-4000-8000-000000000002',
      '38070000-0000-4000-8000-000000000010', v_refused, 1, 'failed', null, 'email_provider_503')
  then
    raise exception 'the unknown-outcome sequence did not settle';
  end if;
  v_rows := public.list_document_deliveries('38070000-0000-4000-8000-000000000010', 'invoice',
    pg_temp.id('invoice'), 50) -> 'rows';
  if (select (row_data ->> 'failureCode', (row_data ->> 'outcomeUnknown')::boolean)
      from jsonb_array_elements(v_rows) row_data where row_data ->> 'id' = v_unknown::text)
    is distinct from ('attachment_unavailable'::text, true)
  then
    raise exception 'a failure before the provider hid the earlier unknown outcome: %', v_rows;
  end if;
  if (select array_agg(row_data ->> 'id' order by row_data ->> 'id') from jsonb_array_elements(v_rows) row_data
      where (row_data ->> 'outcomeUnknown')::boolean)
    is distinct from (select array_agg(id::text order by id::text) from unnest(array[
      v_unknown, pg_temp.id('delivery'), pg_temp.id('old'),
      (select id from public.document_deliveries where attempt_key = '38070000-0000-4000-8000-000000000402')]) id)
  then
    raise exception 'the unknown outcomes list as %', v_rows;
  end if;
end;
$$;

reset role;

-- The history and an unknown outcome refuse changes, also to the table owner,
-- whom no grant stops; the organization's teardown removes its deliveries and
-- their history.
select pg_temp.expect_refusal(label, statement, 'event_ledger_history_immutable')
from (values
  ('a history change', format('update public.document_delivery_events set failure_code = ''x'' where delivery_id = %L',
    pg_temp.id('delivery'))),
  ('a history delete', format('delete from public.document_delivery_events where delivery_id = %L',
    pg_temp.id('delivery')))
) as cases(label, statement);
select pg_temp.expect_refusal(label, statement, 'delivery_outcome_unknown_kept')
from (values
  ('an unknown outcome cleared', format(
    'update public.document_deliveries set outcome_unknown_at = null where id = %L', pg_temp.id('unknown'))),
  ('an unknown outcome moved', format(
    'update public.document_deliveries set outcome_unknown_at = now() - interval ''1 hour'' where id = %L',
    pg_temp.id('unknown')))
) as cases(label, statement);
set local role service_role;
select public.record_manual_delivery('38070000-0000-4000-8000-000000000004', '38070000-0000-4000-8000-000000000011',
  gen_random_uuid(), 'invoice', pg_temp.id('foreign'), '38070000-0000-4000-8000-000000000302', 'per Bote');
reset role;
delete from public.organizations where id = '38070000-0000-4000-8000-000000000011';
do $$
begin
  if exists (select 1 from public.document_deliveries where organization_id = '38070000-0000-4000-8000-000000000011')
    or exists (select 1 from public.document_delivery_events
      where organization_id = '38070000-0000-4000-8000-000000000011') then
    raise exception 'the organization''s teardown left its deliveries';
  end if;
end;
$$;

-- A session reads the signal columns of its organization's deliveries as
-- Admin or Büro, never an address or text; an employee and an outsider read none.
create function pg_temp.deliveries_seen_by(p_user uuid) returns bigint language plpgsql as $$
declare
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count from (select id, state from public.document_deliveries) visible;
  perform pg_temp.expect_refusal('an address read', 'select recipient_email from public.document_deliveries', '42501');
  perform pg_temp.expect_refusal('a history read', 'select count(*) from public.document_delivery_events', '42501');
  perform pg_temp.expect_refusal('a direct write',
    'update public.document_deliveries set state = ''sent'' where true', '42501');
  execute 'reset role';
  return v_count;
end;
$$;
do $$
begin
  if pg_temp.deliveries_seen_by('38070000-0000-4000-8000-000000000002') is distinct from 6::bigint
    or pg_temp.deliveries_seen_by('38070000-0000-4000-8000-000000000003') is distinct from 0::bigint
    or pg_temp.deliveries_seen_by('38070000-0000-4000-8000-000000000004') is distinct from 0::bigint then
    raise exception 'a delivery read crossed a role or an organization';
  end if;
end;
$$;

rollback;
