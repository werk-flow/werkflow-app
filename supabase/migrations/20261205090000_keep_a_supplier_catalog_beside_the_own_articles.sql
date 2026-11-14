-- The office imports a wholesaler's delivery into a supplier catalog beside
-- the own articles, with a preview, and a catalog article becomes an own
-- article on first use (werk-flow/werkflow-planning#375).
--
-- 1. inventory_supplier_catalog_articles holds one supplier's articles as the
--    wholesaler states them: number, texts, unit, price per price quantity,
--    price kind, rebate group, product groups, EAN and the delivery's date. A
--    catalog row is not a Lager article: it carries no stock, and /inventar's
--    article list and counts read inventory_items only. A catalog can hold
--    several hundred thousand rows per supplier, so the search reads one
--    trigram index over a stored, lower-cased search text, and every write
--    reaches a row through its unique key.
-- 2. inventory_supplier_rebate_groups keeps each delivery's rebate groups per
--    supplier as data. Nothing here applies a rebate or changes a price of an
--    own article; werk-flow/werkflow-planning#477 does.
-- 3. An import is a batch (inventory_supplier_catalog_imports) with its
--    staged lines (inventory_supplier_catalog_import_lines). The server reads
--    the uploaded delivery, opens the batch, stages its lines in chunks and
--    asks for the preview: per unit text of the delivery, how many articles
--    are new, changed or unchanged and how many prices change. The office
--    maps each unit text to the unit list; the confirm writes the catalog in
--    one call with that mapping. An article whose unit text stays unmapped is
--    rejected, never written as Stück. The batch is the idempotency key: a
--    second confirm answers the first one's result and writes nothing.
-- 4. A batch belongs to the person who opened it. Opening a new one abandons
--    that person's earlier open batches and drops their staged lines, so at
--    most one open batch per person keeps staged lines. A confirmed batch
--    keeps only the lines its report names: rejected lines, articles with an
--    unmapped unit and price changes of articles the catalog lacks.
-- 5. public.adopt_supplier_catalog_article turns a catalog row into an own
--    article once: the article with its supplier reference (preferred) and
--    the catalog price as a dated price row from today, source datanorm. A
--    list price becomes the sale price and a net price the purchase price, as
--    the wholesaler states them; no rebate is applied. An article that
--    already carries the supplier's article number is returned instead.
--
-- Division of work: the actions establish identity, the organization and the
-- manager role, and pass the server-resolved organization and actor. The
-- public functions follow the inventory pattern (owner decision 2026-11-13):
-- SECURITY DEFINER with search_path '', executable by service_role only,
-- re-checking the manager membership inside (app_private.lock_inventory_manager).
--
-- All four tables are server-only: RLS without a policy, and the service role
-- only reads them, so no client role, an employee's included, reads a catalog
-- row, a price or a rebate group through the Data API. None is in the
-- Realtime publication: the catalog is read on demand, and an adopted article
-- reaches other sessions through inventory_items.

create extension if not exists pg_trgm with schema extensions;

create table public.inventory_supplier_catalog_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  status text not null default 'staging',
  -- The delivery's file names as they arrived, without folder.
  file_names text[] not null,
  -- SHA-256 over the files' own SHA-256 values in file-name order; finds a repeated delivery.
  content_hash text not null,
  format_version text,
  supplier_text text,
  delivery_date date,
  currency text,
  -- The delivery's rebate groups, as the reader states them.
  rebate_groups jsonb not null default '[]'::jsonb,
  -- The kinds of lines the reader leaves out, with their counts.
  skipped jsonb not null default '[]'::jsonb,
  -- The confirm's unit mapping, unit text to unit code or null, and its counts.
  unit_mapping jsonb,
  result jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz,
  constraint inventory_supplier_catalog_imports_org_key unique (id, organization_id),
  constraint inventory_supplier_catalog_imports_supplier_fk foreign key (supplier_id, organization_id)
    references public.inventory_suppliers (id, organization_id) on delete cascade,
  constraint inventory_supplier_catalog_imports_status_check
    check (status in ('staging', 'previewed', 'confirmed', 'abandoned')),
  constraint inventory_supplier_catalog_imports_confirmed_check
    check ((status = 'confirmed') = (confirmed_at is not null)),
  constraint inventory_supplier_catalog_imports_hash_check check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint inventory_supplier_catalog_imports_files_check
    check (cardinality(file_names) between 1 and 20),
  constraint inventory_supplier_catalog_imports_rebate_groups_check
    check (jsonb_typeof(rebate_groups) = 'array'),
  constraint inventory_supplier_catalog_imports_skipped_check check (jsonb_typeof(skipped) = 'array')
);

