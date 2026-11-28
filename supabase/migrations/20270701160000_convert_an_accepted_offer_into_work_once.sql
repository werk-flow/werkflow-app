-- An accepted offer becomes work once, with its Auftragsumfang as the order
-- baseline, and the field sees that scope without a price
-- (werk-flow/werkflow-planning#388, E2a K12).
--
-- 1. orders: one row per converted offer, frozen. It binds the standing
--    Annahme, whose Auftragsumfang never changes, to one job or project.
--    order_lines: the baseline's lines, copied from that Auftragsumfang in
--    its order, each with its own id, which planned material names as its
--    source. No cost: an Annahme holds none.
-- 2. convert_offer_to_work: in one call it checks the offer is accepted and
--    still at the version the office saw, creates a job or a project through
--    the create functions (or takes the job or project the offer was written
--    for), writes the order and its lines, sets the work's
--    Auftraggeber and Rechnungsempfänger to the accepted revision's through
--    set_work_billing_parties, plans each article line's material through
--    plan_job_material with the line as source, bumps the offer's version
--    and writes the offer's history; a project's open lead holding is touched
--    so the lead's view reads again. The order row is the work's record of
--    the conversion: who, when, from which Annahme. Nothing is scheduled,
--    assigned or sent. A repeated press answers the first conversion; a
--    second conversion is refused. The offer's row lock serialises two
--    conversions at the same time, so they create one work.
-- 3. withdraw_offer_acceptance: as in 20270701120000, and refused once work
--    exists from the Annahme.
-- 4. prevent_historic_work_delete: as in 20261201150000, and work holding an
--    order is work with history.
-- 5. get_work_orders: the office's read of a work's orders with their
--    accepted scope, prices included. get_work_scope: the read for the field
--    and the project lead, scope only (text, quantity and unit), without a
--    discount line or a line kind it does not know. get_offer_order: the
--    work an offer became, for the offer's page.
--
-- Division of work: lib/orders/ establishes identity, the role, the
-- organization and, for the scope read, the assignment or the lead holding.
-- The functions check the actor again under the offer's lock. Only the
-- server reads either table, with the service role: no signed-in role holds a
-- grant on a column of them.
--
-- Expand-only: two new tables, four new functions, two replaced functions
-- with their signatures, each adding a refusal an older build reports as a
-- failed save.
--
-- Prevention: Tier 1 (the ledger guard, the checks under the offer's lock,
-- no client grant), Tier 2 supabase/tests/offer_conversion.sql and
-- supabase/tests/offer_conversion_concurrency.sql.

-- 1. The order baseline.
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  offer_id uuid not null,
  acceptance_id uuid not null,
  job_id uuid,
  project_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint orders_offer_fk foreign key (offer_id, organization_id)
    references public.offers (id, organization_id) on delete cascade,
  constraint orders_acceptance_fk foreign key (acceptance_id, organization_id)
    references public.offer_acceptances (id, organization_id) on delete cascade,
  -- A deleted work takes its order only in the organization's teardown:
  -- prevent_historic_work_delete refuses every other delete of it.
  constraint orders_job_fk foreign key (job_id, organization_id)
    references public.jobs (id, organization_id) on delete cascade,
  constraint orders_project_fk foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete cascade,
  constraint orders_one_work check (num_nonnulls(job_id, project_id) = 1),
  -- One order per offer and per Annahme; the keys also serve the foreign keys' lookups.
  constraint orders_offer_unique unique (offer_id, organization_id),
  constraint orders_acceptance_unique unique (acceptance_id, organization_id),
  constraint orders_id_organization_unique unique (id, organization_id)
);

