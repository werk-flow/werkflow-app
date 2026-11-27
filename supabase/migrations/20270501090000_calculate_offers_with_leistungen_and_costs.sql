-- The office calculates an offer: a Position can be taken from a Leistung,
-- and every priced Position keeps its own net cost hidden beside it
-- (werk-flow/werkflow-planning#382, E2a K6).
--
-- 1. offer_positions.leistung_id: the Leistung a priced Position was taken
--    from, inside the offer's organization, as item_id names an article
--    (20270301090000). A Position names an article or a Leistung, not both.
--    The foreign key restricts, so a named Leistung is archived, never deleted.
-- 2. The cost store of 20270301090000 (purchase_cost_cents per
--    purchase_price_quantity) becomes the cost of any priced Position: an
--    article's purchase price, a Leistung's cost rate or a cost the office
--    typed, each the Position's own snapshot like its price. Office-only like
--    the whole table: no client role holds a grant on it.
-- 3. save_offer_content: as in 20270301090000; a source may be a Leistung
--    (new refusal: leistung_not_found), and any priced Position may carry
--    its cost (`purchaseCost`), with or without a source.
-- 4. get_offer answers a Position's Leistung like its article, and still no
--    cost: a document of the offer is built from it.
-- 5. get_offer_with_costs: get_offer and each priced Position's cost, read
--    in one statement so both name the same content, for the office's editor.
--
-- Division of work: lib/offers/ computes every amount, cost and margin; no
-- SQL here computes one.
--
-- Expand-only: one nullable column, checks that bind only rows a save writes
-- from now on, a cost check that admits every row the old one admitted, and
-- both functions keep their signatures and their answers for every Position
-- older code writes.
--
-- Prevention: Tier 1 (the organization-scoped foreign key, the checks, no
-- client grant), Tier 2 supabase/tests/offers.sql.

-- 1. The Leistung.
alter table public.offer_positions add column leistung_id uuid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no offer content table yet; the rule binds only the new column, which older code never writes
alter table public.offer_positions add constraint offer_positions_leistung_fk foreign key (leistung_id, organization_id)
  references public.leistungen (id, organization_id);
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no offer content table yet; the rule binds only the new column, which older code never writes
alter table public.offer_positions add constraint offer_positions_leistung_check
  check (leistung_id is null or (kind = 'free' and item_id is null)) not valid;

create index offer_positions_leistung_idx on public.offer_positions (leistung_id, organization_id);

-- 2. The cost of any priced Position. The new check admits every row the old one did.
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no offer content table yet; the replacing check below is wider
alter table public.offer_positions drop constraint offer_positions_purchase_cost_check;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no offer content table yet; the rule admits every row the dropped one admitted
-- Every operand of the second branch is non-null there, so a row with one cost field null fails
-- instead of passing as unknown. The amount takes any article price (inventory_item_prices).
alter table public.offer_positions add constraint offer_positions_cost_check check (
  (purchase_cost_cents is null and purchase_price_quantity is null)
  or (kind = 'free' and purchase_cost_cents is not null and purchase_price_quantity is not null
    and purchase_cost_cents >= 0 and purchase_price_quantity in (1, 10, 100, 1000))
) not valid;

comment on column public.offer_positions.purchase_cost_cents is
  'The Position''s net cost per purchase_price_quantity: an article''s purchase price, a Leistung''s cost rate or one the office typed. Office-only.';

-- 3. p_sections as in 20270301090000; a source may also be
-- {kind: 'leistung', id}, and purchaseCost may come without a source.
-- New refusal: leistung_not_found (not a Leistung of the organization).
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
  -- A source is absent, null, or an article or Leistung id; a cost is absent, null, or two numbers.
  if exists (select 1 from jsonb_array_elements(p_sections) section,
      jsonb_array_elements(section -> 'positions') line
    where (coalesce(jsonb_typeof(line -> 'source'), 'null') <> 'null'
        and (coalesce(line #>> '{source,kind}', '') not in ('article', 'leistung')
          or coalesce(line #>> '{source,id}', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
      or (coalesce(jsonb_typeof(line -> 'purchaseCost'), 'null') <> 'null'
        and (jsonb_typeof(line #> '{purchaseCost,amountCents}') is distinct from 'number'
          or jsonb_typeof(line #> '{purchaseCost,priceQuantity}') is distinct from 'number')))
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
      purchase_cost_cents, purchase_price_quantity
    )
    select p_organization_id, p_offer_id, v_section_id, line.ordinality::integer, line.value ->> 'kind',
      btrim(line.value ->> 'name'), btrim(coalesce(line.value ->> 'description', '')),
      (line.value ->> 'quantity')::numeric, line.value ->> 'unit', line.value ->> 'unitLabel',
      (line.value ->> 'unitPriceCents')::bigint, (line.value ->> 'priceQuantity')::integer,
      (line.value ->> 'taxRateBasisPoints')::integer, (line.value ->> 'amountCents')::bigint,
      case when line.value #>> '{source,kind}' = 'article' then (line.value #>> '{source,id}')::uuid end,
      case when line.value #>> '{source,kind}' = 'leistung' then (line.value #>> '{source,id}')::uuid end,
      (line.value #>> '{purchaseCost,amountCents}')::bigint,
      (line.value #>> '{purchaseCost,priceQuantity}')::integer
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

-- 4. get_offer of 20270301090000 with each priced Position's article or
-- Leistung, or null, and never a cost. The source is added after
-- jsonb_strip_nulls, so an article without a number keeps its `number: null`.
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
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'kind', line.kind, 'name', line.name, 'description', line.description,
            'quantity', line.quantity::text, 'unit', line.unit, 'unitPriceCents', line.unit_price_cents,
            'priceQuantity', line.price_quantity, 'taxRateBasisPoints', line.tax_rate_basis_points
          )) || case when line.kind = 'free' then jsonb_build_object('source', case
              when item.id is not null then jsonb_build_object('kind', 'article', 'id', item.id,
                'number', item.internal_sku, 'name', item.name, 'archived', not item.is_active)
              when leistung.id is not null then jsonb_build_object('kind', 'leistung', 'id', leistung.id,
                'number', leistung.leistung_number, 'name', leistung.name,
                'archived', leistung.archived_at is not null)
            end) else '{}'::jsonb end
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

-- 5. The offer and, per Titel in order, each Position's cost in order: null
-- for a text line and for a Position without one. One statement, so the
-- costs belong to the content get_offer answers. Null for no such offer.
create function public.get_offer_with_costs(p_organization_id uuid, p_offer_id uuid)
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
    ), '[]'::jsonb)
  )
  from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id;
$$;
revoke all on function public.get_offer_with_costs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer_with_costs(uuid, uuid) to service_role;
