-- Imported prices reach the own articles as dated prices, with the office's
-- rebate per rebate group and a preview of each change
-- (werk-flow/werkflow-planning#477).
--
-- Before this, a wholesaler delivery changed only the supplier catalog, and a
-- CSV row that matched an own article changed none of its prices.
--
-- 1. inventory_supplier_rebates keeps the office's rebate per supplier and
--    rebate group, in hundredths of a percent (3250 is 32,50 %). Only Admin
--    and Büro set it, in the wholesaler preview; the confirm saves it.
-- 2. One function computes a net cost: app_private.supplier_net_cost_cents,
--    the list price minus the rebate, per the price quantity, rounded once
--    half away from zero.
-- 3. app_private.supplier_catalog_import_price_proposals answers, for every
--    active own article whose preferred supplier reference names the batch's
--    supplier and an article number the delivery prices, the prices the
--    delivery proposes: a list price as the sale price and, with a rebate, its
--    net cost as the purchase price; a net price as the purchase price. Each
--    proposal carries the price that applies on its first day and whether it
--    differs. A proposal from an article line carries its unit text, since the
--    office maps units only in the preview; one from a price line carries the
--    catalog's stored unit. A price applies only where that unit is the
--    article's base unit.
-- 4. public.preview_supplier_catalog_import_prices answers the rebate groups
--    of the proposals and the changes, for the rebates the office entered, or
--    at first for the saved ones and else the delivery's own percentages, with
--    a fingerprint of the changes. The dialog sends the fingerprint of the
--    preview it shows with the confirm; the confirm computes the changes again
--    and refuses with prices_changed when they differ, so it never writes a
--    price the office did not see (a reference or a price another session
--    changed in between, or a later preview whose answer never arrived).
-- 5. public.confirm_supplier_catalog_import gains p_rebates: the confirm saves
--    the rebates and writes each changed price through the one price write of
--    werk-flow/werkflow-planning#373, source datanorm, from the delivery's
--    date or today, whichever is later. The previous release's four-argument
--    call keeps its behavior: it writes the catalog only.
-- 6. adopt_supplier_catalog_article also records the net cost as the purchase
--    price of a list-priced row whose rebate group has a saved rebate.
-- 7. A reviewed CSV row that matches an own article records its prices from
--    today, source csv_import, where they differ from today's, and answers each
--    change with the old and the new price, but only in a batch whose preview
--    showed price changes (inventory_import_batches.prices_previewed): the new
--    eight-argument preview_inventory_import marks it. A batch the previous
--    release previewed, before or after this migration, books as before. Such
--    a preview notes each row's price changes; a row whose changes differ at
--    booking (another session recorded a price in between) is refused as
--    changed_since_preview, like a changed article or Lager.
--
-- Prices change only through new dated rows (app_private.record_inventory_item_price);
-- whether a price differs is one rule (app_private.inventory_price_differs).
--
-- Division of work: the actions establish identity, the organization and the
-- manager role, and pass the server-resolved organization and actor. The
-- public functions follow the inventory pattern: SECURITY DEFINER with
-- search_path '', executable by service_role only, re-checking the manager
-- membership inside. The new table is server-only: RLS without a policy and a
-- SELECT grant to service_role alone, so no client role, an employee's
-- included, reads a rebate through the Data API.

create table public.inventory_supplier_rebates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  rebate_group text not null,
  -- Hundredths of a percent: 3250 is 32,50 %.
  rebate_basis_points integer not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint inventory_supplier_rebates_key unique (organization_id, supplier_id, rebate_group),
  constraint inventory_supplier_rebates_supplier_fk foreign key (supplier_id, organization_id)
    references public.inventory_suppliers (id, organization_id) on delete cascade,
  constraint inventory_supplier_rebates_group_check check (length(btrim(rebate_group)) between 1 and 200),
  constraint inventory_supplier_rebates_points_check check (rebate_basis_points between 0 and 10000)
);

create index inventory_supplier_rebates_supplier_idx on public.inventory_supplier_rebates (supplier_id);
create index inventory_supplier_rebates_updated_by_idx
  on public.inventory_supplier_rebates (updated_by) where updated_by is not null;

alter table public.inventory_supplier_rebates enable row level security;
revoke all on table public.inventory_supplier_rebates from public, anon, authenticated, service_role;
grant select on table public.inventory_supplier_rebates to service_role;

-- The rebates the confirm applied, rebate group to hundredths of a percent.
-- Only the confirm writes it, after app_private.is_supplier_rebate_mapping.
alter table public.inventory_supplier_catalog_imports add column rebates jsonb;

-- Whether the batch's preview showed the price changes of matched articles;
-- only such a batch changes them when it books.
alter table public.inventory_import_batches
  add column prices_previewed boolean not null default false;

comment on column public.inventory_supplier_catalog_imports.rebates is
  'The rebates the confirm applied to own articles, rebate group to hundredths of a percent.';
comment on column public.inventory_import_batches.prices_previewed is
  'The preview showed the price changes of matched articles, so the booking records them.';

-- 2. The net cost of a list price: rounded once, half away from zero.
create function app_private.supplier_net_cost_cents(p_list_cents integer, p_rebate_basis_points integer)
returns integer
language sql
immutable
security invoker
set search_path to ''
as $$
  select round(p_list_cents::numeric * (10000 - p_rebate_basis_points) / 10000)::integer;
$$;

