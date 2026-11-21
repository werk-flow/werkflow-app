-- An invoice line keeps the Leistung or article it came from
-- (migration 20261219110000_keep_the_catalog_source_of_invoice_lines.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('38330000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'line-source-buero@example.test', '', now(), '{}',
 '{"first_name":"Erika","last_name":"Musterfrau"}', now(), now()),
('38330000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'line-source-employee@example.test', '', now(), '{}',
 '{"first_name":"Lena","last_name":"Monteurin"}', now(), now()),
('38330000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'line-source-outsider@example.test', '', now(), '{}',
 '{"first_name":"Otto","last_name":"Fremd"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('38330000-0000-4000-8000-000000000010', 'Haustechnik Sonnenberg Positionen', '38330000-0000-4000-8000-000000000001', 'INVSRCA'),
('38330000-0000-4000-8000-000000000011', 'Fremde Haustechnik Positionen', '38330000-0000-4000-8000-000000000004', 'INVSRCB');
insert into public.organization_members (organization_id, user_id, role) values
('38330000-0000-4000-8000-000000000010', '38330000-0000-4000-8000-000000000002', 'employee');

insert into public.clients (id, organization_id, name, client_type) values
('38330000-0000-4000-8000-000000000020', '38330000-0000-4000-8000-000000000010',
 'Hausverwaltung Lindenhof GmbH', 'gewerblich');

-- 30: a Leistung, 31: an archived one, 39: another organization's.
insert into public.leistungen (id, organization_id, leistung_number, name, description, kind, unit,
  tax_rate_basis_points, archived_at) values
('38330000-0000-4000-8000-000000000030', '38330000-0000-4000-8000-000000000010', 'L-7', 'Monteurstunde',
 'Arbeitszeit Geselle', 'arbeit', 'hour', 1900, null),
('38330000-0000-4000-8000-000000000031', '38330000-0000-4000-8000-000000000010', 'L-8', 'Alte Anfahrt',
 '', 'anfahrt', 'flat_rate', 1900, now()),
('38330000-0000-4000-8000-000000000039', '38330000-0000-4000-8000-000000000011', 'L-7', 'Fremde Stunde',
 '', 'arbeit', 'hour', 1900, null);
-- 40: an article, 41: an inactive one, 49: another organization's.
insert into public.inventory_items (id, organization_id, name, item_type, unit, internal_sku, is_active) values
('38330000-0000-4000-8000-000000000040', '38330000-0000-4000-8000-000000000010', 'Kupferrohr 15 mm',
 'material', 'meter', 'KR-15', true),
('38330000-0000-4000-8000-000000000041', '38330000-0000-4000-8000-000000000010', 'Altes Ventil',
 'material', 'piece', null, false),
('38330000-0000-4000-8000-000000000049', '38330000-0000-4000-8000-000000000011', 'Fremdes Rohr',
 'material', 'meter', null, true);

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
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role;

-- Grants: the new reads are server-only.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_role, 'public.get_invoice_with_line_sources(uuid,uuid)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.search_leistung_options(uuid,text,integer)', 'EXECUTE') then
      raise exception '% can execute a line source function', v_role;
    end if;
  end loop;
end;
$$;

-- A line names one source at most, and only one of its own organization.
do $$
begin
  begin
    insert into public.invoice_lines (organization_id, invoice_id, position, name, quantity, unit,
      unit_price_cents, tax_category, tax_rate_basis_points, net_cents, leistung_id, item_id)
    values ('38330000-0000-4000-8000-000000000010', gen_random_uuid(), 1, 'x', 1, 'piece', 0, 'Z', 0, 0,
      '38330000-0000-4000-8000-000000000030', '38330000-0000-4000-8000-000000000040');
  exception when check_violation then
    null;
  end;
  if exists (select 1 from public.invoice_lines where organization_id = '38330000-0000-4000-8000-000000000010') then
    raise exception 'a line took a Leistung and an article as its source';
  end if;
end;
$$;

set local role service_role;

select public.create_invoice('38330000-0000-4000-8000-000000000001', '38330000-0000-4000-8000-000000000010',
  '38330000-0000-4000-8000-000000000101', '38330000-0000-4000-8000-000000000020', null, null);
create temp table ids on commit drop as
select (select invoice_id from public.invoice_events
  where attempt_key = '38330000-0000-4000-8000-000000000101') as draft;
grant select on ids to service_role;

create function pg_temp.save_lines(p_version integer, p_attempt uuid, p_lines jsonb, p_actor uuid default
  '38330000-0000-4000-8000-000000000001', p_org uuid default '38330000-0000-4000-8000-000000000010')
returns integer language sql as $$
  select public.save_invoice_draft(p_actor, p_org, (select draft from ids), p_version, p_attempt,
    '{"serviceStart":null,"serviceEnd":null,"paymentDueDays":14,"discountDays":null,"discountBasisPoints":null,
      "orderReference":"","buyerReference":"","openingText":"","closingText":""}',
    p_lines, '{"lineNetCents":0,"taxCents":0,"grossCents":0}');
