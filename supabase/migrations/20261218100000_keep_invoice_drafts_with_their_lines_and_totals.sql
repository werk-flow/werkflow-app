-- Admin and Büro draft a Rechnung with its lines, terms and totals; it stays
-- an Entwurf (werk-flow/werkflow-planning#456, E2c R3).
--
-- 1. invoices: the invoice record. A draft names its customer (the buyer),
--    optionally the job, project or Servicefall it bills, and its
--    Rechnungsempfänger: the current recipient of that work's billing parties
--    (E10) when the work's Auftraggeber is the customer, else the customer.
--    It carries the Leistungsdatum or Leistungszeitraum, Zahlungsziel,
--    Skonto, Bestellnummer, buyer reference, opening and closing text, and
--    the totals the server computed with lib/invoicing/calculate.ts. Only
--    „entwurf“ is written here; number, issue and Storno follow in their own
--    migrations. The recipient's name and address are copied at issue, not
--    here.
-- 2. invoice_lines: the lines of a draft, each with the net amount the server
--    computed. A save replaces every line of the draft in one call.
-- 3. invoice_events: the append-only history. Every write writes its event
--    in the same call; a retried call under the attempt key of an earlier
--    event answers with that call's result and writes nothing. The history
--    keeps no foreign key to the invoice, so a deleted draft's events stay.
-- 4. create_invoice, save_invoice_draft, delete_invoice_draft: the office's
--    writes. list_invoice_page and get_invoice: the server's reads.
-- 5. client_links: a customer an invoice names is linked and stays.
--
-- Division of work: the server actions in lib/invoices/ establish identity,
-- the manager role and the organization, compute every amount, and pass
-- them. Each write function checks the actor again under the access lock
-- (app_private.lock_office_actor) and refuses every id outside the
-- organization. No SQL here repeats the amount rule.
--
-- Expand-only: new tables and functions; client_links keeps its signature
-- and adds one key.
--
-- Prevention: Tier 1 (constraints, the ledger guard, no client grant on lines
-- and history), Tier 2 supabase/tests/invoice_drafts.sql.

-- 1. The invoice record.
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'entwurf',
  -- Assigned at issue; a draft has none.
  invoice_number text,
  -- The buyer, and the Rechnungsempfänger.
  client_id uuid not null,
  recipient_client_id uuid not null,
  -- The work it bills, at most one; a deleted work clears it.
  job_id uuid,
  project_id uuid,
  service_case_id uuid,
  -- Leistungsdatum (start = end) or Leistungszeitraum; open while drafting.
  service_start date,
  service_end date,
  payment_due_days integer not null default 14,
  -- Skonto: a percentage in basis points if paid within the days.
  discount_days integer,
  discount_basis_points integer,
  order_reference text not null default '',
  buyer_reference text not null default '',
  opening_text text not null default '',
  closing_text text not null default '',
  -- Computed by the server from the lines (lib/invoicing/calculate.ts).
  line_net_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  gross_cents bigint not null default 0,
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_id_organization_key unique (id, organization_id),
  constraint invoices_number_unique unique (organization_id, invoice_number),
  constraint invoices_status_check check (status in ('entwurf', 'ausgestellt', 'storniert')),
  constraint invoices_number_check check (
    invoice_number is null or (btrim(invoice_number) <> '' and char_length(invoice_number) <= 40)
  ),
  constraint invoices_one_work check (num_nonnulls(job_id, project_id, service_case_id) <= 1),
  constraint invoices_service_period_check check (
    (service_start is null) = (service_end is null) and service_end >= service_start
  ),
  constraint invoices_payment_due_check check (payment_due_days between 0 and 365),
  constraint invoices_discount_check check (
    (discount_days is null) = (discount_basis_points is null)
    and discount_days between 1 and payment_due_days
    and discount_basis_points between 1 and 9999
  ),
  constraint invoices_reference_check check (
    char_length(order_reference) <= 200 and char_length(buyer_reference) <= 200
  ),
  constraint invoices_text_check check (
    char_length(opening_text) <= 4000 and char_length(closing_text) <= 4000
  ),
  constraint invoices_totals_check check (gross_cents = line_net_cents + tax_cents),
  constraint invoices_version_check check (version >= 1),
  -- Every reference stays inside the organization.
  constraint invoices_client_fk foreign key (client_id, organization_id)
    references public.clients (id, organization_id),
  constraint invoices_recipient_fk foreign key (recipient_client_id, organization_id)
    references public.clients (id, organization_id),
  constraint invoices_job_fk foreign key (job_id, organization_id)
    references public.jobs (id, organization_id) on delete set null (job_id),
  constraint invoices_project_fk foreign key (project_id, organization_id)
    references public.projects (id, organization_id) on delete set null (project_id),
  constraint invoices_service_case_fk foreign key (service_case_id, organization_id)
    references public.service_cases (id, organization_id) on delete set null (service_case_id)
);

