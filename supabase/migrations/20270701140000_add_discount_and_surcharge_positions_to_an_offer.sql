-- An offer holds Nachlässe and Zuschläge as Positionen of their own
-- (werk-flow/werkflow-planning#611, E2a K6c).
--
-- 1. offer_positions.kind „adjustment“: a Nachlass („rabatt“, it lowers the
--    sum) or a Zuschlag („zuschlag“), in price_adjustment, as a percentage in
--    hundredths of its Titel's or the offer's normal priced Positionen
--    (price_adjustment_scope „titel“ or „angebot“), or as a fixed net amount
--    in unit_price_cents at its own tax_rate_basis_points („betrag“).
--    amount_cents is its amount, and tax_split its parts by VAT rate, which
--    add up to it: lib/offers/amounts.ts computes each part once per rate.
--    It counts in its Titel's sum, so the save's sum check stays as it was.
-- 2. save_offer_content as in 20270701100000; it stores a Nachlass or
--    Zuschlag, refuses one whose parts do not add up, and refuses a caller
--    that does not say it knows them (`adjustments: true` in p_totals) for an
--    offer that holds one (offer_not_editable): a rolled-back build would
--    otherwise drop it on its next save.
-- 3. get_offer as in 20270701100000, with each Nachlass and Zuschlag as typed.
--    A build older than this one refuses the answer of an offer holding one
--    (its read knows two kinds), so it never shows such an offer without it.
-- 4. send_offer as in 20270701100000; the frozen content keeps each Nachlass
--    and Zuschlag with its parts, and a rendering that does not say it
--    printed them (`adjustments: true` in p_snapshot) is refused for an offer
--    that holds one.
--
-- No SQL here computes an amount: it checks that the parts add up, as it
-- checks a Titel's sum.
--
-- Expand-only: four nullable columns, the amount check replaced NOT VALID by
-- one that admits every row the old one did, a NOT VALID check, and three
-- functions keep their signatures and their answers for every offer without
-- a Nachlass or Zuschlag.
--
-- Prevention: Tier 1 (the checks), Tier 2 supabase/tests/offer_adjustments.sql.

-- 1. A Nachlass or Zuschlag.
alter table public.offer_positions add column price_adjustment text;
alter table public.offer_positions add column price_adjustment_scope text;
alter table public.offer_positions add column price_adjustment_percent_hundredths integer;
alter table public.offer_positions add column tax_split jsonb;

-- @destructive: after release 8a73d1d0aa07fd5f17dd05cb04d2a8e06f3b8f7b: that release writes text and free Positionen only, which the replacing check admits as before
alter table public.offer_positions drop constraint offer_positions_amount_check;
-- @destructive: after release 8a73d1d0aa07fd5f17dd05cb04d2a8e06f3b8f7b: that release writes text and free Positionen only, which this check admits as the dropped one did
-- The adjustment branch is coalesced: a null operand would otherwise pass the whole check.
alter table public.offer_positions add constraint offer_positions_amount_check check (
  (kind = 'text' and num_nonnulls(quantity, unit, unit_label, unit_price_cents, price_quantity,
    tax_rate_basis_points, amount_cents) = 0)
  or (kind = 'free' and num_nulls(quantity, unit, unit_label, unit_price_cents, price_quantity,
    tax_rate_basis_points, amount_cents) = 0
    and unit ~ '^[a-z_]{1,40}$' and char_length(unit_label) between 1 and 20
    and unit_price_cents between 0 and 100000000 and price_quantity in (1, 10, 100, 1000)
    and tax_rate_basis_points between 0 and 9999)
  or coalesce(kind = 'adjustment' and num_nonnulls(quantity, unit, unit_label, price_quantity) = 0
    and amount_cents is not null and price_adjustment in ('rabatt', 'zuschlag')
    and jsonb_typeof(tax_split) = 'array'
    and case
      when price_adjustment_scope = 'betrag' then price_adjustment_percent_hundredths is null
        and unit_price_cents between 1 and 100000000 and tax_rate_basis_points between 0 and 9999
      when price_adjustment_scope in ('titel', 'angebot') then
        price_adjustment_percent_hundredths between 1 and 10000
        and num_nonnulls(unit_price_cents, tax_rate_basis_points) = 0
      else false end, false)
) not valid;
-- @destructive: after release 8a73d1d0aa07fd5f17dd05cb04d2a8e06f3b8f7b: that release never writes the new columns, which are null on every row
alter table public.offer_positions add constraint offer_positions_adjustment_check check (
  kind = 'adjustment' or num_nonnulls(price_adjustment, price_adjustment_scope,
    price_adjustment_percent_hundredths, tax_split) = 0
) not valid;

comment on column public.offer_positions.tax_split is
  'A Nachlass''s or Zuschlag''s parts by VAT rate, [{taxRateBasisPoints, amountCents}], adding up to amount_cents.';

-- 2. p_sections as in 20270701100000; a Position may also be
-- {kind: 'adjustment', name, description, adjustment: {direction, scope,
-- percentHundredths | amountCents, taxRateBasisPoints}, amountCents, taxSplit:
-- [{taxRateBasisPoints, amountCents}]}: the server's amount and its parts by
-- VAT rate, which add up to it; a fixed amount is its one part at its rate.
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
  -- A type is absent, null or „normal“, or a priced Position's „bedarf“, or its „alternative“ to a
  -- normal priced Position of the same Titel, named by its place there.
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where coalesce(jsonb_typeof(line -> 'positionType'), 'null') <> 'null'
      and (coalesce(line #>> '{positionType,kind}', '') not in ('normal', 'bedarf', 'alternative')
        or (line #>> '{positionType,kind}' <> 'normal' and line ->> 'kind' is distinct from 'free')
        or (line #>> '{positionType,kind}' = 'alternative') is distinct from
          (coalesce(jsonb_typeof(line #> '{positionType,alternativeTo}'), 'null') = 'number')
        or (line #>> '{positionType,kind}' = 'alternative' and not exists (
          select 1 from jsonb_array_elements(section -> 'positions') with ordinality as base(value, place)
          where base.place::text = line #>> '{positionType,alternativeTo}'
            and base.value ->> 'kind' = 'free'
            and coalesce(base.value #>> '{positionType,kind}', 'normal') = 'normal'))))
  then
    raise exception 'invalid_input';
  end if;
  -- A Nachlass or Zuschlag: a direction, a percentage of its Titel or the offer or a fixed amount,
  -- the server's amount and its parts, each a rate and an amount.
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where line ->> 'kind' = 'adjustment'
      and (coalesce(line #>> '{adjustment,direction}', '') not in ('rabatt', 'zuschlag')
        or coalesce(line #>> '{adjustment,scope}', '') not in ('titel', 'angebot', 'betrag')
        -- A fixed amount has an amount and a rate and no percentage; a percentage has neither.
        or (line #>> '{adjustment,scope}' = 'betrag') is distinct from
          (coalesce(jsonb_typeof(line #> '{adjustment,amountCents}'), '') = 'number')
        or (line #>> '{adjustment,scope}' = 'betrag') is distinct from
          (coalesce(jsonb_typeof(line #> '{adjustment,taxRateBasisPoints}'), '') = 'number')
        or (line #>> '{adjustment,scope}' = 'betrag') =
          (coalesce(jsonb_typeof(line #> '{adjustment,percentHundredths}'), '') = 'number')
        or jsonb_typeof(line -> 'amountCents') is distinct from 'number'
        or jsonb_typeof(line -> 'taxSplit') is distinct from 'array'))
  then
    raise exception 'invalid_input';
  end if;
  -- Its parts name each rate once and add up to its amount; a fixed amount is its one part.
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where line ->> 'kind' = 'adjustment'
      and (exists (select 1 from jsonb_array_elements(line -> 'taxSplit') part
          where jsonb_typeof(part -> 'taxRateBasisPoints') is distinct from 'number'
            or jsonb_typeof(part -> 'amountCents') is distinct from 'number')
        or (select count(distinct part ->> 'taxRateBasisPoints') from jsonb_array_elements(line -> 'taxSplit') part)
          <> jsonb_array_length(line -> 'taxSplit')
        or (line ->> 'amountCents')::numeric is distinct from (select coalesce(sum((part ->> 'amountCents')::numeric), 0)
          from jsonb_array_elements(line -> 'taxSplit') part)
        or (line #>> '{adjustment,scope}' = 'betrag' and line -> 'taxSplit' is distinct from jsonb_build_array(
          jsonb_build_object('taxRateBasisPoints', line #> '{adjustment,taxRateBasisPoints}',
            'amountCents', case line #>> '{adjustment,direction}' when 'rabatt' then -1 else 1 end
              * (line #>> '{adjustment,amountCents}')::numeric)))))
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
  if p_totals ->> 'positionTypes' is distinct from 'true'
    and exists (select 1 from public.offer_positions line
      where line.organization_id = p_organization_id and line.offer_id = p_offer_id
        and line.position_type <> 'normal')
  then
    raise exception 'offer_not_editable';
  end if;
  -- A caller older than Nachlässe and Zuschläge would drop one, or count it as it does not know.
  if p_totals ->> 'adjustments' is distinct from 'true'
    and exists (select 1 from public.offer_positions line
      where line.organization_id = p_organization_id and line.offer_id = p_offer_id
        and line.kind = 'adjustment')
  then
    raise exception 'offer_not_editable';
  end if;
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
      purchase_cost_cents, purchase_price_quantity, price_source, price_condition_id, position_type,
      alternative_to, price_adjustment, price_adjustment_scope, price_adjustment_percent_hundredths, tax_split
    )
    select p_organization_id, p_offer_id, v_section_id, line.ordinality::integer, line.value ->> 'kind',
      btrim(line.value ->> 'name'), btrim(coalesce(line.value ->> 'description', '')),
      (line.value ->> 'quantity')::numeric, line.value ->> 'unit', line.value ->> 'unitLabel',
      -- A fixed Nachlass or Zuschlag keeps its amount and its rate where a priced Position keeps its own.
      coalesce(line.value #>> '{adjustment,amountCents}', line.value ->> 'unitPriceCents')::bigint,
      (line.value ->> 'priceQuantity')::integer,
      coalesce(line.value #>> '{adjustment,taxRateBasisPoints}', line.value ->> 'taxRateBasisPoints')::integer,
      (line.value ->> 'amountCents')::bigint,
      case when line.value #>> '{source,kind}' = 'article' then (line.value #>> '{source,id}')::uuid end,
      case when line.value #>> '{source,kind}' = 'leistung' then (line.value #>> '{source,id}')::uuid end,
      (line.value #>> '{purchaseCost,amountCents}')::bigint,
      (line.value #>> '{purchaseCost,priceQuantity}')::integer,
      line.value #>> '{priceSource,kind}',
      (line.value #>> '{priceSource,conditionId}')::uuid,
      coalesce(line.value #>> '{positionType,kind}', 'normal'),
      (line.value #>> '{positionType,alternativeTo}')::integer,
      line.value #>> '{adjustment,direction}', line.value #>> '{adjustment,scope}',
      (line.value #>> '{adjustment,percentHundredths}')::integer,
      case when line.value ->> 'kind' = 'adjustment' then line.value -> 'taxSplit' end
    from jsonb_array_elements(v_section.value -> 'positions') with ordinality as line(value, ordinality);
  end loop;

  -- The server computed every amount; the stored sums must add up, of the normal Positions and the
  -- Nachlässe and Zuschläge only.
  if exists (
    select 1 from public.offer_sections section
    where section.organization_id = p_organization_id and section.offer_id = p_offer_id
      and section.net_cents is distinct from (select coalesce(sum(line.amount_cents), 0)
        from public.offer_positions line
        where line.organization_id = p_organization_id and line.section_id = section.id
          and line.position_type = 'normal')
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


-- 3. As in 20270701100000; a Nachlass or Zuschlag answers its kind, name, description and
-- adjustment as the save took it, and no amount.
create or replace function public.get_offer(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', offer.id,
    'offerNumber', offer.offer_number,
    'title', offer.title,
    'status', offer.status,
    'version', offer.version,
    'contentVersion', offer.content_version,
    'validUntil', offer.valid_until,
    'openingText', offer.opening_text,
    'closingText', offer.closing_text,
    'client', jsonb_build_object('id', client.id, 'name', client.name),
    'site', (select jsonb_build_object('id', site.id, 'name', site.name, 'street', site.street,
        'postalCode', site.postal_code, 'city', site.city)
      from public.client_sites site
      where site.id = offer.site_id and site.organization_id = p_organization_id),
    'contact', (select jsonb_build_object('id', contact.id, 'name', contact.name)
      from public.client_contacts contact
      where contact.id = offer.contact_id and contact.organization_id = p_organization_id),
    'recipient', jsonb_build_object('id', recipient.id, 'name', recipient.name,
      'address', recipient.address, 'isDefault', offer.recipient_is_default),
    'owner', (select jsonb_build_object('userId', profile.id, 'firstName', profile.first_name,
        'lastName', profile.last_name, 'email', profile.email)
      from public.profiles profile where profile.id = offer.owner_user_id),
    'work', coalesce(
      (select jsonb_build_object('kind', 'job', 'id', job.id, 'number', job.job_number, 'title', job.title)
        from public.jobs job where job.id = offer.job_id and job.organization_id = p_organization_id),
      (select jsonb_build_object('kind', 'project', 'id', project.id, 'number', project.project_number,
          'title', project.name)
        from public.projects project
        where project.id = offer.project_id and project.organization_id = p_organization_id),
      (select jsonb_build_object('kind', 'request', 'id', request.id, 'number', request.request_number,
          'title', request.summary)
        from public.client_requests request
        where request.id = offer.request_id and request.organization_id = p_organization_id)
    ),
    -- The quantity as text: a JSON number would reach the server as a float.
    'sections', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', section.title,
        'positions', coalesce((
          select jsonb_agg(case when line.kind = 'adjustment' then jsonb_build_object(
            'kind', line.kind, 'name', line.name, 'description', line.description,
            'adjustment', jsonb_strip_nulls(jsonb_build_object('direction', line.price_adjustment,
              'scope', line.price_adjustment_scope, 'percentHundredths', line.price_adjustment_percent_hundredths,
              'amountCents', line.unit_price_cents, 'taxRateBasisPoints', line.tax_rate_basis_points)))
          else jsonb_strip_nulls(jsonb_build_object(
            'kind', line.kind, 'name', line.name, 'description', line.description,
            'quantity', line.quantity::text, 'unit', line.unit, 'unitPriceCents', line.unit_price_cents,
            'priceQuantity', line.price_quantity, 'taxRateBasisPoints', line.tax_rate_basis_points
          )) || case when line.position_type <> 'normal' then jsonb_build_object('positionType',
              jsonb_strip_nulls(jsonb_build_object('kind', line.position_type, 'alternativeTo', line.alternative_to)))
            else '{}'::jsonb end
          || case when line.kind = 'free' then jsonb_build_object('source', case
              when item.id is not null then jsonb_build_object('kind', 'article', 'id', item.id,
                'number', item.internal_sku, 'name', item.name, 'archived', not item.is_active)
              when leistung.id is not null then jsonb_build_object('kind', 'leistung', 'id', leistung.id,
                'number', leistung.leistung_number, 'name', leistung.name,
                'archived', leistung.archived_at is not null)
            end) else '{}'::jsonb end end
          order by line.position)
          from public.offer_positions line
          left join public.inventory_items item
            on item.id = line.item_id and item.organization_id = p_organization_id
          left join public.leistungen leistung
            on leistung.id = line.leistung_id and leistung.organization_id = p_organization_id
          where line.section_id = section.id and line.organization_id = p_organization_id
        ), '[]'::jsonb)
      ) order by section.position)
      from public.offer_sections section
      where section.offer_id = offer.id and section.organization_id = p_organization_id
    ), '[]'::jsonb)
  )
  from public.offers offer
  join public.clients client on client.id = offer.client_id and client.organization_id = p_organization_id
  join public.clients recipient
    on recipient.id = offer.recipient_client_id and recipient.organization_id = p_organization_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id;
$$;
revoke all on function public.get_offer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer(uuid, uuid) to service_role;

-- 4. As in 20270701100000; the frozen content keeps a Nachlass or Zuschlag with its number,
-- its adjustment, its amount and its parts by VAT rate.
create or replace function public.send_offer(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_expected_content_version integer,
  p_attempt_key uuid,
  p_channel text,
  p_sent_on date,
  p_recipient_name text,
  p_recipient_address text,
  p_snapshot jsonb,
  p_document_id uuid default null,
  p_storage_path text default null,
  p_file_name text default null,
  p_size_bytes bigint default null,
  p_content_hash text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer public.offers;
  v_earlier public.offer_events;
  v_revision integer;
  v_content jsonb;
  v_name text;
  v_counter integer := 1;
  v_constraint text;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or p_expected_content_version is null or p_sent_on is null
    or p_channel is null or p_channel not in ('download', 'email', 'post', 'persoenlich')
    or btrim(coalesce(p_recipient_name, '')) = '' or jsonb_typeof(p_snapshot) is distinct from 'object'
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  -- Under the row lock an earlier send of this offer has committed its event.
  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found and (v_earlier.event_type <> 'sent' or v_earlier.offer_id <> p_offer_id) then
    raise exception 'invalid_input';
  end if;
  if not found then
    -- The same draft sent from another tab or under a lost key.
    select * into v_earlier from public.offer_events event
    where event.organization_id = p_organization_id and event.offer_id = p_offer_id
      and event.event_type = 'sent'
      and (event.payload ->> 'fromVersion')::integer = p_expected_version
      and (event.payload ->> 'fromContentVersion')::integer = p_expected_content_version;
  end if;
  if found then
    return jsonb_build_object('revision', (v_earlier.payload ->> 'revision')::integer,
      'documentId', v_earlier.payload ->> 'documentId', 'replay', true);
  end if;

  if v_offer.status <> 'entwurf' then raise exception 'offer_not_editable'; end if;
  if v_offer.version <> p_expected_version or v_offer.content_version <> p_expected_content_version then
    raise exception 'offer_changed';
  end if;
  if p_document_id is null or p_storage_path is null or p_file_name is null or p_size_bytes is null
    or p_size_bytes <= 0 or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_storage_path not like p_organization_id::text || '/' || p_document_id::text || '/%'
    -- The PDF is dated the day the server rendered it; a send across midnight keeps that day.
    or p_sent_on not between (clock_timestamp() at time zone 'Europe/Berlin')::date - 1
      and (clock_timestamp() at time zone 'Europe/Berlin')::date
  then
    raise exception 'invalid_input';
  end if;
  if v_offer.valid_until < p_sent_on then raise exception 'offer_expired'; end if;
  if not exists (
    select 1 from public.offer_positions line
    where line.organization_id = p_organization_id and line.offer_id = p_offer_id
  ) then
    raise exception 'offer_empty';
  end if;
  if p_snapshot ->> 'positionTypes' is distinct from 'true' and exists (
    select 1 from public.offer_positions line
    where line.organization_id = p_organization_id and line.offer_id = p_offer_id
      and line.position_type <> 'normal'
  ) then
    raise exception 'offer_not_editable';
  end if;
  -- An older rendering printed no Nachlass or Zuschlag.
  if p_snapshot ->> 'adjustments' is distinct from 'true' and exists (
    select 1 from public.offer_positions line
    where line.organization_id = p_organization_id and line.offer_id = p_offer_id
      and line.kind = 'adjustment'
  ) then
    raise exception 'offer_not_editable';
  end if;

  -- The content as stored, with each priced Position's printed number (a text line has none)
  -- and its article or Leistung, a type other than „normal“ with an Alternativposition's
  -- Position by its printed number, and without its cost (20270501090000): a revision keeps
  -- what the customer got, never the office's calculation.
  select coalesce(jsonb_agg(jsonb_build_object(
      'number', section.position::text,
      'title', section.title,
      'netCents', section.net_cents,
      'positions', coalesce((
        with numbered as (
          select line.*, count(*) filter (where line.kind <> 'text')
            over (order by line.position) as counted
          from public.offer_positions line
          where line.organization_id = p_organization_id and line.section_id = section.id
        )
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'number', case when numbered.kind <> 'text' then section.position || '.' || numbered.counted end,
          'kind', numbered.kind, 'name', numbered.name, 'description', numbered.description,
          'quantity', numbered.quantity::text, 'unit', numbered.unit, 'unitLabel', numbered.unit_label,
          'unitPriceCents', case when numbered.kind = 'free' then numbered.unit_price_cents end,
          'priceQuantity', numbered.price_quantity,
          'taxRateBasisPoints', case when numbered.kind = 'free' then numbered.tax_rate_basis_points end,
          'amountCents', numbered.amount_cents,
          'adjustment', case when numbered.kind = 'adjustment' then jsonb_strip_nulls(jsonb_build_object(
            'direction', numbered.price_adjustment, 'scope', numbered.price_adjustment_scope,
            'percentHundredths', numbered.price_adjustment_percent_hundredths,
            'amountCents', numbered.unit_price_cents, 'taxRateBasisPoints', numbered.tax_rate_basis_points)) end,
          'taxSplit', numbered.tax_split,
          'itemId', numbered.item_id, 'leistungId', numbered.leistung_id,
          'positionType', nullif(numbered.position_type, 'normal'),
          'alternativeTo', (select section.position || '.' || base.counted from numbered base
            where base.position = numbered.alternative_to)
        )) order by numbered.position)
        from numbered
      ), '[]'::jsonb)
    ) order by section.position), '[]'::jsonb)
  into v_content
  from public.offer_sections section
  where section.organization_id = p_organization_id and section.offer_id = p_offer_id;

  select coalesce(max(revision.revision), 0) + 1 into v_revision from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id;

  -- The PDF lands in the library root, where an active name is unique: the
  -- first free `name (n).pdf`, as a Servicebericht is named
  -- (20261219113104), also when another upload takes the name meanwhile.
  v_name := btrim(p_file_name);
  loop
    if not exists (
      select 1 from public.documents document
      where document.organization_id = p_organization_id and document.folder_id is null
        and document.deleted_at is null and lower(btrim(document.display_name)) = lower(v_name)
    ) then
      begin
        insert into public.documents (
          id, organization_id, folder_id, storage_bucket, storage_path, original_file_name, display_name,
          category, mime_type, size_bytes, uploaded_by, document_date, retention_class, metadata
        ) values (
          p_document_id, p_organization_id, null, 'organization-documents', p_storage_path, v_name,
          v_name, 'offer', 'application/pdf', p_size_bytes, p_actor_id, p_sent_on, 'ten_years',
          jsonb_build_object('offerId', p_offer_id, 'revision', v_revision, 'contentHash', p_content_hash)
        );
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'documents_unique_active_folder_name_idx' then raise; end if;
      end;
    end if;
    v_counter := v_counter + 1;
    v_name := regexp_replace(btrim(p_file_name), '\.pdf$', '', 'i') || ' (' || v_counter || ').pdf';
  end loop;
  insert into public.document_links (organization_id, document_id, offer_id, created_by)
  values (p_organization_id, p_document_id, p_offer_id, p_actor_id);
  insert into public.document_links (organization_id, document_id, client_id, created_by)
  values (p_organization_id, p_document_id, v_offer.client_id, p_actor_id);
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'uploaded',
    jsonb_build_object('source', 'offer_send', 'offerId', p_offer_id, 'revision', v_revision,
      'storagePath', p_storage_path, 'contentHash', p_content_hash, 'clientId', v_offer.client_id)
  );
  perform public.file_document(p_actor_id, p_organization_id, p_document_id);

  insert into public.offer_revisions (
    organization_id, offer_id, revision, offer_number, title, valid_until, sent_on, channel,
    client_id, recipient_client_id, recipient_name, recipient_address, snapshot, content,
    net_cents, tax_cents, gross_cents, document_id, sent_by
  ) values (
    p_organization_id, p_offer_id, v_revision, v_offer.offer_number, v_offer.title, v_offer.valid_until,
    p_sent_on, p_channel, v_offer.client_id, v_offer.recipient_client_id, btrim(p_recipient_name),
    nullif(btrim(coalesce(p_recipient_address, '')), ''), p_snapshot, v_content,
    v_offer.net_cents, v_offer.tax_cents, v_offer.gross_cents, p_document_id, p_actor_id
  );
  update public.offers offer set
    status = 'gesendet',
    version = offer.version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'sent', 'gesendet', v_offer.version + 1,
    jsonb_build_object('revision', v_revision, 'channel', p_channel, 'documentId', p_document_id,
      'fromVersion', v_offer.version, 'fromContentVersion', v_offer.content_version,
      'grossCents', v_offer.gross_cents),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('revision', v_revision, 'documentId', p_document_id, 'replay', false);
end;
$$;
revoke all on function public.send_offer(uuid, uuid, uuid, integer, integer, uuid, text, date, text, text, jsonb,
  uuid, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.send_offer(uuid, uuid, uuid, integer, integer, uuid, text, date, text, text, jsonb,
  uuid, text, text, bigint, text) to service_role;
