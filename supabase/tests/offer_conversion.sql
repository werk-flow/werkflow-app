-- An accepted offer becomes work once, with its Auftragsumfang as the order
-- baseline, and the field reads that scope without a price
-- (migration 20270701160000_convert_an_accepted_offer_into_work_once.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'convert-admin@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'convert-buero@example.test', '', now(), '{}',
 '{"first_name":"Max","last_name":"Mustermann"}', now(), now()),
('38800000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'convert-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38800000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'convert-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38800000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Auftrag', '38800000-0000-4000-8000-000000000001', 'OFFCONV'),
('38800000-0000-4000-8000-000000000011', 'Fremde Haustechnik Auftrag', '38800000-0000-4000-8000-000000000004', 'OFFCONVO');
insert into public.organization_members (organization_id, user_id, role) values
('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000002', 'buero'),
('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000003', 'employee');

-- 20 the customer, 21 another customer the office once named as payer of the existing job.
insert into public.clients (id, organization_id, name, client_type, address) values
('38800000-0000-4000-8000-000000000020', '38800000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich', 'Hofweg 1, 10117 Berlin'),
('38800000-0000-4000-8000-000000000021', '38800000-0000-4000-8000-000000000010',
 'WEG Lindenstraße 5', 'gewerblich', 'Lindenstraße 5, 10115 Berlin');
insert into public.client_sites (id, organization_id, client_id, name, street, postal_code, city) values
('38800000-0000-4000-8000-000000000030', '38800000-0000-4000-8000-000000000010',
 '38800000-0000-4000-8000-000000000020', 'Haus Lindenhof', 'Hofweg 1', '10117', 'Berlin');
-- 40 a boiler and 41 a pipe in their own units, 42 a valve the offer sells per meter.
insert into public.inventory_items (id, organization_id, name, item_type, unit, internal_sku, is_active) values
('38800000-0000-4000-8000-000000000040', '38800000-0000-4000-8000-000000000010', 'Gas-Brennwerttherme 25 kW',
 'material', 'piece', 'GBT-25', true),
('38800000-0000-4000-8000-000000000041', '38800000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm',
 'material', 'meter', 'KR-15', true),
('38800000-0000-4000-8000-000000000042', '38800000-0000-4000-8000-000000000010', 'Kugelhahn DN 20',
 'material', 'piece', 'KH-20', true);
-- The job an offer is written for, with the employee on it.
insert into public.jobs (id, organization_id, title, job_number, client_id, site_id, status, created_by) values
('38800000-0000-4000-8000-000000000050', '38800000-0000-4000-8000-000000000010', 'Heizung tauschen',
 'B-50', '38800000-0000-4000-8000-000000000020', '38800000-0000-4000-8000-000000000030',
 'nicht_bearbeitet', '38800000-0000-4000-8000-000000000001');
insert into public.job_assignments (organization_id, job_id, user_id, assigned_by) values
('38800000-0000-4000-8000-000000000010', '38800000-0000-4000-8000-000000000050',
 '38800000-0000-4000-8000-000000000003', '38800000-0000-4000-8000-000000000001');

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

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role, authenticated;
create function pg_temp.id(p_name text) returns uuid language sql as $$
  select id from ids where name = p_name;
$$;
grant execute on function pg_temp.id(text) to service_role, authenticated;

-- A priced Position at 19 %: its quantity, unit, net price and article.
create function pg_temp.priced(p_name text, p_quantity text, p_unit text, p_cents integer, p_amount integer,
  p_item uuid) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('kind', 'free', 'name', p_name, 'description', '',
    'quantity', p_quantity, 'unit', p_unit, 'unitLabel', case p_unit when 'meter' then 'm' else 'Stk.' end,
    'unitPriceCents', p_cents, 'priceQuantity', 1, 'taxRateBasisPoints', 1900, 'amountCents', p_amount,
    'source', case when p_item is not null then jsonb_build_object('kind', 'article', 'id', p_item) end,
    'purchaseCost', case when p_item is not null then jsonb_build_object('amountCents', 1000, 'priceQuantity', 1) end,
    'positionType', jsonb_build_object('kind', 'normal')));