create unique index invoices_replident_idx on public.invoices (id, organization_id);
create index invoices_organization_updated_idx on public.invoices (organization_id, updated_at desc, id desc);
create index invoices_client_idx on public.invoices (client_id, organization_id);
create index invoices_recipient_idx on public.invoices (recipient_client_id, organization_id);
create index invoices_job_idx on public.invoices (job_id, organization_id) where job_id is not null;
create index invoices_project_idx on public.invoices (project_id, organization_id) where project_id is not null;
create index invoices_service_case_idx on public.invoices (service_case_id, organization_id)
  where service_case_id is not null;
create index invoices_created_by_idx on public.invoices (created_by);
create index invoices_updated_by_idx on public.invoices (updated_by);

-- A manager's session reads the rows only to hear of a change; the server
-- reads and writes them. A field worker reads no invoice.
alter table public.invoices enable row level security;
create policy "Managers can view invoices in their orgs" on public.invoices
  for select to authenticated
  using (organization_id in (select app_private.get_user_admin_or_manager_org_ids((select auth.uid()))));
revoke all on table public.invoices from public, anon, authenticated, service_role;
grant select on table public.invoices to authenticated;
grant select, insert, update, delete on table public.invoices to service_role;

alter table public.invoices replica identity using index invoices_replident_idx;
alter publication supabase_realtime add table public.invoices;
create trigger emit_realtime_deletion after delete on public.invoices
  for each row execute function app_private.emit_realtime_deletion();

-- 2. The lines. Server-only: a save bumps the invoice's version, which signals.
create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null,
  position integer not null,
  name text not null,
  description text not null default '',
  quantity numeric(12, 3) not null,
  -- A code of lib/inventory/units.ts; the server parses it against that list.
  unit text not null,
  unit_price_cents bigint not null,
  price_quantity integer not null default 1,
  -- S with a rate, or Z: the office chooses the tax per line.
  tax_category text not null,
  tax_rate_basis_points integer not null,
  net_cents bigint not null,
  constraint invoice_lines_invoice_fk foreign key (invoice_id, organization_id)
    references public.invoices (id, organization_id) on delete cascade,
  constraint invoice_lines_position_unique unique (invoice_id, position),
  constraint invoice_lines_position_check check (position between 1 and 500),
  constraint invoice_lines_name_check check (btrim(name) <> '' and char_length(name) <= 200),
  constraint invoice_lines_description_check check (char_length(description) <= 2000),
  constraint invoice_lines_unit_check check (unit ~ '^[a-z_]{1,40}$'),
  constraint invoice_lines_price_check check (unit_price_cents between 0 and 100000000),
  constraint invoice_lines_price_quantity_check check (price_quantity in (1, 10, 100, 1000)),
  constraint invoice_lines_tax_check check (
    (tax_category = 'S' and tax_rate_basis_points between 1 and 9999)
    or (tax_category = 'Z' and tax_rate_basis_points = 0)
  )
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id, organization_id, position);