create index orders_organization_id_fk_idx on public.orders (organization_id);
create index orders_job_idx on public.orders (job_id, organization_id) where job_id is not null;
create index orders_project_idx on public.orders (project_id, organization_id) where project_id is not null;
create index orders_created_by_idx on public.orders (created_by);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  order_id uuid not null,
  -- The line's place in the baseline, from 1.
  position integer not null,
  section_number text not null,
  section_title text not null,
  -- The printed number of a priced line; null for a text line.
  number text,
  -- free (a priced Position) or text, as the Auftragsumfang names it.
  kind text not null,
  name text not null,
  description text not null default '',
  quantity numeric(12, 3),
  unit text,
  unit_label text,
  unit_price_cents bigint,
  price_quantity integer,
  tax_rate_basis_points integer,
  amount_cents bigint,
  item_id uuid,
  -- bedarf or alternative for a chosen option; an Alternativposition names the Position it replaces.
  option text,
  replaces text,
  constraint order_lines_order_fk foreign key (order_id, organization_id)
    references public.orders (id, organization_id) on delete cascade,
  constraint order_lines_item_fk foreign key (item_id, organization_id)
    references public.inventory_items (id, organization_id),
  constraint order_lines_position_unique unique (order_id, position),
  constraint order_lines_kind_check check (kind ~ '^[a-z][a-z_]{0,30}$'),
  constraint order_lines_position_check check (position >= 1)
);

create index order_lines_order_idx on public.order_lines (order_id, organization_id);
create index order_lines_organization_id_fk_idx on public.order_lines (organization_id);
create index order_lines_item_idx on public.order_lines (item_id, organization_id);

-- The server reads and writes both; no signed-in role reads a row or a column.
alter table public.orders enable row level security;
revoke all on table public.orders from public, anon, authenticated, service_role;
grant select, insert on table public.orders to service_role;
alter table public.order_lines enable row level security;
revoke all on table public.order_lines from public, anon, authenticated, service_role;
grant select, insert on table public.order_lines to service_role;

-- The baseline never changes: no update, no delete but a foreign key's set null or cascade.
create trigger guard_event_ledger_history before update or delete on public.orders
  for each row execute function app_private.guard_event_ledger_history();
create trigger guard_event_ledger_history before update or delete on public.order_lines
  for each row execute function app_private.guard_event_ledger_history();

