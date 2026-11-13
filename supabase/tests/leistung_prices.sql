-- Leistungen keep dated prices without rewriting old ones, and no client role
-- reads them (migration 20261201180000_keep_dated_leistung_prices.sql).
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
('47000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'leistung-admin@example.test', '', now(), '{}',
 '{"first_name":"Admin","last_name":"Leistung"}', now(), now()),
('47000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'leistung-buero@example.test', '', now(), '{}',
 '{"first_name":"Büro","last_name":"Leistung"}', now(), now()),
('47000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'leistung-employee@example.test', '', now(), '{}',
 '{"first_name":"Employee","last_name":"Leistung"}', now(), now()),
('47000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'leistung-outsider@example.test', '', now(), '{}',
 '{"first_name":"Outsider","last_name":"Leistung"}', now(), now());

insert into public.organizations (id, name, admin_id, unique_code) values
('47000000-0000-0000-0000-000000000010', 'Haustechnik Sonnenberg SQL', '47000000-0000-0000-0000-000000000001', 'LEISTSQL'),
('47000000-0000-0000-0000-000000000011', 'Fremde Haustechnik SQL', '47000000-0000-0000-0000-000000000004', 'LEISTSQO');
insert into public.organization_members (organization_id, user_id, role) values
('47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002', 'buero'),
('47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000003', 'employee');

-- Runs one statement and requires the named refusal.
create function pg_temp.expect_refusal(p_label text, p_statement text, p_refusal text) returns void
language plpgsql as $$
begin
  begin
    execute p_statement;
  exception when others then
    if sqlerrm <> p_refusal and sqlstate <> p_refusal then
      raise exception '% refused with % (%) instead of %', p_label, sqlerrm, sqlstate, p_refusal;
    end if;
    return;
  end;
  raise exception '% was not refused', p_label;
end;
$$;
grant execute on function pg_temp.expect_refusal(text, text, text) to service_role, authenticated;

-- Grants: server-only tables and functions; the cost rate is selectable by no client role.
do $$
declare
  v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.leistungen', 'SELECT')
      or has_table_privilege(v_role, 'public.leistungen', 'INSERT')
      or has_table_privilege(v_role, 'public.leistungen', 'UPDATE')
      or has_table_privilege(v_role, 'public.leistungen', 'DELETE')
      or has_table_privilege(v_role, 'public.leistung_price_versions', 'SELECT')
      or has_table_privilege(v_role, 'public.leistung_price_versions', 'INSERT')
      or has_table_privilege(v_role, 'public.leistung_price_versions', 'UPDATE')
      or has_table_privilege(v_role, 'public.leistung_price_versions', 'DELETE') then
      raise exception '% holds a table privilege on the Leistungen', v_role;
    end if;
    if has_column_privilege(v_role, 'public.leistung_price_versions', 'cost_rate_cents', 'SELECT')
      or has_column_privilege(v_role, 'public.leistung_price_versions', 'sale_price_cents', 'SELECT') then
      raise exception '% can select a Leistung price column', v_role;
    end if;
    if has_function_privilege(v_role, 'public.create_leistung(uuid,uuid,text,text,text,text,text,integer,date,integer,integer)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.add_leistung_price(uuid,uuid,uuid,date,integer,integer)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.leistung_prices_on_day(uuid,uuid[],date)', 'EXECUTE')
      or has_function_privilege(v_role, 'public.list_leistung_page(uuid,date,text,text,integer,integer)', 'EXECUTE') then
      raise exception '% can execute a Leistung function', v_role;
    end if;
  end loop;
  if has_table_privilege('service_role', 'public.leistung_price_versions', 'UPDATE')
    or has_table_privilege('service_role', 'public.leistung_price_versions', 'DELETE')
    or has_table_privilege('service_role', 'public.leistungen', 'DELETE') then
    raise exception 'service_role can update or delete Leistung price history';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.leistungen'::regclass)
    or not (select relrowsecurity from pg_class where oid = 'public.leistung_price_versions'::regclass) then
    raise exception 'a Leistungen table runs without RLS';
  end if;