alter table public.invoice_lines enable row level security;
revoke all on table public.invoice_lines from public, anon, authenticated, service_role;
grant select, insert, delete on table public.invoice_lines to service_role;

-- 3. The history.
create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- No foreign key: a deleted draft's history stays.
  invoice_id uuid not null,
  event_type text not null,
  -- The invoice's status and version after the event.
  status text not null,
  version integer not null,
  payload jsonb not null default '{}',
  actor_id uuid references auth.users (id) on delete set null,
  attempt_key uuid not null,
  created_at timestamptz not null default now(),
  constraint invoice_events_type_check check (event_type in ('created', 'saved', 'deleted')),
  constraint invoice_events_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint invoice_events_attempt_unique unique (organization_id, attempt_key)
);

create index invoice_events_invoice_idx on public.invoice_events (invoice_id, organization_id, created_at desc);
create index invoice_events_actor_id_idx on public.invoice_events (actor_id);

alter table public.invoice_events enable row level security;
revoke all on table public.invoice_events from public, anon, authenticated, service_role;
grant select, insert on table public.invoice_events to service_role;

create trigger guard_event_ledger_history before update or delete on public.invoice_events
  for each row execute function app_private.guard_event_ledger_history();

-- An earlier call under the same attempt key: its event, or nothing. The
-- key's advisory lock makes an overlapping retry wait for the first call.
create function app_private.invoice_attempt(p_organization_id uuid, p_actor_id uuid, p_attempt_key uuid)
returns public.invoice_events
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_event public.invoice_events;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':invoice-attempt:' || p_attempt_key::text, 0));
  select * into v_event from public.invoice_events event
  where event.organization_id = p_organization_id and event.attempt_key = p_attempt_key;
  if found and v_event.actor_id is distinct from p_actor_id then
    raise exception 'invalid_input';
  end if;
  return v_event;