$$;
grant execute on function pg_temp.priced(text, text, text, integer, integer, uuid) to service_role;

-- Titel 1: 1.1 the boiler, a text line about prices, 1.2 12,5 m pipe, 1.3 two valves sold per
-- meter, 1.4 a Nachlass, 1.5 a credit that rounds to 0 cents. Titel 2: 2.1 the Montage without an article. 5.806,25 € net.
create function pg_temp.content() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('title', 'Wärmeerzeuger', 'netCents', 500625, 'positions', jsonb_build_array(
      pg_temp.priced('Gas-Brennwerttherme 25 kW', '1', 'piece', 489000, 489000, '38800000-0000-4000-8000-000000000040'),
      '{"kind": "text", "name": "Preise gelten vier Wochen", "description": ""}'::jsonb,
      pg_temp.priced('Kupferrohr 15 mm', '12.5', 'meter', 1250, 15625, '38800000-0000-4000-8000-000000000041'),
      pg_temp.priced('Kugelhahn DN 20', '2', 'meter', 3000, 6000, '38800000-0000-4000-8000-000000000042'),
      pg_temp.priced('Nachlass', '-1', 'piece', 10000, -10000, null),
      pg_temp.priced('Gutschrift Kleinteile', '-0.001', 'piece', 100, 0, null))),
    jsonb_build_object('title', 'Montage', 'netCents', 80000, 'positions', jsonb_build_array(
      pg_temp.priced('Montagepauschale', '1', 'piece', 80000, 80000, null))));
$$;
grant execute on function pg_temp.content() to service_role;

-- Saves the content, sends revision 1 and records its Annahme as Büro; the offer is then at version 3.
create function pg_temp.accepted_offer(p_offer uuid) returns void language plpgsql as $$
declare
  v_document uuid := gen_random_uuid();
begin
  perform public.save_offer_content('38800000-0000-4000-8000-000000000002',
    '38800000-0000-4000-8000-000000000010', p_offer, 1, gen_random_uuid(), pg_temp.content(),
    '{"netCents": 580625, "taxCents": 110319, "grossCents": 690944, "positionTypes": true}');
  perform public.send_offer('38800000-0000-4000-8000-000000000002', '38800000-0000-4000-8000-000000000010',
    p_offer, 1, 2, gen_random_uuid(), 'post', (now() at time zone 'Europe/Berlin')::date,
    'Hausverwaltung Lindenhof GmbH', 'Hofweg 1, 10117 Berlin', '{"site": null, "positionTypes": true}', v_document,
    '38800000-0000-4000-8000-000000000010/' || v_document || '/Angebot.pdf', 'Angebot ' || p_offer || '.pdf',
    2048, repeat('b', 64));
  perform public.accept_offer('38800000-0000-4000-8000-000000000002', '38800000-0000-4000-8000-000000000010',
    p_offer, 2, gen_random_uuid(), 1, 'Erika Musterfrau', (now() at time zone 'Europe/Berlin')::date,
    'unterschrift', '', '{}', '{"netCents": 580625, "taxCents": 110319, "grossCents": 690944}');
end;
$$;
grant execute on function pg_temp.accepted_offer(uuid) to service_role;

-- A conversion as Büro (or p_actor) under p_key.
create function pg_temp.convert(p_offer uuid, p_target text, p_key uuid, p_version integer default 3,
  p_actor uuid default '38800000-0000-4000-8000-000000000002',
  p_organization uuid default '38800000-0000-4000-8000-000000000010') returns jsonb language sql as $$
  select public.convert_offer_to_work(p_actor, p_organization, p_offer, p_version, p_key, p_target,
    'Heizung Hofweg 1');
$$;
grant execute on function pg_temp.convert(uuid, text, uuid, integer, uuid, uuid) to service_role;

