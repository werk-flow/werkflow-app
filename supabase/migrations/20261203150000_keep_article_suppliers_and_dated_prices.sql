-- An article knows its suppliers with their pack sizes, and every price has a
-- date and a source (werk-flow/werkflow-planning#373).
--
-- Before this, an article carried one supplier, one supplier article number,
-- and one purchase and one sale price per base unit, overwritten on each save.
--
-- 1. inventory_item_suppliers holds an article's supplier references: the
--    supplier, its article number, and the purchase unit with its conversion
--    to the base unit („1 Rolle = 50 m“: pack_quantity 1, base_quantity 50).
--    An article with references has exactly one preferred reference; removing
--    the preferred one makes the oldest remaining one preferred.
-- 2. inventory_item_prices holds the purchase and list sale prices as dated
--    rows: amount_cents per price_quantity base units (1, 10, 100, 1000),
--    valid from a Berlin day, with its source and the person. A row is never
--    changed or deleted, outside an organization deletion; a correction is a
--    new row. A row may start in the past or the future. Each row keeps the
--    base unit its amount is stated in: after a change of the article's unit,
--    a price in the earlier unit stays as history and no longer applies.
--    The unit of an article whose supplier sells it in packs cannot change,
--    because each pack conversion counts in that unit (unit_has_pack_sizes).
-- 3. One rule answers the price: public.read_inventory_item_prices_on_day picks per
--    kind the row with the latest first day up to that day, and among rows of
--    the same first day the latest recorded. The price reader of the app
--    (readArticlePrices), the cost snapshot of record_job_material_use and the
--    sync below read through it. One function writes a price
--    (app_private.record_inventory_item_price): the article form, the price
--    tab and the CSV import call it.
-- 4. Expand-only: inventory_items.supplier_id and supplier_article_number
--    mirror the preferred reference, and purchase_price_cents and
--    sale_price_cents show today's price per one base unit where that is a
--    whole cent (else NULL), so every reader of the previous release keeps
--    working. Only the functions here write those columns. A price that
--    starts after the day it was recorded reaches the columns through an
--    hourly job. An article number an article carries without any supplier
--    stays on it until the article gets a reference.
-- 5. save_inventory_item keeps its signature. A save without the supplier and
--    price keys in p_item leaves references and prices as they are (the
--    article form edits them in their own tabs). A save with them, as the
--    previous release sends it and as a new article sends it, makes that
--    supplier the preferred reference and records a changed price as a manual
--    price from today. A cleared price or supplier is ignored: a price is
--    corrected by a new one.
-- 6. The CSV import records a new article's supplier as its first reference and
--    its prices as CSV-import prices. A matched article stays as it is, as
--    before: its prices change only through a price the office records.
-- 7. Today's columns become the first rows: each supplier the first, preferred
--    reference, each price a row „carried_over“ from the Berlin day of the
--    article's last save, without a person.
--
-- Division of work: the actions establish identity, the organization and the
-- manager role, and pass the server-resolved organization and actor. The
-- public write functions follow the inventory pattern (owner decision
-- 2026-11-13): SECURITY DEFINER with search_path '', executable by
-- service_role only, re-checking the manager membership inside
-- (app_private.lock_inventory_manager); their app_private steps are revoked
-- from every role.
--
-- Both tables are server-only: RLS without a policy and a SELECT grant to
-- service_role alone, so no client role reads a supplier reference or a price
-- through the Data API. A write touches the article row, which the Realtime
-- publication carries, so another session's inventory page reads again.

create table public.inventory_item_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null,
  supplier_id uuid not null,
  supplier_article_number text,
  -- A unit code of lib/inventory/units.ts; NULL orders in the article's base unit.
  purchase_unit text,
  -- pack_quantity purchase units hold base_quantity base units.
  pack_quantity numeric(12,3) not null default 1,
  base_quantity numeric(12,3) not null default 1,
  is_preferred boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  constraint inventory_item_suppliers_item_fk foreign key (item_id, organization_id)
    references public.inventory_items (id, organization_id) on delete cascade,
  constraint inventory_item_suppliers_supplier_fk foreign key (supplier_id, organization_id)
    references public.inventory_suppliers (id, organization_id) on delete cascade,
  constraint inventory_item_suppliers_article_number_check
    check (supplier_article_number is null or length(btrim(supplier_article_number)) between 1 and 200),
  constraint inventory_item_suppliers_purchase_unit_check
    check (purchase_unit is null or purchase_unit ~ '^[a-z_]{1,40}$'),
  constraint inventory_item_suppliers_conversion_check check (pack_quantity > 0 and base_quantity > 0),
  constraint inventory_item_suppliers_base_unit_check
    check (purchase_unit is not null or (pack_quantity = 1 and base_quantity = 1))
);

create unique index inventory_item_suppliers_preferred_key
  on public.inventory_item_suppliers (item_id) where is_preferred;