create index inventory_supplier_catalog_imports_repeat_idx
  on public.inventory_supplier_catalog_imports (organization_id, supplier_id, content_hash, confirmed_at desc)
  where status = 'confirmed';
create index inventory_supplier_catalog_imports_open_idx
  on public.inventory_supplier_catalog_imports (organization_id, created_by)
  where status in ('staging', 'previewed');
create index inventory_supplier_catalog_imports_supplier_idx
  on public.inventory_supplier_catalog_imports (supplier_id);
create index inventory_supplier_catalog_imports_created_by_idx
  on public.inventory_supplier_catalog_imports (created_by) where created_by is not null;
create index inventory_supplier_catalog_imports_confirmed_by_idx
  on public.inventory_supplier_catalog_imports (confirmed_by) where confirmed_by is not null;

create table public.inventory_supplier_catalog_import_lines (
  organization_id uuid not null,
  import_id uuid not null,
  -- The line's place in the delivery as the server read it; a later line of the same article wins.
  ordinal integer not null,
  kind text not null,
  file_name text not null,
  line_number integer not null,
  article_number text,
  name text,
  name_addition text,
  unit_text text,
  price_quantity integer,
  price_kind text,
  price_cents integer,
  rebate_group text,
  main_product_group text,
  product_group text,
  ean text,
  matchcode text,
  reason_code text,
  reason text,
  primary key (import_id, ordinal),
  constraint inventory_supplier_catalog_import_lines_import_fk foreign key (import_id, organization_id)
    references public.inventory_supplier_catalog_imports (id, organization_id) on delete cascade,
  constraint inventory_supplier_catalog_import_lines_kind_check
    check (kind in ('article', 'price', 'deletion', 'rejection')),
  constraint inventory_supplier_catalog_import_lines_article_check check (
    kind = 'rejection'
    or (article_number is not null and length(btrim(article_number)) between 1 and 200)
  ),
  constraint inventory_supplier_catalog_import_lines_shape_check check (
    (kind <> 'article' or (name is not null and name_addition is not null and unit_text is not null
      and price_quantity in (1, 10, 100, 1000)))
    and (kind <> 'rejection' or (reason_code is not null and reason is not null))
  ),
  constraint inventory_supplier_catalog_import_lines_price_check check (
    (price_kind is null or price_kind in ('list', 'net'))
    and (price_cents is null or price_cents >= 0)
    and (price_cents is null or price_kind is not null)
  )
);

create index inventory_supplier_catalog_import_lines_article_idx
  on public.inventory_supplier_catalog_import_lines (import_id, kind, article_number);