end;
$$;
revoke all on function app_private.invoice_attempt(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.invoice_attempt(uuid, uuid, uuid) to service_role;

-- Locks the organization's draft for a change. Refusals: invoice_not_found,
-- invoice_not_draft, stale_version.
create function app_private.lock_invoice_draft(p_organization_id uuid, p_invoice_id uuid, p_expected_version integer)
returns public.invoices
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_invoice public.invoices;
begin
  select * into v_invoice from public.invoices invoice
  where invoice.organization_id = p_organization_id and invoice.id = p_invoice_id
  for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if v_invoice.status <> 'entwurf' then raise exception 'invoice_not_draft'; end if;
  if v_invoice.version <> p_expected_version then raise exception 'stale_version'; end if;
  return v_invoice;
end;
$$;
revoke all on function app_private.lock_invoice_draft(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function app_private.lock_invoice_draft(uuid, uuid, integer) to service_role;

-- 4. Creates a draft for a customer, optionally for one of its jobs,
-- projects or Servicefälle (p_work_kind job, project or service_case with
-- p_work_id, or both null). The recipient is the work's current
-- Rechnungsempfänger when the work's billing parties name this customer as
-- Auftraggeber, else the customer. Refusals: invalid_input, not_authorized,
-- client_not_found, client_archived, work_not_found.
create function public.create_invoice(
  p_actor_id uuid,
  p_organization_id uuid,
  p_attempt_key uuid,
  p_client_id uuid,
  p_work_kind text,
  p_work_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_earlier public.invoice_events;
  v_archived boolean;
  v_work_client_id uuid;
  v_parties public.work_billing_parties;
  v_invoice_id uuid;
begin
  if p_actor_id is null or p_organization_id is null or p_attempt_key is null or p_client_id is null
    or (p_work_kind is null) <> (p_work_id is null)
    or p_work_kind not in ('job', 'project', 'service_case')
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  v_earlier := app_private.invoice_attempt(p_organization_id, p_actor_id, p_attempt_key);
  if v_earlier.id is not null then
    if v_earlier.event_type <> 'created' then raise exception 'invalid_input'; end if;
    return v_earlier.invoice_id;
  end if;

  select client.archived_at is not null into v_archived from public.clients client
  where client.id = p_client_id and client.organization_id = p_organization_id
  for share;
  if not found then raise exception 'client_not_found'; end if;
  if v_archived then raise exception 'client_archived'; end if;
  if p_work_kind = 'job' then
    select job.client_id into v_work_client_id from public.jobs job
    where job.id = p_work_id and job.organization_id = p_organization_id for share;
  elsif p_work_kind = 'project' then
    select project.client_id into v_work_client_id from public.projects project
    where project.id = p_work_id and project.organization_id = p_organization_id for share;
  elsif p_work_kind = 'service_case' then
    select service_case.client_id into v_work_client_id from public.service_cases service_case
    where service_case.id = p_work_id and service_case.organization_id = p_organization_id for share;
  end if;
  if p_work_kind is not null and (not found or v_work_client_id is distinct from p_client_id) then
    raise exception 'work_not_found';
  end if;
  if p_work_id is not null then
    v_parties := app_private.current_work_billing_parties(p_organization_id, p_work_id);
  end if;

  insert into public.invoices (
    organization_id, client_id, recipient_client_id, job_id, project_id, service_case_id,
    created_by, updated_by
  ) values (
    p_organization_id, p_client_id,
    case when v_parties.client_id = p_client_id then v_parties.recipient_client_id else p_client_id end,
    case when p_work_kind = 'job' then p_work_id end,
    case when p_work_kind = 'project' then p_work_id end,
    case when p_work_kind = 'service_case' then p_work_id end,
    p_actor_id, p_actor_id
  )
  returning id into v_invoice_id;
  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, actor_id, attempt_key
  ) values (p_organization_id, v_invoice_id, 'created', 'entwurf', 1, p_actor_id, p_attempt_key);
  return v_invoice_id;
end;
$$;
revoke all on function public.create_invoice(uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.create_invoice(uuid, uuid, uuid, uuid, text, uuid) to service_role;

-- Saves a draft's terms and replaces its lines, with the amounts the server
-- computed, from p_expected_version to the next version. p_terms holds
-- serviceStart, serviceEnd, paymentDueDays, discountDays,
-- discountBasisPoints, orderReference, buyerReference, openingText and
-- closingText; p_lines an array of lines with their netCents; p_totals
-- lineNetCents, taxCents and grossCents. Returns the new version; a retry
-- under the same key returns the version that call wrote. Refusals:
-- invalid_input (also a quantity with more than three decimals),
-- not_authorized, those of lock_invoice_draft, and a check violation for a
-- value outside a column's limits.
create function public.save_invoice_draft(
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
    price_quantity, tax_category, tax_rate_basis_points, net_cents
  )
  select p_organization_id, v_invoice.id, line.ordinality::integer, line.value ->> 'name',
    coalesce(line.value ->> 'description', ''), (line.value ->> 'quantity')::numeric,
    line.value ->> 'unit', (line.value ->> 'unitPriceCents')::bigint,
    (line.value ->> 'priceQuantity')::integer, line.value ->> 'taxCategory',
    (line.value ->> 'taxRateBasisPoints')::integer, (line.value ->> 'netCents')::bigint
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

-- Deletes a draft (it has no number) with its lines; its history stays with
-- a deleted event that names the customer and the last totals. A retry under
-- the same key answers as the first call did. Refusals: invalid_input,
-- not_authorized and those of lock_invoice_draft.
create function public.delete_invoice_draft(
  p_actor_id uuid,
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_attempt_key uuid
)
returns void
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_earlier public.invoice_events;
  v_invoice public.invoices;
begin
  if p_actor_id is null or p_organization_id is null or p_invoice_id is null or p_attempt_key is null
    or p_expected_version is null
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  v_earlier := app_private.invoice_attempt(p_organization_id, p_actor_id, p_attempt_key);
  if v_earlier.id is not null then
    if v_earlier.event_type <> 'deleted' or v_earlier.invoice_id <> p_invoice_id then
      raise exception 'invalid_input';
    end if;
    return;
  end if;
  v_invoice := app_private.lock_invoice_draft(p_organization_id, p_invoice_id, p_expected_version);
  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_invoice.id, 'deleted', 'entwurf', v_invoice.version,
    jsonb_build_object('clientId', v_invoice.client_id, 'grossCents', v_invoice.gross_cents),
    p_actor_id, p_attempt_key
  );
  delete from public.invoices invoice
  where invoice.id = v_invoice.id and invoice.organization_id = p_organization_id;
end;
$$;
revoke all on function public.delete_invoice_draft(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.delete_invoice_draft(uuid, uuid, uuid, integer, uuid) to service_role;

-- One page of the organization's invoices, last changed first. The search
-- matches number, customer and recipient name; the status filter one status,
-- or every one when null. Total and order apply before the page boundary.
create function public.list_invoice_page(
  p_organization_id uuid,
  p_status text default null,
  p_search text default '',
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb language sql stable security invoker set search_path = '' as $$
  with matching as materialized (
    select invoice.id, invoice.updated_at
    from public.invoices invoice
    join public.clients client on client.id = invoice.client_id and client.organization_id = p_organization_id
    join public.clients recipient
      on recipient.id = invoice.recipient_client_id and recipient.organization_id = p_organization_id
    where invoice.organization_id = p_organization_id
      and (p_status is null or invoice.status = p_status)
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', invoice.invoice_number, client.name, recipient.name)), lower(p_search)) > 0
      )
  ), page as (
    select * from matching order by updated_at desc, id desc
    limit least(greatest(p_page_size, 1), 100)
    offset (greatest(p_page, 1)::bigint - 1) * least(greatest(p_page_size, 1), 100)
  ) select jsonb_build_object(
    'total', (select count(*) from matching),
    'hasAny', exists (select 1 from public.invoices invoice where invoice.organization_id = p_organization_id),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', invoice.id,
        'invoiceNumber', invoice.invoice_number,
        'status', invoice.status,
        'clientName', client.name,
        'recipientName', case when invoice.recipient_client_id <> invoice.client_id then recipient.name end,
        'grossCents', invoice.gross_cents,
        'updatedAt', invoice.updated_at
      ) order by page.updated_at desc, page.id desc)
      from page
      join public.invoices invoice on invoice.id = page.id and invoice.organization_id = p_organization_id
      join public.clients client on client.id = invoice.client_id and client.organization_id = p_organization_id
      join public.clients recipient
        on recipient.id = invoice.recipient_client_id and recipient.organization_id = p_organization_id
    ), '[]')
  );