create unique index inventory_item_suppliers_item_supplier_key
  on public.inventory_item_suppliers (item_id, supplier_id, coalesce(supplier_article_number, ''));
-- A supplier's article number names one article of the organization, as on inventory_items.
create unique index inventory_item_suppliers_article_number_key
  on public.inventory_item_suppliers (organization_id, supplier_id, supplier_article_number)
  where supplier_article_number is not null;
create index inventory_item_suppliers_supplier_idx on public.inventory_item_suppliers (supplier_id);

create table public.inventory_item_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  item_id uuid not null,
  kind text not null,
  -- The article's base unit when the price was recorded; amount_cents is per price_quantity of it.
  unit text not null,
  amount_cents integer not null,
  price_quantity integer not null,
  -- The first Berlin day this price applies.
  valid_from date not null,
  source text not null,
  -- NULL for a price carried over from the article row.
  created_by uuid references public.profiles (id),
  -- The recording order decides between prices of the same first day.
  created_at timestamptz not null default clock_timestamp(),
  -- An article with price history is archived, never deleted.
  constraint inventory_item_prices_item_fk foreign key (item_id, organization_id)
    references public.inventory_items (id, organization_id),
  constraint inventory_item_prices_kind_check check (kind in ('purchase', 'sale')),
  constraint inventory_item_prices_amount_check check (amount_cents >= 0),
  constraint inventory_item_prices_quantity_check check (price_quantity in (1, 10, 100, 1000)),
  constraint inventory_item_prices_source_check
    check (source in ('manual', 'csv_import', 'datanorm', 'carried_over'))
);

create index inventory_item_prices_item_day_idx
  on public.inventory_item_prices (item_id, kind, valid_from desc, created_at desc, id desc);
create index inventory_item_prices_valid_from_idx on public.inventory_item_prices (valid_from);
create index inventory_item_prices_created_by_idx
  on public.inventory_item_prices (created_by) where created_by is not null;

create trigger guard_inventory_item_prices_append_only
before update or delete on public.inventory_item_prices
for each row execute function app_private.guard_inventory_ledger_append_only();

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.inventory_item_suppliers enable row level security;
alter table public.inventory_item_prices enable row level security;

revoke all on table public.inventory_item_suppliers from public, anon, authenticated, service_role;
revoke all on table public.inventory_item_prices from public, anon, authenticated, service_role;
grant select on table public.inventory_item_suppliers to service_role;
grant select on table public.inventory_item_prices to service_role;

-- 7. Today's columns become the first rows.
insert into public.inventory_item_suppliers (
  organization_id, item_id, supplier_id, supplier_article_number, is_preferred, created_at
)
select item.organization_id, item.id, item.supplier_id,
  case when btrim(item.supplier_article_number) <> '' then item.supplier_article_number end,
  true, item.updated_at
from public.inventory_items item
join public.inventory_suppliers supplier
  on supplier.id = item.supplier_id and supplier.organization_id = item.organization_id;

insert into public.inventory_item_prices (
  organization_id, item_id, kind, unit, amount_cents, price_quantity, valid_from, source, created_at
)
select item.organization_id, item.id, price.kind, item.unit, price.amount_cents, 1,
  (item.updated_at at time zone 'Europe/Berlin')::date, 'carried_over', item.updated_at
from public.inventory_items item
cross join lateral (values
  ('purchase', item.purchase_price_cents),
  ('sale', item.sale_price_cents)
) as price (kind, amount_cents)
where price.amount_cents is not null;

-- 3. The price of each named article of the organization on one Berlin day,
-- per kind: the row with the latest first day up to that day, the latest
-- recorded among rows of the same first day. Only a price stated in the
-- article's current base unit applies. An article without such a row answers
-- with empty columns of that kind; an id of another organization or
-- of no article is left out. Archived articles answer too.
create function public.read_inventory_item_prices_on_day(
  p_organization_id uuid,
  p_item_ids uuid[],
  p_on_date date
) returns table (
  item_id uuid,
  unit text,
  tax_rate_basis_points integer,
  purchase_price_id uuid,
  purchase_amount_cents integer,
  purchase_price_quantity integer,
  purchase_valid_from date,
  purchase_source text,
  sale_price_id uuid,
  sale_amount_cents integer,
  sale_price_quantity integer,
  sale_valid_from date,
  sale_source text
) language sql stable security invoker set search_path = '' as $$
  with current_price as (
    select distinct on (price.item_id, price.kind) price.*
    from public.inventory_item_prices price
    join public.inventory_items priced_item
      on priced_item.id = price.item_id and priced_item.organization_id = price.organization_id
    where price.organization_id = p_organization_id
      and price.item_id = any(coalesce(p_item_ids, '{}'))
      and price.valid_from <= p_on_date
      and price.unit = priced_item.unit
    order by price.item_id, price.kind, price.valid_from desc, price.created_at desc, price.id desc
  )
  select item.id, item.unit, item.tax_rate_basis_points,
    purchase.id, purchase.amount_cents, purchase.price_quantity, purchase.valid_from, purchase.source,
    sale.id, sale.amount_cents, sale.price_quantity, sale.valid_from, sale.source
  from public.inventory_items item
  left join current_price purchase on purchase.item_id = item.id and purchase.kind = 'purchase'
  left join current_price sale on sale.item_id = item.id and sale.kind = 'sale'
  where item.organization_id = p_organization_id
    and item.id = any(coalesce(p_item_ids, '{}'))
  order by item.id;