end;
$$;

set local role service_role;

-- 20: Montage (three versions, one corrected), 21: Anfahrt (only a coming price),
-- 22: archived, 29: another organization's Leistung with the same number as 20.
select public.create_leistung(
  '47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
  ' L-100 ', 'Montage Heizung', 'Stundensatz Monteur', 'arbeit', 'hour', 1900, '2038-01-01', 6500, 4200
);
select public.create_leistung(
  '47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
  'L-200', 'Anfahrt Stadtgebiet', '', 'anfahrt', 'flat_rate', 1900, '2039-03-01', 3900, null
);
select public.create_leistung(
  '47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
  'L-300', 'Entsorgungsgebühr Altkessel', '', 'gebuehr', 'piece', 1900, '2038-01-01', 5000, 3000
);
select public.create_leistung(
  '47000000-0000-0000-0000-000000000011', '47000000-0000-0000-0000-000000000004',
  'L-100', 'Fremde Montage', '', 'arbeit', 'hour', 1900, '2038-01-01', 9900, 8800
);

create temp table ids on commit drop as
select
  (select id from public.leistungen where organization_id = '47000000-0000-0000-0000-000000000010' and leistung_number = 'L-100') as montage,
  (select id from public.leistungen where organization_id = '47000000-0000-0000-0000-000000000010' and leistung_number = 'L-200') as anfahrt,
  (select id from public.leistungen where organization_id = '47000000-0000-0000-0000-000000000010' and leistung_number = 'L-300') as archived,
  (select id from public.leistungen where organization_id = '47000000-0000-0000-0000-000000000011') as foreign_leistung;
grant select on ids to service_role, authenticated;

update public.leistungen set archived_at = now() where id = (select archived from ids);

-- A raise on 2026-07-01, entered twice: the later recording corrects the first. Then a coming price.
insert into public.leistung_price_versions (organization_id, leistung_id, valid_from, sale_price_cents, cost_rate_cents, created_by)
select '47000000-0000-0000-0000-000000000010', montage, '2038-07-01', 6900, 4400, '47000000-0000-0000-0000-000000000002' from ids;
insert into public.leistung_price_versions (organization_id, leistung_id, valid_from, sale_price_cents, cost_rate_cents, created_by)
select '47000000-0000-0000-0000-000000000010', montage, '2038-07-01', 7100, 4500, '47000000-0000-0000-0000-000000000002' from ids;
insert into public.leistung_price_versions (organization_id, leistung_id, valid_from, sale_price_cents, cost_rate_cents, created_by)
select '47000000-0000-0000-0000-000000000010', montage, '2039-01-01', 7500, 4600, '47000000-0000-0000-0000-000000000002' from ids;

-- The create trims the number and stores the first price as a version.
do $$
begin
  if (select leistung_number from public.leistungen where id = (select montage from ids)) <> 'L-100' then
    raise exception 'create_leistung kept the untrimmed number';
  end if;
  if (select count(*) from public.leistung_price_versions where leistung_id = (select montage from ids)) <> 4 then
    raise exception 'create_leistung did not store the first price as a version';
  end if;
end;
$$;

-- The price on a day picks the right version.
do $$
declare
  v_case record;
  v_found record;
begin
  for v_case in
    select * from (values
      ('2037-12-31'::date, null::integer, null::integer, null::date),
      ('2038-01-01', 6500, 4200, '2038-01-01'),
      ('2038-06-30', 6500, 4200, '2038-01-01'),
      ('2038-07-01', 7100, 4500, '2038-07-01'),
      ('2038-12-31', 7100, 4500, '2038-07-01'),
      ('2039-01-01', 7500, 4600, '2039-01-01'),
      ('2042-05-05', 7500, 4600, '2039-01-01')
    ) as cases (on_day, sale, cost, valid_from)
  loop
    select * into v_found from public.leistung_prices_on_day(
      '47000000-0000-0000-0000-000000000010', array[(select montage from ids)], v_case.on_day
    );
    if v_found.leistung_id is distinct from (select montage from ids)
      or v_found.sale_price_cents is distinct from v_case.sale
      or v_found.cost_rate_cents is distinct from v_case.cost
      or v_found.valid_from is distinct from v_case.valid_from
      or v_found.unit <> 'hour'
      or v_found.tax_rate_basis_points <> 1900 then
      raise exception 'price on % picked % / % from %, expected % / % from %', v_case.on_day,
        v_found.sale_price_cents, v_found.cost_rate_cents, v_found.valid_from, v_case.sale, v_case.cost, v_case.valid_from;
    end if;
  end loop;