$$;
grant execute on function pg_temp.save_lines(integer, uuid, jsonb, uuid, uuid) to service_role;

create function pg_temp.line(p_name text, p_source jsonb) returns jsonb language sql as $$
  select jsonb_build_object('name', p_name, 'description', '', 'quantity', '1', 'unit', 'piece',
    'unitPriceCents', 0, 'priceQuantity', 1, 'taxCategory', 'Z', 'taxRateBasisPoints', 0, 'netCents', 0)
    || case when p_source is null then '{}'::jsonb else jsonb_build_object('source', p_source) end;
$$;
grant execute on function pg_temp.line(text, jsonb) to service_role;

-- A save keeps each line's source: a Leistung, an article, none, and a line
-- from the release before, which sends no source.
select pg_temp.save_lines(1, '38330000-0000-4000-8000-000000000201', jsonb_build_array(
  pg_temp.line('Monteurstunde', '{"kind":"leistung","id":"38330000-0000-4000-8000-000000000030"}'),
  pg_temp.line('Kupferrohr', '{"kind":"article","id":"38330000-0000-4000-8000-000000000040"}'),
  pg_temp.line('Frei', 'null'),
  pg_temp.line('Ohne Angabe', null)));
do $$
declare
  v_sources jsonb;
begin
  if (select jsonb_agg(jsonb_build_array(line.name, line.leistung_id, line.item_id) order by line.position)
      from public.invoice_lines line where line.invoice_id = (select draft from ids))
    is distinct from jsonb_build_array(
      jsonb_build_array('Monteurstunde', '38330000-0000-4000-8000-000000000030', null),
      jsonb_build_array('Kupferrohr', null, '38330000-0000-4000-8000-000000000040'),
      jsonb_build_array('Frei', null, null),
      jsonb_build_array('Ohne Angabe', null, null)) then
    raise exception 'a save did not keep each line''s source';
  end if;
  v_sources := public.get_invoice_with_line_sources('38330000-0000-4000-8000-000000000010', (select draft from ids))
    -> 'lineSources';
  if v_sources is distinct from jsonb_build_array(
      jsonb_build_object('kind', 'leistung', 'id', '38330000-0000-4000-8000-000000000030', 'number', 'L-7',
        'name', 'Monteurstunde', 'archived', false),
      jsonb_build_object('kind', 'article', 'id', '38330000-0000-4000-8000-000000000040', 'number', 'KR-15',
        'name', 'Kupferrohr 15 mm', 'archived', false),
      null, null) then
    raise exception 'the invoice read answers the line sources %', v_sources;
  end if;
  if jsonb_array_length(public.get_invoice_with_line_sources('38330000-0000-4000-8000-000000000010',
      (select draft from ids)) -> 'lines') is distinct from 4 then
    raise exception 'the invoice read with line sources lost the lines';
  end if;
  if public.get_invoice_with_line_sources('38330000-0000-4000-8000-000000000011', (select draft from ids))
      is not null then
    raise exception 'another organization reads the draft with its line sources';
  end if;
end;
$$;

-- An archived source stays on a saved line, and the read flags it.
select pg_temp.save_lines(2, '38330000-0000-4000-8000-000000000202', jsonb_build_array(
  pg_temp.line('Alte Anfahrt', '{"kind":"leistung","id":"38330000-0000-4000-8000-000000000031"}'),
  pg_temp.line('Altes Ventil', '{"kind":"article","id":"38330000-0000-4000-8000-000000000041"}')));
do $$
begin
  if (select jsonb_agg(source -> 'archived')
      from jsonb_array_elements(public.get_invoice_with_line_sources('38330000-0000-4000-8000-000000000010',
        (select draft from ids)) -> 'lineSources') source)
    is distinct from '[true, true]'::jsonb then
    raise exception 'the read does not flag an archived source';
  end if;
