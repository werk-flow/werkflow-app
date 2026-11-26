-- The office writes Titel and Positionen into an offer, and its totals are
-- right (werk-flow/werkflow-planning#452).
--
-- 1. offer_sections (Titel) and offer_positions: an offer's content, Titel
--    in order, each with its Positionen in order. A Position is free
--    (Bezeichnung, Beschreibung, quantity, unit code and label, net price per
--    price quantity, VAT rate and its amount) or a text line without an
--    amount. Each line keeps its own text, unit and price, so a later change
--    of the unit list touches no offer.
-- 2. offers carries its net, VAT and gross total and the version of its
--    content. A content save and a header save each check their own version,
--    so a header change in one tab does not turn the content typed in
--    another stale.
-- 3. save_offer_content replaces the content of a draft in one call, against
--    the content version the editor was filled from, renumbers Titel and
--    Positionen by their order, stores the amounts the server computed with
--    the invoice core (lib/offers/amounts.ts) and writes the
--    `content_changed` history row in the same call. No SQL computes a line
--    amount or VAT; the function checks only that the stored sums add up.
-- 4. get_offer answers the content too.
--
-- Division of work: the server action in lib/offers/ establishes identity,
-- the manager role and the organization, and passes them; the function checks
-- the actor again under the access lock (app_private.lock_office_actor of
-- 20261210130000).
--
-- Expand-only: two new tables, four new columns with defaults, one new
-- function; get_offer keeps its signature and every key it answered.
--
-- Prevention: Tier 1 (constraints, no client grant on the content), Tier 2
-- supabase/tests/offers.sql.

-- 1. The content. Neither table has a client grant: the server reads and
-- writes them, and a field worker reads no row.
create table public.offer_sections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null,
  -- 1 for the first Titel; a save renumbers by order.
  position integer not null,
  title text not null,
  -- The sum of its positions' amounts.
  net_cents bigint not null,
  constraint offer_sections_offer_fk foreign key (offer_id, organization_id)
    references public.offers (id, organization_id) on delete cascade,
  constraint offer_sections_key unique (id, offer_id, organization_id),
  constraint offer_sections_position_unique unique (offer_id, position),
  constraint offer_sections_position_check check (position between 1 and 100),
  constraint offer_sections_title_check check (btrim(title) <> '' and char_length(title) <= 200)
);

create index offer_sections_offer_idx on public.offer_sections (offer_id, organization_id, position);

alter table public.offer_sections enable row level security;
revoke all on table public.offer_sections from public, anon, authenticated, service_role;
grant select, insert, delete on table public.offer_sections to service_role;

create table public.offer_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null,
  section_id uuid not null,
  -- 1 for the first position of its Titel; a save renumbers by order.
  position integer not null,
  -- free: typed by hand with an amount; text: a note without one.
  kind text not null,
  name text not null,
  description text not null default '',
  quantity numeric(12, 3),
  -- A code of lib/inventory/units.ts and its short label when saved.
  unit text,
  unit_label text,
  unit_price_cents bigint,
  price_quantity integer,
  tax_rate_basis_points integer,
  amount_cents bigint,
  constraint offer_positions_section_fk foreign key (section_id, offer_id, organization_id)
    references public.offer_sections (id, offer_id, organization_id) on delete cascade,
  constraint offer_positions_position_unique unique (section_id, position),
  constraint offer_positions_position_check check (position between 1 and 500),
  constraint offer_positions_name_check check (btrim(name) <> '' and char_length(name) <= 200),
  constraint offer_positions_description_check check (char_length(description) <= 4000),
  constraint offer_positions_amount_check check (
    (kind = 'text' and num_nonnulls(quantity, unit, unit_label, unit_price_cents, price_quantity,
      tax_rate_basis_points, amount_cents) = 0)
    or (kind = 'free' and num_nulls(quantity, unit, unit_label, unit_price_cents, price_quantity,
      tax_rate_basis_points, amount_cents) = 0
      and unit ~ '^[a-z_]{1,40}$' and char_length(unit_label) between 1 and 20
      and unit_price_cents between 0 and 100000000 and price_quantity in (1, 10, 100, 1000)
      and tax_rate_basis_points between 0 and 9999)
  )
);

create index offer_positions_section_idx on public.offer_positions (section_id, offer_id, organization_id);

alter table public.offer_positions enable row level security;
revoke all on table public.offer_positions from public, anon, authenticated, service_role;
grant select, insert, delete on table public.offer_positions to service_role;

-- 2. The totals and the content version. Office sessions select offers to
-- hear of a change; the totals are sale amounts, which Admin and Büro see.
alter table public.offers
  add column net_cents bigint not null default 0,
  add column tax_cents bigint not null default 0,
  add column gross_cents bigint not null default 0,
  add column content_version integer not null default 1;
alter table public.offers add constraint offers_totals_check
  check (gross_cents = net_cents + tax_cents and content_version >= 1) not valid;

-- 3. p_sections is [{title, netCents, positions: [{kind, name, description,
-- quantity, unit, unitLabel, unitPriceCents, priceQuantity,
-- taxRateBasisPoints, amountCents}]}] in order; a text line names kind, name
-- and description only. p_totals is {netCents, taxCents, grossCents}. A call
-- under the attempt key of an earlier content save of this offer answers that
-- save's content version and writes nothing. The answer is
-- {contentVersion, updatedAt}: the content version and the offer's
-- transaction stamp after the call.
-- Refusals: invalid_input (also stored sums that do not add up),
-- not_authorized, offer_not_found, offer_not_editable (no longer
-- „Entwurf“), offer_changed (another content save came first).
create function public.save_offer_content(
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
      unit_price_cents, price_quantity, tax_rate_basis_points, amount_cents
    )
    select p_organization_id, p_offer_id, v_section_id, line.ordinality::integer, line.value ->> 'kind',
      btrim(line.value ->> 'name'), btrim(coalesce(line.value ->> 'description', '')),
      (line.value ->> 'quantity')::numeric, line.value ->> 'unit', line.value ->> 'unitLabel',
      (line.value ->> 'unitPriceCents')::bigint, (line.value ->> 'priceQuantity')::integer,
      (line.value ->> 'taxRateBasisPoints')::integer, (line.value ->> 'amountCents')::bigint
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

-- 4. get_offer of 20261210130000 with the content version and the content.
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
          )) order by line.position)
          from public.offer_positions line
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
