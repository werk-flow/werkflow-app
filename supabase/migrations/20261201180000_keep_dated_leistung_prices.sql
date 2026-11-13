-- Leistungen: priced services without an article (labour, travel, a flat
-- service, a fee, subcontracted work), kept by Admin and Büro under
-- „Angebote“ → „Leistungen“ (werk-flow/werkflow-planning#379).
--
-- A Leistung's prices are dated versions: from `valid_from` on, a version
-- answers until a later one starts. A version is never changed or deleted, so
-- a price an offer used stays as it was. Recording another version for the
-- same first day supersedes the earlier one for every later read; the earlier
-- row stays as history. A Leistung is archived, never deleted: its versions
-- reference it from its creation on.
--
-- Sale price and internal cost rate are office facts. Both tables are
-- server-only: no client role holds a grant, so a field worker reads no row
-- and no column through the Data API. The server reads them with the service
-- role after the manager check (lib/price-catalog/).

create table public.leistungen (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  leistung_number text not null,
  name text not null,
  description text not null default '',
  kind text not null,
  -- A unit code of lib/inventory/units.ts; the server accepts only codes of that list.
  unit text not null,
  tax_rate_basis_points integer not null,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leistungen_id_organization_key unique (id, organization_id),
  constraint leistungen_number_check check (length(btrim(leistung_number)) between 1 and 40),
  constraint leistungen_name_check check (length(btrim(name)) between 1 and 200),
  constraint leistungen_description_check check (length(description) <= 4000),
  constraint leistungen_kind_check check (kind in ('arbeit', 'anfahrt', 'pauschale', 'gebuehr', 'fremdleistung')),
  constraint leistungen_unit_check check (unit ~ '^[a-z_]{1,40}$'),
  constraint leistungen_tax_rate_check check (tax_rate_basis_points between 0 and 10000)
);

create unique index leistungen_organization_number_key
  on public.leistungen (organization_id, lower(btrim(leistung_number)));
create index leistungen_organization_name_idx on public.leistungen (organization_id, lower(name), id);

create trigger leistungen_set_updated_at
before update on public.leistungen
for each row execute function public.set_updated_at();

create table public.leistung_price_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  leistung_id uuid not null,
  -- The first Berlin day this price applies.
  valid_from date not null,
  -- Net cents per one unit of the Leistung.
  sale_price_cents integer not null,
  -- The internal cost per unit; null when the office keeps none.
  cost_rate_cents integer,
  created_by uuid references auth.users (id) on delete set null,
  -- The recording order decides between versions of the same first day.
  created_at timestamptz not null default clock_timestamp(),
  constraint leistung_price_versions_leistung_fk foreign key (leistung_id, organization_id)
    references public.leistungen (id, organization_id) on delete cascade,
  constraint leistung_price_versions_sale_price_check check (sale_price_cents between 0 and 100000000),
  constraint leistung_price_versions_cost_rate_check check (cost_rate_cents between 0 and 100000000)
);

create index leistung_price_versions_leistung_day_idx
  on public.leistung_price_versions (leistung_id, valid_from desc, created_at desc, id desc);

-- A version and a Leistung outlive every direct DELETE; only the cascade of a
-- deleted organization removes them. A version never changes, except that a
-- deleted account's author reference becomes NULL (its foreign key action).
create function app_private.keep_leistung_price_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  if tg_op = 'UPDATE' and pg_trigger_depth() > 1 and new.created_by is null
    and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;
  if tg_table_name = 'leistungen' then raise exception 'leistung_is_archived_not_deleted'; end if;
  raise exception 'leistung_price_version_is_immutable';
end;
$$;
revoke all on function app_private.keep_leistung_price_history() from public, anon, authenticated;

create trigger leistungen_keep_history
before delete on public.leistungen
for each row execute function app_private.keep_leistung_price_history();
create trigger leistung_price_versions_keep_history
before update or delete on public.leistung_price_versions
for each row execute function app_private.keep_leistung_price_history();

-- RLS without a policy: client roles see no row even if a grant appeared later.
alter table public.leistungen enable row level security;
alter table public.leistung_price_versions enable row level security;

revoke all on table public.leistungen from public, anon, authenticated, service_role;
revoke all on table public.leistung_price_versions from public, anon, authenticated, service_role;
grant select, insert, update on table public.leistungen to service_role;
grant select, insert on table public.leistung_price_versions to service_role;