$$;
revoke all on function public.list_invoice_page(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_invoice_page(uuid, text, text, integer, integer) to service_role;

-- One invoice of the organization with its lines and the names its page
-- shows; null when the organization has no such invoice.
create function public.get_invoice(p_organization_id uuid, p_invoice_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', invoice.id,
    'invoiceNumber', invoice.invoice_number,
    'status', invoice.status,
    'version', invoice.version,
    'serviceStart', invoice.service_start,
    'serviceEnd', invoice.service_end,
    'paymentDueDays', invoice.payment_due_days,
    'discountDays', invoice.discount_days,
    'discountBasisPoints', invoice.discount_basis_points,
    'orderReference', invoice.order_reference,
    'buyerReference', invoice.buyer_reference,
    'openingText', invoice.opening_text,
    'closingText', invoice.closing_text,
    'lineNetCents', invoice.line_net_cents,
    'taxCents', invoice.tax_cents,
    'grossCents', invoice.gross_cents,
    'client', jsonb_build_object('id', client.id, 'name', client.name),
    'recipient', jsonb_build_object('id', recipient.id, 'name', recipient.name, 'address', recipient.address),
    'work', coalesce(
      (select jsonb_build_object('kind', 'job', 'id', job.id, 'number', job.job_number, 'title', job.title)
        from public.jobs job where job.id = invoice.job_id and job.organization_id = p_organization_id),
      (select jsonb_build_object('kind', 'project', 'id', project.id, 'number', project.project_number,
          'title', project.name)
        from public.projects project
        where project.id = invoice.project_id and project.organization_id = p_organization_id),
      (select jsonb_build_object('kind', 'service_case', 'id', service_case.id,
          'number', service_case.case_number, 'title', service_case.summary)
        from public.service_cases service_case
        where service_case.id = invoice.service_case_id and service_case.organization_id = p_organization_id)
    ),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', line.name,
        'description', line.description,
        'quantity', line.quantity::text,
        'unit', line.unit,
        'unitPriceCents', line.unit_price_cents,
        'priceQuantity', line.price_quantity,
        'taxCategory', line.tax_category,
        'taxRateBasisPoints', line.tax_rate_basis_points,
        'netCents', line.net_cents
      ) order by line.position)
      from public.invoice_lines line
      where line.invoice_id = invoice.id and line.organization_id = p_organization_id
    ), '[]')
  )
  from public.invoices invoice
  join public.clients client on client.id = invoice.client_id and client.organization_id = p_organization_id
  join public.clients recipient
    on recipient.id = invoice.recipient_client_id and recipient.organization_id = p_organization_id
  where invoice.organization_id = p_organization_id and invoice.id = p_invoice_id;
