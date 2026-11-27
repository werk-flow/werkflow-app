-- A customer's own conditions price new offer Positions, and each Position
-- keeps where its price came from (werk-flow/werkflow-planning#384, E2a K8).
--
-- 1. client_price_conditions: Kundenkonditionen as numbered versions per
--    customer, each with its first valid day and a discount in tenths of a
--    percent on material, on Arbeit and on Anfahrt. The conditions key on the
--    kind of line, never on an article category. A version never changes; a
--    new one is the whole set again. The version with the latest first day up
--    to a day applies on it; among versions of one first day the higher number
--    (app_private.client_price_condition_on_day, the one home of that rule).
-- 2. client_price_condition_leistungen: a version's own net price for a named
--    Leistung, per one unit of it.
-- 3. offer_positions.price_source and price_condition_id: the snapshot of
--    where a priced Position's price came from: „listenpreis“, „kundenkondition“
--    with the version, or „manuell“. Changing a condition never touches a
--    Position.
-- 4. record_client_price_condition: a new version with its own prices, in one
--    call, under the customer's row lock, at the version the form was filled
--    from, with a retry key. It touches the customer's row, the published
--    owning root, so an open customer page hears of the new version.
-- 5. list_client_price_conditions: a customer's newest versions with their
--    own prices, how many there are and which applies on a day.
--    get_offer_price_condition: what prices a new Position of an offer on
--    a day: the version of its customer and that version's own price of one
--    Leistung.
-- 6. save_offer_content as in 20270501090000, with each priced Position's
--    price source; a condition must be one of the offer's customer.
-- 7. get_offer_with_costs as in 20270501090000, with each priced Position's
--    price source beside its cost. get_offer, which a document reads, stays.
--
-- Sale prices and discounts are office facts. Both tables are server-only: no
-- client role holds a grant, so a field worker reads no row. lib/price-catalog/ resolves every price
-- and lib/offers/ computes every amount; no SQL here computes one.
--
-- Expand-only: two new tables, two nullable columns with a NOT VALID check,
-- and three functions keep their signatures and their answers for every
-- caller older code makes.
--
-- Prevention: Tier 1 (the history guard, the organization-scoped foreign keys,
-- the checks, RLS and the grants), Tier 2 supabase/tests/client_price_conditions.sql.

-- 1. The versions.
create table public.client_price_conditions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null,
  -- 1, 2, 3 … per customer, in the order the office recorded them.
  version integer not null,
  -- The first Berlin day the version applies.
  valid_from date not null,
  -- Tenths of a percent: 125 is 12,5 %.
  material_discount_tenths integer not null,
  arbeit_discount_tenths integer not null,
  anfahrt_discount_tenths integer not null,
  attempt_key uuid not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  constraint client_price_conditions_client_fk foreign key (client_id, organization_id)
    references public.clients (id, organization_id) on delete cascade,
  constraint client_price_conditions_id_organization_key unique (id, organization_id),
  constraint client_price_conditions_version_key unique (client_id, version),
  constraint client_price_conditions_attempt_key unique (organization_id, attempt_key),
  constraint client_price_conditions_version_check check (version >= 1),
  constraint client_price_conditions_discount_check check (
    material_discount_tenths between 0 and 1000
    and arbeit_discount_tenths between 0 and 1000
    and anfahrt_discount_tenths between 0 and 1000
  )
);

create index client_price_conditions_client_idx on public.client_price_conditions (client_id, organization_id);
create index client_price_conditions_created_by_idx on public.client_price_conditions (created_by);

-- 2. A version's own Leistung prices.
create table public.client_price_condition_leistungen (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  condition_id uuid not null,
  leistung_id uuid not null,
  -- Net cents per one unit of the Leistung.
  sale_price_cents integer not null,
  constraint client_price_condition_leistungen_pkey primary key (condition_id, leistung_id),
  constraint client_price_condition_leistungen_condition_fk foreign key (condition_id, organization_id)
    references public.client_price_conditions (id, organization_id) on delete cascade,
  -- A Leistung is archived, never deleted.
  constraint client_price_condition_leistungen_leistung_fk foreign key (leistung_id, organization_id)
    references public.leistungen (id, organization_id),
  constraint client_price_condition_leistungen_price_check check (sale_price_cents between 0 and 100000000)
);