-- Whether a new amount per its price quantity differs from the old one; no
-- old price differs from every new one. 100 cents per 1 equals 1000 per 10.
create function app_private.inventory_price_differs(
  p_old_amount_cents integer,
  p_old_price_quantity integer,
  p_new_amount_cents integer,
  p_new_price_quantity integer
)
returns boolean
language sql
immutable
security invoker
set search_path to ''
as $$
  select p_old_amount_cents is null
    or p_old_amount_cents::bigint * p_new_price_quantity <> p_new_amount_cents::bigint * p_old_price_quantity;
$$;

-- An office's rebates: an object of rebate groups (1 to 200 characters) to
-- hundredths of a percent from 0 to 10000, or null for no rebate.
create function app_private.is_supplier_rebate_mapping(p_rebates jsonb)
returns boolean
language sql
immutable
security invoker
set search_path to ''
as $$
  select jsonb_typeof(p_rebates) = 'object' and not exists (
    select 1 from jsonb_each(p_rebates) entry
    where length(btrim(entry.key)) not between 1 and 200
      or entry.key <> btrim(entry.key)
      -- CASE keeps the order, so only five digits are ever cast.
      or case
        when jsonb_typeof(entry.value) = 'null' then false
        when jsonb_typeof(entry.value) <> 'number' or entry.value::text !~ '^[0-9]{1,5}$' then true
        else entry.value::text::integer > 10000
      end
  );
$$;

-- The one write of an imported price: records it from p_valid_from when it
-- differs from the price of that day, and answers the change, or null. The
-- caller holds the article row, so its unit stays as compared.
create function app_private.record_imported_inventory_item_price(
  p_organization_id uuid,
  p_actor_id uuid,
  p_item_id uuid,
  p_kind text,
  p_amount_cents integer,
  p_price_quantity integer,
  p_valid_from date,
  p_source text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_old_amount integer;
  v_old_quantity integer;
begin
  select
    case p_kind when 'purchase' then current_price.purchase_amount_cents else current_price.sale_amount_cents end,
    case p_kind when 'purchase' then current_price.purchase_price_quantity else current_price.sale_price_quantity end
  into v_old_amount, v_old_quantity
  from public.read_inventory_item_prices_on_day(p_organization_id, array[p_item_id], p_valid_from) current_price;
  if not app_private.inventory_price_differs(v_old_amount, v_old_quantity, p_amount_cents, p_price_quantity) then
    return null;
  end if;
  perform app_private.record_inventory_item_price(
    p_organization_id, p_actor_id, p_item_id, p_kind, p_amount_cents, p_price_quantity, p_valid_from, p_source
  );
  -- The article row reaches the Realtime publication, so open inventory pages
  -- read the new price, also one from a later day.
  update public.inventory_items item set updated_at = now()
  where item.id = p_item_id and item.organization_id = p_organization_id;
  return jsonb_build_object(
    'kind', p_kind,
    'old_amount_cents', v_old_amount,
    'old_price_quantity', v_old_quantity,
    'new_amount_cents', p_amount_cents,
    'new_price_quantity', p_price_quantity,
    'valid_from', p_valid_from
  );
end;
$$;

-- 3. The prices a batch proposes for the own articles, one row per article
-- and kind, with the price of the proposal's first day. p_rebates maps a
-- rebate group to hundredths of a percent; a list price without one proposes
-- no purchase price. unit_text is set for a proposal from an article line,
-- catalog_unit for one from a price line; the caller resolves the unit.
create function app_private.supplier_catalog_import_price_proposals(
  p_organization_id uuid,
  p_import_id uuid,
  p_rebates jsonb
)
returns table (
  item_id uuid,
  item_name text,
  item_unit text,
  article_number text,
  unit_text text,
  catalog_unit text,
  price_kind text,
  rebate_group text,
  rebate_basis_points integer,
  kind text,
  old_amount_cents integer,
  old_price_quantity integer,
  new_amount_cents integer,
  new_price_quantity integer,
  valid_from date,
  is_change boolean
)
language sql
stable
security invoker
set search_path to ''
as $$
  with batch as (
    select batch.supplier_id,
      -- greatest() ignores a missing delivery date; a delivery never rewrites a past day.
      greatest((now() at time zone 'Europe/Berlin')::date, batch.delivery_date) as valid_from
    from public.inventory_supplier_catalog_imports batch
    where batch.id = p_import_id and batch.organization_id = p_organization_id
  ), matched as (
    select ref.item_id, ref.supplier_article_number as article_number, item.name, item.unit
    from batch
    join public.inventory_item_suppliers ref
      on ref.organization_id = p_organization_id and ref.supplier_id = batch.supplier_id
      and ref.is_preferred and ref.supplier_article_number is not null
    join public.inventory_items item
      on item.id = ref.item_id and item.organization_id = p_organization_id and item.is_active
  ), delivered as (
    -- The article's latest line, else the latest price line of a catalog row
    -- the delivery has no article line for, as the confirm writes the catalog.
    select matched.*, source.unit_text, source.catalog_unit, source.rebate_group, source.price_kind,
      source.price_cents, source.price_quantity
    from matched
    cross join lateral (
      (
        select 1 as rank, line.unit_text, null::text as catalog_unit, line.rebate_group, line.price_kind,
          line.price_cents, line.price_quantity
        from public.inventory_supplier_catalog_import_lines line
        where line.import_id = p_import_id and line.organization_id = p_organization_id
          and line.kind = 'article' and line.article_number = matched.article_number
        order by line.ordinal desc
        limit 1
      )
      union all
      (
        select 2, null, catalog.unit, catalog.rebate_group, line.price_kind, line.price_cents,
          catalog.price_quantity
        from public.inventory_supplier_catalog_import_lines line
        join batch on true
        join public.inventory_supplier_catalog_articles catalog
          on catalog.organization_id = p_organization_id and catalog.supplier_id = batch.supplier_id
          and catalog.article_number = line.article_number
        where line.import_id = p_import_id and line.organization_id = p_organization_id
          and line.kind = 'price' and line.article_number = matched.article_number
        order by line.ordinal desc
        limit 1
      )
      order by rank
      limit 1
    ) source
    where source.price_cents is not null
  ), proposal as (
    select delivered.*, null::integer as rebate_basis_points, 'sale' as kind,
      delivered.price_cents as amount_cents
    from delivered where delivered.price_kind = 'list'
    union all
    select delivered.*, null, 'purchase', delivered.price_cents
    from delivered where delivered.price_kind = 'net'
    union all
    select delivered.*, (p_rebates ->> delivered.rebate_group)::integer, 'purchase',
      app_private.supplier_net_cost_cents(delivered.price_cents, (p_rebates ->> delivered.rebate_group)::integer)
    from delivered
    where delivered.price_kind = 'list' and delivered.rebate_group is not null
      and jsonb_typeof(p_rebates -> delivered.rebate_group) = 'number'
  ), current_price as (
    select current_price.* from batch
    cross join lateral public.read_inventory_item_prices_on_day(
      p_organization_id, (select array_agg(distinct matched.item_id) from matched), batch.valid_from
    ) current_price
  )
  select proposal.item_id, proposal.name, proposal.unit, proposal.article_number, proposal.unit_text,
    proposal.catalog_unit, proposal.price_kind, proposal.rebate_group, proposal.rebate_basis_points,
    proposal.kind, old.amount_cents, old.price_quantity, proposal.amount_cents, proposal.price_quantity,
    batch.valid_from,
    app_private.inventory_price_differs(old.amount_cents, old.price_quantity, proposal.amount_cents, proposal.price_quantity)
  from proposal
  join batch on true
  left join current_price on current_price.item_id = proposal.item_id
  cross join lateral (
    select
      case proposal.kind when 'purchase' then current_price.purchase_amount_cents else current_price.sale_amount_cents end
        as amount_cents,
      case proposal.kind when 'purchase' then current_price.purchase_price_quantity else current_price.sale_price_quantity end
        as price_quantity
  ) old;
$$;

-- The changed prices of a batch's proposals for p_rebates, as the preview
-- answers them and the confirm compares them: one array in a fixed order.
create function app_private.supplier_catalog_import_price_changes(
  p_organization_id uuid,
  p_import_id uuid,
  p_rebates jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'item_id', proposal.item_id,
      'item_name', proposal.item_name,
      'item_unit', proposal.item_unit,
      'article_number', proposal.article_number,
      'unit_text', proposal.unit_text,
      'catalog_unit', proposal.catalog_unit,
      'kind', proposal.kind,
      'rebate_group', proposal.rebate_group,
      'rebate_basis_points', proposal.rebate_basis_points,
      'old_amount_cents', proposal.old_amount_cents,
      'old_price_quantity', proposal.old_price_quantity,
      'new_amount_cents', proposal.new_amount_cents,
      'new_price_quantity', proposal.new_price_quantity,
      'valid_from', proposal.valid_from
    ) order by proposal.item_name, proposal.item_id, proposal.kind
  ), '[]'::jsonb)
  from app_private.supplier_catalog_import_price_proposals(p_organization_id, p_import_id, p_rebates) proposal
  where proposal.is_change;
