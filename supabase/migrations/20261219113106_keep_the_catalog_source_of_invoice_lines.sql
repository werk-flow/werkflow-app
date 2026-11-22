-- An invoice line can come from a Leistung or an article with today's price,
-- and keeps that source (werk-flow/werkflow-planning#483, E2c R3b).
--
-- 1. invoice_lines.leistung_id and invoice_lines.item_id: the line's source,
--    at most one, each inside the line's organization. The copied name,
--    unit, price and tax rate stay the line's own values: the office can
--    still change them on a draft, and a later price of the source changes
--    no line.
-- 2. save_invoice_draft: as in
--    20261215100000_keep_invoice_drafts_with_their_lines_and_totals.sql, and
--    each line may name its source. A source outside the organization is
--    refused. An archived source stays on a saved line: it was offered when
--    the line was added, and refusing it later would lock the draft.
-- 3. get_invoice_with_line_sources: get_invoice plus each line's source with
--    its number, name and archive state, in line order, read in one
--    statement, so the editor keeps the source of every line it saves again.
-- 4. search_leistung_options: the Leistung picker; active Leistungen only.
--
-- Division of work: lib/invoices/line-source-actions.ts refuses an archived
-- or unpriced source when the office adds a line, and reads the price through
-- the readers of E1 and E2a; no SQL here prices a line.
--
-- Expand-only: two nullable columns, two new functions, and
-- save_invoice_draft keeps its signature and still takes a line without a
-- source.
--
-- Prevention: Tier 1 (the organization-scoped foreign keys and the one-source
-- check), Tier 2 supabase/tests/invoice_line_sources.sql.

-- 1. The source of a line.
alter table public.invoice_lines
  add column leistung_id uuid,
  add column item_id uuid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet; the rule binds only the new columns, which older code never writes
alter table public.invoice_lines add constraint invoice_lines_leistung_fk foreign key (leistung_id, organization_id)
  references public.leistungen (id, organization_id);
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet; the rule binds only the new columns, which older code never writes
alter table public.invoice_lines add constraint invoice_lines_item_fk foreign key (item_id, organization_id)
  references public.inventory_items (id, organization_id);
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet; the rule binds only the new columns, which older code never writes
alter table public.invoice_lines add constraint invoice_lines_one_source_check
  check (leistung_id is null or item_id is null) not valid;

create index invoice_lines_leistung_idx on public.invoice_lines (leistung_id, organization_id);
create index invoice_lines_item_idx on public.invoice_lines (item_id, organization_id);

-- 2. The save, with each line's source.
create or replace function public.save_invoice_draft(
  p_actor_id uuid,
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_terms jsonb,
  p_lines jsonb,
  p_totals jsonb
)
returns integer
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_earlier public.invoice_events;
  v_invoice public.invoices;
begin
  if p_actor_id is null or p_organization_id is null or p_invoice_id is null or p_attempt_key is null
    or p_expected_version is null or jsonb_typeof(p_terms) is distinct from 'object'
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_typeof(p_totals) is distinct from 'object'
    -- numeric(12,3) would round a fourth decimal silently.
    or exists (select 1 from jsonb_array_elements(p_lines) line
      where coalesce(line ->> 'quantity', '') !~ '^-?[0-9]{1,9}(\.[0-9]{1,3})?$')
    -- A source is absent, null, or a Leistung or an article.
    or exists (select 1 from jsonb_array_elements(p_lines) line
      where coalesce(jsonb_typeof(line -> 'source'), 'null') <> 'null'
        and coalesce(line #>> '{source,kind}', '') not in ('leistung', 'article'))
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  v_earlier := app_private.invoice_attempt(p_organization_id, p_actor_id, p_attempt_key);
  if v_earlier.id is not null then
    if v_earlier.event_type <> 'saved' or v_earlier.invoice_id <> p_invoice_id then
      raise exception 'invalid_input';
    end if;
    return v_earlier.version;
  end if;
  v_invoice := app_private.lock_invoice_draft(p_organization_id, p_invoice_id, p_expected_version);

  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    where (line #>> '{source,kind}' = 'leistung' and not exists (
        select 1 from public.leistungen leistung
        where leistung.id = (line #>> '{source,id}')::uuid and leistung.organization_id = p_organization_id))
      or (line #>> '{source,kind}' = 'article' and not exists (
        select 1 from public.inventory_items item
        where item.id = (line #>> '{source,id}')::uuid and item.organization_id = p_organization_id))
  ) then
    raise exception 'source_not_found';
  end if;

  update public.invoices invoice set
    service_start = (p_terms ->> 'serviceStart')::date,
    service_end = (p_terms ->> 'serviceEnd')::date,
    payment_due_days = (p_terms ->> 'paymentDueDays')::integer,
    discount_days = (p_terms ->> 'discountDays')::integer,
    discount_basis_points = (p_terms ->> 'discountBasisPoints')::integer,
    order_reference = coalesce(p_terms ->> 'orderReference', ''),
    buyer_reference = coalesce(p_terms ->> 'buyerReference', ''),
    opening_text = coalesce(p_terms ->> 'openingText', ''),
    closing_text = coalesce(p_terms ->> 'closingText', ''),
    line_net_cents = (p_totals ->> 'lineNetCents')::bigint,
    tax_cents = (p_totals ->> 'taxCents')::bigint,
    gross_cents = (p_totals ->> 'grossCents')::bigint,
    version = invoice.version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where invoice.id = v_invoice.id and invoice.organization_id = p_organization_id
    and invoice.version = p_expected_version;

  delete from public.invoice_lines line
  where line.invoice_id = v_invoice.id and line.organization_id = p_organization_id;
  insert into public.invoice_lines (
    organization_id, invoice_id, position, name, description, quantity, unit, unit_price_cents,
    price_quantity, tax_category, tax_rate_basis_points, net_cents, leistung_id, item_id
  )
  select p_organization_id, v_invoice.id, line.ordinality::integer, line.value ->> 'name',
    coalesce(line.value ->> 'description', ''), (line.value ->> 'quantity')::numeric,
    line.value ->> 'unit', (line.value ->> 'unitPriceCents')::bigint,
    (line.value ->> 'priceQuantity')::integer, line.value ->> 'taxCategory',
    (line.value ->> 'taxRateBasisPoints')::integer, (line.value ->> 'netCents')::bigint,
    case when line.value #>> '{source,kind}' = 'leistung' then (line.value #>> '{source,id}')::uuid end,
    case when line.value #>> '{source,kind}' = 'article' then (line.value #>> '{source,id}')::uuid end
  from jsonb_array_elements(p_lines) with ordinality as line(value, ordinality);

  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_invoice.id, 'saved', 'entwurf', v_invoice.version + 1,
    jsonb_build_object('lineCount', jsonb_array_length(p_lines),
      'grossCentsBefore', v_invoice.gross_cents, 'grossCents', (p_totals ->> 'grossCents')::bigint),
    p_actor_id, p_attempt_key
  );
  return v_invoice.version + 1;
end;
$$;
revoke all on function public.save_invoice_draft(uuid, uuid, uuid, integer, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_invoice_draft(uuid, uuid, uuid, integer, uuid, jsonb, jsonb, jsonb)
  to service_role;

-- 3. The invoice with each line's source. One statement, so the sources
-- belong to the lines get_invoice answers; null when there is no invoice.
create function public.get_invoice_with_line_sources(p_organization_id uuid, p_invoice_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select invoice.answer || jsonb_build_object('lineSources', coalesce((
    select jsonb_agg(case
        when leistung.id is not null then jsonb_build_object('kind', 'leistung', 'id', leistung.id,
          'number', leistung.leistung_number, 'name', leistung.name,
          'archived', leistung.archived_at is not null)
        when item.id is not null then jsonb_build_object('kind', 'article', 'id', item.id,
          'number', item.internal_sku, 'name', item.name, 'archived', not item.is_active)
      end order by line.position)
    from public.invoice_lines line
    left join public.leistungen leistung
      on leistung.id = line.leistung_id and leistung.organization_id = p_organization_id
    left join public.inventory_items item
      on item.id = line.item_id and item.organization_id = p_organization_id
    where line.invoice_id = p_invoice_id and line.organization_id = p_organization_id
  ), '[]'))
  from (select public.get_invoice(p_organization_id, p_invoice_id) as answer) invoice
  where invoice.answer is not null;
$$;
revoke all on function public.get_invoice_with_line_sources(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_invoice_with_line_sources(uuid, uuid) to service_role;

-- 4. The Leistung picker: active Leistungen whose number, name or description
-- holds the text literally, one page of 50 from p_offset in natural number
-- order, and whether more follow. A Leistung number is free text: the order
-- splits off its trailing digits and compares them as a number (L-2 before
-- L-10); a number without trailing digits comes last. Service-role only: the
-- caller resolves the organization and the manager role first.
create function public.search_leistung_options(
  p_organization_id uuid,
  p_search text default '',
  p_offset integer default 0
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select leistung.id, leistung.leistung_number, leistung.name, leistung.unit,
      leistung.leistung_number !~ '[0-9]$' as number_unmatched,
      substring(leistung.leistung_number from '^(.*?)[0-9]+$') as number_prefix,
      substring(leistung.leistung_number from '([0-9]+)$')::numeric as number_sequence
    from public.leistungen leistung
    where leistung.organization_id = p_organization_id
      and leistung.archived_at is null
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', leistung.leistung_number, leistung.name, leistung.description)),
          lower(p_search)) > 0
      )
  ), page as (
    select * from matching
    order by number_unmatched, number_prefix, number_sequence, leistung_number, id
    limit 51 offset greatest(coalesce(p_offset, 0), 0)
  ), choices as (
    select * from page
    order by number_unmatched, number_prefix, number_sequence, leistung_number, id limit 50
  ) select jsonb_build_object(
    'options', coalesce((select jsonb_agg(
      jsonb_build_object('id', id, 'number', leistung_number, 'name', name, 'unit', unit)
      order by number_unmatched, number_prefix, number_sequence, leistung_number, id) from choices), '[]'),
    'hasMore', (select count(*) > 50 from page)
  );
$$;
revoke all on function public.search_leistung_options(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.search_leistung_options(uuid, text, integer) to service_role;