set local role service_role;
-- The office once chose another payer for the existing job.
select public.set_work_billing_parties('38800000-0000-4000-8000-000000000002',
  '38800000-0000-4000-8000-000000000010', 'job', '38800000-0000-4000-8000-000000000050',
  '38800000-0000-4000-8000-000000000021', '38800000-0000-4000-8000-000000000021',
  (select version from public.work_billing_parties where work_id = '38800000-0000-4000-8000-000000000050'
   order by version desc limit 1));
insert into ids
select name, public.create_offer('38800000-0000-4000-8000-000000000002', '38800000-0000-4000-8000-000000000010',
  gen_random_uuid(), name, '38800000-0000-4000-8000-000000000020', '38800000-0000-4000-8000-000000000030', null,
  case when name = 'existing' then 'job' end,
  case when name = 'existing' then '38800000-0000-4000-8000-000000000050'::uuid end)
from unnest(array['job', 'project', 'existing', 'stale', 'unaccepted']) name;
select pg_temp.accepted_offer(pg_temp.id(name)) from ids where name <> 'unaccepted';

-- „job“ becomes a new job for the accepted customer with the next number and the site's address,
-- unassigned and unscheduled. Its order binds the Annahme and copies the Auftragsumfang's seven lines.
do $$
declare
  v_answer jsonb := pg_temp.convert(pg_temp.id('job'), 'job', '38800000-0000-4000-8000-000000000101');
  v_job public.jobs;
  v_order public.orders;
begin
  select * into v_job from public.jobs where id = (v_answer ->> 'workId')::uuid;
  if v_answer ->> 'kind' is distinct from 'job' or v_answer ->> 'replay' is distinct from 'false'
    or v_answer ->> 'version' is distinct from '4'
    or v_answer ->> 'updatedAt' is null
    or v_job.organization_id is distinct from '38800000-0000-4000-8000-000000000010'
    or v_job.title is distinct from 'Heizung Hofweg 1'
    or v_job.client_id is distinct from '38800000-0000-4000-8000-000000000020'
    or v_job.site_id is distinct from '38800000-0000-4000-8000-000000000030'
    or v_job.location is distinct from 'Hofweg 1, 10117 Berlin'
    or v_job.job_number !~ ('^AUF-' || extract(year from now()) || '-[0-9]{3}$')
    or v_job.planned_date is not null
    or exists (select 1 from public.job_assignments where job_id = v_job.id) then
    raise exception 'the conversion answered % and created the job %', v_answer, to_jsonb(v_job);
  end if;
  select * into v_order from public.orders where id = (v_answer ->> 'orderId')::uuid;
  if v_order.offer_id is distinct from pg_temp.id('job') or v_order.job_id is distinct from v_job.id
    or v_order.project_id is not null
    or v_order.acceptance_id is distinct from (select id from public.offer_acceptances where offer_id = pg_temp.id('job'))
    or v_order.created_by is distinct from '38800000-0000-4000-8000-000000000002' then
    raise exception 'the order was written as %', to_jsonb(v_order);
  end if;
  if (select array_agg(coalesce(number, '-') || ' ' || kind || ' ' || coalesce(amount_cents::text, '') order by position)
      from public.order_lines where order_id = v_order.id)
    is distinct from array['1.1 free 489000', '- text ', '1.2 free 15625', '1.3 free 6000', '1.4 free -10000',
      '1.5 free 0', '2.1 free 80000'] then
    raise exception 'the order baseline is not the Auftragsumfang';
  end if;
end;
$$;

-- The article lines in their article's unit are planned on the new job with their order line as
-- source; the valve sold per meter is named back, the lines without an article plan nothing.
do $$
declare
  v_answer jsonb := pg_temp.convert(pg_temp.id('job'), 'job', '38800000-0000-4000-8000-000000000101');
begin
  if (select array_agg(material.item_id::text || ' ' || material.planned_quantity order by material.planned_quantity)
      from public.job_material_lines material
      join public.order_lines line on line.id = material.source_id and material.source_kind = 'order_line'
      where material.job_id = (v_answer ->> 'workId')::uuid and line.item_id = material.item_id)
    is distinct from array['38800000-0000-4000-8000-000000000040 1.000', '38800000-0000-4000-8000-000000000041 12.500']
    or v_answer -> 'unplannedPositions' is distinct from '["1.3"]'::jsonb then
    raise exception 'the conversion planned the material % and named % unplanned',
      (select jsonb_agg(to_jsonb(material)) from public.job_material_lines material
       where material.job_id = (v_answer ->> 'workId')::uuid), v_answer -> 'unplannedPositions';
  end if;