-- 2. Converts the accepted offer p_offer_id, still at p_expected_version, into
-- work: p_target 'job' or 'project' creates one named p_title for the
-- accepted customer with the offer's Einsatzort and Ansprechpartner and the
-- next number; 'offer_work' takes the job or project the offer was written
-- for. The answer is {orderId, kind, workId, unplannedPositions, version,
-- updatedAt, replay}: unplannedPositions names the article lines planned as no material
-- because their unit is not the article's or their quantity is not positive.
-- A call under the attempt key of an earlier conversion answers it with
-- replay true and writes nothing.
-- Refusals: invalid_input, not_authorized, offer_not_found,
-- offer_not_accepted, offer_changed, offer_converted (work exists from the
-- offer already), work_not_found, and those of the create functions,
-- set_work_billing_parties and plan_job_material.
create function public.convert_offer_to_work(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_target text,
  p_title text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer public.offers;
  v_earlier public.offer_events;
  v_acceptance public.offer_acceptances;
  v_revision public.offer_revisions;
  v_kind text;
  v_job_id uuid;
  v_project_id uuid;
  v_site_id uuid;
  v_contact_id uuid;
  v_location text;
  v_order_id uuid;
  v_parties public.work_billing_parties;
  v_line record;
  v_unplanned text[] := '{}';
  v_payload jsonb;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or p_target is null or p_target not in ('job', 'project', 'offer_work')
    or (p_target <> 'offer_work' and (btrim(coalesce(p_title, '')) = '' or char_length(p_title) > 200))
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  -- Under the row lock an earlier conversion under this key has committed its event.
  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found then
    if v_earlier.event_type <> 'converted' or v_earlier.offer_id <> p_offer_id then
      raise exception 'invalid_input';
    end if;
    return (v_earlier.payload - 'revision' - 'acceptanceId' - 'fromVersion')
      || jsonb_build_object('version', v_earlier.version, 'updatedAt', v_offer.updated_at, 'replay', true);
  end if;
  if exists (
    select 1 from public.orders existing
    where existing.organization_id = p_organization_id and existing.offer_id = p_offer_id
  ) then
    raise exception 'offer_converted';
  end if;
  if v_offer.status <> 'angenommen' then raise exception 'offer_not_accepted'; end if;
  if v_offer.version <> p_expected_version then raise exception 'offer_changed'; end if;
  select acceptance.* into v_acceptance from public.offer_acceptances acceptance
  where acceptance.organization_id = p_organization_id and acceptance.offer_id = p_offer_id
    and not exists (
      select 1 from public.offer_acceptance_withdrawals withdrawal
      where withdrawal.organization_id = p_organization_id and withdrawal.acceptance_id = acceptance.id
    );
  if not found then raise exception 'offer_not_accepted'; end if;
  select * into strict v_revision from public.offer_revisions revision
  where revision.organization_id = p_organization_id and revision.offer_id = p_offer_id
    and revision.revision = v_acceptance.revision;

  if p_target = 'offer_work' then
    if v_offer.job_id is not null then
      select job.id into v_job_id from public.jobs job
      where job.organization_id = p_organization_id and job.id = v_offer.job_id
      for update;
    elsif v_offer.project_id is not null then
      select project.id into v_project_id from public.projects project
      where project.organization_id = p_organization_id and project.id = v_offer.project_id
      for update;
    else
      raise exception 'invalid_input';
    end if;
    if v_job_id is null and v_project_id is null then raise exception 'work_not_found'; end if;
  else
    -- The Einsatzort and Ansprechpartner belong to the customer who accepted only while
    -- that customer is still the offer's.
    if v_offer.client_id = v_revision.client_id then
      v_site_id := v_offer.site_id;
      v_contact_id := v_offer.contact_id;
    end if;
    if p_target = 'job' then
      -- As a request's conversion: a job at a site records the site's current address.
      select nullif(concat_ws(', ', nullif(site.street, ''),
        nullif(concat_ws(' ', nullif(site.postal_code, ''), nullif(site.city, '')), '')), '')
      into v_location
      from public.client_sites site
      where site.organization_id = p_organization_id and site.id = v_site_id;
      -- The number lock first, so the next number is still free when the job takes it.
      perform pg_advisory_xact_lock(hashtextextended('job_number:' || p_organization_id::text, 0));
      select (public.create_job_with_assignments(
        p_organization_id, p_actor_id,
        jsonb_strip_nulls(jsonb_build_object('title', btrim(p_title), 'client_id', v_revision.client_id,
          'site_id', v_site_id, 'contact_id', v_contact_id, 'location', v_location,
          'job_number', public.generate_job_number(p_organization_id))),
        '{}'::uuid[], null, '{}'::uuid[], null, null, null, null, null, false, null, false
      )).id into v_job_id;
    else
      perform pg_advisory_xact_lock(hashtextextended('project_number:' || p_organization_id::text, 0));
      select (public.create_project_with_template(
        p_organization_id, p_actor_id,
        jsonb_strip_nulls(jsonb_build_object('name', btrim(p_title), 'client_id', v_revision.client_id,
          'site_id', v_site_id, 'contact_id', v_contact_id,
          'project_number', public.generate_project_number(p_organization_id))),
        null
      )).id into v_project_id;
    end if;
  end if;
  v_kind := case when v_job_id is not null then 'job' else 'project' end;

  insert into public.orders (organization_id, offer_id, acceptance_id, job_id, project_id, created_by)
  values (p_organization_id, p_offer_id, v_acceptance.id, v_job_id, v_project_id, p_actor_id)
  returning id into v_order_id;
  insert into public.order_lines (
    organization_id, order_id, position, section_number, section_title, number, kind, name, description,
    quantity, unit, unit_label, unit_price_cents, price_quantity, tax_rate_basis_points, amount_cents,
    item_id, option, replaces
  )
  select p_organization_id, v_order_id,
    row_number() over (order by section.ordinality, line.ordinality),
    section.value ->> 'number', section.value ->> 'title', line.value ->> 'number', line.value ->> 'kind',
    line.value ->> 'name', coalesce(line.value ->> 'description', ''), (line.value ->> 'quantity')::numeric,
    line.value ->> 'unit', line.value ->> 'unitLabel', (line.value ->> 'unitPriceCents')::bigint,
    (line.value ->> 'priceQuantity')::integer, (line.value ->> 'taxRateBasisPoints')::integer,
    (line.value ->> 'amountCents')::bigint, (line.value ->> 'itemId')::uuid, line.value ->> 'option',
    line.value ->> 'replaces'
  from jsonb_array_elements(v_acceptance.scope) with ordinality section(value, ordinality)
  cross join lateral jsonb_array_elements(section.value -> 'positions') with ordinality line(value, ordinality);

  -- The parties the customer accepted, as the office's choice, so a later site change keeps them.
  v_parties := app_private.current_work_billing_parties(p_organization_id, coalesce(v_job_id, v_project_id));
  perform public.set_work_billing_parties(p_actor_id, p_organization_id, v_kind,
    coalesce(v_job_id, v_project_id), v_revision.client_id, v_revision.recipient_client_id,
    coalesce(v_parties.version, 0));

  -- An article's quantity counts in its one base unit; a line in another unit plans nothing.
  for v_line in
    select line.id, line.number, line.item_id, line.quantity, line.unit = item.unit as same_unit
    from public.order_lines line
    join public.inventory_items item on item.id = line.item_id and item.organization_id = p_organization_id
    where line.organization_id = p_organization_id and line.order_id = v_order_id
    order by line.position
  loop
    if v_line.same_unit and v_line.quantity > 0 then
      perform public.plan_job_material(p_organization_id, p_actor_id, v_job_id, v_project_id,
        v_line.item_id, v_line.quantity, null, null, 'order_line', v_line.id);
    else
      v_unplanned := v_unplanned || v_line.number;
    end if;
  end loop;

  -- A project's lead may read none of its jobs: the touch of their open holding signals their view
  -- (20261210120000_name_and_end_a_project_lead.sql). A job's change signals it through its trigger.
  update public.work_leads work_lead set updated_at = now()
  where work_lead.organization_id = p_organization_id and work_lead.ended_at is null
    and work_lead.project_id = v_project_id;

  v_payload := jsonb_build_object('orderId', v_order_id, 'kind', v_kind,
    'workId', coalesce(v_job_id, v_project_id), 'unplannedPositions', to_jsonb(v_unplanned));
  update public.offers offer set
    version = offer.version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  returning offer.updated_at into v_updated_at;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'converted', 'angenommen', v_offer.version + 1,
    v_payload || jsonb_build_object('revision', v_acceptance.revision, 'acceptanceId', v_acceptance.id,
      'fromVersion', v_offer.version),
    p_actor_id, p_attempt_key
  );
  return v_payload
    || jsonb_build_object('version', v_offer.version + 1, 'updatedAt', v_updated_at, 'replay', false);
