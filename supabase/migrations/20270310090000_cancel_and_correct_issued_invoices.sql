-- „Stornieren“ and „Korrigieren“: the office cancels an issued invoice with a
-- Stornorechnung, or cancels it and opens a new draft prefilled from it; the
-- original never changes (werk-flow/werkflow-planning#459, E2c R6).
--
-- 1. invoices: a Stornorechnung names the invoice it cancels and the reason;
--    a correction draft names the invoice it corrects. Each invoice has at
--    most one of each, and a link never changes after insert.
-- 2. guard_issued_invoice: an issued invoice takes exactly one change, its
--    status from Ausgestellt to Storniert, only while app.invoice_cancel
--    names that invoice and once its issued Stornorechnung exists; on the
--    app's path that is inside cancel_invoice. A link must name the invoice
--    the transaction cancels (app.invoice_cancel). In the app only
--    cancel_invoice sets it; the guard trusts the flag, so a session that
--    sets it directly, as the SQL test and a service-role session can, is
--    the residual of werk-flow/werkflow-planning#515. Every other column
--    stays refused as before.
-- 3. cancel_invoice: in one transaction it copies the original into a
--    Stornorechnung with every line negated, issues it through issue_invoice
--    (the next number of the same series, under the series' row lock), marks
--    the original Storniert, optionally opens the correction draft, and
--    writes the history. The server checks the Stornorechnung with the
--    EN 16931 rules first; the Stornorechnung's original it stored is
--    registered and filed by issue_invoice in the same transaction.
-- 4. get_invoice and list_invoice_page answer the links: the chain of
--    original, Stornorechnung and correction, each with its number.
--
-- The server actions in lib/invoices/ establish identity, role and
-- organization; cancel_invoice checks the actor again under the access lock.
--
-- Expand-only: new nullable columns, a widened event check, a replaced guard
-- with an insert trigger, a new function; get_invoice and list_invoice_page keep their signatures.
--
-- Prevention: Tier 1 (the links' checks and unique indexes, the guard),
-- Tier 2 supabase/tests/invoice_cancel.sql.

-- 1. The links.
alter table public.invoices
  add column cancels_invoice_id uuid,
  add column cancellation_reason text,
  add column corrects_invoice_id uuid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet
alter table public.invoices add constraint invoices_cancellation_check check (
  (cancels_invoice_id is null) = (cancellation_reason is null)
  and (cancellation_reason is null
    or (btrim(cancellation_reason) <> '' and char_length(cancellation_reason) <= 500))
  and num_nonnulls(cancels_invoice_id, corrects_invoice_id) <= 1
) not valid;
-- Every existing row has no link, so the foreign keys are added without a scan.
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet
alter table public.invoices add constraint invoices_cancels_fk foreign key (cancels_invoice_id, organization_id)
  references public.invoices (id, organization_id) not valid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet
alter table public.invoices add constraint invoices_corrects_fk foreign key (corrects_invoice_id, organization_id)
  references public.invoices (id, organization_id) not valid;
-- An invoice is cancelled at most once and corrected by at most one draft.
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet
create unique index invoices_cancels_unique on public.invoices (cancels_invoice_id)
  where cancels_invoice_id is not null;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet
create unique index invoices_corrects_unique on public.invoices (corrects_invoice_id)
  where corrects_invoice_id is not null;

-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice history yet; the widened rule keeps every type it allowed
alter table public.invoice_events drop constraint invoice_events_type_check;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice history yet; the widened rule keeps every type it allowed
alter table public.invoice_events add constraint invoice_events_type_check
  check (event_type in ('created', 'saved', 'deleted', 'issued', 'original_registered', 'cancelled')) not valid;

-- 2. As in 20270205090000_issue_invoices_with_gapless_numbers.sql, with two
-- additions. A link is inserted only for the invoice the transaction cancels
-- (app.invoice_cancel, which the app raises only in cancel_invoice, to that
-- id; the SQL test and a service-role session can set it directly, the
-- residual of werk-flow/werkflow-planning#515), on a new draft without an
-- original, and never changes. While the flag names the invoice (on the
-- app's path, inside cancel_invoice; directly set, the same residual) and
-- once an issued Stornorechnung names it, its status alone turns from
-- Ausgestellt to Storniert; the cancel's actor and time are in its history. Every other rule of R4's guard
-- stays: a work or person reference clears only when its target is gone,
-- an original is named once and only when it is the invoice's ten-year
-- document, filed with its filing record, linked to its customer and to
-- nothing else, with the registration's history, and a draft names none.
-- Security definer as there; no role executes it.
create or replace function app_private.guard_issued_invoice()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_free constant text[] := array[
    'job_id', 'project_id', 'service_case_id', 'created_by', 'updated_by', 'issued_by', 'original_document_id'
  ];
  v_cancelling constant text := coalesce(current_setting('app.invoice_cancel', true), '');
begin
  if tg_op = 'INSERT' then
    if coalesce(new.cancels_invoice_id, new.corrects_invoice_id)::text <> v_cancelling then
      raise exception 'invoice_link_fixed';
    end if;
    -- A linked invoice starts as a draft without an original; issue_invoice and the registration name the rest.
    if num_nonnulls(new.cancels_invoice_id, new.corrects_invoice_id) > 0
      and (new.status <> 'entwurf' or new.original_document_id is not null)
    then
      raise exception 'invoice_issued';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status = 'entwurf' or not exists (
      select 1 from public.organizations organization where organization.id = old.organization_id
    ) then
      return old;
    end if;
    raise exception 'invoice_issued';
  end if;
  if (new.cancels_invoice_id, new.cancellation_reason, new.corrects_invoice_id)
    is distinct from (old.cancels_invoice_id, old.cancellation_reason, old.corrects_invoice_id)
  then
    raise exception 'invoice_link_fixed';
  end if;
  if old.status = 'entwurf' then
    -- A draft has no original; only the registration names one, on an issued invoice.
    if new.original_document_id is not null then
      raise exception 'invoice_issued';
    end if;
    return new;
  end if;
  if old.status = 'ausgestellt' and new.status = 'storniert' and old.id::text = v_cancelling
    and to_jsonb(new) - 'status' = to_jsonb(old) - 'status'
    and exists (
      select 1 from public.invoices storno
      where storno.cancels_invoice_id = old.id and storno.organization_id = old.organization_id
        and storno.status = 'ausgestellt'
    )
  then
    return new;
  end if;
  if to_jsonb(new) - v_free is distinct from to_jsonb(old) - v_free
    or (new.job_id is distinct from old.job_id and (new.job_id is not null or exists (
      select 1 from public.jobs job where job.id = old.job_id and job.organization_id = old.organization_id)))
    or (new.project_id is distinct from old.project_id and (new.project_id is not null or exists (
      select 1 from public.projects project
      where project.id = old.project_id and project.organization_id = old.organization_id)))
    or (new.service_case_id is distinct from old.service_case_id and (new.service_case_id is not null or exists (
      select 1 from public.service_cases service_case
      where service_case.id = old.service_case_id and service_case.organization_id = old.organization_id)))
    or (new.created_by is distinct from old.created_by and (new.created_by is not null
      or exists (select 1 from auth.users person where person.id = old.created_by)))
    or (new.updated_by is distinct from old.updated_by and (new.updated_by is not null
      or exists (select 1 from auth.users person where person.id = old.updated_by)))
    or (new.issued_by is distinct from old.issued_by and (new.issued_by is not null
      or exists (select 1 from auth.users person where person.id = old.issued_by)))
    or (new.original_document_id is distinct from old.original_document_id and (
      old.original_document_id is not null or new.original_document_id is null
      or not exists (
        select 1 from public.documents document
        where document.id = new.original_document_id and document.organization_id = old.organization_id
          and document.filed_at is not null and document.category = 'invoice'
          and document.retention_class = 'ten_years' and document.document_date = old.issue_date
          and document.metadata ->> 'invoiceId' = old.id::text)
      or not exists (
        select 1 from public.invoice_events event
        where event.organization_id = old.organization_id and event.invoice_id = old.id
          and event.event_type = 'original_registered' and event.attempt_key = new.original_document_id)
      or not exists (
        select 1 from public.document_audit_events audit
        where audit.organization_id = old.organization_id and audit.document_id = new.original_document_id
          and audit.event_type = 'filed')
      or not exists (
        select 1 from public.document_links link
        where link.document_id = new.original_document_id and link.organization_id = old.organization_id
          and link.client_id = old.client_id)
      or exists (
        select 1 from public.document_links link
        where link.document_id = new.original_document_id and link.organization_id = old.organization_id
          and (link.client_id is distinct from old.client_id or num_nonnulls(link.job_id, link.project_id,
            link.employee_id, link.request_id, link.equipment_id, link.service_case_id,
            link.maintenance_coverage_id) > 0))))
  then
    raise exception 'invoice_issued';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_issued_invoice() from public, anon, authenticated, service_role;
create trigger guard_invoice_links before insert on public.invoices
  for each row execute function app_private.guard_issued_invoice();

-- 3. Cancels an issued invoice with a Stornorechnung: the original's lines
-- negated, each with its catalog source, its Leistungszeitraum, references,
-- customer and Rechnungsempfänger, the snapshot it was issued with, nothing
-- due, and the reason. issue_invoice gives it the series' next number and
-- today's Rechnungsdatum. The original becomes Storniert. With p_correct a
-- new draft prefilled from the original, its lines with their catalog
-- sources, names it as the invoice it corrects; its Rechnungsempfänger follows
-- create_invoice's rule, so a recipient corrected on the work since applies.
-- An original with a negative total (a credit) is not cancelled: its
-- Stornorechnung would ask for payment. A retry under the same key answers
-- the first call. p_expected_number and p_expected_issue_date are the number
-- and Rechnungsdatum the server checked the Stornorechnung under; the head of
-- its original prints the number, so another number refuses
-- (invoice_number_moved) and the server checks again. The p_original_*
-- arguments name the Stornorechnung's original the server rendered under that
-- number and day and stored; issue_invoice registers and files it in this
-- transaction, or leaves it pending without them. Answers stornoId,
-- stornoNumber, issueDate, correctionId and the Stornorechnung's registered
-- originalDocumentId; a retry registers nothing and answers the one it has.
-- Refusals: invalid_input, not_authorized, invoice_not_found,
-- invoice_not_issued, invoice_cancelled, invoice_is_storno,
-- invoice_not_cancellable, invoice_numbers_exhausted (a used-up series, for
-- which the server sends an empty number), invoice_number_moved, and those of
-- register_invoice_original.
create function public.cancel_invoice(
  p_actor_id uuid,
  p_organization_id uuid,
  p_invoice_id uuid,
  p_attempt_key uuid,
  p_reason text,
  p_correct boolean,
  p_expected_number text,
  p_expected_issue_date date,
  p_original_document_id uuid default null,
  p_original_storage_path text default null,
  p_original_file_name text default null,
  p_original_size_bytes bigint default null,
  p_original_content_hash text default null
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_reason text := btrim(p_reason);
  v_earlier public.invoice_events;
  v_original public.invoices;
  v_storno_id uuid;
  v_issued jsonb;
  v_correction_id uuid;
  v_parties public.work_billing_parties;
  v_settings public.invoice_settings;
  v_issue_date date;
  v_year integer;
  v_sequence integer;
  v_answer jsonb;
begin
  if p_actor_id is null or p_organization_id is null or p_invoice_id is null or p_attempt_key is null
    or p_correct is null or coalesce(v_reason, '') = '' or char_length(v_reason) > 500
    or p_expected_number is null or p_expected_issue_date is null
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  v_earlier := app_private.invoice_attempt(p_organization_id, p_actor_id, p_attempt_key);
  if v_earlier.id is not null then
    if v_earlier.event_type <> 'cancelled' or v_earlier.invoice_id <> p_invoice_id then
      raise exception 'invalid_input';
    end if;
    return v_earlier.payload || jsonb_build_object('originalDocumentId', (
      select storno.original_document_id from public.invoices storno
      where storno.id = (v_earlier.payload ->> 'stornoId')::uuid and storno.organization_id = p_organization_id
    ));
  end if;
  -- The invoice's work before the invoice: deleting a work locks its row, then clears the invoice's
  -- reference, and the Stornorechnung and correction take this key share for the same reference below,
  -- so taking it only after the invoice's lock could deadlock with that deletion. The read without a
  -- lock names the work; after the invoice's lock a reference is the same or, its work deleted, cleared.
  select * into v_original from public.invoices invoice
  where invoice.id = p_invoice_id and invoice.organization_id = p_organization_id;
  perform 1 from public.projects project
  where project.id = v_original.project_id and project.organization_id = p_organization_id
  for key share;
  perform 1 from public.service_cases service_case
  where service_case.id = v_original.service_case_id and service_case.organization_id = p_organization_id
  for key share;
  perform 1 from public.jobs job
  where job.id = v_original.job_id and job.organization_id = p_organization_id
  for key share;
  select * into v_original from public.invoices invoice
  where invoice.id = p_invoice_id and invoice.organization_id = p_organization_id
  for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if v_original.status = 'entwurf' then raise exception 'invoice_not_issued'; end if;
  if v_original.status = 'storniert' then raise exception 'invoice_cancelled'; end if;
  if v_original.cancels_invoice_id is not null then raise exception 'invoice_is_storno'; end if;
  if v_original.gross_cents < 0 then raise exception 'invoice_not_cancellable'; end if;
  -- The series' row lock, which issue_invoice takes again below, holds the number checked here.
  select * into v_settings from public.invoice_settings settings
  where settings.organization_id = p_organization_id
  for update;
  -- The day once the lock is held, as issue_invoice reads it, not when the transaction began.
  v_issue_date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_year := extract(year from v_issue_date)::integer;
  v_sequence := app_private.next_invoice_sequence(v_settings, v_year);
  -- A used-up series has no number for the Stornorechnung; the server sends an empty number then.
  if v_sequence >= 999999999 then
    raise exception 'invoice_numbers_exhausted';
  end if;
  if v_issue_date is distinct from p_expected_issue_date
    or app_private.format_invoice_number(v_settings, v_year, v_sequence) is distinct from p_expected_number
  then
    raise exception 'invoice_number_moved';
  end if;
  perform set_config('app.invoice_cancel', v_original.id::text, true);

  insert into public.invoices (
    organization_id, client_id, recipient_client_id, job_id, project_id, service_case_id,
    service_start, service_end, payment_due_days, order_reference, buyer_reference,
    line_net_cents, tax_cents, gross_cents, cancels_invoice_id, cancellation_reason, created_by, updated_by
  ) values (
    p_organization_id, v_original.client_id, v_original.recipient_client_id, v_original.job_id,
    v_original.project_id, v_original.service_case_id, v_original.service_start, v_original.service_end,
    0, v_original.order_reference, v_original.buyer_reference,
    -v_original.line_net_cents, -v_original.tax_cents, -v_original.gross_cents,
    v_original.id, v_reason, p_actor_id, p_actor_id
  )
  returning id into v_storno_id;
  -- Negating the quantity negates each line amount and each tax sum exactly:
  -- the line rule rounds half away from zero, symmetric around zero.
  insert into public.invoice_lines (
    organization_id, invoice_id, position, name, description, quantity, unit, unit_price_cents,
    price_quantity, tax_category, tax_rate_basis_points, net_cents, leistung_id, item_id
  )
  select p_organization_id, v_storno_id, line.position, line.name, line.description, -line.quantity, line.unit,
    line.unit_price_cents, line.price_quantity, line.tax_category, line.tax_rate_basis_points, -line.net_cents,
    line.leistung_id, line.item_id
  from public.invoice_lines line
  where line.invoice_id = v_original.id and line.organization_id = p_organization_id;
  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_storno_id, 'created', 'entwurf', 1,
    jsonb_build_object('cancelsInvoiceId', v_original.id), p_actor_id, gen_random_uuid()
  );
  v_issued := public.issue_invoice(
    p_actor_id, p_organization_id, v_storno_id, 1, gen_random_uuid(), v_original.issue_snapshot,
    p_expected_number, p_expected_issue_date, p_original_document_id, p_original_storage_path,
    p_original_file_name, p_original_size_bytes, p_original_content_hash
  );

  update public.invoices invoice set status = 'storniert'
  where invoice.id = v_original.id and invoice.organization_id = p_organization_id;

  if p_correct then
    if coalesce(v_original.job_id, v_original.project_id, v_original.service_case_id) is not null then
      v_parties := app_private.current_work_billing_parties(p_organization_id,
        coalesce(v_original.job_id, v_original.project_id, v_original.service_case_id));
    end if;
    insert into public.invoices (
      organization_id, client_id, recipient_client_id, job_id, project_id, service_case_id,
      service_start, service_end, payment_due_days, discount_days, discount_basis_points,
      order_reference, buyer_reference, opening_text, closing_text,
      line_net_cents, tax_cents, gross_cents, corrects_invoice_id, created_by, updated_by
    ) values (
      p_organization_id, v_original.client_id,
      case when v_parties.client_id = v_original.client_id then v_parties.recipient_client_id
        else v_original.client_id end,
      v_original.job_id, v_original.project_id, v_original.service_case_id, v_original.service_start,
      v_original.service_end, v_original.payment_due_days, v_original.discount_days, v_original.discount_basis_points,
      v_original.order_reference, v_original.buyer_reference, v_original.opening_text, v_original.closing_text,
      v_original.line_net_cents, v_original.tax_cents, v_original.gross_cents, v_original.id,
      p_actor_id, p_actor_id
    )
    returning id into v_correction_id;
    insert into public.invoice_lines (
      organization_id, invoice_id, position, name, description, quantity, unit, unit_price_cents,
      price_quantity, tax_category, tax_rate_basis_points, net_cents, leistung_id, item_id
    )
    select p_organization_id, v_correction_id, line.position, line.name, line.description, line.quantity,
      line.unit, line.unit_price_cents, line.price_quantity, line.tax_category, line.tax_rate_basis_points,
      line.net_cents, line.leistung_id, line.item_id
    from public.invoice_lines line
    where line.invoice_id = v_original.id and line.organization_id = p_organization_id;
    insert into public.invoice_events (
      organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
    ) values (
      p_organization_id, v_correction_id, 'created', 'entwurf', 1,
      jsonb_build_object('correctsInvoiceId', v_original.id), p_actor_id, gen_random_uuid()
    );
  end if;

  v_answer := jsonb_build_object(
    'stornoId', v_storno_id,
    'stornoNumber', v_issued ->> 'invoiceNumber',
    'issueDate', v_issued ->> 'issueDate',
    'correctionId', v_correction_id
  );
  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_original.id, 'cancelled', 'storniert', v_original.version, v_answer,
    p_actor_id, p_attempt_key
  );
  perform set_config('app.invoice_cancel', '', true);
  return v_answer || jsonb_build_object('originalDocumentId', v_issued -> 'originalDocumentId');
end;
$$;
revoke all on function public.cancel_invoice(uuid, uuid, uuid, uuid, text, boolean, text, date, uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.cancel_invoice(uuid, uuid, uuid, uuid, text, boolean, text, date, uuid, text, text, bigint, text)
  to service_role;

-- 4. Every invoice linked to p_invoice_id through Stornos and corrections,
-- from the first original on: generation by generation, each original
-- before its Stornorechnung before its correction. A lone invoice answers
-- itself alone.
create function app_private.invoice_chain(p_organization_id uuid, p_invoice_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $$
  with recursive ancestors(id, parent_id) as (
    select invoice.id, coalesce(invoice.cancels_invoice_id, invoice.corrects_invoice_id)
    from public.invoices invoice
    where invoice.id = p_invoice_id and invoice.organization_id = p_organization_id
    union
    select parent.id, coalesce(parent.cancels_invoice_id, parent.corrects_invoice_id)
    from public.invoices parent
    join ancestors on parent.id = ancestors.parent_id
    where parent.organization_id = p_organization_id
  ), chain(id, generation, rank) as (
    select ancestors.id, 0, 0 from ancestors where ancestors.parent_id is null
    union
    select child.id, chain.generation + 1, case when child.cancels_invoice_id is not null then 0 else 1 end
    from public.invoices child
    join chain on chain.id in (child.cancels_invoice_id, child.corrects_invoice_id)
    where child.organization_id = p_organization_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', invoice.id,
    'invoiceNumber', invoice.invoice_number,
    'status', invoice.status,
    'kind', case
      when invoice.cancels_invoice_id is not null then 'storno'
      when invoice.corrects_invoice_id is not null then 'korrektur'
      else 'rechnung'
    end,
    'issueDate', invoice.issue_date
  ) order by chain.generation, chain.rank), '[]')
  from chain
  join public.invoices invoice on invoice.id = chain.id and invoice.organization_id = p_organization_id;
$$;
revoke all on function app_private.invoice_chain(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.invoice_chain(uuid, uuid) to service_role;

-- The links join the answer: the invoice a Stornorechnung cancels with its
-- number and Rechnungsdatum, the reason, and the chain. Otherwise as in
-- 20270205090000_issue_invoices_with_gapless_numbers.sql.
create or replace function public.get_invoice(p_organization_id uuid, p_invoice_id uuid)
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
    'issueDate', invoice.issue_date,
    'issueSnapshot', invoice.issue_snapshot,
    'original', (select jsonb_build_object('documentId', document.id, 'filed', document.filed_at is not null)
      from public.documents document
      where document.id = invoice.original_document_id and document.organization_id = p_organization_id),
    'cancels', (select jsonb_build_object('id', cancelled.id, 'invoiceNumber', cancelled.invoice_number,
        'issueDate', cancelled.issue_date)
      from public.invoices cancelled
      where cancelled.id = invoice.cancels_invoice_id and cancelled.organization_id = p_organization_id),
    'cancellationReason', invoice.cancellation_reason,
    'chain', app_private.invoice_chain(p_organization_id, invoice.id),
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

-- A row names the invoice its Stornorechnung or correction refers to, and the
-- search finds a Stornorechnung and a correction by that number too.
-- Otherwise as in 20261219100000_keep_invoice_drafts_with_their_lines_and_totals.sql.
create or replace function public.list_invoice_page(
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
    left join public.invoices referred
      on referred.id = coalesce(invoice.cancels_invoice_id, invoice.corrects_invoice_id)
      and referred.organization_id = p_organization_id
    where invoice.organization_id = p_organization_id
      and (p_status is null or invoice.status = p_status)
      and (
        coalesce(p_search, '') = ''
        or strpos(lower(concat_ws(' ', invoice.invoice_number, client.name, recipient.name,
          referred.invoice_number)), lower(p_search)) > 0
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
        'updatedAt', invoice.updated_at,
        'refersTo', case when referred.id is not null then jsonb_build_object(
          'kind', case when invoice.cancels_invoice_id is not null then 'storno' else 'korrektur' end,
          'invoiceNumber', referred.invoice_number) end
      ) order by page.updated_at desc, page.id desc)
      from page
      join public.invoices invoice on invoice.id = page.id and invoice.organization_id = p_organization_id
      join public.clients client on client.id = invoice.client_id and client.organization_id = p_organization_id
      join public.clients recipient
        on recipient.id = invoice.recipient_client_id and recipient.organization_id = p_organization_id
      left join public.invoices referred
        on referred.id = coalesce(invoice.cancels_invoice_id, invoice.corrects_invoice_id)
        and referred.organization_id = p_organization_id
    ), '[]')
  );
$$;
revoke all on function public.list_invoice_page(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.list_invoice_page(uuid, text, text, integer, integer) to service_role;