create index client_price_condition_leistungen_condition_idx
  on public.client_price_condition_leistungen (condition_id, organization_id);
create index client_price_condition_leistungen_leistung_idx
  on public.client_price_condition_leistungen (leistung_id, organization_id);
create index client_price_condition_leistungen_organization_idx
  on public.client_price_condition_leistungen (organization_id);

-- A version and its prices outlive every direct UPDATE and DELETE; only the
-- cascade of a deleted customer or organization removes them, and a deleted
-- account's author reference becomes NULL (its foreign key action).
create function app_private.keep_client_price_condition_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  -- Nested: the own prices have no author, and PL/pgSQL resolves every field of one condition.
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and tg_table_name = 'client_price_conditions' then
    if new.created_by is null and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
      return new;
    end if;
  end if;
  raise exception 'client_price_condition_is_immutable';
end;
$$;
revoke all on function app_private.keep_client_price_condition_history() from public, anon, authenticated;

create trigger client_price_conditions_keep_history
before update or delete on public.client_price_conditions
for each row execute function app_private.keep_client_price_condition_history();
create trigger client_price_condition_leistungen_keep_history
before update or delete on public.client_price_condition_leistungen
for each row execute function app_private.keep_client_price_condition_history();

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.client_price_conditions enable row level security;
alter table public.client_price_condition_leistungen enable row level security;

revoke all on table public.client_price_conditions from public, anon, authenticated, service_role;
revoke all on table public.client_price_condition_leistungen from public, anon, authenticated, service_role;
grant select, insert on table public.client_price_conditions to service_role;
grant select, insert on table public.client_price_condition_leistungen to service_role;

-- 3. A priced Position's price source.
alter table public.offer_positions add column price_source text;
alter table public.offer_positions add column price_condition_id uuid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no offer content table yet; the rule binds only the new column, which older code never writes
-- Not valid: every existing row has no version, so no scan under the lock is needed.
alter table public.offer_positions add constraint offer_positions_price_condition_fk
  foreign key (price_condition_id, organization_id)
  references public.client_price_conditions (id, organization_id) not valid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no offer content table yet; the rule binds only the new columns, which older code never writes
-- A Position saved before this migration, or by older code, keeps no source.
-- Every operand of the second branch is non-null there, so no row passes as unknown.
alter table public.offer_positions add constraint offer_positions_price_source_check check (
  (price_source is null and price_condition_id is null)
  or (price_source is not null and kind = 'free' and case price_source
    when 'manuell' then price_condition_id is null
    when 'listenpreis' then price_condition_id is null and (item_id is not null or leistung_id is not null)
    when 'kundenkondition' then price_condition_id is not null and (item_id is not null or leistung_id is not null)
    else false end)
) not valid;

create index offer_positions_price_condition_idx on public.offer_positions (price_condition_id, organization_id)
  where price_condition_id is not null;