end;
$$;

-- A Leistung without a price on that day answers without one; an archived one answers;
-- another organization's id is left out.
do $$
declare
  v_rows integer;
begin
  select count(*) into v_rows from public.leistung_prices_on_day(
    '47000000-0000-0000-0000-000000000010',
    array[(select anfahrt from ids), (select archived from ids), (select foreign_leistung from ids)],
    '2038-11-12'
  );
  if v_rows <> 2 then raise exception 'price on day answered % rows instead of the own two', v_rows; end if;
  if exists (
    select 1 from public.leistung_prices_on_day('47000000-0000-0000-0000-000000000010', array[(select anfahrt from ids)], '2038-11-12')
    where sale_price_cents is not null or price_version_id is not null
  ) then
    raise exception 'a Leistung answered a price before its first version';
  end if;
  if not exists (
    select 1 from public.leistung_prices_on_day('47000000-0000-0000-0000-000000000010', array[(select archived from ids)], '2038-11-12')
    where sale_price_cents = 5000 and cost_rate_cents = 3000
  ) then
    raise exception 'an archived Leistung did not answer its price';
  end if;
  if exists (
    select 1 from public.leistung_prices_on_day('47000000-0000-0000-0000-000000000011', array[(select montage from ids)], '2038-11-12')
  ) then
    raise exception 'another organization read a foreign Leistung price';
  end if;
end;
$$;

-- A used version cannot change or be deleted, also by the service role; a Leistung is archived, never deleted.
select pg_temp.expect_refusal(
  'changing a price version',
  $sql$update public.leistung_price_versions set sale_price_cents = 1 where leistung_id = (select montage from ids)$sql$,
  '42501'
);
select pg_temp.expect_refusal(
  'deleting a price version',
  $sql$delete from public.leistung_price_versions where leistung_id = (select montage from ids)$sql$,
  '42501'
);
select pg_temp.expect_refusal(
  'deleting a Leistung',
  $sql$delete from public.leistungen where id = (select archived from ids)$sql$,
  '42501'
);
reset role;
-- Even the table owner, past every grant, meets the history guard.
select pg_temp.expect_refusal(
  'changing a price version past the grants',
  $sql$update public.leistung_price_versions set sale_price_cents = 1 where leistung_id = (select montage from ids)$sql$,
  'leistung_price_version_is_immutable'
);
select pg_temp.expect_refusal(
  'deleting a price version past the grants',
  $sql$delete from public.leistung_price_versions where leistung_id = (select montage from ids)$sql$,
  'leistung_price_version_is_immutable'
);
select pg_temp.expect_refusal(
  'deleting a Leistung past the grants',
  $sql$delete from public.leistungen where id = (select archived from ids)$sql$,
  'leistung_is_archived_not_deleted'
);
set local role service_role;

-- A number is unique per organization, whatever its case and spaces; a version cannot cross organizations.
select pg_temp.expect_refusal(
  'a taken number',
  $sql$select public.create_leistung('47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
    'l-100 ', 'Doppelt', '', 'arbeit', 'hour', 1900, '2038-01-01', 1, null)$sql$,
  'leistung_number_taken'
);
select pg_temp.expect_refusal(
  'a version of a foreign Leistung',
  $sql$insert into public.leistung_price_versions (organization_id, leistung_id, valid_from, sale_price_cents)
    select '47000000-0000-0000-0000-000000000010', foreign_leistung, '2038-01-01', 1 from ids$sql$,
  '23503'
);
select pg_temp.expect_refusal(
  'a unit outside the code shape',
  $sql$select public.create_leistung('47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
    'L-900', 'Falsche Einheit', '', 'arbeit', 'Std.', 1900, '2038-01-01', 1, null)$sql$,
  '23514'
);
select pg_temp.expect_refusal(
  'a negative price',
  $sql$insert into public.leistung_price_versions (organization_id, leistung_id, valid_from, sale_price_cents)
    select '47000000-0000-0000-0000-000000000010', montage, '2040-01-01', -1 from ids$sql$,
  '23514'
);