$$;

-- The rebate groups of a batch's list-priced proposals with their text, the
-- office's saved rebate and the delivery's own percentage, in group order.
create function app_private.supplier_catalog_import_rebate_groups(p_organization_id uuid, p_import_id uuid)
returns table (rebate_group text, text text, office_basis_points integer, delivery_basis_points integer)
language sql
stable
security invoker
set search_path to ''
as $$
  with batch as (
    select batch.supplier_id, batch.rebate_groups from public.inventory_supplier_catalog_imports batch
    where batch.id = p_import_id and batch.organization_id = p_organization_id
  ), listed as (
    select distinct proposal.rebate_group
    from app_private.supplier_catalog_import_price_proposals(p_organization_id, p_import_id, '{}'::jsonb) proposal
    where proposal.price_kind = 'list' and proposal.rebate_group is not null
  ), stated as (
    -- The delivery's own entry, else the one an earlier delivery left.
    select distinct on (entry.rebate_group) entry.rebate_group, entry.text, entry.discount
    from (
      select btrim(item.value->>'rebate_group') as rebate_group, coalesce(item.value->>'text', '') as text,
        item.value->'discount' as discount, 1 as rank, item.ordinality
      from batch cross join lateral jsonb_array_elements(batch.rebate_groups) with ordinality item
      union all
      select stored.rebate_group, stored.text, stored.discount, 2, 0
      from batch
      join public.inventory_supplier_rebate_groups stored
        on stored.organization_id = p_organization_id and stored.supplier_id = batch.supplier_id
    ) entry
    order by entry.rebate_group, entry.rank, entry.ordinality desc
  )
  select listed.rebate_group, coalesce(stated.text, ''), office.rebate_basis_points,
    case
      when stated.discount->>'kind' is distinct from 'percent'
        or (stated.discount->>'hundredthsOfPercent') !~ '^[0-9]{1,5}$' then null
      when (stated.discount->>'hundredthsOfPercent')::integer <= 10000
        then (stated.discount->>'hundredthsOfPercent')::integer
    end
  from listed
  join batch on true
  left join stated on stated.rebate_group = listed.rebate_group
  left join public.inventory_supplier_rebates office
    on office.organization_id = p_organization_id and office.supplier_id = batch.supplier_id
    and office.rebate_group = listed.rebate_group
  order by listed.rebate_group;