$$;
revoke all on function public.read_inventory_item_prices_on_day(uuid, uuid[], date) from public, anon, authenticated;
grant execute on function public.read_inventory_item_prices_on_day(uuid, uuid[], date) to service_role;

-- 4. The previous release's price columns: today's price per one base unit
-- where that is a whole cent. Writes only articles whose columns differ.
create function app_private.sync_inventory_item_price_columns(p_organization_id uuid, p_item_ids uuid[])
returns void
language sql
security invoker
set search_path to ''
as $$
  update public.inventory_items item
  set purchase_price_cents = today.purchase_per_unit,
      sale_price_cents = today.sale_per_unit
  from (
    select current_price.item_id,
      case when current_price.purchase_amount_cents % current_price.purchase_price_quantity = 0
        then current_price.purchase_amount_cents / current_price.purchase_price_quantity end as purchase_per_unit,
      case when current_price.sale_amount_cents % current_price.sale_price_quantity = 0
        then current_price.sale_amount_cents / current_price.sale_price_quantity end as sale_per_unit
    from public.read_inventory_item_prices_on_day(
      p_organization_id, p_item_ids, (now() at time zone 'Europe/Berlin')::date
    ) current_price
  ) today
  where item.id = today.item_id
    and item.organization_id = p_organization_id
    and (item.purchase_price_cents is distinct from today.purchase_per_unit
      or item.sale_price_cents is distinct from today.sale_per_unit);
$$;