end;
$$;

-- A repeated press answers the first conversion and writes nothing; the offer's history names it.
do $$
declare
  v_answer jsonb := pg_temp.convert(pg_temp.id('job'), 'job', '38800000-0000-4000-8000-000000000101');
  v_event public.offer_events;
begin
  if v_answer ->> 'replay' is distinct from 'true'
    or (select count(*) from public.orders where offer_id = pg_temp.id('job')) <> 1
    or (select count(*) from public.jobs where organization_id = '38800000-0000-4000-8000-000000000010') <> 2
    or (select version from public.offers where id = pg_temp.id('job')) is distinct from 4 then
    raise exception 'a repeated conversion answered % and wrote again', v_answer;
  end if;
  select * into v_event from public.offer_events
  where organization_id = '38800000-0000-4000-8000-000000000010'
    and attempt_key = '38800000-0000-4000-8000-000000000101';
  if v_event.event_type is distinct from 'converted' or v_event.status is distinct from 'angenommen'
    or v_event.payload ->> 'workId' is distinct from v_answer ->> 'workId'
    or v_event.actor_id is distinct from '38800000-0000-4000-8000-000000000002' then
    raise exception 'the conversion''s history is %', to_jsonb(v_event);
  end if;
end;
$$;

-- A second conversion and a withdrawal of the Annahme work exists from are refused; the offer stays accepted.
select pg_temp.expect_refusal('a second conversion',
  format('select pg_temp.convert(%L, ''project'', gen_random_uuid(), 4)', pg_temp.id('job')), 'offer_converted');
select pg_temp.expect_refusal('a withdrawal of a converted Annahme',
  format('select public.withdraw_offer_acceptance(''38800000-0000-4000-8000-000000000002'',
    ''38800000-0000-4000-8000-000000000010'', %L, 4, gen_random_uuid(), ''Falsch erfasst'')', pg_temp.id('job')),
  'offer_converted');
do $$
begin
  if (select status from public.offers where id = pg_temp.id('job')) is distinct from 'angenommen'
    or exists (select 1 from public.offer_acceptance_withdrawals withdrawal
      join public.offer_acceptances acceptance on acceptance.id = withdrawal.acceptance_id
      where acceptance.offer_id = pg_temp.id('job')) then
    raise exception 'a refused withdrawal changed the converted offer';
  end if;
end;
$$;

-- „project“ becomes a new project; its article material is planned on the project.
do $$
declare
  v_answer jsonb := pg_temp.convert(pg_temp.id('project'), 'project', gen_random_uuid());
  v_project public.projects;
begin
  select * into v_project from public.projects where id = (v_answer ->> 'workId')::uuid;
  if v_answer ->> 'kind' is distinct from 'project' or v_project.name is distinct from 'Heizung Hofweg 1'
    or v_project.client_id is distinct from '38800000-0000-4000-8000-000000000020'
    or v_project.project_number !~ ('^PRJ-' || extract(year from now()) || '-[0-9]{3,}$')
    or (select count(*) from public.job_material_lines
        where project_id = v_project.id and job_id is null and source_kind = 'order_line') <> 2 then
    raise exception 'the project conversion answered % and created %', v_answer, to_jsonb(v_project);
  end if;
  insert into ids values ('project_work', v_project.id);
end;
$$;

-- „existing“ binds the job it was written for. The job's parties become the accepted revision's,
-- as the office's choice, whatever the office chose before.
do $$
declare
  v_answer jsonb := pg_temp.convert(pg_temp.id('existing'), 'offer_work', gen_random_uuid());
  v_parties public.work_billing_parties;
  v_revision public.offer_revisions;