create table public.inventory_supplier_catalog_articles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  article_number text not null,
  name text not null,
  name_addition text not null default '',
  -- A unit code of lib/inventory/units.ts, as the office mapped the delivery's unit text.
  unit text not null,
  -- The unit exactly as the wholesaler wrote it.
  unit_text text not null,
  price_quantity integer not null,
  -- Both null when the wholesaler gives no price.
  price_kind text,
  price_cents integer,
  rebate_group text,
  main_product_group text,
  product_group text,
  ean text,
  matchcode text,
  -- The date of the delivery that last changed the row.
  delivery_date date,
  import_id uuid not null,
  updated_at timestamptz not null default now(),
  search_text text generated always as (
    lower(
      article_number || ' ' || name || ' ' || name_addition || ' ' || coalesce(ean, '') || ' '
        || coalesce(matchcode, '')
    )
  ) stored,
  constraint inventory_supplier_catalog_articles_number_key
    unique (organization_id, supplier_id, article_number),
  constraint inventory_supplier_catalog_articles_supplier_fk foreign key (supplier_id, organization_id)
    references public.inventory_suppliers (id, organization_id) on delete cascade,
  constraint inventory_supplier_catalog_articles_import_fk foreign key (import_id, organization_id)
    references public.inventory_supplier_catalog_imports (id, organization_id),
  constraint inventory_supplier_catalog_articles_number_check
    check (length(btrim(article_number)) between 1 and 200),
  constraint inventory_supplier_catalog_articles_name_check check (length(btrim(name)) between 1 and 500),
  constraint inventory_supplier_catalog_articles_unit_check check (unit ~ '^[a-z_]{1,40}$'),
  constraint inventory_supplier_catalog_articles_quantity_check
    check (price_quantity in (1, 10, 100, 1000)),
  constraint inventory_supplier_catalog_articles_price_check check (
    (price_kind is null) = (price_cents is null)
    and (price_kind is null or price_kind in ('list', 'net'))
    and (price_cents is null or price_cents >= 0)
  )
);

-- The picker's search: a substring of number, texts, EAN or matchcode.
create index inventory_supplier_catalog_articles_search_idx
  on public.inventory_supplier_catalog_articles using gin (search_text extensions.gin_trgm_ops);
create index inventory_supplier_catalog_articles_supplier_idx
  on public.inventory_supplier_catalog_articles (supplier_id);
create index inventory_supplier_catalog_articles_import_idx
  on public.inventory_supplier_catalog_articles (import_id);

create table public.inventory_supplier_rebate_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid not null,
  rebate_group text not null,
  text text not null default '',
  -- The rebate as the reader states it: a percentage, another group, or unread.
  discount jsonb not null,
  import_id uuid not null,
  updated_at timestamptz not null default now(),
  constraint inventory_supplier_rebate_groups_key unique (organization_id, supplier_id, rebate_group),
  constraint inventory_supplier_rebate_groups_supplier_fk foreign key (supplier_id, organization_id)
    references public.inventory_suppliers (id, organization_id) on delete cascade,
  constraint inventory_supplier_rebate_groups_import_fk foreign key (import_id, organization_id)
    references public.inventory_supplier_catalog_imports (id, organization_id),
  constraint inventory_supplier_rebate_groups_group_check
    check (length(btrim(rebate_group)) between 1 and 40),
  constraint inventory_supplier_rebate_groups_discount_check check (jsonb_typeof(discount) = 'object')
);

create index inventory_supplier_rebate_groups_supplier_idx
  on public.inventory_supplier_rebate_groups (supplier_id);
create index inventory_supplier_rebate_groups_import_idx
  on public.inventory_supplier_rebate_groups (import_id);

alter table public.inventory_supplier_catalog_imports enable row level security;
alter table public.inventory_supplier_catalog_import_lines enable row level security;
alter table public.inventory_supplier_catalog_articles enable row level security;
alter table public.inventory_supplier_rebate_groups enable row level security;

revoke all on table public.inventory_supplier_catalog_imports from public, anon, authenticated, service_role;
revoke all on table public.inventory_supplier_catalog_import_lines from public, anon, authenticated, service_role;
revoke all on table public.inventory_supplier_catalog_articles from public, anon, authenticated, service_role;
revoke all on table public.inventory_supplier_rebate_groups from public, anon, authenticated, service_role;
grant select on table public.inventory_supplier_catalog_imports to service_role;
grant select on table public.inventory_supplier_catalog_import_lines to service_role;
grant select on table public.inventory_supplier_catalog_articles to service_role;
grant select on table public.inventory_supplier_rebate_groups to service_role;