end;
$$;
revoke all on function public.convert_offer_to_work(uuid, uuid, uuid, integer, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.convert_offer_to_work(uuid, uuid, uuid, integer, uuid, text, text)
  to service_role;

-- 3. As in 20270701120000; a withdrawal of an Annahme that work exists from is
-- refused (offer_converted).
create or replace function public.withdraw_offer_acceptance(
  p_actor_id uuid,
  p_organization_id uuid,
  p_offer_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_offer public.offers;
  v_earlier public.offer_events;
  v_acceptance public.offer_acceptances;
  v_updated_at timestamptz;
begin
  if p_actor_id is null or p_organization_id is null or p_offer_id is null or p_attempt_key is null
    or p_expected_version is null or btrim(coalesce(p_reason, '')) = '' or char_length(p_reason) > 2000
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_offer from public.offers offer
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  for update;
  if not found then raise exception 'offer_not_found'; end if;

  select * into v_earlier from public.offer_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found then
    if v_earlier.event_type <> 'acceptance_withdrawn' or v_earlier.offer_id <> p_offer_id then
      raise exception 'invalid_input';
    end if;
    return jsonb_build_object('version', v_earlier.version, 'updatedAt', v_offer.updated_at, 'replay', true);
  end if;

  if v_offer.status <> 'angenommen' then raise exception 'offer_not_accepted'; end if;
  if v_offer.version <> p_expected_version then raise exception 'offer_changed'; end if;
  select acceptance.* into v_acceptance from public.offer_acceptances acceptance
  where acceptance.organization_id = p_organization_id and acceptance.offer_id = p_offer_id
    and not exists (
      select 1 from public.offer_acceptance_withdrawals withdrawal
      where withdrawal.organization_id = p_organization_id and withdrawal.acceptance_id = acceptance.id
    );
  if not found then raise exception 'offer_not_accepted'; end if;
  -- The conversion locks the offer too, so no order commits between this check and the withdrawal.
  if exists (
    select 1 from public.orders work_order
    where work_order.organization_id = p_organization_id and work_order.acceptance_id = v_acceptance.id
  ) then
    raise exception 'offer_converted';
  end if;

  insert into public.offer_acceptance_withdrawals (organization_id, acceptance_id, reason, withdrawn_by)
  values (p_organization_id, v_acceptance.id, btrim(p_reason), p_actor_id);
  update public.offers offer set
    status = 'gesendet',
    version = offer.version + 1,
    updated_by = p_actor_id
  where offer.organization_id = p_organization_id and offer.id = p_offer_id
  returning offer.updated_at into v_updated_at;
  insert into public.offer_events (
    organization_id, offer_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, p_offer_id, 'acceptance_withdrawn', 'gesendet', v_offer.version + 1,
    jsonb_build_object('revision', v_acceptance.revision, 'acceptanceId', v_acceptance.id,
      'fromVersion', v_offer.version),
    p_actor_id, p_attempt_key
  );
  return jsonb_build_object('version', v_offer.version + 1, 'updatedAt', v_updated_at, 'replay', false);
end;
$$;

-- 4. Work with an order is work with history: its hard deletion is refused
-- with the reason the office already sees. Unchanged from
-- 20261201150000_name_a_project_lead_per_work.sql but for the orders.
create or replace function app_private.prevent_historic_work_delete()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if pg_trigger_depth() > 1 and old.organization_id::text = any (
    string_to_array(current_setting('app.deleting_organization_ids', true), ',')
  ) then return old; end if;

  if tg_table_name = 'jobs' and (
    exists (select 1 from public.work_execution_events event where event.job_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.job_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_job_id = old.id or dependency.predecessor_job_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.job_id = old.id)
    or exists (select 1 from public.work_request_entries entry where entry.job_id = old.id)
    or exists (select 1 from public.work_leads lead where lead.job_id = old.id)
    or exists (select 1 from public.orders work_order where work_order.job_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;

  if tg_table_name = 'projects' and (
    exists (select 1 from public.work_execution_events event where event.project_id = old.id)
    or exists (select 1 from public.work_blockers blocker where blocker.project_id = old.id)
    or exists (select 1 from public.work_dependencies dependency
      where dependency.dependent_project_id = old.id or dependency.predecessor_project_id = old.id)
    or exists (select 1 from public.work_artifacts artifact where artifact.project_id = old.id)
    or exists (select 1 from public.work_request_entries entry where entry.project_id = old.id)
    or exists (select 1 from public.work_leads lead where lead.project_id = old.id)
    or exists (select 1 from public.orders work_order where work_order.project_id = old.id)
  ) then raise exception 'work_with_history_cannot_be_deleted'; end if;
  return old;
end;
$function$;

-- 5. The orders of the job or project p_work_id (p_kind 'job' or 'project'),
-- oldest first, for the office: each with its offer, the accepted revision,
-- who accepted it when, who converted it, and the Auftragsumfang with its
-- prices and totals as the Annahme froze them.
create function public.get_work_orders(p_organization_id uuid, p_kind text, p_work_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', work_order.id,
      'offerId', offer.id,
      'offerNumber', offer.offer_number,
      'revision', acceptance.revision,
      'acceptedByName', acceptance.accepted_by_name,
      'acceptedOn', acceptance.accepted_on,
      'convertedAt', work_order.created_at,
      'convertedBy', (select jsonb_build_object('firstName', profile.first_name,
          'lastName', profile.last_name, 'email', profile.email)
        from public.profiles profile where profile.id = work_order.created_by),
      'scope', acceptance.scope,
      'netCents', acceptance.net_cents,
      'taxCents', acceptance.tax_cents,
      'grossCents', acceptance.gross_cents
    ) order by work_order.created_at, work_order.id), '[]'::jsonb)
  from public.orders work_order
  join public.offers offer
    on offer.id = work_order.offer_id and offer.organization_id = p_organization_id
  join public.offer_acceptances acceptance
    on acceptance.id = work_order.acceptance_id and acceptance.organization_id = p_organization_id
  where work_order.organization_id = p_organization_id
    and ((p_kind = 'job' and work_order.job_id = p_work_id)
      or (p_kind = 'project' and work_order.project_id = p_work_id));
$$;
revoke all on function public.get_work_orders(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_work_orders(uuid, text, uuid) to service_role;

-- The scope of the job or project p_work_id for the field and the project
-- lead: the orders bound to it and, for a job, to its project, each with its
-- offer number and its Titel in order, each Titel with its lines' number,
-- kind, name, description, quantity and unit label. Never a price, a cost or
-- a total: a priced line below zero or with a negative quantity (a Nachlass,
-- also one that rounds to 0 cents) and every line of a kind
-- other than a priced Position or a text line are left out.
create function public.get_work_scope(p_organization_id uuid, p_kind text, p_work_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with bound as (
    select work_order.id, work_order.created_at, offer.offer_number,
      case when work_order.job_id is not null then 'job' else 'project' end as work_kind
    from public.orders work_order
    join public.offers offer
      on offer.id = work_order.offer_id and offer.organization_id = p_organization_id
    where work_order.organization_id = p_organization_id
      and ((p_kind = 'job' and (work_order.job_id = p_work_id or work_order.project_id = (
          select job.project_id from public.jobs job
          where job.organization_id = p_organization_id and job.id = p_work_id)))
        or (p_kind = 'project' and work_order.project_id = p_work_id))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'offerNumber', bound.offer_number,
      'workKind', bound.work_kind,
      'sections', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'number', section.section_number, 'title', section.section_title, 'lines', section.lines)
          order by section.first_position), '[]'::jsonb)
        from (
          select line.section_number, line.section_title, min(line.position) as first_position,
            jsonb_agg(jsonb_build_object('number', line.number, 'kind', line.kind, 'name', line.name,
              'description', line.description, 'quantity', line.quantity::text, 'unitLabel', line.unit_label)
              order by line.position) as lines
          from public.order_lines line
          where line.organization_id = p_organization_id and line.order_id = bound.id
            and (line.kind = 'text' or (line.kind = 'free' and line.amount_cents >= 0 and line.quantity >= 0))
          group by line.section_number, line.section_title
        ) section
      )
    ) order by bound.created_at, bound.id), '[]'::jsonb)
  from bound;
$$;
revoke all on function public.get_work_scope(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.get_work_scope(uuid, text, uuid) to service_role;

-- The work the offer p_offer_id became: its kind, id, number, title and, for
-- a job of a project, the project's number; null before its conversion.
create function public.get_offer_order(p_organization_id uuid, p_offer_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'kind', case when work_order.job_id is not null then 'job' else 'project' end,
    'workId', coalesce(work_order.job_id, work_order.project_id),
    'number', coalesce(job.job_number, project.project_number),
    'title', coalesce(job.title, project.name),
    'projectNumber', job_project.project_number)
  from public.orders work_order
  left join public.jobs job on job.id = work_order.job_id and job.organization_id = p_organization_id
  left join public.projects job_project
    on job_project.id = job.project_id and job_project.organization_id = p_organization_id
  left join public.projects project
    on project.id = work_order.project_id and project.organization_id = p_organization_id
  where work_order.organization_id = p_organization_id and work_order.offer_id = p_offer_id;
$$;
revoke all on function public.get_offer_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_offer_order(uuid, uuid) to service_role;