begin
  select * into v_parties from public.work_billing_parties
  where work_id = '38800000-0000-4000-8000-000000000050' order by version desc limit 1;
  select * into v_revision from public.offer_revisions where offer_id = pg_temp.id('existing');
  if v_answer ->> 'workId' is distinct from '38800000-0000-4000-8000-000000000050'
    or v_parties.client_id is distinct from v_revision.client_id
    or v_parties.recipient_client_id is distinct from v_revision.recipient_client_id
    or v_parties.source is distinct from 'buero'
    or (select count(*) from public.jobs where organization_id = '38800000-0000-4000-8000-000000000010') <> 2 then
    raise exception 'binding the offer''s job answered % with the parties %', v_answer, to_jsonb(v_parties);
  end if;
end;
$$;

-- Refusals before anything is written.
select pg_temp.expect_refusal('an offer without an Annahme',
  format('select pg_temp.convert(%L, ''job'', gen_random_uuid(), 2)', pg_temp.id('unaccepted')), 'offer_not_accepted');
select pg_temp.expect_refusal('an offer written for no work as its work',
  format('select pg_temp.convert(%L, ''offer_work'', gen_random_uuid())', pg_temp.id('stale')), 'invalid_input');
select pg_temp.expect_refusal('a new job without a title',
  format('select public.convert_offer_to_work(''38800000-0000-4000-8000-000000000002'',
    ''38800000-0000-4000-8000-000000000010'', %L, 2, gen_random_uuid(), ''job'', ''  '')', pg_temp.id('unaccepted')),
  'invalid_input');
select pg_temp.expect_refusal('an employee',
  format('select pg_temp.convert(%L, ''job'', gen_random_uuid(), 2, ''38800000-0000-4000-8000-000000000003'')',
    pg_temp.id('unaccepted')), 'not_authorized');