end;
$$;

-- Refusals change nothing: another organization's Leistung or article, an
-- unknown kind, and an employee.
select pg_temp.expect_refusal(label, format('select pg_temp.save_lines(3, gen_random_uuid(), %L, %L)',
  jsonb_build_array(pg_temp.line('Fremd', source::jsonb)), actor), refusal)
from (values
  ('a foreign Leistung', '{"kind":"leistung","id":"38330000-0000-4000-8000-000000000039"}',
   '38330000-0000-4000-8000-000000000001', 'source_not_found'),
  ('a foreign article', '{"kind":"article","id":"38330000-0000-4000-8000-000000000049"}',
   '38330000-0000-4000-8000-000000000001', 'source_not_found'),
  ('an article named as a Leistung', '{"kind":"leistung","id":"38330000-0000-4000-8000-000000000040"}',
   '38330000-0000-4000-8000-000000000001', 'source_not_found'),
  ('an unknown kind', '{"kind":"angebot","id":"38330000-0000-4000-8000-000000000030"}',
   '38330000-0000-4000-8000-000000000001', 'invalid_input'),
  ('an employee', '{"kind":"leistung","id":"38330000-0000-4000-8000-000000000030"}',
   '38330000-0000-4000-8000-000000000002', 'not_authorized')
) as cases(label, source, actor, refusal);
do $$
begin
  if (select version from public.invoices where id = (select draft from ids)) is distinct from 3
    or (select count(*) from public.invoice_lines where invoice_id = (select draft from ids)) is distinct from 2::bigint
  then
    raise exception 'a refused save with a source changed the draft';
  end if;
end;
$$;

-- The Leistung picker offers the active Leistungen of the organization only.
do $$
declare
  v_page jsonb := public.search_leistung_options('38330000-0000-4000-8000-000000000010', '', 0);
begin
  if v_page is distinct from jsonb_build_object('options', jsonb_build_array(jsonb_build_object(
      'id', '38330000-0000-4000-8000-000000000030', 'number', 'L-7', 'name', 'Monteurstunde', 'unit', 'hour')),
      'hasMore', false) then
    raise exception 'the Leistung picker offers %', v_page;
  end if;
  if jsonb_array_length(public.search_leistung_options('38330000-0000-4000-8000-000000000010', 'geselle', 0)
      -> 'options') is distinct from 1
    or jsonb_array_length(public.search_leistung_options('38330000-0000-4000-8000-000000000010', 'anfahrt', 0)
      -> 'options') is distinct from 0 then
    raise exception 'the Leistung picker search does not match description or shows an archived one';
  end if;
end;
$$;

reset role;

-- The Leistung picker orders numbers naturally: L-2 before L-10, a number
-- without trailing digits last.
insert into public.leistungen (id, organization_id, leistung_number, name, kind, unit, tax_rate_basis_points)
values
('38330000-0000-4000-8000-000000000032', '38330000-0000-4000-8000-000000000010', 'Pauschale', 'Anfahrt',
 'anfahrt', 'flat_rate', 1900),
('38330000-0000-4000-8000-000000000033', '38330000-0000-4000-8000-000000000010', 'L-10', 'Meisterstunde',
 'arbeit', 'hour', 1900),
('38330000-0000-4000-8000-000000000034', '38330000-0000-4000-8000-000000000010', 'L-2', 'Helferstunde',
 'arbeit', 'hour', 1900);
set local role service_role;
do $$
declare
  v_numbers jsonb := jsonb_path_query_array(
    public.search_leistung_options('38330000-0000-4000-8000-000000000010', '', 0), '$.options[*].number');
begin
  if v_numbers is distinct from '["L-2", "L-7", "L-10", "Pauschale"]'::jsonb then
    raise exception 'the Leistung picker orders the numbers %', v_numbers;
  end if;
end;
$$;
reset role;

-- The organization's deletion removes its lines with their sources.
delete from public.organizations where id = '38330000-0000-4000-8000-000000000010';
do $$
begin
  if exists (select 1 from public.invoice_lines where organization_id = '38330000-0000-4000-8000-000000000010') then
    raise exception 'an organization deletion left a line with a source';
  end if;
end;
$$;

rollback;