-- A new Leistung with its first price, in one call. The caller resolved the
-- organization, the manager role and every value.
create function public.create_leistung(
  p_organization_id uuid,
  p_actor_id uuid,
  p_leistung_number text,
  p_name text,
  p_description text,
  p_kind text,
  p_unit text,
  p_tax_rate_basis_points integer,
  p_valid_from date,
  p_sale_price_cents integer,
  p_cost_rate_cents integer
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_leistung_id uuid;
begin
  begin
    insert into public.leistungen (
      organization_id, leistung_number, name, description, kind, unit, tax_rate_basis_points,
      created_by, updated_by
    ) values (
      p_organization_id, btrim(p_leistung_number), btrim(p_name), btrim(coalesce(p_description, '')), p_kind,
      p_unit, p_tax_rate_basis_points, p_actor_id, p_actor_id
    ) returning id into v_leistung_id;
  exception when unique_violation then
    raise exception 'leistung_number_taken';
  end;
  insert into public.leistung_price_versions (
    organization_id, leistung_id, valid_from, sale_price_cents, cost_rate_cents, created_by
  ) values (
    p_organization_id, v_leistung_id, p_valid_from, p_sale_price_cents, p_cost_rate_cents, p_actor_id
  );
  return v_leistung_id;
end;
$$;
revoke all on function public.create_leistung(uuid, uuid, text, text, text, text, text, integer, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.create_leistung(uuid, uuid, text, text, text, text, text, integer, date, integer, integer)
  to service_role;

-- A new price of an active Leistung, in one call: the Leistung row stays
-- locked from the check to the insert, so an archive in between waits.
create function public.add_leistung_price(
  p_organization_id uuid,
  p_actor_id uuid,
  p_leistung_id uuid,
  p_valid_from date,
  p_sale_price_cents integer,
  p_cost_rate_cents integer
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_version_id uuid;
begin
  perform 1 from public.leistungen
  where id = p_leistung_id and organization_id = p_organization_id and archived_at is null
  for update;
  if not found then raise exception 'leistung_not_found'; end if;
  insert into public.leistung_price_versions (
    organization_id, leistung_id, valid_from, sale_price_cents, cost_rate_cents, created_by
  ) values (
    p_organization_id, p_leistung_id, p_valid_from, p_sale_price_cents, p_cost_rate_cents, p_actor_id
  ) returning id into v_version_id;
  return v_version_id;
end;
$$;
revoke all on function public.add_leistung_price(uuid, uuid, uuid, date, integer, integer)
  from public, anon, authenticated;
grant execute on function public.add_leistung_price(uuid, uuid, uuid, date, integer, integer) to service_role;

-- The price of each named Leistung of the organization on one Berlin day: the
-- version with the latest first day up to that day, the latest recorded one
-- among versions of the same first day. A Leistung without a version on that
-- day answers with empty price columns; an id of another organization or of
-- no Leistung is left out. Archived Leistungen answer too.
create function public.leistung_prices_on_day(
  p_organization_id uuid,
  p_leistung_ids uuid[],
  p_on_date date
) returns table (
  leistung_id uuid,
  unit text,
  tax_rate_basis_points integer,
  price_version_id uuid,
  valid_from date,
  sale_price_cents integer,
  cost_rate_cents integer
) language sql stable security invoker set search_path = '' as $$
  select l.id, l.unit, l.tax_rate_basis_points, v.id, v.valid_from, v.sale_price_cents, v.cost_rate_cents
  from public.leistungen l
  left join lateral (
    select version.id, version.valid_from, version.sale_price_cents, version.cost_rate_cents
    from public.leistung_price_versions version
    where version.leistung_id = l.id
      and version.organization_id = p_organization_id
      and version.valid_from <= p_on_date
    order by version.valid_from desc, version.created_at desc, version.id desc
    limit 1
  ) v on true
  where l.organization_id = p_organization_id
    and l.id = any(coalesce(p_leistung_ids, '{}'))
  order by l.id;
$$;
revoke all on function public.leistung_prices_on_day(uuid, uuid[], date) from public, anon, authenticated;
grant execute on function public.leistung_prices_on_day(uuid, uuid[], date) to service_role;

-- One bounded page of the Leistungen list with the price on `p_on_date`, the
-- first day of the next coming price and each row's price history. View,
-- search and the count apply before the page boundary. A Leistung's history
-- grows by one row per price change, so it is bounded by the office's own
-- entries, not by the organization's size.
create function public.list_leistung_page(
  p_organization_id uuid,
  p_on_date date,
  p_view text default 'aktiv',
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select l.id, l.name
    from public.leistungen l
    where l.organization_id = p_organization_id
      and case when coalesce(p_view, 'aktiv') = 'archiviert' then l.archived_at is not null
        else l.archived_at is null end
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', l.leistung_number, l.name, l.description)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching order by lower(name), id
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ), priced as (
    select * from public.leistung_prices_on_day(
      p_organization_id, array(select id from page), p_on_date
    )
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (select 1 from public.leistungen l where l.organization_id = p_organization_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'leistungNumber', l.leistung_number,
        'name', l.name,
        'description', l.description,
        'kind', l.kind,
        'unit', l.unit,
        'taxRateBasisPoints', l.tax_rate_basis_points,
        'archivedAt', l.archived_at,
        'updatedAt', l.updated_at,
        'priceVersionId', priced.price_version_id,
        'validFrom', priced.valid_from,
        'salePriceCents', priced.sale_price_cents,
        'costRateCents', priced.cost_rate_cents,
        'nextValidFrom', (
          select min(version.valid_from) from public.leistung_price_versions version
          where version.leistung_id = l.id
            and version.organization_id = p_organization_id
            and version.valid_from > p_on_date
        ),
        'versions', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', version.id,
            'validFrom', version.valid_from,
            'salePriceCents', version.sale_price_cents,
            'costRateCents', version.cost_rate_cents,
            'recordedAt', version.created_at
          ) order by version.valid_from desc, version.created_at desc, version.id desc)
          from public.leistung_price_versions version
          where version.leistung_id = l.id and version.organization_id = p_organization_id
        ), '[]')
      ) order by lower(l.name), l.id)
      from page
      join public.leistungen l on l.id = page.id and l.organization_id = p_organization_id
      left join priced on priced.leistung_id = l.id
    ), '[]')
  );
$$;
revoke all on function public.list_leistung_page(uuid, date, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.list_leistung_page(uuid, date, text, text, integer, integer) to service_role;