$$;
revoke all on function public.get_invoice(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_invoice(uuid, uuid) to service_role;

-- 5. A customer an invoice names as buyer or Rechnungsempfänger is linked, so
-- the delete guard refuses its deletion first (client_has_history). The
-- body is 20261210130000's with the invoices line added.
create or replace function app_private.client_links(p_organization_id uuid, p_client_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'jobs', nullif((select count(*) from public.jobs link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'projects', nullif((select count(*) from public.projects link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'requests', nullif((select count(*) from public.client_requests link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'service_cases', nullif((select count(*) from public.service_cases link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'equipment', nullif((select count(*) from public.installed_equipment link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'maintenance', nullif((select count(*) from public.maintenance_coverages link
      where link.organization_id = p_organization_id and link.client_id = p_client_id)
      + (select count(*) from public.maintenance_plans link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'documents', nullif((select count(*) from public.document_links link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'follow_ups', nullif((select count(*) from public.client_follow_ups link
      where link.organization_id = p_organization_id and link.client_id = p_client_id), 0),
    'site_roles', nullif((select count(*) from public.client_site_roles link
      where link.organization_id = p_organization_id and link.holder_client_id <> link.client_id
        and (link.client_id = p_client_id or link.holder_client_id = p_client_id)), 0),
    'billing_parties', nullif((select count(distinct link.work_id) from public.work_billing_parties link
      where link.organization_id = p_organization_id
        and (link.client_id = p_client_id or link.recipient_client_id = p_client_id)
        and p_client_id is distinct from coalesce(
          (select request.client_id from public.client_requests request where request.id = link.request_id),
          (select job.client_id from public.jobs job where job.id = link.job_id),
          (select project.client_id from public.projects project where project.id = link.project_id),
          (select service_case.client_id from public.service_cases service_case
            where service_case.id = link.service_case_id))), 0),
    'offers', nullif((select count(*) from public.offers link
      where link.organization_id = p_organization_id
        and (link.client_id = p_client_id or link.recipient_client_id = p_client_id)), 0),
    'invoices', nullif((select count(*) from public.invoices link
      where link.organization_id = p_organization_id
        and (link.client_id = p_client_id or link.recipient_client_id = p_client_id)), 0)
  ));
$$;