-- The picker's search: the catalog rows of the organization whose search text
-- holds p_search literally (%, _ and \ match only themselves), in name order,
-- at most p_limit (up to 101). The pattern is escaped here, because the Data
-- API reads * in a LIKE filter as a wildcard. The statement reads the trigram
-- index; supabase/tests/inventory_supplier_catalog_search.sql explains it.
create function public.search_supplier_catalog_articles(
  p_organization_id uuid,
  p_search text,
  p_limit integer
)
returns table (
  id uuid,
  supplier_name text,
  article_number text,
  name text,
  name_addition text,
  unit text,
  price_kind text,
  price_cents integer,
  price_quantity integer
)
language sql
stable
security invoker
set search_path to ''
as $$
  select catalog.id, supplier.name, catalog.article_number, catalog.name, catalog.name_addition, catalog.unit,
    catalog.price_kind, catalog.price_cents, catalog.price_quantity
  from public.inventory_supplier_catalog_articles catalog
  join public.inventory_suppliers supplier
    on supplier.id = catalog.supplier_id and supplier.organization_id = catalog.organization_id
  where catalog.organization_id = p_organization_id
    and catalog.search_text like
      '%' || replace(replace(replace(lower(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by catalog.name, catalog.id
  limit least(greatest(p_limit, 1), 101);
$$;

-- An open batch of the actor in the organization, locked; import_not_found otherwise.
create function app_private.lock_open_supplier_catalog_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid,
  p_statuses text[]
)
returns public.inventory_supplier_catalog_imports
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_import public.inventory_supplier_catalog_imports;
begin
  select batch.* into v_import from public.inventory_supplier_catalog_imports batch
  where batch.id = p_import_id and batch.organization_id = p_organization_id
    and batch.created_by = p_actor_id
  for update;
  if v_import.id is null or not (v_import.status = any (p_statuses)) then
    raise exception 'import_not_found';
  end if;
  return v_import;
end;
$$;

-- The article lines of a batch with what each would do to the catalog: the
-- latest line per article number, its catalog row's state and stored unit,
-- and whether its price differs. The unit text is compared as written; the
-- caller compares the mapped unit with catalog_unit, since the office maps
-- units only after this answer.
create function app_private.supplier_catalog_import_effects(p_organization_id uuid, p_import_id uuid)
returns table (
  article_number text,
  unit_text text,
  catalog_unit text,
  is_new boolean,
  is_changed boolean,
  price_changed boolean
)
language sql
stable
security invoker
set search_path to ''
as $$
  with latest as (
    select distinct on (line.article_number) line.*
    from public.inventory_supplier_catalog_import_lines line
    where line.import_id = p_import_id and line.organization_id = p_organization_id
      and line.kind = 'article'
    order by line.article_number, line.ordinal desc
  )
  select latest.article_number, latest.unit_text, catalog.unit,
    catalog.id is null,
    catalog.id is not null and (
      catalog.name, catalog.name_addition, catalog.unit_text, catalog.price_quantity, catalog.price_kind,
      catalog.price_cents, catalog.rebate_group, catalog.main_product_group, catalog.product_group,
      catalog.ean, catalog.matchcode
    ) is distinct from (
      latest.name, latest.name_addition, latest.unit_text, latest.price_quantity, latest.price_kind,
      latest.price_cents, latest.rebate_group, latest.main_product_group, latest.product_group,
      latest.ean, latest.matchcode
    ),
    catalog.id is not null and (catalog.price_quantity, catalog.price_kind, catalog.price_cents)
      is distinct from (latest.price_quantity, latest.price_kind, latest.price_cents)
  from latest
  join public.inventory_supplier_catalog_imports batch on batch.id = p_import_id
  left join public.inventory_supplier_catalog_articles catalog
    on catalog.organization_id = p_organization_id
    and catalog.supplier_id = batch.supplier_id
    and catalog.article_number = latest.article_number;
$$;

-- What the price and deletion lines of a batch would do: price changes of
-- catalog rows outside the delivery's articles that change a price, those
-- whose article the catalog lacks, and catalog rows a deletion removes.
create function app_private.supplier_catalog_import_other_effects(p_organization_id uuid, p_import_id uuid)
returns table (price_updates bigint, price_unmatched bigint, removed bigint)
language sql
stable
security invoker
set search_path to ''
as $$
  with batch as (
    select batch.supplier_id from public.inventory_supplier_catalog_imports batch
    where batch.id = p_import_id and batch.organization_id = p_organization_id
  ), delivered as (
    select distinct line.article_number from public.inventory_supplier_catalog_import_lines line
    where line.import_id = p_import_id and line.kind = 'article'
  ), prices as (
    select distinct on (line.article_number) line.*
    from public.inventory_supplier_catalog_import_lines line
    where line.import_id = p_import_id and line.kind = 'price'
      and not exists (select 1 from delivered where delivered.article_number = line.article_number)
    order by line.article_number, line.ordinal desc
  )
  select
    (select count(*) from prices
      join batch on true
      join public.inventory_supplier_catalog_articles catalog
        on catalog.organization_id = p_organization_id and catalog.supplier_id = batch.supplier_id
        and catalog.article_number = prices.article_number
      where (catalog.price_kind, catalog.price_cents) is distinct from (prices.price_kind, prices.price_cents)),
    (select count(*) from prices
      join batch on true
      where not exists (
        select 1 from public.inventory_supplier_catalog_articles catalog
        where catalog.organization_id = p_organization_id and catalog.supplier_id = batch.supplier_id
          and catalog.article_number = prices.article_number
      )),
    (select count(distinct catalog.id) from public.inventory_supplier_catalog_import_lines line
      join batch on true
      join public.inventory_supplier_catalog_articles catalog
        on catalog.organization_id = p_organization_id and catalog.supplier_id = batch.supplier_id
        and catalog.article_number = line.article_number
      where line.import_id = p_import_id and line.kind = 'deletion'
        and not exists (select 1 from delivered where delivered.article_number = line.article_number));
$$;

-- Opens a batch for one delivery of a supplier of the organization and
-- abandons the actor's earlier open batches with their staged lines.
-- Refusals: not_authorized, supplier_not_found, invalid_input.
create function public.open_supplier_catalog_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_supplier_id uuid,
  p_file_names text[],
  p_content_hash text,
  p_header jsonb,
  p_rebate_groups jsonb,
  p_skipped jsonb
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_import_id uuid;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  perform 1 from public.inventory_suppliers supplier
  where supplier.id = p_supplier_id and supplier.organization_id = p_organization_id
  for key share;
  if not found then
    raise exception 'supplier_not_found';
  end if;
  if p_header is not null and jsonb_typeof(p_header) <> 'object' then
    raise exception 'invalid_input';
  end if;

  -- The update locks each open batch first: a batch a concurrent confirm
  -- finished meanwhile is skipped and keeps the lines its report names.
  with abandoned as (
    update public.inventory_supplier_catalog_imports batch set status = 'abandoned'
    where batch.organization_id = p_organization_id and batch.created_by = p_actor_id
      and batch.status in ('staging', 'previewed')
    returning batch.id
  )
  delete from public.inventory_supplier_catalog_import_lines line
  using abandoned
  where line.import_id = abandoned.id;

  begin
    insert into public.inventory_supplier_catalog_imports (
      organization_id, supplier_id, file_names, content_hash, format_version, supplier_text,
      delivery_date, currency, rebate_groups, skipped, created_by
    ) values (
      p_organization_id, p_supplier_id, p_file_names, p_content_hash,
      p_header->>'format_version', p_header->>'supplier_text', (p_header->>'date')::date,
      p_header->>'currency', coalesce(p_rebate_groups, '[]'::jsonb), coalesce(p_skipped, '[]'::jsonb),
      p_actor_id
    )
    returning id into v_import_id;
  exception when check_violation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'invalid_input';
  end;
  return v_import_id;
end;
$$;

-- Stages one chunk of a staging batch's lines; answers how many it staged.
-- Refusals: not_authorized, import_not_found, invalid_input.
create function public.stage_supplier_catalog_import_lines(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid,
  p_lines jsonb
)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_count integer;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  perform app_private.lock_open_supplier_catalog_import(
    p_organization_id, p_actor_id, p_import_id, array['staging']
  );
  if jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'invalid_input';
  end if;
  begin
    insert into public.inventory_supplier_catalog_import_lines (
      organization_id, import_id, ordinal, kind, file_name, line_number, article_number, name,
      name_addition, unit_text, price_quantity, price_kind, price_cents, rebate_group,
      main_product_group, product_group, ean, matchcode, reason_code, reason
    )
    select p_organization_id, p_import_id, line.ordinal, line.kind, line.file_name, line.line_number,
      nullif(btrim(line.article_number), ''), btrim(line.name), btrim(line.name_addition),
      btrim(line.unit_text), line.price_quantity, line.price_kind, line.price_cents,
      nullif(btrim(line.rebate_group), ''), nullif(btrim(line.main_product_group), ''),
      nullif(btrim(line.product_group), ''), nullif(btrim(line.ean), ''), nullif(btrim(line.matchcode), ''),
      line.reason_code, line.reason
    from jsonb_to_recordset(p_lines) as line (
      ordinal integer, kind text, file_name text, line_number integer, article_number text, name text,
      name_addition text, unit_text text, price_quantity integer, price_kind text, price_cents integer,
      rebate_group text, main_product_group text, product_group text, ean text, matchcode text,
      reason_code text, reason text
    );
    get diagnostics v_count = row_count;
  exception when check_violation or not_null_violation or unique_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception 'invalid_input';
  end;
  return v_count;
end;
$$;

-- Ends the staging of a batch and answers its preview: per unit text the
-- articles, new, changed, unchanged and price changes; the price and
-- deletion effects; the rejected lines' count; and the latest confirmed
-- batch of the same supplier and content, for the repeat warning.
-- Refusals: not_authorized, import_not_found.
create function public.preview_supplier_catalog_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_import public.inventory_supplier_catalog_imports;
  v_units jsonb;
  v_other record;
  v_rejected bigint;
  v_repeat jsonb;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  v_import := app_private.lock_open_supplier_catalog_import(
    p_organization_id, p_actor_id, p_import_id, array['staging', 'previewed']
  );

  -- Per unit text; an otherwise unchanged article counts per stored unit, so
  -- the dialog counts it as changed when the office maps the text to another unit.
  select coalesce(jsonb_agg(unit order by unit->>'unit_text'), '[]'::jsonb) into v_units
  from (
    select jsonb_build_object(
      'unit_text', grouped.unit_text,
      'articles', sum(grouped.articles),
      'new', sum(grouped.created),
      'changed', sum(grouped.changed),
      'unchanged', sum(grouped.unchanged),
      'unchanged_by_unit', coalesce(
        jsonb_object_agg(grouped.catalog_unit, grouped.unchanged) filter (where grouped.unchanged > 0),
        '{}'::jsonb
      ),
      'price_changed', sum(grouped.price_changed)
    ) as unit
    from (
      select effect.unit_text, effect.catalog_unit,
        count(*) as articles,
        count(*) filter (where effect.is_new) as created,
        count(*) filter (where effect.is_changed) as changed,
        count(*) filter (where not effect.is_new and not effect.is_changed) as unchanged,
        count(*) filter (where effect.price_changed) as price_changed
      from app_private.supplier_catalog_import_effects(p_organization_id, p_import_id) effect
      group by effect.unit_text, effect.catalog_unit
    ) grouped
    group by grouped.unit_text
  ) units;
  select * into v_other from app_private.supplier_catalog_import_other_effects(p_organization_id, p_import_id);
  select count(*) into v_rejected from public.inventory_supplier_catalog_import_lines line
  where line.import_id = p_import_id and line.kind = 'rejection';
  select jsonb_build_object('confirmed_at', earlier.confirmed_at, 'confirmed_by', earlier.confirmed_by)
  into v_repeat
  from public.inventory_supplier_catalog_imports earlier
  where earlier.organization_id = p_organization_id and earlier.supplier_id = v_import.supplier_id
    and earlier.content_hash = v_import.content_hash and earlier.status = 'confirmed'
  order by earlier.confirmed_at desc
  limit 1;

  update public.inventory_supplier_catalog_imports set status = 'previewed' where id = v_import.id;

  return jsonb_build_object(
    'units', v_units,
    'price_updates', v_other.price_updates,
    'price_unmatched', v_other.price_unmatched,
    'removed', v_other.removed,
    'rejected', v_rejected,
    'repeat', v_repeat
  );
end;
$$;

-- Writes a previewed batch to the catalog in one call with the office's unit
-- mapping (unit text to unit code, or null to reject its articles), and
-- answers what it wrote. A confirmed batch answers its stored result again.
-- Refusals: not_authorized, import_not_found, invalid_input.
create function public.confirm_supplier_catalog_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid,
  p_unit_mapping jsonb
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
  -- One import of a supplier's catalog at a time; an article's FK check still passes.
  perform 1 from public.inventory_suppliers supplier
  where supplier.id = v_import.supplier_id and supplier.organization_id = p_organization_id
  for no key update;

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
    and length(btrim(coalesce(entry.value->>'rebate_group', ''))) between 1 and 40
  order by btrim(entry.value->>'rebate_group'), entry.ordinality desc
  on conflict (organization_id, supplier_id, rebate_group) do update set
    text = excluded.text,
    discount = excluded.discount,
    import_id = excluded.import_id,
    updated_at = now()
  where (rebate.text, rebate.discount) is distinct from (excluded.text, excluded.discount);

  -- The batch keeps only the lines its report names.
  delete from public.inventory_supplier_catalog_import_lines line
  where line.import_id = p_import_id and (
    line.kind = 'deletion'
    or (line.kind = 'article' and p_unit_mapping ->> line.unit_text is not null)
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
    result = v_result,
    confirmed_by = p_actor_id,
    confirmed_at = now()
  where id = v_import.id;

  return v_result || jsonb_build_object('already_confirmed', false);
end;
$$;

-- Abandons an open batch of the actor and drops its staged lines; a
-- confirmed or abandoned batch stays as it is. Refusals: not_authorized,
-- import_not_found.
create function public.abandon_supplier_catalog_import(
  p_organization_id uuid,
  p_actor_id uuid,
  p_import_id uuid
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_import public.inventory_supplier_catalog_imports;
begin
  perform app_private.lock_inventory_manager(p_organization_id, p_actor_id);
  v_import := app_private.lock_open_supplier_catalog_import(
    p_organization_id, p_actor_id, p_import_id, array['staging', 'previewed', 'confirmed', 'abandoned']
  );
  if v_import.status not in ('staging', 'previewed') then
    return;
  end if;
  delete from public.inventory_supplier_catalog_import_lines line where line.import_id = v_import.id;
  update public.inventory_supplier_catalog_imports set status = 'abandoned' where id = v_import.id;
end;
$$;

-- Turns a catalog row into an own article, once: the article, its preferred
-- supplier reference with the wholesaler's article number, the EAN as its
-- barcode when no other article carries it, and the catalog price from today
-- (source datanorm). An article that already carries the supplier's article
-- number is answered instead, with created false.
-- Refusals: not_authorized, catalog_article_not_found, item_archived.
create function public.adopt_supplier_catalog_article(
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
      v_catalog.price_cents, v_catalog.price_quantity, (now() at time zone 'Europe/Berlin')::date,
      'datanorm'
    );
  end if;
  return jsonb_build_object('item_id', v_item.id, 'created', true);
end;
$$;

revoke all on function app_private.lock_open_supplier_catalog_import(uuid, uuid, uuid, text[])
  from public, anon, authenticated, service_role;
revoke all on function app_private.supplier_catalog_import_effects(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function app_private.supplier_catalog_import_other_effects(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.open_supplier_catalog_import(uuid, uuid, uuid, text[], text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.stage_supplier_catalog_import_lines(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.preview_supplier_catalog_import(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.confirm_supplier_catalog_import(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.abandon_supplier_catalog_import(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.adopt_supplier_catalog_article(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.search_supplier_catalog_articles(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.open_supplier_catalog_import(uuid, uuid, uuid, text[], text, jsonb, jsonb, jsonb)
  to service_role;
grant execute on function public.stage_supplier_catalog_import_lines(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.preview_supplier_catalog_import(uuid, uuid, uuid) to service_role;
grant execute on function public.confirm_supplier_catalog_import(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.abandon_supplier_catalog_import(uuid, uuid, uuid) to service_role;
grant execute on function public.adopt_supplier_catalog_article(uuid, uuid, uuid) to service_role;
grant execute on function public.search_supplier_catalog_articles(uuid, text, integer) to service_role;