select pg_temp.expect_refusal('another organization''s offer',
  format('select pg_temp.convert(%L, ''job'', gen_random_uuid(), 2, ''38800000-0000-4000-8000-000000000004'',
    ''38800000-0000-4000-8000-000000000011'')', pg_temp.id('unaccepted')), 'offer_not_found');
select pg_temp.expect_refusal('a stale version',
  format('select pg_temp.convert(%L, ''job'', gen_random_uuid(), 2)', pg_temp.id('stale')), 'offer_changed');

-- The work keeps its baseline.
select pg_temp.expect_refusal('a converted job''s delete',
  'delete from public.jobs where id = ''38800000-0000-4000-8000-000000000050''', 'work_with_history_cannot_be_deleted');
select pg_temp.expect_refusal('a converted project''s delete',
  format('delete from public.projects where id = %L', pg_temp.id('project_work')), 'work_with_history_cannot_be_deleted');

-- The office reads the orders with their prices; the field reads scope only: the job's own order
-- and its project's, text, quantity and unit, without the Nachlass, the credit and any amount.
do $$
declare
  v_project_job uuid;
  v_scope jsonb;
  v_orders jsonb := public.get_work_orders('38800000-0000-4000-8000-000000000010', 'job',
    '38800000-0000-4000-8000-000000000050');
begin
  if jsonb_array_length(v_orders) is distinct from 1 or v_orders #>> '{0,grossCents}' is distinct from '690944'
    or v_orders #>> '{0,scope,0,positions,0,amountCents}' is distinct from '489000' then
    raise exception 'the office reads the orders %', v_orders;
  end if;
  insert into public.jobs (organization_id, project_id, title, job_number, client_id, status, created_by)
  values ('38800000-0000-4000-8000-000000000010', pg_temp.id('project_work'), 'Heizraum vorbereiten', 'B-51',
    '38800000-0000-4000-8000-000000000020', 'nicht_bearbeitet', '38800000-0000-4000-8000-000000000001')
  returning id into v_project_job;
  v_scope := public.get_work_scope('38800000-0000-4000-8000-000000000010', 'job', v_project_job);
  if jsonb_array_length(v_scope) is distinct from 1 or v_scope #>> '{0,workKind}' is distinct from 'project'
    or (select jsonb_agg(coalesce(line ->> 'number', line ->> 'name'))
        from jsonb_array_elements(v_scope #> '{0,sections}') section, jsonb_array_elements(section -> 'lines') line)
      is distinct from '["1.1", "Preise gelten vier Wochen", "1.2", "1.3", "2.1"]'::jsonb
    or v_scope #>> '{0,sections,0,lines,2,quantity}' is distinct from '12.500'
    or v_scope #>> '{0,sections,0,lines,2,unitLabel}' is distinct from 'm'
    -- No key of the answer names a price, a cost or a total.
    or v_scope::text ~* '"[a-z]*(cent|price|cost|amount|net|tax|gross|total)[a-z]*": ' then
    raise exception 'the field reads the scope %', v_scope;
  end if;
end;
$$;
-- The baseline never changes, whoever writes: the server role holds no update grant, and the
-- guard refuses the owner too.
select pg_temp.expect_refusal('the server role changes an order line',
  'update public.order_lines set quantity = 2
    where organization_id = ''38800000-0000-4000-8000-000000000010''', '42501');
reset role;
select pg_temp.expect_refusal('an order change',
  format('update public.orders set job_id = null
    where organization_id = ''38800000-0000-4000-8000-000000000010'' and offer_id = %L', pg_temp.id('job')), 'event_ledger_history_immutable');
select pg_temp.expect_refusal('an order line change',
  'update public.order_lines set quantity = 2
    where organization_id = ''38800000-0000-4000-8000-000000000010'' and position = 1', 'event_ledger_history_immutable');
select pg_temp.expect_refusal('an order line delete',
  'delete from public.order_lines where organization_id = ''38800000-0000-4000-8000-000000000010''', 'event_ledger_history_immutable');

-- No signed-in role holds a grant on a cost or margin column of an order or offer table. The
-- assigned employee reads no value of any price or cost column: either no grant, or no row.
create temporary table price_columns as
select column_name.table_name::text as table_name, column_name.column_name::text as column_name
from information_schema.columns column_name
where column_name.table_schema = 'public'
  and (column_name.table_name in ('orders', 'order_lines') or column_name.table_name like 'offer%')
  and column_name.column_name ~ '(cents|price|cost|amount|margin|discount|net_|tax|gross)';
grant select on price_columns to authenticated;
do $$
declare
  v_granted text[];
begin
  if (select count(*) from price_columns where table_name = 'order_lines') <> 4 then
    raise exception 'the price columns of the order lines were not found';
  end if;
  select array_agg(table_name || '.' || column_name) into v_granted from price_columns
  where column_name ~ '(cost|margin)'
    and has_column_privilege('authenticated', format('public.%I', table_name), column_name, 'SELECT');
  if v_granted is not null then
    raise exception 'authenticated may select the cost columns %', v_granted;
  end if;
end;
$$;
select set_config('request.jwt.claims',
  json_build_object('sub', '38800000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_column record;
  v_values bigint;
begin
  for v_column in select * from price_columns loop
    begin
      execute format('select count(*) from public.%I where %I is not null', v_column.table_name, v_column.column_name)
        into v_values;
    exception when insufficient_privilege then
      continue;
    end;
    if v_values is distinct from 0 then
      raise exception 'the assigned employee reads % values of %.%', v_values, v_column.table_name, v_column.column_name;
    end if;
  end loop;
end;
$$;
select pg_temp.expect_refusal('the assigned employee''s order read', 'select * from public.orders', '42501');
select pg_temp.expect_refusal('the assigned employee''s order line read',
  'select name, quantity from public.order_lines', '42501');
select pg_temp.expect_refusal('the assigned employee''s scope read',
  'select public.get_work_scope(''38800000-0000-4000-8000-000000000010'', ''job'',
    ''38800000-0000-4000-8000-000000000050'')', '42501');
select pg_temp.expect_refusal('the assigned employee''s conversion',
  format('select public.convert_offer_to_work(''38800000-0000-4000-8000-000000000003'',
    ''38800000-0000-4000-8000-000000000010'', %L, 2, gen_random_uuid(), ''job'', ''Neu'')', pg_temp.id('unaccepted')),
  '42501');
reset role;

rollback;