-- The one write of a price. The caller checked the actor and the article.
create function app_private.record_inventory_item_price(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_price_quantity integer,
  p_valid_from date,
  p_source text
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_price_id uuid;
begin
  insert into public.inventory_item_prices (
    organization_id, item_id, kind, unit, amount_cents, price_quantity, valid_from, source, created_by
  )
  select p_organization_id, p_item_id, p_kind, item.unit, p_amount_cents, p_price_quantity, p_valid_from,
    p_source, p_actor_id
  from public.inventory_items item
  where item.id = p_item_id and item.organization_id = p_organization_id
  returning id into v_price_id;
  perform app_private.sync_inventory_item_price_columns(p_organization_id, array[p_item_id]);
  return v_price_id;
end;
$$;

-- After a change of an article's references: the oldest reference becomes
-- preferred when none is, and the article's supplier columns mirror the
-- preferred one, or are emptied when no reference is left.
create function app_private.settle_inventory_item_suppliers(p_organization_id uuid, p_item_id uuid)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_preferred public.inventory_item_suppliers;
begin
  select ref.* into v_preferred from public.inventory_item_suppliers ref
  where ref.item_id = p_item_id and ref.organization_id = p_organization_id and ref.is_preferred;
  if v_preferred.id is null then
    update public.inventory_item_suppliers ref set is_preferred = true
    where ref.id = (
      select oldest.id from public.inventory_item_suppliers oldest
      where oldest.item_id = p_item_id and oldest.organization_id = p_organization_id
      order by oldest.created_at, oldest.id
      limit 1
    )
    returning ref.* into v_preferred;
  end if;
  update public.inventory_items item
  set supplier_id = v_preferred.supplier_id,
      supplier_article_number = v_preferred.supplier_article_number
  where item.id = p_item_id and item.organization_id = p_organization_id
    and (item.supplier_id is distinct from v_preferred.supplier_id
      or item.supplier_article_number is distinct from v_preferred.supplier_article_number);
end;
$$;

-- Creates (p_reference_id null) or changes one reference of an article the
-- caller locked, then settles the article's references. A preferred
-- reference takes the mark from the article's other references.
-- Refusals: supplier_reference_not_found, supplier_reference_taken,
-- invalid_input (a conversion of zero or less, an unknown unit format).
create function app_private.write_inventory_item_supplier(
  p_organization_id uuid,
  p_item_id uuid,
  p_reference_id uuid,
  p_supplier_id uuid,
  p_supplier_article_number text,
  p_purchase_unit text,
  p_pack_quantity numeric,
  p_base_quantity numeric,
  p_is_preferred boolean
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_number text := nullif(btrim(coalesce(p_supplier_article_number, '')), '');
  v_unit text := nullif(btrim(coalesce(p_purchase_unit, '')), '');
  v_reference_id uuid;
begin
  if p_is_preferred then
    update public.inventory_item_suppliers ref set is_preferred = false
    where ref.item_id = p_item_id and ref.organization_id = p_organization_id and ref.is_preferred
      and ref.id is distinct from p_reference_id;
  end if;
  begin
    if p_reference_id is null then
      insert into public.inventory_item_suppliers (
        organization_id, item_id, supplier_id, supplier_article_number, purchase_unit,
        pack_quantity, base_quantity, is_preferred
      ) values (
        p_organization_id, p_item_id, p_supplier_id, v_number, v_unit,
        coalesce(p_pack_quantity, 1), coalesce(p_base_quantity, 1), coalesce(p_is_preferred, false)
      )
      returning id into v_reference_id;
    else
      update public.inventory_item_suppliers ref
      set supplier_id = p_supplier_id,
          supplier_article_number = v_number,
          purchase_unit = v_unit,
          pack_quantity = coalesce(p_pack_quantity, 1),
          base_quantity = coalesce(p_base_quantity, 1),
          is_preferred = coalesce(p_is_preferred, false) or ref.is_preferred
      where ref.id = p_reference_id and ref.item_id = p_item_id and ref.organization_id = p_organization_id
      returning ref.id into v_reference_id;
      if v_reference_id is null then
        raise exception 'supplier_reference_not_found';
      end if;
    end if;
  exception
    when unique_violation then raise exception 'supplier_reference_taken';
    when check_violation then raise exception 'invalid_input';
  end;
  perform app_private.settle_inventory_item_suppliers(p_organization_id, p_item_id);
  return v_reference_id;
end;
$$;

-- Saves one supplier reference of an article: a named existing supplier, or
-- one created by name. p_unit is the base unit the caller showed the pack
-- in. Returns the reference id.
-- Refusals: not_authorized, item_not_found, unit_changed, supplier_not_found,
-- supplier_required, supplier_reference_not_found, supplier_reference_taken,
-- invalid_input.
create function public.save_inventory_item_supplier(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_unit text,
  p_reference_id uuid,
  p_supplier_id uuid,
  p_supplier_name text,
  p_supplier_article_number text,
  p_purchase_unit text,
  p_pack_quantity numeric,
  p_base_quantity numeric,
  p_is_preferred boolean
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_supplier_id uuid := p_supplier_id;
  v_reference_id uuid;
  v_unit text;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  -- The article row lock serializes every change of its references and of its unit.
  update public.inventory_items item set updated_at = now()
  where item.id = p_item_id and item.organization_id = p_organization_id
  returning item.unit into v_unit;
  if not found then
    raise exception 'item_not_found';
  end if;
  if v_unit is distinct from p_unit then
    raise exception 'unit_changed';
  end if;
  if v_supplier_id is not null then
    perform 1 from public.inventory_suppliers supplier
    where supplier.id = v_supplier_id and supplier.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'supplier_not_found';
    end if;
  else
    v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
    if v_supplier_id is null then
      raise exception 'supplier_required';
    end if;
  end if;
  v_reference_id := app_private.write_inventory_item_supplier(
    p_organization_id, p_item_id, p_reference_id, v_supplier_id, p_supplier_article_number,
    p_purchase_unit, p_pack_quantity, p_base_quantity, p_is_preferred
  );
  return v_reference_id;
end;
$$;

-- Removes one supplier reference; the oldest remaining one becomes preferred
-- when the removed one was. Refusals: not_authorized,
-- supplier_reference_not_found.
create function public.remove_inventory_item_supplier(
  p_organization_id uuid,
  p_actor_id uuid,
  p_reference_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_item_id uuid;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  select ref.item_id into v_item_id from public.inventory_item_suppliers ref
  where ref.id = p_reference_id and ref.organization_id = p_organization_id;
  if v_item_id is null then
    raise exception 'supplier_reference_not_found';
  end if;
  update public.inventory_items item set updated_at = now()
  where item.id = v_item_id and item.organization_id = p_organization_id;
  delete from public.inventory_item_suppliers ref
  where ref.id = p_reference_id and ref.organization_id = p_organization_id;
  if not found then
    raise exception 'supplier_reference_not_found';
  end if;
  perform app_private.settle_inventory_item_suppliers(p_organization_id, v_item_id);
end;
$$;

-- Records a price the office enters, from its first day on, per p_price_quantity
-- of p_unit, the base unit the caller showed the amount in. Returns the price
-- id. Refusals: not_authorized, invalid_input, item_not_found, unit_changed.
create function public.add_inventory_item_price(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_unit text,
  p_kind text,
  p_amount_cents integer,
  p_price_quantity integer,
  p_valid_from date
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_unit text;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  if p_kind is null or p_kind not in ('purchase', 'sale') or p_amount_cents is null or p_amount_cents < 0
    or p_price_quantity is null or p_price_quantity not in (1, 10, 100, 1000) or p_valid_from is null
  then
    raise exception 'invalid_input';
  end if;
  update public.inventory_items item set updated_at = now()
  where item.id = p_item_id and item.organization_id = p_organization_id
  returning item.unit into v_unit;
  if not found then
    raise exception 'item_not_found';
  end if;
  if v_unit is distinct from p_unit then
    raise exception 'unit_changed';
  end if;
  return app_private.record_inventory_item_price(
    p_organization_id, p_actor_id, p_item_id, p_kind, p_amount_cents, p_price_quantity, p_valid_from, 'manual'
  );
end;
$$;

-- The supplier and prices a save carries in p_item (keys supplier_id,
-- supplier_article_number, purchase_price_cents, sale_price_cents): the
-- supplier becomes the preferred reference, and a price that differs from
-- today's per-unit price is recorded from today with p_source. A missing key
-- or a NULL value changes nothing, except that an article number without a
-- supplier stays on an article that has no reference.
create function app_private.apply_inventory_item_save_terms(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_item jsonb,
  p_supplier_id uuid,
  p_source text
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_fields public.inventory_items := jsonb_populate_record(null::public.inventory_items, coalesce(p_item, '{}'::jsonb));
  v_number text := nullif(btrim(coalesce(v_fields.supplier_article_number, '')), '');
  v_item public.inventory_items;
  v_reference_id uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  select item.* into v_item from public.inventory_items item
  where item.id = p_item_id and item.organization_id = p_organization_id;

  if p_supplier_id is not null then
    select ref.id into v_reference_id from public.inventory_item_suppliers ref
    where ref.item_id = p_item_id and ref.organization_id = p_organization_id
      and ref.supplier_id = p_supplier_id
    order by ref.is_preferred desc, ref.created_at, ref.id
    limit 1;
    perform app_private.write_inventory_item_supplier(
      p_organization_id, p_item_id, v_reference_id, p_supplier_id,
      case when p_item ? 'supplier_article_number' then v_number
        else (select ref.supplier_article_number from public.inventory_item_suppliers ref where ref.id = v_reference_id) end,
      (select ref.purchase_unit from public.inventory_item_suppliers ref where ref.id = v_reference_id),
      (select ref.pack_quantity from public.inventory_item_suppliers ref where ref.id = v_reference_id),
      (select ref.base_quantity from public.inventory_item_suppliers ref where ref.id = v_reference_id),
      true
    );
  elsif p_item ? 'supplier_article_number' and v_number is not null and not exists (
    select 1 from public.inventory_item_suppliers ref
    where ref.item_id = p_item_id and ref.organization_id = p_organization_id
  ) then
    update public.inventory_items item set supplier_article_number = v_number
    where item.id = p_item_id and item.organization_id = p_organization_id
      and item.supplier_article_number is distinct from v_number;
  end if;

  if v_fields.purchase_price_cents is not null
    and v_fields.purchase_price_cents is distinct from v_item.purchase_price_cents then
    perform app_private.record_inventory_item_price(
      p_organization_id, p_actor_id, p_item_id, 'purchase', v_fields.purchase_price_cents, 1, v_today, p_source
    );
  end if;
  if v_fields.sale_price_cents is not null
    and v_fields.sale_price_cents is distinct from v_item.sale_price_cents then
    perform app_private.record_inventory_item_price(
      p_organization_id, p_actor_id, p_item_id, 'sale', v_fields.sale_price_cents, 1, v_today, p_source
    );
  end if;
end;
$$;

-- 5. Creates or updates an item with its primary barcode and, on a create, its
-- first count; signature and result as before. A new refusal:
-- unit_has_pack_sizes, a unit change while a supplier sells the item in packs.
create or replace function public.save_inventory_item(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_item jsonb,
  p_supplier_name text,
  p_barcode text,
  p_initial_location_id uuid,
  p_initial_quantity numeric
)
returns public.inventory_items
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_fields public.inventory_items := jsonb_populate_record(null::public.inventory_items, coalesce(p_item, '{}'::jsonb));
  v_quantity numeric := coalesce(p_initial_quantity, 0);
  v_supplier_id uuid;
  v_item public.inventory_items;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  if v_quantity < 0 or (p_item_id is not null and v_quantity > 0) then
    raise exception 'invalid_input';
  end if;
  if v_quantity > 0 and p_initial_location_id is null then
    raise exception 'location_required_for_initial_stock';
  end if;

  if v_fields.category_id is not null then
    perform 1 from public.inventory_categories category
    where category.id = v_fields.category_id and category.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'category_not_found';
    end if;
  end if;
  if v_fields.supplier_id is not null then
    perform 1 from public.inventory_suppliers supplier
    where supplier.id = v_fields.supplier_id and supplier.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'supplier_not_found';
    end if;
    v_supplier_id := v_fields.supplier_id;
  else
    v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
  end if;
  if p_initial_location_id is not null then
    perform 1 from public.inventory_locations location
    where location.id = p_initial_location_id and location.organization_id = p_organization_id
    for share;
    if not found then
      raise exception 'location_not_found';
    end if;
  end if;

  if p_item_id is null then
    insert into public.inventory_items (
      organization_id, item_type, name, description, category_id, unit, internal_sku, manufacturer,
      is_billable, global_minimum_stock, global_target_stock, track_quantity, track_individual_assets,
      notes, created_by
    ) values (
      p_organization_id, v_fields.item_type, v_fields.name, v_fields.description, v_fields.category_id,
      v_fields.unit, v_fields.internal_sku, v_fields.manufacturer, v_fields.is_billable,
      v_fields.global_minimum_stock, v_fields.global_target_stock, v_fields.track_quantity,
      v_fields.track_individual_assets, v_fields.notes, p_actor_id
    )
    returning * into v_item;
  else
    -- A pack conversion counts in the base unit, so the unit stays while a
    -- supplier sells in packs. The lock comes first: a reference another
    -- session commits while this save waits for the row counts.
    perform 1 from public.inventory_items item
    where item.id = p_item_id and item.organization_id = p_organization_id
    for update;
    if exists (
      select 1 from public.inventory_items item
      where item.id = p_item_id and item.organization_id = p_organization_id
        and item.unit is distinct from v_fields.unit
        and exists (
          select 1 from public.inventory_item_suppliers ref
          where ref.item_id = item.id and ref.purchase_unit is not null
        )
    ) then
      raise exception 'unit_has_pack_sizes';
    end if;
    update public.inventory_items item
    set item_type = v_fields.item_type,
        name = v_fields.name,
        description = v_fields.description,
        category_id = v_fields.category_id,
        unit = v_fields.unit,
        internal_sku = v_fields.internal_sku,
        manufacturer = v_fields.manufacturer,
        is_billable = v_fields.is_billable,
        global_minimum_stock = v_fields.global_minimum_stock,
        global_target_stock = v_fields.global_target_stock,
        track_quantity = v_fields.track_quantity,
        track_individual_assets = v_fields.track_individual_assets,
        notes = v_fields.notes
    where item.id = p_item_id and item.organization_id = p_organization_id
    returning * into v_item;
    if v_item.id is null then
      raise exception 'item_not_found';
    end if;
    -- A changed unit leaves the prices of the earlier unit as history.
    perform app_private.sync_inventory_item_price_columns(p_organization_id, array[v_item.id]);
  end if;

  perform app_private.apply_inventory_item_save_terms(
    p_organization_id, p_actor_id, v_item.id, p_item, v_supplier_id, 'manual'
  );

  perform app_private.attach_primary_inventory_barcode(p_organization_id, v_item.id, p_barcode);

  if v_quantity > 0 then
    perform public.record_inventory_movement(
      p_organization_id, p_actor_id, v_item.id, p_initial_location_id, 'initial_count', v_quantity,
      null, null, null, null, 'Erstbestand beim Anlegen'
    );
  end if;

  select item.* into v_item from public.inventory_items item where item.id = v_item.id;
  return v_item;
end;
$$;

-- 6. One CSV row, as in 20261202120000: a new article gets the row's supplier
-- as its first reference and the row's prices as CSV-import prices.
create or replace function app_private.apply_inventory_import_row(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_batch_id uuid,
  p_item jsonb,
  p_category_name text,
  p_supplier_name text,
  p_location_name text,
  p_barcode text,
  p_quantity numeric,
  p_reason text,
  p_mode text,
  p_reviewed boolean
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_fields public.inventory_items := jsonb_populate_record(null::public.inventory_items, coalesce(p_item, '{}'::jsonb));
  v_sku text := nullif(btrim(coalesce(v_fields.internal_sku, '')), '');
  v_barcode text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_quantity numeric := coalesce(p_quantity, 0);
  v_category_id uuid;
  v_supplier_id uuid;
  v_location_id uuid;
  v_location public.inventory_locations;
  v_item public.inventory_items;
  v_matched_by text;
  v_movement record;
  v_outcome jsonb;
begin
  if v_quantity < 0 then
    raise exception 'invalid_input';
  end if;

  if not p_reviewed then
    v_category_id := app_private.ensure_inventory_category(p_organization_id, p_category_name);
    v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
  end if;
  if p_mode = 'stock' and (not p_reviewed or v_quantity > 0) then
    v_location_id := app_private.ensure_inventory_location(p_organization_id, p_actor_id, p_location_name);
    select location.* into v_location from public.inventory_locations location where location.id = v_location_id;
  end if;

  if v_sku is not null then
    select item.* into v_item from public.inventory_items item
    where item.organization_id = p_organization_id and item.internal_sku = v_sku
    -- Blocks a change of the unit until the row is booked, but not the
    -- foreign-key check of a movement another session inserts while it holds
    -- the stock row: FOR UPDATE would deadlock with that booking.
    for no key update;
    if v_item.id is not null then
      v_matched_by := 'internal_sku';
    end if;
  end if;
  if v_item.id is null and v_barcode is not null then
    select item.* into v_item from public.inventory_item_barcodes barcode
    join public.inventory_items item on item.id = barcode.item_id
    where barcode.organization_id = p_organization_id and barcode.barcode_value = v_barcode
    for no key update of item;
    if v_item.id is not null then
      v_matched_by := 'barcode';
    end if;
  end if;

  if v_item.id is not null and p_reviewed and v_item.unit is distinct from v_fields.unit then
    raise exception 'unit_mismatch' using detail = v_item.unit;
  end if;

  if v_item.id is null then
    if p_reviewed then
      v_category_id := app_private.ensure_inventory_category(p_organization_id, p_category_name);
      v_supplier_id := app_private.ensure_inventory_supplier(p_organization_id, p_supplier_name);
    end if;
    insert into public.inventory_items (
      organization_id, item_type, name, category_id, unit, internal_sku, manufacturer, is_billable,
      global_minimum_stock, global_target_stock, notes, created_by
    ) values (
      p_organization_id, v_fields.item_type, v_fields.name, v_category_id, v_fields.unit, v_sku,
      v_fields.manufacturer, v_fields.is_billable, v_fields.global_minimum_stock,
      v_fields.global_target_stock, v_fields.notes, p_actor_id
    )
    returning * into v_item;
    perform app_private.apply_inventory_item_save_terms(
      p_organization_id, p_actor_id, v_item.id, p_item, v_supplier_id, 'csv_import'
    );
    select item.* into v_item from public.inventory_items item where item.id = v_item.id;
  end if;

  if p_reviewed and v_matched_by is not null then
    if exists (
      select 1 from public.inventory_item_barcodes barcode
      where barcode.organization_id = p_organization_id and barcode.barcode_value = v_barcode
        and barcode.item_id <> v_item.id
    ) then
      raise exception 'barcode_taken';
    end if;
  else
    perform app_private.attach_primary_inventory_barcode(p_organization_id, v_item.id, v_barcode);
  end if;

  v_outcome := jsonb_build_object(
    'outcome', 'imported',
    'matched_by', v_matched_by,
    'item_id', v_item.id,
    'item_name', v_item.name,
    'unit', v_item.unit,
    'location_id', v_location.id,
    -- A Lager this transaction created reads as new on every row that names it.
    'location_name', v_location.name,
    'location_created', coalesce(v_location.created_at = now(), false),
    'quantity', v_quantity,
    'quantity_before', null,
    'quantity_after', null
  );
  if p_mode <> 'stock' or v_quantity = 0 then
    return v_outcome;
  end if;
  if v_location.id is null then
    return v_outcome || jsonb_build_object('outcome', 'missing_location');
  end if;
  select * into v_movement from public.record_inventory_movement(
    p_organization_id, p_actor_id, v_item.id, v_location.id,
    case when v_matched_by is null then 'initial_count' else 'stock_in' end, v_quantity,
    null, null, null, p_import_batch_id, p_reason
  );
  return v_outcome || jsonb_build_object(
    'outcome', 'booked',
    'quantity_before', v_movement.quantity_before,
    'quantity_after', v_movement.quantity_after
  );
end;
$$;

-- Records a use of job material, as in 20261201110000; the cost snapshot is
-- the article's purchase price of today (Berlin) per its price quantity.
create or replace function public.record_job_material_use(
  p_organization_id uuid,
  p_actor_id uuid,
  p_job_material_line_id uuid,
  p_quantity numeric,
  p_note text default null,
  p_corrects_event_id uuid default null
)
returns numeric
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line public.job_material_lines%rowtype;
  v_unit text;
  v_price integer;
  v_price_quantity integer;
  v_corrected public.job_material_use_events%rowtype;
  v_corrected_sum numeric(12,3);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_cost_amount integer;
  v_cost_quantity integer;
  v_used numeric(12,3);
  v_role public.org_role;
  v_recorded_unit text;
begin
  if p_quantity is null or p_quantity = 0 then
    raise exception 'quantity_required';
  end if;

  select member.role into v_role from public.organization_members member
  where member.organization_id = p_organization_id
    and member.user_id = p_actor_id
  for share;
  if v_role is null then
    raise exception 'not_authorized';
  end if;

  -- The lock serializes every use, take and return of the line.
  select * into v_line
  from public.job_material_lines line
  where line.id = p_job_material_line_id
    and line.organization_id = p_organization_id
  for no key update;

  if not found or v_line.status = 'cancelled' then
    raise exception 'material_line_not_found';
  end if;

  -- The action checked the same access; a removed assignment or role since then refuses here.
  if v_role not in ('admin', 'buero') then
    if v_line.job_id is null then
      raise exception 'not_authorized';
    end if;
    perform 1 from public.job_assignments assignment
    where assignment.organization_id = p_organization_id
      and assignment.job_id = v_line.job_id
      and assignment.user_id = p_actor_id
    for share;
    if not found then
      raise exception 'not_authorized';
    end if;
  end if;

  select current_price.unit, current_price.purchase_amount_cents, current_price.purchase_price_quantity
    into v_unit, v_price, v_price_quantity
  from public.read_inventory_item_prices_on_day(
    p_organization_id, array[v_line.item_id], (now() at time zone 'Europe/Berlin')::date
  ) current_price;

  if p_corrects_event_id is null then
    if p_quantity < 0 then
      raise exception 'quantity_required';
    end if;
    if v_line.used_quantity + v_line.returned_quantity + p_quantity > v_line.taken_quantity then
      raise exception 'use_exceeds_taken';
    end if;
    -- Every event of a line carries one unit; a changed article unit waits for the office.
    select event.unit into v_recorded_unit
    from public.job_material_use_events event
    where event.job_material_line_id = v_line.id
    limit 1;
    if v_recorded_unit is not null and v_recorded_unit <> v_unit then
      raise exception 'material_unit_changed';
    end if;
    v_cost_amount := v_price;
    v_cost_quantity := v_price_quantity;
  else
    if p_quantity > 0 then
      raise exception 'correction_must_reduce';
    end if;
    if v_note is null then
      raise exception 'correction_reason_required';
    end if;

    select * into v_corrected
    from public.job_material_use_events event
    where event.id = p_corrects_event_id
      and event.organization_id = p_organization_id
      and event.job_material_line_id = v_line.id;

    if not found or v_corrected.corrects_event_id is not null then
      raise exception 'use_event_not_found';
    end if;

    select coalesce(sum(event.quantity), 0) into v_corrected_sum
    from public.job_material_use_events event
    where event.corrects_event_id = v_corrected.id;

    if v_corrected.quantity + v_corrected_sum + p_quantity < 0 then
      raise exception 'correction_exceeds_event';
    end if;
    v_cost_amount := v_corrected.cost_amount_cents;
    v_cost_quantity := v_corrected.cost_price_quantity;
    -- The article's unit may have changed since; the correction counts in the event's unit.
    v_unit := v_corrected.unit;
  end if;

  insert into public.job_material_use_events (
    organization_id, job_id, project_id, job_material_line_id, item_id, unit, quantity,
    cost_amount_cents, cost_price_quantity, corrects_event_id, note, actor_id
  ) values (
    p_organization_id, v_line.job_id, v_line.project_id, v_line.id, v_line.item_id, v_unit, p_quantity,
    v_cost_amount, v_cost_quantity, p_corrects_event_id, v_note, p_actor_id
  );

  update public.job_material_lines line
  set used_quantity = line.used_quantity + p_quantity
  where line.id = v_line.id
  returning line.used_quantity into v_used;

  return v_used;
end;
$$;

-- A price recorded before its first day reaches the previous release's
-- columns on that day: every hour, the articles whose price began in the last
-- week after it was recorded are synced again. Returns the number of
-- organizations it visited.
create function app_private.sync_begun_inventory_item_prices()
returns integer
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_organization record;
  v_count integer := 0;
begin
  for v_organization in
    select price.organization_id, array_agg(distinct price.item_id) as item_ids
    from public.inventory_item_prices price
    where price.valid_from between v_today - 7 and v_today
      and price.valid_from > (price.created_at at time zone 'Europe/Berlin')::date
    group by price.organization_id
  loop
    perform app_private.sync_inventory_item_price_columns(v_organization.organization_id, v_organization.item_ids);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function app_private.sync_inventory_item_price_columns(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function app_private.record_inventory_item_price(uuid, uuid, uuid, text, integer, integer, date, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.settle_inventory_item_suppliers(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.write_inventory_item_supplier(
  uuid, uuid, uuid, uuid, text, text, numeric, numeric, boolean
) from public, anon, authenticated, service_role;
revoke all on function app_private.apply_inventory_item_save_terms(uuid, uuid, uuid, jsonb, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.sync_begun_inventory_item_prices()
  from public, anon, authenticated, service_role;
revoke all on function public.save_inventory_item_supplier(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text, numeric, numeric, boolean
) from public, anon, authenticated;
revoke all on function public.remove_inventory_item_supplier(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.add_inventory_item_price(uuid, uuid, uuid, text, text, integer, integer, date)
  from public, anon, authenticated;
grant execute on function public.save_inventory_item_supplier(
  uuid, uuid, uuid, text, uuid, uuid, text, text, text, numeric, numeric, boolean
) to service_role;
grant execute on function public.remove_inventory_item_supplier(uuid, uuid, uuid) to service_role;
grant execute on function public.add_inventory_item_price(uuid, uuid, uuid, text, text, integer, integer, date)
  to service_role;

select cron.schedule('werkflow-inventory-begun-prices', '7 * * * *',
  'select app_private.sync_begun_inventory_item_prices()');