-- Adding a price refuses an archived or foreign Leistung and records an active one's.
select pg_temp.expect_refusal(
  'a price for an archived Leistung',
  $sql$select public.add_leistung_price('47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
    (select archived from ids), '2040-01-01', 1, null)$sql$,
  'leistung_not_found'
);
select pg_temp.expect_refusal(
  'a price for a foreign Leistung',
  $sql$select public.add_leistung_price('47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
    (select foreign_leistung from ids), '2040-01-01', 1, null)$sql$,
  'leistung_not_found'
);
do $$
declare
  v_id uuid;
begin
  v_id := public.add_leistung_price('47000000-0000-0000-0000-000000000010', '47000000-0000-0000-0000-000000000002',
    (select anfahrt from ids), '2040-01-01', 4100, null);
  if not exists (
    select 1 from public.leistung_price_versions
    where id = v_id and leistung_id = (select anfahrt from ids) and sale_price_cents = 4100 and valid_from = '2040-01-01'
  ) then
    raise exception 'add_leistung_price did not record the price';
  end if;
end;
$$;

-- The list page: the price on the day, the next coming first day, view, search and the organization boundary.
do $$
declare
  v_page jsonb;
  v_row jsonb;
begin
  v_page := public.list_leistung_page('47000000-0000-0000-0000-000000000010', '2038-11-12', 'aktiv', '', 1, 50);
  if (v_page ->> 'total')::integer is distinct from 2 or (v_page ->> 'hasAny')::boolean is distinct from true then
    raise exception 'active list page counted %', v_page ->> 'total';
  end if;
  if (v_page -> 'rows' -> 0 ->> 'leistungNumber') is distinct from 'L-200' or (v_page -> 'rows' -> 1 ->> 'leistungNumber') is distinct from 'L-100' then
    raise exception 'active list page is not ordered by name: %', v_page -> 'rows';
  end if;
  v_row := v_page -> 'rows' -> 1;
  if (v_row ->> 'salePriceCents')::integer is distinct from 7100 or (v_row ->> 'costRateCents')::integer is distinct from 4500
    or v_row ->> 'validFrom' is distinct from '2038-07-01' or v_row ->> 'nextValidFrom' is distinct from '2039-01-01' then
    raise exception 'list row priced Montage wrongly: %', v_row;
  end if;
  -- The history lists every version, newest first day first, the correction before the corrected one.
  if jsonb_array_length(v_row -> 'versions') is distinct from 4
    or (v_row -> 'versions' -> 0 ->> 'salePriceCents')::integer is distinct from 7500
    or (v_row -> 'versions' -> 1 ->> 'salePriceCents')::integer is distinct from 7100
    or (v_row -> 'versions' -> 2 ->> 'salePriceCents')::integer is distinct from 6900
    or (v_row -> 'versions' -> 3 ->> 'salePriceCents')::integer is distinct from 6500
    or v_row ->> 'priceVersionId' is null
    or v_row ->> 'priceVersionId' is distinct from v_row -> 'versions' -> 1 ->> 'id' then
    raise exception 'list row history of Montage is wrong: %', v_row -> 'versions';
  end if;
  v_row := v_page -> 'rows' -> 0;
  if v_row -> 'salePriceCents' is distinct from 'null'::jsonb or v_row ->> 'nextValidFrom' is distinct from '2039-03-01' then
    raise exception 'list row priced Anfahrt before its first version: %', v_row;
  end if;

  v_page := public.list_leistung_page('47000000-0000-0000-0000-000000000010', '2038-11-12', 'archiviert', '', 1, 50);
  if (v_page ->> 'total')::integer is distinct from 1 or (v_page -> 'rows' -> 0 ->> 'leistungNumber') is distinct from 'L-300' then
    raise exception 'archived list page showed %', v_page -> 'rows';
  end if;

  v_page := public.list_leistung_page('47000000-0000-0000-0000-000000000010', '2038-11-12', 'aktiv', 'monteur', 1, 50);
  if (v_page ->> 'total')::integer is distinct from 1 or (v_page -> 'rows' -> 0 ->> 'leistungNumber') is distinct from 'L-100' then
    raise exception 'search did not find the description: %', v_page;
  end if;

  v_page := public.list_leistung_page('47000000-0000-0000-0000-000000000010', '2038-11-12', 'aktiv', '', 2, 1);
  if (v_page ->> 'total')::integer is distinct from 2 or jsonb_array_length(v_page -> 'rows') is distinct from 1
    or (v_page -> 'rows' -> 0 ->> 'leistungNumber') is distinct from 'L-100' then
    raise exception 'second page of one row showed %', v_page;
  end if;

  v_page := public.list_leistung_page('47000000-0000-0000-0000-000000000011', '2038-11-12', 'aktiv', '', 1, 50);
  if (v_page ->> 'total')::integer is distinct from 1 or (v_page -> 'rows' -> 0 ->> 'name') is distinct from 'Fremde Montage' then
    raise exception 'another organization''s list page showed %', v_page;
  end if;