-- 4. A new version with its own prices, in one call. The caller resolved the
-- organization, the actor and every value. p_expected_version is the newest
-- version the form was filled from, 0 for none: another session's version
-- meanwhile refuses this one. A repeat under the same key answers the first
-- version. p_leistung_prices: [{"leistungId": uuid, "salePriceCents": integer}].
-- The answer names the version, the customer and the customer row's stamp.
-- Refusals: invalid_input, not_authorized, client_not_found, client_archived,
-- condition_changed, leistung_not_found.
create function public.record_client_price_condition(
  p_actor_id uuid,
  p_organization_id uuid,
  p_client_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_valid_from date,
  p_material_discount_tenths integer,
  p_arbeit_discount_tenths integer,
  p_anfahrt_discount_tenths integer,
  p_leistung_prices jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_client public.clients;
  v_earlier public.client_price_conditions;
  v_newest integer;
  v_condition_id uuid;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_client_id is null or p_attempt_key is null
    or p_expected_version is null or p_expected_version < 0 or p_valid_from is null
    or jsonb_typeof(p_leistung_prices) is distinct from 'array'
  then
    raise exception 'invalid_input';
  end if;
  if exists (select 1 from jsonb_array_elements(p_leistung_prices) entry
      where coalesce(entry ->> 'leistungId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or jsonb_typeof(entry -> 'salePriceCents') is distinct from 'number')
    or (select count(*) from jsonb_array_elements(p_leistung_prices))
      <> (select count(distinct lower(entry ->> 'leistungId')) from jsonb_array_elements(p_leistung_prices) entry)
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_client from public.clients client
  where client.organization_id = p_organization_id and client.id = p_client_id
  for no key update;
  if not found then raise exception 'client_not_found'; end if;

  -- Under the customer's row lock an earlier call under the same key has committed its version.
  select * into v_earlier from public.client_price_conditions condition
  where condition.organization_id = p_organization_id and condition.attempt_key = p_attempt_key;
  if found then
    if v_earlier.client_id <> p_client_id then raise exception 'invalid_input'; end if;
    return jsonb_build_object('conditionId', v_earlier.id, 'version', v_earlier.version,
      'clientId', p_client_id, 'updatedAt', v_client.updated_at);
  end if;

  if v_client.archived_at is not null then raise exception 'client_archived'; end if;
  select coalesce(max(condition.version), 0) into v_newest from public.client_price_conditions condition
  where condition.organization_id = p_organization_id and condition.client_id = p_client_id;
  if v_newest <> p_expected_version then raise exception 'condition_changed'; end if;
  if exists (select 1 from jsonb_array_elements(p_leistung_prices) entry
      where not exists (select 1 from public.leistungen leistung
        where leistung.id = (entry ->> 'leistungId')::uuid and leistung.organization_id = p_organization_id))
  then
    raise exception 'leistung_not_found';
  end if;

  insert into public.client_price_conditions (
    organization_id, client_id, version, valid_from, material_discount_tenths, arbeit_discount_tenths,
    anfahrt_discount_tenths, attempt_key, created_by
  ) values (
    p_organization_id, p_client_id, v_newest + 1, p_valid_from, p_material_discount_tenths,
    p_arbeit_discount_tenths, p_anfahrt_discount_tenths, p_attempt_key, p_actor_id
  ) returning id into v_condition_id;
  insert into public.client_price_condition_leistungen (organization_id, condition_id, leistung_id, sale_price_cents)
  select p_organization_id, v_condition_id, (entry ->> 'leistungId')::uuid, (entry ->> 'salePriceCents')::integer
  from jsonb_array_elements(p_leistung_prices) entry;
  -- The customer's row is the published owning root: its change tells open pages of the new version.
  -- No master data field changes, so the master history records nothing.
  -- Its stamp goes back with the answer, so the saving tab knows the echo of its own save.
  update public.clients client set updated_at = now()
  where client.organization_id = p_organization_id and client.id = p_client_id
  returning client.updated_at into v_updated_at;
  return jsonb_build_object('conditionId', v_condition_id, 'version', v_newest + 1,
    'clientId', p_client_id, 'updatedAt', v_updated_at);
end;
$$;
revoke all on function public.record_client_price_condition(uuid, uuid, uuid, integer, uuid, date, integer, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_client_price_condition(uuid, uuid, uuid, integer, uuid, date, integer, integer, integer, jsonb)
  to service_role;

-- 5. The version of a customer that applies on a day: the latest first day up
-- to that day, the higher number among versions of one first day. Null before
-- the first one starts.
create function app_private.client_price_condition_on_day(
  p_organization_id uuid, p_client_id uuid, p_on_date date
) returns uuid language sql stable security invoker set search_path = '' as $$
  select condition.id from public.client_price_conditions condition
  where condition.organization_id = p_organization_id and condition.client_id = p_client_id
    and condition.valid_from <= p_on_date
  order by condition.valid_from desc, condition.version desc
  limit 1;
$$;
revoke all on function app_private.client_price_condition_on_day(uuid, uuid, date) from public, anon, authenticated;
grant execute on function app_private.client_price_condition_on_day(uuid, uuid, date) to service_role;

-- The customer's newest versions (at most p_limit, the newest number first,
-- and the one that applies on p_on_date also when it is older), each with its own prices and the Leistung's number, name, unit and archive
-- state; how many versions it has; and the one that applies on p_on_date. A
-- customer without one, or of another organization, answers none.
create function public.list_client_price_conditions(
  p_organization_id uuid, p_client_id uuid, p_on_date date, p_limit integer default 20
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', (select count(*) from public.client_price_conditions condition
      where condition.organization_id = p_organization_id and condition.client_id = p_client_id),
    'applyingId', app_private.client_price_condition_on_day(p_organization_id, p_client_id, p_on_date),
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', newest.id,
          'version', newest.version,
          'validFrom', newest.valid_from,
          'materialDiscountTenths', newest.material_discount_tenths,
          'arbeitDiscountTenths', newest.arbeit_discount_tenths,
          'anfahrtDiscountTenths', newest.anfahrt_discount_tenths,
          'leistungPrices', coalesce((
            select jsonb_agg(jsonb_build_object(
                'leistungId', leistung.id,
                'number', leistung.leistung_number,
                'name', leistung.name,
                'unit', leistung.unit,
                'archived', leistung.archived_at is not null,
                'salePriceCents', price.sale_price_cents
              ) order by lower(leistung.name), leistung.id)
            from public.client_price_condition_leistungen price
            join public.leistungen leistung
              on leistung.id = price.leistung_id and leistung.organization_id = p_organization_id
            where price.condition_id = newest.id and price.organization_id = p_organization_id
          ), '[]'::jsonb)
        ) order by newest.version desc)
      -- A customer's versions are numbered 1, 2, 3 … without a gap.
      from public.client_price_conditions newest
      where newest.organization_id = p_organization_id and newest.client_id = p_client_id
        and (newest.version > (select coalesce(max(condition.version), 0) from public.client_price_conditions condition
            where condition.organization_id = p_organization_id and condition.client_id = p_client_id)
            - least(greatest(p_limit, 1), 100)
          or newest.id = app_private.client_price_condition_on_day(p_organization_id, p_client_id, p_on_date))
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.list_client_price_conditions(uuid, uuid, date, integer) from public, anon, authenticated;
grant execute on function public.list_client_price_conditions(uuid, uuid, date, integer) to service_role;

-- What prices a new Position of an offer of the organization on a day: null
-- for no such offer; else the version of its customer that applies on the
-- day, or null, with that version's own price of p_leistung_id (null for an
-- article or a Leistung without one).
create function public.get_offer_price_condition(
  p_organization_id uuid, p_offer_id uuid, p_on_date date, p_leistung_id uuid default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('condition', (
      select jsonb_build_object(
        'id', condition.id,
        'version', condition.version,
        'validFrom', condition.valid_from,
        'materialDiscountTenths', condition.material_discount_tenths,
        'arbeitDiscountTenths', condition.arbeit_discount_tenths,
        'anfahrtDiscountTenths', condition.anfahrt_discount_tenths,
        'ownPriceCents', (select price.sale_price_cents from public.client_price_condition_leistungen price
          where price.condition_id = condition.id and price.organization_id = p_organization_id
            and price.leistung_id = p_leistung_id))
      from public.client_price_conditions condition
      where condition.organization_id = p_organization_id
        and condition.id = app_private.client_price_condition_on_day(p_organization_id, offer.client_id, p_on_date)))
  from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id;
$$;
revoke all on function public.get_offer_price_condition(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.get_offer_price_condition(uuid, uuid, date, uuid) to service_role;

-- 6. p_sections as in 20270501090000; a priced Position may also carry
-- priceSource {kind: 'listenpreis' | 'kundenkondition' | 'manuell',
-- conditionId}. New refusal: price_condition_not_found (no version of the
-- offer's customer).
create or replace function public.save_offer_content(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_content_version integer,
  p_attempt_key uuid,
  p_sections jsonb,
  p_totals jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_old public.offers;
  v_replayed jsonb;
  v_section record;
  v_section_id uuid;
  v_positions integer;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_content_version is null or jsonb_typeof(p_sections) is distinct from 'array'
    or jsonb_typeof(p_totals) is distinct from 'object'
  then
    raise exception 'invalid_input';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sections) section
    where jsonb_typeof(section -> 'positions') is distinct from 'array')
  then
    raise exception 'invalid_input';
  end if;
  -- numeric(12,3) would round a fourth decimal silently.
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where line ->> 'kind' = 'free'
      and coalesce(line ->> 'quantity', '') !~ '^-?[0-9]{1,9}(\.[0-9]{1,3})?$')
  then
    raise exception 'invalid_input';
  end if;
  -- A source is absent, null, or an article or Leistung id; a cost is absent, null, or two numbers;
  -- a price source is absent, null, or a kind with a version id exactly for a customer condition.
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where (coalesce(jsonb_typeof(line -> 'source'), 'null') <> 'null'
        and (coalesce(line #>> '{source,kind}', '') not in ('article', 'leistung')
          or coalesce(line #>> '{source,id}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      or (coalesce(jsonb_typeof(line -> 'purchaseCost'), 'null') <> 'null'
        and (jsonb_typeof(line #> '{purchaseCost,amountCents}') is distinct from 'number'
          or jsonb_typeof(line #> '{purchaseCost,priceQuantity}') is distinct from 'number'))
      or (coalesce(jsonb_typeof(line -> 'priceSource'), 'null') <> 'null'
        and (coalesce(line #>> '{priceSource,kind}', '') not in ('listenpreis', 'kundenkondition', 'manuell')
          or (line #>> '{priceSource,kind}' = 'kundenkondition') is distinct from
            (coalesce(line #>> '{priceSource,conditionId}', '')
              ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
          or (line #>> '{priceSource,kind}' <> 'kundenkondition'
            and coalesce(jsonb_typeof(line #> '{priceSource,conditionId}'), 'null') <> 'null'))))
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_old from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;
  -- Under the row lock an earlier call under the same key has committed its event.
  select event.payload into v_replayed from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key
    and event.offer_id = p_offer_id and event.actor_id = p_actor_id and event.event_type = 'content_changed';
  if found then
    return jsonb_build_object('contentVersion', (v_replayed ->> 'contentVersion')::integer,
      'updatedAt', v_old.updated_at);
  end if;
  if v_old.status <> 'entwurf' then raise exception 'offer_not_editable'; end if;
  if v_old.content_version <> p_expected_content_version then raise exception 'offer_changed'; end if;
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where line #>> '{source,kind}' = 'article' and not exists (
      select 1 from public.inventory_items item
      where item.id = (line #>> '{source,id}')::uuid and item.organization_id = p_organization_id))
  then
    raise exception 'article_not_found';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where line #>> '{source,kind}' = 'leistung' and not exists (
      select 1 from public.leistungen leistung
      where leistung.id = (line #>> '{source,id}')::uuid and leistung.organization_id = p_organization_id))
  then
    raise exception 'leistung_not_found';
  end if;
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where line #>> '{priceSource,kind}' = 'kundenkondition' and not exists (
      select 1 from public.client_price_conditions condition
      where condition.id = (line #>> '{priceSource,conditionId}')::uuid
        and condition.organization_id = p_organization_id and condition.client_id = v_old.client_id))
  then
    raise exception 'price_condition_not_found';
  end if;

  delete from public.offer_sections section
  where section.organization_id = p_organization_id and section.offer_id = p_offer_id;
  for v_section in
    select entry.value, entry.ordinality::integer as position
    from jsonb_array_elements(p_sections) with ordinality as entry(value, ordinality)
  loop
    insert into public.offer_sections (organization_id, offer_id, position, title, net_cents)
    values (p_organization_id, p_offer_id, v_section.position, btrim(v_section.value ->> 'title'),
      (v_section.value ->> 'netCents')::bigint)
    returning id into v_section_id;
    insert into public.offer_positions (
      organization_id, offer_id, section_id, position, kind, name, description, quantity, unit, unit_label,
      unit_price_cents, price_quantity, tax_rate_basis_points, amount_cents, item_id, leistung_id,
      purchase_cost_cents, purchase_price_quantity, price_source, price_condition_id
    )
    select p_organization_id, p_offer_id, v_section_id, line.ordinality::integer, line.value ->> 'kind',
      btrim(line.value ->> 'name'), btrim(coalesce(line.value ->> 'description', '')),
      (line.value ->> 'quantity')::numeric, line.value ->> 'unit', line.value ->> 'unitLabel',
      (line.value ->> 'unitPriceCents')::bigint, (line.value ->> 'priceQuantity')::integer,
      (line.value ->> 'taxRateBasisPoints')::integer, (line.value ->> 'amountCents')::bigint,
      case when line.value #>> '{source,kind}' = 'article' then (line.value #>> '{source,id}')::uuid end,
      case when line.value #>> '{source,kind}' = 'leistung' then (line.value #>> '{source,id}')::uuid end,
      (line.value #>> '{purchaseCost,amountCents}')::bigint,
      (line.value #>> '{purchaseCost,priceQuantity}')::integer,
      line.value #>> '{priceSource,kind}',
      (line.value #>> '{priceSource,conditionId}')::uuid
    from jsonb_array_elements(v_section.value -> 'positions') with ordinality as line(value, ordinality);
  end loop;

  -- The server computed every amount; the stored sums must add up.
  if exists (
    select 1 from public.offer_sections section
    where section.organization_id = p_organization_id and section.offer_id = p_offer_id
      and section.net_cents is distinct from (select coalesce(sum(line.amount_cents), 0)
        from public.offer_positions line
        where line.organization_id = p_organization_id and line.section_id = section.id)
  ) or (p_totals ->> 'netCents')::bigint is distinct from (select coalesce(sum(section.net_cents), 0)
      from public.offer_sections section
      where section.organization_id = p_organization_id and section.offer_id = p_offer_id)
  then
    raise exception 'invalid_input';
  end if;
  select count(*) into v_positions from public.offer_positions line
  where line.organization_id = p_organization_id and line.offer_id = p_offer_id;

  update public.offers offer set
    net_cents = (p_totals ->> 'netCents')::bigint,
    tax_cents = (p_totals ->> 'taxCents')::bigint,
    gross_cents = (p_totals ->> 'grossCents')::bigint,
    content_version = offer.content_version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
    and offer.content_version = p_expected_content_version
  returning offer.updated_at into v_updated_at;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'content_changed', v_old.status, v_old.version,
    jsonb_build_object('contentVersion', v_old.content_version + 1,
      'sectionCount', jsonb_array_length(p_sections), 'positionCount', v_positions,
      'grossCentsBefore', v_old.gross_cents, 'grossCents', (p_totals ->> 'grossCents')::bigint),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('contentVersion', v_old.content_version + 1, 'updatedAt', v_updated_at);
end;
$$;
revoke all on function public.save_offer_content(uuid, uuid, uuid, integer, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_offer_content(uuid, uuid, uuid, integer, uuid, jsonb, jsonb)
  to service_role;

-- 7. As in 20270501090000, and per Titel in order each Position's price
-- source in order: null for a text line and for a Position saved without
-- one, else its kind and, for a customer condition, the version's number
-- and first day.
create or replace function public.get_offer_with_costs(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'offer', public.get_offer(p_organization_id, p_offer_id),
    'costs', coalesce((
      select jsonb_agg(coalesce((
          select jsonb_agg(case when line.purchase_cost_cents is not null then jsonb_build_object(
              'amountCents', line.purchase_cost_cents, 'priceQuantity', line.purchase_price_quantity) end
            order by line.position)
          from public.offer_positions line
          where line.section_id = section.id and line.organization_id = p_organization_id
        ), '[]'::jsonb) order by section.position)
      from public.offer_sections section
      where section.offer_id = offer.id and section.organization_id = p_organization_id
    ), '[]'::jsonb),
    'priceSources', coalesce((
      select jsonb_agg(coalesce((
          select jsonb_agg(case when line.price_source is not null then jsonb_build_object(
              'kind', line.price_source,
              'condition', (select jsonb_build_object('id', condition.id, 'version', condition.version,
                  'validFrom', condition.valid_from)
                from public.client_price_conditions condition
                where condition.id = line.price_condition_id
                  and condition.organization_id = p_organization_id)) end
            order by line.position)
          from public.offer_positions line
          where line.section_id = section.id and line.organization_id = p_organization_id
        ), '[]'::jsonb) order by section.position)
      from public.offer_sections section
      where section.offer_id = offer.id and section.organization_id = p_organization_id
    ), '[]'::jsonb)
  )
  from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id;
$$;
revoke all on function public.get_offer_with_costs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer_with_costs(uuid, uuid) to service_role;