$$;

-- 4. The rebate groups and the own articles' price changes of a previewed
-- batch, for p_rebates, or with p_rebates null for the saved rebates and else
-- the delivery's percentages, with the changes' fingerprint for the confirm.
-- Writes nothing.
-- Refusals: not_authorized, import_not_found, invalid_input.
create function public.preview_supplier_catalog_import_prices(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid,
  p_rebates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_groups jsonb;
  v_rebates jsonb;
  v_changes jsonb;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  perform app_private.lock_open_supplier_catalog_import(
    p_organization_id, p_actor_id, p_import_id, array['previewed']
  );
  if p_rebates is not null and not app_private.is_supplier_rebate_mapping(p_rebates) then
    raise exception 'invalid_input';
  end if;

  select coalesce(jsonb_agg(to_jsonb(listed) order by listed.rebate_group), '[]'::jsonb),
    coalesce(
      p_rebates,
      jsonb_object_agg(listed.rebate_group, coalesce(listed.office_basis_points, listed.delivery_basis_points)),
      '{}'::jsonb
    )
  into v_groups, v_rebates
  from app_private.supplier_catalog_import_rebate_groups(p_organization_id, p_import_id) listed;

  v_changes := app_private.supplier_catalog_import_price_changes(p_organization_id, p_import_id, v_rebates);

  -- The confirm writes only the changes of the fingerprint it is sent.
  return jsonb_build_object(
    'rebate_groups', v_groups, 'rebates', v_rebates, 'changes', v_changes, 'fingerprint', md5(v_changes::text)
  );
end;
$$;

-- 5. Writes a previewed batch to the catalog in one call with the office's
-- unit mapping, as in 20261214090001, and with p_rebates also saves the
-- rebates and records each changed price of an own article whose unit the
-- mapping keeps. A confirmed batch answers its stored result again.
-- Refusals: not_authorized, import_not_found, invalid_input, prices_changed
-- (the changes differ from those of p_price_fingerprint, the preview shown).
create function public.confirm_supplier_catalog_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid,
  p_unit_mapping jsonb,
  p_rebates jsonb,
  p_price_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_import public.inventory_supplier_catalog_imports;
  v_result jsonb;
  v_other record;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_changes jsonb := '[]'::jsonb;
  v_change jsonb;
  v_written integer := 0;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  select batch.* into v_import from public.inventory_supplier_catalog_imports batch
  where batch.id = p_import_id and batch.organization_id = p_organization_id
    and batch.created_by = p_actor_id
  for update;
  if v_import.id is not null and v_import.status = 'confirmed' then
    return v_import.result || jsonb_build_object('already_confirmed', true);
  end if;
  if v_import.id is null or v_import.status <> 'previewed' then
    raise exception 'import_not_found';
  end if;
  if jsonb_typeof(p_unit_mapping) is distinct from 'object' or exists (
    select 1 from jsonb_each(p_unit_mapping) mapped
    where jsonb_typeof(mapped.value) <> 'null'
      and (jsonb_typeof(mapped.value) <> 'string' or not (mapped.value #>> '{}') ~ '^[a-z_]{1,40}$')
  ) then
    raise exception 'invalid_input';
  end if;
  if p_rebates is not null and not app_private.is_supplier_rebate_mapping(p_rebates) then
    raise exception 'invalid_input';
  end if;
  -- One import of a supplier's catalog at a time; an article's FK check still passes.
  perform 1 from public.inventory_suppliers supplier
  where supplier.id = v_import.supplier_id and supplier.organization_id = p_organization_id
  for no key update;

  if p_rebates is not null then
    -- The matched articles keep their unit until their prices are written.
    perform 1 from public.inventory_item_suppliers ref
    join public.inventory_items item on item.id = ref.item_id and item.organization_id = ref.organization_id
    where ref.organization_id = p_organization_id and ref.supplier_id = v_import.supplier_id
      and ref.is_preferred and ref.supplier_article_number is not null
    order by item.id
    for no key update of item;

    -- Read before the catalog and the staged lines change, and only as the
    -- price preview the office sees showed it: a reference or a price another
    -- session changed since then makes the office look again.
    v_changes := app_private.supplier_catalog_import_price_changes(p_organization_id, p_import_id, p_rebates);
    if p_price_fingerprint is distinct from md5(v_changes::text) then
      raise exception 'prices_changed';
    end if;
  end if;

  select * into v_other from app_private.supplier_catalog_import_other_effects(p_organization_id, p_import_id);

  select jsonb_build_object(
    'new', count(*) filter (where effect.unit is not null and effect.is_new),
    -- A mapping to another unit than the stored one changes the article too.
    'changed', count(*) filter (
      where effect.unit is not null and not effect.is_new
        and (effect.is_changed or effect.catalog_unit is distinct from effect.unit)
    ),
    'unchanged', count(*) filter (
      where effect.unit is not null and not effect.is_new and not effect.is_changed
        and effect.catalog_unit = effect.unit
    ),
    'price_changed', count(*) filter (where effect.unit is not null and effect.price_changed),
    'unit_rejected', count(*) filter (where effect.unit is null),
    'price_updates', v_other.price_updates,
    'price_unmatched', v_other.price_unmatched,
    'removed', v_other.removed,
    'rejected', (
      select count(*) from public.inventory_supplier_catalog_import_lines line
      where line.import_id = p_import_id and line.kind = 'rejection'
    )
  ) into v_result
  from (
    select effect.*, p_unit_mapping ->> effect.unit_text as unit
    from app_private.supplier_catalog_import_effects(p_organization_id, p_import_id) effect
  ) effect;

  insert into public.inventory_supplier_catalog_articles as catalog (
    organization_id, supplier_id, article_number, name, name_addition, unit, unit_text, price_quantity,
    price_kind, price_cents, rebate_group, main_product_group, product_group, ean, matchcode,
    delivery_date, import_id
  )
  select p_organization_id, v_import.supplier_id, line.article_number, line.name, line.name_addition,
    p_unit_mapping ->> line.unit_text, line.unit_text, line.price_quantity, line.price_kind, line.price_cents,
    line.rebate_group, line.main_product_group, line.product_group, line.ean, line.matchcode,
    coalesce(v_import.delivery_date, v_today), v_import.id
  from (
    select distinct on (latest.article_number) latest.*
    from public.inventory_supplier_catalog_import_lines latest
    where latest.import_id = p_import_id and latest.kind = 'article'
    order by latest.article_number, latest.ordinal desc
  ) line
  where p_unit_mapping ->> line.unit_text is not null
  on conflict (organization_id, supplier_id, article_number) do update set
    name = excluded.name,
    name_addition = excluded.name_addition,
    unit = excluded.unit,
    unit_text = excluded.unit_text,
    price_quantity = excluded.price_quantity,
    price_kind = excluded.price_kind,
    price_cents = excluded.price_cents,
    rebate_group = excluded.rebate_group,
    main_product_group = excluded.main_product_group,
    product_group = excluded.product_group,
    ean = excluded.ean,
    matchcode = excluded.matchcode,
    delivery_date = excluded.delivery_date,
    import_id = excluded.import_id,
    updated_at = now()
  where (
    catalog.name, catalog.name_addition, catalog.unit, catalog.unit_text, catalog.price_quantity,
    catalog.price_kind, catalog.price_cents, catalog.rebate_group, catalog.main_product_group,
    catalog.product_group, catalog.ean, catalog.matchcode
  ) is distinct from (
    excluded.name, excluded.name_addition, excluded.unit, excluded.unit_text, excluded.price_quantity,
    excluded.price_kind, excluded.price_cents, excluded.rebate_group, excluded.main_product_group,
    excluded.product_group, excluded.ean, excluded.matchcode
  );

  update public.inventory_supplier_catalog_articles catalog set
    price_kind = prices.price_kind,
    price_cents = prices.price_cents,
    delivery_date = coalesce(v_import.delivery_date, v_today),
    import_id = v_import.id,
    updated_at = now()
  from (
    select distinct on (line.article_number) line.article_number, line.price_kind, line.price_cents
    from public.inventory_supplier_catalog_import_lines line
    where line.import_id = p_import_id and line.kind = 'price'
      and not exists (
        select 1 from public.inventory_supplier_catalog_import_lines delivered
        where delivered.import_id = p_import_id and delivered.kind = 'article'
          and delivered.article_number = line.article_number
      )
    order by line.article_number, line.ordinal desc
  ) prices
  where catalog.organization_id = p_organization_id and catalog.supplier_id = v_import.supplier_id
    and catalog.article_number = prices.article_number
    and (catalog.price_kind, catalog.price_cents) is distinct from (prices.price_kind, prices.price_cents);

  delete from public.inventory_supplier_catalog_articles catalog
  using public.inventory_supplier_catalog_import_lines line
  where line.import_id = p_import_id and line.kind = 'deletion'
    and catalog.organization_id = p_organization_id and catalog.supplier_id = v_import.supplier_id
    and catalog.article_number = line.article_number
    and not exists (
        select 1 from public.inventory_supplier_catalog_import_lines delivered
        where delivered.import_id = p_import_id and delivered.kind = 'article'
          and delivered.article_number = line.article_number
      );

  insert into public.inventory_supplier_rebate_groups as rebate (
    organization_id, supplier_id, rebate_group, text, discount, import_id
  )
  select distinct on (btrim(entry.value->>'rebate_group'))
    p_organization_id, v_import.supplier_id, btrim(entry.value->>'rebate_group'),
    coalesce(entry.value->>'text', ''), entry.value->'discount', v_import.id
  from jsonb_array_elements(v_import.rebate_groups) with ordinality entry
  where jsonb_typeof(entry.value->'discount') = 'object'
    and length(btrim(coalesce(entry.value->>'rebate_group', ''))) between 1 and 200
  order by btrim(entry.value->>'rebate_group'), entry.ordinality desc
  on conflict (organization_id, supplier_id, rebate_group) do update set
    text = excluded.text,
    discount = excluded.discount,
    import_id = excluded.import_id,
    updated_at = now()
  where (rebate.text, rebate.discount) is distinct from (excluded.text, excluded.discount);

  if p_rebates is not null then
    -- A group without a rebate drops the saved one; a changed one replaces it.
    delete from public.inventory_supplier_rebates office
    using jsonb_each(p_rebates) entry
    where office.organization_id = p_organization_id and office.supplier_id = v_import.supplier_id
      and office.rebate_group = entry.key and jsonb_typeof(entry.value) = 'null';
    insert into public.inventory_supplier_rebates as office (
      organization_id, supplier_id, rebate_group, rebate_basis_points, updated_by
    )
    select p_organization_id, v_import.supplier_id, entry.key, entry.value::text::integer, p_actor_id
    from jsonb_each(p_rebates) entry
    where jsonb_typeof(entry.value) = 'number'
    on conflict (organization_id, supplier_id, rebate_group) do update set
      rebate_basis_points = excluded.rebate_basis_points,
      updated_by = excluded.updated_by,
      updated_at = now()
    where office.rebate_basis_points <> excluded.rebate_basis_points;

    -- An article line's unit is the office's mapping of its text; a price
    -- line's is the catalog's. A price applies only in the article's unit.
    for v_change in
      select change.value from jsonb_array_elements(v_changes) change
      where change.value->>'item_unit'
        = coalesce(p_unit_mapping ->> (change.value->>'unit_text'), change.value->>'catalog_unit')
    loop
      if app_private.record_imported_inventory_item_price(
        p_organization_id, p_actor_id, (v_change->>'item_id')::uuid, v_change->>'kind',
        (v_change->>'new_amount_cents')::integer, (v_change->>'new_price_quantity')::integer,
        (v_change->>'valid_from')::date, 'datanorm'
      ) is not null then
        v_written := v_written + 1;
      end if;
    end loop;
  end if;
  v_result := v_result || jsonb_build_object('own_prices_changed', v_written);

  -- The batch keeps only the lines its report names: of an article, only its
  -- latest line, and only when its unit stays unmapped.
  delete from public.inventory_supplier_catalog_import_lines line
  where line.import_id = p_import_id and (
    line.kind = 'deletion'
    or (line.kind = 'article' and (
      p_unit_mapping ->> line.unit_text is not null
      or exists (
        select 1 from public.inventory_supplier_catalog_import_lines later
        where later.import_id = p_import_id and later.kind = 'article'
          and later.article_number = line.article_number and later.ordinal > line.ordinal
      )
    ))
    or (line.kind = 'price' and (
      exists (
        select 1 from public.inventory_supplier_catalog_import_lines delivered
        where delivered.import_id = p_import_id and delivered.kind = 'article'
          and delivered.article_number = line.article_number
      )
      or exists (
        select 1 from public.inventory_supplier_catalog_articles catalog
        where catalog.organization_id = p_organization_id and catalog.supplier_id = v_import.supplier_id
          and catalog.article_number = line.article_number
      )
    ))
  );

  update public.inventory_supplier_catalog_imports set
    status = 'confirmed',
    unit_mapping = p_unit_mapping,
    rebates = p_rebates,
    result = v_result,
    confirmed_by = p_actor_id,
    confirmed_at = now()
  where id = v_import.id;

  return v_result || jsonb_build_object('already_confirmed', false);
end;
$$;

-- The previous release's confirm: the catalog only, as its preview said.
create or replace function public.confirm_supplier_catalog_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid,
  p_unit_mapping jsonb
)
returns jsonb
language sql
security invoker
set search_path to ''
as $$
  select public.confirm_supplier_catalog_import(
    p_organization_id, p_actor_id, p_import_id, p_unit_mapping, null::jsonb, null::text
  );
$$;

-- 6. Turns a catalog row into an own article once, as in 20261214090001; a
-- list price with a saved rebate also gives its net cost as the purchase price.
-- Refusals: not_authorized, catalog_article_not_found, item_archived.
create or replace function public.adopt_supplier_catalog_article(
  p_organization_id uuid,
  p_actor_id uuid,
  p_catalog_article_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_catalog public.inventory_supplier_catalog_articles;
  v_item public.inventory_items;
  v_name text;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_rebate integer;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  -- Two adopts of the same row wait for each other, so the second finds the first's article.
  select catalog.* into v_catalog from public.inventory_supplier_catalog_articles catalog
  where catalog.id = p_catalog_article_id and catalog.organization_id = p_organization_id
  for update;
  if v_catalog.id is null then
    raise exception 'catalog_article_not_found';
  end if;

  select item.* into v_item from public.inventory_item_suppliers ref
  join public.inventory_items item on item.id = ref.item_id
  where ref.organization_id = p_organization_id and ref.supplier_id = v_catalog.supplier_id
    and ref.supplier_article_number = v_catalog.article_number;
  if v_item.id is null then
    -- An article number carried before references existed, without a reference.
    select item.* into v_item from public.inventory_items item
    where item.organization_id = p_organization_id and item.supplier_id = v_catalog.supplier_id
      and item.supplier_article_number = v_catalog.article_number;
  end if;
  if v_item.id is not null then
    if not v_item.is_active then
      raise exception 'item_archived';
    end if;
    return jsonb_build_object('item_id', v_item.id, 'created', false);
  end if;

  v_name := left(btrim(v_catalog.name || ' ' || v_catalog.name_addition), 500);
  insert into public.inventory_items (organization_id, item_type, name, unit, created_by)
  values (p_organization_id, 'material', v_name, v_catalog.unit, p_actor_id)
  returning * into v_item;
  perform app_private.write_inventory_item_supplier(
    p_organization_id, v_item.id, null, v_catalog.supplier_id, v_catalog.article_number, null, 1, 1, true
  );
  -- An EAN another article carries, also one a concurrent adopt just took, stays with that article.
  if v_catalog.ean is not null then
    insert into public.inventory_item_barcodes (organization_id, item_id, barcode_value, barcode_type, is_primary)
    values (p_organization_id, v_item.id, v_catalog.ean, 'unknown', true)
    on conflict (organization_id, barcode_value) do nothing;
  end if;
  if v_catalog.price_cents is not null then
    perform app_private.record_inventory_item_price(
      p_organization_id, p_actor_id, v_item.id,
      case v_catalog.price_kind when 'net' then 'purchase' else 'sale' end,
      v_catalog.price_cents, v_catalog.price_quantity, v_today, 'datanorm'
    );
  end if;
  if v_catalog.price_kind = 'list' then
    select office.rebate_basis_points into v_rebate from public.inventory_supplier_rebates office
    where office.organization_id = p_organization_id and office.supplier_id = v_catalog.supplier_id
      and office.rebate_group = v_catalog.rebate_group;
    if v_rebate is not null then
      perform app_private.record_inventory_item_price(
        p_organization_id, p_actor_id, v_item.id, 'purchase',
        app_private.supplier_net_cost_cents(v_catalog.price_cents, v_rebate), v_catalog.price_quantity,
        v_today, 'datanorm'
      );
    end if;
  end if;
  return jsonb_build_object('item_id', v_item.id, 'created', true);
end;
$$;

-- 7. One CSV row, as in 20261203150000: a reviewed row that matches an own
-- article records its prices from today, source csv_import, where they
-- differ, and answers each change in price_changes.
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
  v_price record;
  v_change jsonb;
  v_price_changes jsonb := '[]'::jsonb;
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
    -- The row's prices per one base unit become the matched article's prices
    -- from today, in a batch whose preview showed them.
    for v_price in
      select price.kind, price.amount_cents from (values
        ('purchase', v_fields.purchase_price_cents),
        ('sale', v_fields.sale_price_cents)
      ) as price (kind, amount_cents)
      where price.amount_cents is not null and exists (
        select 1 from public.inventory_import_batches batch
        where batch.id = p_import_batch_id and batch.organization_id = p_organization_id
          and batch.prices_previewed
      )
    loop
      v_change := app_private.record_imported_inventory_item_price(
        p_organization_id, p_actor_id, v_item.id, v_price.kind, v_price.amount_cents, 1,
        (now() at time zone 'Europe/Berlin')::date, 'csv_import'
      );
      if v_change is not null then
        v_price_changes := v_price_changes || jsonb_build_array(v_change);
      end if;
    end loop;
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
    'quantity_after', null,
    'price_changes', v_price_changes
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

-- A row's price changes as a preview shows them and a booking compares
-- them: without their first day, so a booking on a later day still matches.
create function app_private.import_price_changes_shown(p_changes jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path to ''
as $$
  select coalesce(jsonb_agg(change.value - 'valid_from' order by change.ordinality), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) with ordinality change;
$$;

-- Every staged row through the rule, as in 20261202120000; a row of a
-- price-showing preview must also change the prices that preview showed.
create or replace function app_private.apply_inventory_import_rows(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_batch_id uuid,
  p_rows jsonb,
  p_mode text,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_row jsonb;
  v_index bigint;
  v_outcome jsonb;
  v_detail text;
  v_state text;
  v_reason text;
  v_ref text;
  v_location_ref text;
  v_created uuid[] := '{}';
  v_results jsonb := '[]'::jsonb;
begin
  for v_row, v_index in
    select staged.value, staged.ordinality - 1 from jsonb_array_elements(p_rows) with ordinality staged
  loop
    if v_row ? 'rejection' then
      v_outcome := jsonb_build_object('outcome', 'rejected', 'reason', v_row->>'rejection');
    elsif v_row ? 'previewed_rejection' then
      v_outcome := v_row->'previewed_rejection';
    else
      begin
        v_outcome := app_private.apply_inventory_import_row(
          p_organization_id, p_actor_id, p_import_batch_id, v_row->'item',
          v_row->>'category_name', v_row->>'supplier_name', v_row->>'location_name', v_row->>'barcode',
          (v_row->>'quantity')::numeric, p_reason, p_mode, true
        );
        v_ref := case
          when v_outcome->>'matched_by' is null then 'new'
          when (v_outcome->>'item_id')::uuid = any (v_created) then 'file'
          else v_outcome->>'item_id'
        end;
        -- A Lager the import creates reads as „new“ on every row that names
        -- it, in the preview and in the booking alike.
        v_location_ref := case
          when (v_outcome->>'location_created')::boolean then 'new'
          else v_outcome->>'location_id'
        end;
        if (v_row ? 'previewed_item' and v_row->>'previewed_item' is distinct from v_ref)
          or (v_row ? 'previewed_location' and v_row->>'previewed_location' is distinct from v_location_ref)
          or (v_row ? 'previewed_prices'
            and v_row->'previewed_prices' is distinct from app_private.import_price_changes_shown(v_outcome->'price_changes'))
        then
          raise exception 'changed_since_preview';
        end if;
        v_outcome := v_outcome || jsonb_build_object('item_ref', v_ref, 'location_ref', v_location_ref);
      -- One handler for every row failure: the savepoint must isolate any of
      -- them so the other rows still book. The named refusals all raise
      -- SQLSTATE P0001 and differ only by message, so condition names cannot
      -- tell them apart. Any other failure keeps only its SQLSTATE (`code`),
      -- never its message or detail, which can quote row values; the action
      -- logs it. query_canceled is no OTHERS condition and fails the call.
      -- A deadlock or serialization failure is not the row's fault: it fails
      -- the whole call, so the batch stays a draft and a repeated confirm
      -- books it again instead of answering a stored failure.
      exception
      when deadlock_detected or serialization_failure then
        raise;
      when others then
        get stacked diagnostics v_detail = pg_exception_detail, v_state = returned_sqlstate;
        v_reason := case
          when sqlerrm in ('unit_mismatch', 'barcode_taken', 'invalid_input', 'changed_since_preview') then sqlerrm
          when sqlerrm = 'inventory item is not available for stock movement' then 'stock_not_tracked'
          else 'failed'
        end;
        v_outcome := jsonb_build_object(
          'outcome', 'rejected',
          'reason', v_reason,
          'unit', v_row->'item'->>'unit',
          'item_unit', case when v_reason = 'unit_mismatch' then v_detail end
        ) || case when v_reason = 'failed' then jsonb_build_object('code', v_state) else '{}'::jsonb end;
      end;
      -- Kept only once the row's savepoint committed, so a later row of the
      -- file that matches this new article reads as „file“.
      if v_outcome->>'item_ref' = 'new' then
        v_created := v_created || (v_outcome->>'item_id')::uuid;
      end if;
    end if;
    v_results := v_results || jsonb_build_array(v_outcome - 'item_id' - 'location_id' || jsonb_build_object('index', v_index));
  end loop;
  return v_results;
end;
$$;

-- 7. The CSV preview as in 20261202120000, with p_with_prices marking the
-- batch whose preview shows the matched articles' price changes. The
-- previous release's seven-argument call previews and books as before.
create function public.preview_inventory_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_file_name text,
  p_column_mapping jsonb,
  p_content_hash text,
  p_mode text,
  p_rows jsonb,
  p_with_prices boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_batch_id uuid;
  v_results jsonb;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  if p_mode not in ('stock', 'master_data') or jsonb_typeof(p_rows) is distinct from 'array'
    or jsonb_array_length(p_rows) = 0 or p_with_prices is null
  then
    raise exception 'invalid_input';
  end if;

  insert into public.inventory_import_batches (
    organization_id, file_name, status, column_mapping, row_count, created_by, content_hash, mode, staged_rows,
    prices_previewed
  ) values (
    p_organization_id, p_file_name, 'draft', coalesce(p_column_mapping, '{}'::jsonb),
    jsonb_array_length(p_rows), p_actor_id, p_content_hash, p_mode, p_rows, p_with_prices
  )
  returning id into v_batch_id;

  begin
    v_results := app_private.apply_inventory_import_rows(
      p_organization_id, p_actor_id, v_batch_id, p_rows, p_mode, null
    );
    -- Local variables keep their values; every write of the block rolls back.
    raise exception 'inventory_import_preview_done';
  exception when others then
    if sqlerrm <> 'inventory_import_preview_done' then
      raise;
    end if;
  end;

  -- The booking holds to this: each row notes the article and the Lager it
  -- resolved to, or the rejection it showed. Managers read the staged rows
  -- through the Data API, so a rejection keeps no SQLSTATE.
  update public.inventory_import_batches batch set staged_rows = (
    select jsonb_agg(
      case
        when staged.value ? 'rejection' then staged.value
        when result.value->>'outcome' = 'rejected'
          then staged.value || jsonb_build_object('previewed_rejection', result.value - 'index' - 'code')
        else staged.value || jsonb_build_object(
          'previewed_item', result.value->>'item_ref',
          'previewed_location', result.value->'location_ref'
        ) || case when p_with_prices
          then jsonb_build_object('previewed_prices', app_private.import_price_changes_shown(result.value->'price_changes'))
          else '{}'::jsonb end
      end
      order by staged.ordinality)
    from jsonb_array_elements(p_rows) with ordinality staged
    join jsonb_array_elements(v_results) with ordinality result on result.ordinality = staged.ordinality
  )
  where batch.id = v_batch_id;

  return jsonb_build_object('batch_id', v_batch_id, 'rows', v_results);
end;
$$;

-- The previous release's preview: its batch books no price of a matched article.
create or replace function public.preview_inventory_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_file_name text,
  p_column_mapping jsonb,
  p_content_hash text,
  p_mode text,
  p_rows jsonb
)
returns jsonb
language sql
security invoker
set search_path to ''
as $$
  select public.preview_inventory_import(
    p_organization_id, p_actor_id, p_file_name, p_column_mapping, p_content_hash, p_mode, p_rows, false
  );
$$;

revoke all on function app_private.supplier_net_cost_cents(integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function app_private.inventory_price_differs(integer, integer, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function app_private.is_supplier_rebate_mapping(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.record_imported_inventory_item_price(uuid, uuid, uuid, text, integer, integer, date, text)
  from public, anon, authenticated, service_role;
revoke all on function app_private.supplier_catalog_import_price_proposals(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.supplier_catalog_import_rebate_groups(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.supplier_catalog_import_price_changes(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.import_price_changes_shown(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function app_private.apply_inventory_import_rows(uuid, uuid, uuid, jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.preview_inventory_import(uuid, uuid, text, jsonb, text, text, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.preview_inventory_import(uuid, uuid, text, jsonb, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.preview_inventory_import(uuid, uuid, text, jsonb, text, text, jsonb, boolean)
  to service_role;
grant execute on function public.preview_inventory_import(uuid, uuid, text, jsonb, text, text, jsonb)
  to service_role;
revoke all on function public.preview_supplier_catalog_import_prices(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.confirm_supplier_catalog_import(uuid, uuid, uuid, jsonb, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.confirm_supplier_catalog_import(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.preview_supplier_catalog_import_prices(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.confirm_supplier_catalog_import(uuid, uuid, uuid, jsonb, jsonb, text) to service_role;
grant execute on function public.confirm_supplier_catalog_import(uuid, uuid, uuid, jsonb) to service_role;