end;
$$;
reset role;

-- No signed-in member reads a row: not the employee, not the office, not another organization's admin.
create function pg_temp.read_as(p_user uuid, p_statement text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform pg_temp.expect_refusal(p_user::text || ': ' || p_statement, p_statement, '42501');
  execute 'reset role';
end;
$$;
select pg_temp.read_as(member, statement)
from unnest(array[
  '47000000-0000-0000-0000-000000000003'::uuid,
  '47000000-0000-0000-0000-000000000002',
  '47000000-0000-0000-0000-000000000004'
]) as member
cross join unnest(array[
  'select count(*) from public.leistungen',
  'select count(*) from public.leistung_price_versions',
  'select cost_rate_cents from public.leistung_price_versions',
  $sql$select public.leistung_prices_on_day('47000000-0000-0000-0000-000000000010', array[(select montage from ids)], '2038-11-12')$sql$,
  $sql$select public.list_leistung_page('47000000-0000-0000-0000-000000000010', '2038-11-12')$sql$
]) as statement;

-- A deleted account leaves its prices with an empty author; every price field stays.
reset role;
delete from public.organization_members where user_id = '47000000-0000-0000-0000-000000000002';
delete from auth.users where id = '47000000-0000-0000-0000-000000000002';
do $$
begin
  if exists (select 1 from public.leistung_price_versions where created_by = '47000000-0000-0000-0000-000000000002')
    or (select count(*) from public.leistung_price_versions
        where organization_id = '47000000-0000-0000-0000-000000000010' and created_by is null) <> 7
    or not exists (select 1 from public.leistung_price_versions
      where organization_id = '47000000-0000-0000-0000-000000000010' and leistung_id = (select montage from ids)
        and sale_price_cents = 7100 and cost_rate_cents = 4500) then
    raise exception 'deleting a price author changed the price history';
  end if;
end;
$$;
select pg_temp.expect_refusal(
  'clearing a price author directly',
  $sql$update public.leistung_price_versions set created_by = null$sql$,
  'leistung_price_version_is_immutable'
);

-- Deleting an organization removes its Leistungen with their versions (legitimate teardown).
delete from public.organizations where id = '47000000-0000-0000-0000-000000000011';
do $$
begin
  if exists (select 1 from public.leistungen where organization_id = '47000000-0000-0000-0000-000000000011')
    or exists (select 1 from public.leistung_price_versions where organization_id = '47000000-0000-0000-0000-000000000011') then
    raise exception 'organization cascade left Leistung rows';
  end if;
end;
$$;

rollback;
