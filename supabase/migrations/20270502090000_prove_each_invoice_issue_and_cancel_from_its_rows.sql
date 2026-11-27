-- The invoice guards check the rows an issue or a cancel leaves, never a
-- transaction flag (werk-flow/werkflow-planning#515, E2c). Until now the
-- series moved and an issued invoice turned Storniert while a session setting
-- said so (app.invoice_number_write, app.invoice_cancel), a draft became
-- issued by any direct update, and a direct insert could write an issued
-- invoice. A session holding the service role could set either flag itself.
--
-- 1. guard_invoice_series: from the first issue on, the number moves only by
--    one step past the number an issued invoice of this organization holds,
--    in that invoice's year, and stays with its organization. At rest no
--    issued invoice holds the series' next number, so no direct write moves it.
-- 2. advance_invoice_series: the step itself. Issuing a draft moves the
--    series in the same statement, under its row lock, and only when the
--    invoice took the series' next number in a year the series has not left.
--    So the series and the issued numbers never part.
-- 3. guard_issued_invoice: every insert is a draft without an original. A
--    draft turns Ausgestellt only as issue_invoice leaves it: its issue
--    history entry written first, the Berlin day, a complete draft, an office
--    actor, only the issue columns changed; a Stornorechnung only as the
--    exact negation of the issued invoice it cancels. A link to an invoice,
--    and Ausgestellt to Storniert, only as cancel_invoice leaves them: its
--    history entry, written first, names the Stornorechnung and the
--    correction, and the Stornorechnung is issued before the original turns.
-- 4. check_invoice_history_kept: at commit, an issue's or a cancel's history
--    entry stands only beside the rows it names, so a half-done issue or
--    cancel rolls back.
-- 5. issue_invoice and cancel_invoice write their history entry first and
--    no longer set a flag; issue_invoice leaves the series to step 2.
--
-- A direct write passes a guard only by leaving every row the function
-- leaves, after the same checks on stored data; the function's server-side
-- checks of the snapshot and the rendered original stay the server's, as they
-- were.
--
-- Expand-only: replaced guards and functions with their signatures, two new
-- trigger functions, three new triggers.
--
-- Prevention: Tier 1 (the guards), Tier 2 supabase/tests/invoice_issue.sql
-- and supabase/tests/invoice_cancel.sql.

-- 1. The series. Security invoker as before: it reads only what service_role reads.
create or replace function app_private.guard_invoice_series()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_sequence integer;
begin
  if tg_op = 'DELETE' then
    if old.first_issued_at is null or not exists (
      select 1 from public.organizations organization where organization.id = old.organization_id
    ) then
      return old;
    end if;
    raise exception 'invoice_numbers_fixed';
  end if;
  -- Only the first issue fixes the series.
  if tg_op = 'INSERT' then
    if new.first_issued_at is not null then
      raise exception 'invoice_numbers_fixed';
    end if;
    return new;
  end if;
  -- The series stays with its organization.
  if new.organization_id is distinct from old.organization_id then
    raise exception 'invoice_numbers_fixed';
  end if;
  -- Before the first issue the Admin sets the series freely.
  if old.first_issued_at is null and new.first_issued_at is null then
    return new;
  end if;
  if (new.number_prefix, new.number_with_year, new.number_min_digits)
      is distinct from (old.number_prefix, old.number_with_year, old.number_min_digits)
    or new.first_issued_at is null
    or (old.first_issued_at is not null and new.first_issued_at is distinct from old.first_issued_at)
  then
    raise exception 'invoice_numbers_fixed';
  end if;
  if (new.next_number, new.number_year, new.first_issued_at)
    is not distinct from (old.next_number, old.number_year, old.first_issued_at)
  then
    return new;
  end if;
  -- One step past the number an issued invoice of that year holds. The year never goes back: an
  -- earlier year's numbers are issued.
  v_sequence := app_private.next_invoice_sequence(old, new.number_year);
  if new.number_year is null or new.number_year < coalesce(old.number_year, new.number_year)
    or new.next_number is distinct from v_sequence + 1
    or not exists (
      select 1 from public.invoices invoice
      where invoice.organization_id = old.organization_id
        and invoice.invoice_number = app_private.format_invoice_number(old, new.number_year, v_sequence)
        and invoice.status <> 'entwurf'
        and extract(year from invoice.issue_date) = new.number_year)
  then
    raise exception 'invoice_numbers_fixed';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_invoice_series() from public, anon, authenticated, service_role;
create trigger guard_invoice_series_insert before insert on public.invoice_settings
  for each row execute function app_private.guard_invoice_series();

-- 2. Issuing a draft takes the series' next number, and the series steps past
-- it. The row lock waits for another issue in flight; issue_invoice holds it
-- already. Refusal: invoice_number_moved.
create function app_private.advance_invoice_series()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_settings public.invoice_settings;
  v_year constant integer := extract(year from new.issue_date)::integer;
  v_sequence integer;
begin
  select * into v_settings from public.invoice_settings settings
  where settings.organization_id = new.organization_id
  for update;
  v_sequence := app_private.next_invoice_sequence(v_settings, v_year);
  if v_settings.organization_id is null or v_year < coalesce(v_settings.number_year, v_year)
    or v_sequence >= 999999999
    or new.invoice_number is distinct from app_private.format_invoice_number(v_settings, v_year, v_sequence)
  then
    raise exception 'invoice_number_moved';
  end if;
  update public.invoice_settings settings set
    next_number = v_sequence + 1,
    number_year = v_year,
    first_issued_at = coalesce(settings.first_issued_at, now()),
    -- The first issue fixes the series: a settings form opened before it is stale.
    version = settings.version + case when settings.first_issued_at is null then 1 else 0 end
  where settings.organization_id = new.organization_id;
  return null;
end;
$$;
revoke all on function app_private.advance_invoice_series() from public, anon, authenticated, service_role;
create trigger advance_invoice_series after update on public.invoices
  for each row when (old.status = 'entwurf' and new.status <> 'entwurf')
  execute function app_private.advance_invoice_series();

-- 3. As in 20270310090000_cancel_and_correct_issued_invoices.sql, with every
-- flag replaced by the rows the function leaves. Every other rule stays: a
-- link never changes, a work or person reference clears only when its target
-- is gone, an original is named once and only as register_invoice_original
-- leaves it, and an issued invoice is never deleted while its organization
-- exists. Security definer as there: service_role cannot read auth.users,
-- and lock_office_actor reads the access lifecycle; no role executes it.
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
  -- What issue_invoice writes on a draft.
  v_issue constant text[] := array[
    'status', 'invoice_number', 'issue_date', 'issued_at', 'issued_by', 'issue_snapshot', 'logo_storage_path',
    'stationery_first_storage_path', 'stationery_following_storage_path', 'version', 'updated_by', 'updated_at'
  ];
  v_cancelled public.invoices;
  v_event public.invoice_events;
begin
  if tg_op = 'INSERT' then
    -- Every invoice starts as a draft without an original; issue_invoice and the registration name the rest.
    if new.status <> 'entwurf' or new.original_document_id is not null then
      raise exception 'invoice_issued';
    end if;
    -- A Stornorechnung only for an issued invoice that is neither a Stornorechnung nor a credit, and a
    -- correction only for an invoice with its issued Stornorechnung; cancel_invoice's history entry,
    -- written first, names each by its id.
    if new.cancels_invoice_id is not null and (
      not exists (
        select 1 from public.invoices cancelled
        where cancelled.id = new.cancels_invoice_id and cancelled.organization_id = new.organization_id
          and cancelled.status = 'ausgestellt' and cancelled.cancels_invoice_id is null
          and cancelled.gross_cents >= 0)
      or not exists (
        select 1 from public.invoice_events event
        where event.organization_id = new.organization_id and event.invoice_id = new.cancels_invoice_id
          and event.event_type = 'cancelled' and event.payload ->> 'stornoId' = new.id::text))
    then
      raise exception 'invoice_link_fixed';
    end if;
    if new.corrects_invoice_id is not null and (
      not exists (
        select 1 from public.invoices storno
        where storno.cancels_invoice_id = new.corrects_invoice_id and storno.organization_id = new.organization_id
          and storno.status = 'ausgestellt')
      or not exists (
        select 1 from public.invoice_events event
        where event.organization_id = new.organization_id and event.invoice_id = new.corrects_invoice_id
          and event.event_type = 'cancelled' and event.payload ->> 'correctionId' = new.id::text))
    then
      raise exception 'invoice_link_fixed';
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
    if new.status = 'entwurf' then
      return new;
    end if;
    -- The series' row lock first, as issue_invoice takes it, before this row takes its number.
    perform 1 from public.invoice_settings settings where settings.organization_id = old.organization_id for update;
    -- Today's Berlin day, as issue_invoice checked it under that lock: past midnight the server checks again.
    if new.issue_date is distinct from (clock_timestamp() at time zone 'Europe/Berlin')::date then
      raise exception 'invoice_number_moved';
    end if;
    -- The issue, as issue_invoice leaves it: its history entry first, a complete draft, the checked
    -- snapshot's parts, only the issue columns. advance_invoice_series checks the number.
    if new.status <> 'ausgestellt' or new.version <> old.version + 1
      or to_jsonb(new) - v_issue is distinct from to_jsonb(old) - v_issue
      or new.issued_by is null or new.updated_by is distinct from new.issued_by
      or new.issued_at is distinct from now()
      or jsonb_typeof(new.issue_snapshot -> 'profile') is distinct from 'object'
      or jsonb_typeof(new.issue_snapshot -> 'buyer') is distinct from 'object'
      or jsonb_typeof(new.issue_snapshot -> 'files') is distinct from 'object'
      or new.service_start is null
      or not exists (
        select 1 from public.invoice_lines line
        where line.invoice_id = old.id and line.organization_id = old.organization_id)
      or not exists (
        select 1 from public.invoice_events event
        where event.organization_id = old.organization_id and event.invoice_id = old.id
          and event.event_type = 'issued' and event.status = 'ausgestellt' and event.version = new.version
          and event.actor_id = new.issued_by
          and event.payload -> 'invoiceNumber' = to_jsonb(new.invoice_number)
          and event.payload -> 'issueDate' = to_jsonb(new.issue_date)
          and event.payload -> 'grossCents' = to_jsonb(new.gross_cents))
    then
      raise exception 'invoice_issued';
    end if;
    perform app_private.lock_office_actor(old.organization_id, new.issued_by);
    -- A Stornorechnung is the invoice it cancels negated, still issued, with its parties, work, period,
    -- references and snapshot, nothing due and no texts, as cancel_invoice writes it.
    if new.cancels_invoice_id is not null then
      select * into v_cancelled from public.invoices cancelled
      where cancelled.id = new.cancels_invoice_id and cancelled.organization_id = new.organization_id;
      if v_cancelled.status is distinct from 'ausgestellt'
        or (new.client_id, new.recipient_client_id, new.job_id, new.project_id, new.service_case_id,
            new.service_start, new.service_end, new.order_reference, new.buyer_reference, new.issue_snapshot,
            -new.line_net_cents, -new.tax_cents, -new.gross_cents)
          is distinct from (v_cancelled.client_id, v_cancelled.recipient_client_id, v_cancelled.job_id,
            v_cancelled.project_id, v_cancelled.service_case_id, v_cancelled.service_start, v_cancelled.service_end,
            v_cancelled.order_reference, v_cancelled.buyer_reference, v_cancelled.issue_snapshot,
            v_cancelled.line_net_cents, v_cancelled.tax_cents, v_cancelled.gross_cents)
        or (new.payment_due_days, new.discount_days, new.discount_basis_points, new.opening_text, new.closing_text)
          is distinct from (0, null::integer, null::integer, '', '')
        or exists (
          (select line.position, line.name, line.description, -line.quantity, line.unit, line.unit_price_cents,
              line.price_quantity, line.tax_category, line.tax_rate_basis_points, -line.net_cents
            from public.invoice_lines line
            where line.invoice_id = v_cancelled.id and line.organization_id = new.organization_id)
          except
          (select line.position, line.name, line.description, line.quantity, line.unit, line.unit_price_cents,
              line.price_quantity, line.tax_category, line.tax_rate_basis_points, line.net_cents
            from public.invoice_lines line
            where line.invoice_id = new.id and line.organization_id = new.organization_id))
        or exists (
          (select line.position, line.name, line.description, line.quantity, line.unit, line.unit_price_cents,
              line.price_quantity, line.tax_category, line.tax_rate_basis_points, line.net_cents
            from public.invoice_lines line
            where line.invoice_id = new.id and line.organization_id = new.organization_id)
          except
          (select line.position, line.name, line.description, -line.quantity, line.unit, line.unit_price_cents,
              line.price_quantity, line.tax_category, line.tax_rate_basis_points, -line.net_cents
            from public.invoice_lines line
            where line.invoice_id = v_cancelled.id and line.organization_id = new.organization_id))
      then
        raise exception 'invoice_issued';
      end if;
    end if;
    return new;
  end if;
  -- Ausgestellt to Storniert, status alone, once cancel_invoice's history entry names an issued
  -- Stornorechnung of this invoice. The cancel's actor and time are in that entry.
  if old.status = 'ausgestellt' and new.status = 'storniert' and to_jsonb(new) - 'status' = to_jsonb(old) - 'status' then
    select event.* into v_event from public.invoice_events event
    join public.invoices storno
      on storno.cancels_invoice_id = old.id and storno.organization_id = old.organization_id
      and storno.status = 'ausgestellt' and event.payload ->> 'stornoId' = storno.id::text
    where event.organization_id = old.organization_id and event.invoice_id = old.id
      and event.event_type = 'cancelled' and event.status = 'storniert';
    if v_event.id is not null then
      perform app_private.lock_office_actor(old.organization_id, v_event.actor_id);
      return new;
    end if;
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

-- 4. An issue's or a cancel's history entry, written first, stands only beside the rows it names: checked
-- at commit, so a transaction that wrote the entry but left the issue or cancel unfinished rolls back. A
-- cancel's entry names its Storniert invoice, its issued Stornorechnung with that number and day, and the
-- correction draft it opened, if any. Refusal: invoice_history_unkept.
create function app_private.check_invoice_history_kept()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if new.event_type = 'issued' and not exists (
    select 1 from public.invoices invoice
    where invoice.id = new.invoice_id and invoice.organization_id = new.organization_id
      and invoice.status <> 'entwurf' and invoice.issued_by is not distinct from new.actor_id
      and new.payload -> 'invoiceNumber' = to_jsonb(invoice.invoice_number)
      and new.payload -> 'issueDate' = to_jsonb(invoice.issue_date))
  then
    raise exception 'invoice_history_unkept';
  end if;
  if new.event_type = 'cancelled' and (
    not exists (
      select 1 from public.invoices original
      where original.id = new.invoice_id and original.organization_id = new.organization_id
        and original.status = 'storniert')
    or not exists (
      select 1 from public.invoices storno
      where storno.id::text = new.payload ->> 'stornoId' and storno.organization_id = new.organization_id
        and storno.cancels_invoice_id = new.invoice_id and storno.status = 'ausgestellt'
        and new.payload -> 'stornoNumber' = to_jsonb(storno.invoice_number)
        and new.payload -> 'issueDate' = to_jsonb(storno.issue_date))
    or (coalesce(new.payload -> 'correctionId', 'null') <> 'null' and not exists (
      select 1 from public.invoices correction
      where correction.id::text = new.payload ->> 'correctionId' and correction.organization_id = new.organization_id
        and correction.corrects_invoice_id = new.invoice_id)))
  then
    raise exception 'invoice_history_unkept';
  end if;
  return null;
end;
$$;
revoke all on function app_private.check_invoice_history_kept() from public, anon, authenticated, service_role;
create constraint trigger invoice_history_kept after insert on public.invoice_events
  deferrable initially deferred
  for each row when (new.event_type in ('issued', 'cancelled'))
  execute function app_private.check_invoice_history_kept();

-- 5. As in 20270205090000_issue_invoices_with_gapless_numbers.sql, except
-- that the history entry comes first, as guard_issued_invoice requires, and
-- the issue's own update moves the series (advance_invoice_series).
create or replace function public.issue_invoice(
  p_actor_id uuid,
  p_organization_id uuid,
  p_invoice_id uuid,
  p_expected_version integer,
  p_attempt_key uuid,
  p_snapshot jsonb,
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
  v_earlier public.invoice_events;
  v_invoice public.invoices;
  v_settings public.invoice_settings;
  v_issue_date date;
  v_year integer;
  v_sequence integer;
  v_number text;
begin
  if p_actor_id is null or p_organization_id is null or p_invoice_id is null or p_attempt_key is null
    or p_expected_version is null or jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_snapshot -> 'profile') is distinct from 'object'
    or jsonb_typeof(p_snapshot -> 'buyer') is distinct from 'object'
    or jsonb_typeof(p_snapshot -> 'files') is distinct from 'object'
    or p_expected_number is null or p_expected_issue_date is null
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  v_earlier := app_private.invoice_attempt(p_organization_id, p_actor_id, p_attempt_key);
  if v_earlier.id is not null then
    if v_earlier.event_type <> 'issued' or v_earlier.invoice_id <> p_invoice_id then
      raise exception 'invalid_input';
    end if;
    return v_earlier.payload || jsonb_build_object('version', v_earlier.version,
      'originalDocumentId', (select invoice.original_document_id from public.invoices invoice
        where invoice.id = p_invoice_id and invoice.organization_id = p_organization_id));
  end if;
  v_invoice := app_private.lock_invoice_draft(p_organization_id, p_invoice_id, p_expected_version);
  if v_invoice.service_start is null or not exists (
    select 1 from public.invoice_lines line
    where line.invoice_id = v_invoice.id and line.organization_id = p_organization_id
  ) then
    raise exception 'invoice_incomplete';
  end if;

  insert into public.invoice_settings (organization_id) values (p_organization_id)
  on conflict (organization_id) do nothing;
  select * into v_settings from public.invoice_settings settings
  where settings.organization_id = p_organization_id
  for update;
  -- The day once the lock is held, not when the transaction began: an issue that waited across
  -- midnight on New Year's Eve must not write the series back to the old year.
  v_issue_date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_year := extract(year from v_issue_date)::integer;
  v_sequence := app_private.next_invoice_sequence(v_settings, v_year);
  v_number := app_private.format_invoice_number(v_settings, v_year, v_sequence);
  if v_sequence >= 999999999 then
    raise exception 'invoice_numbers_exhausted';
  end if;
  if v_number is distinct from p_expected_number or v_issue_date is distinct from p_expected_issue_date then
    raise exception 'invoice_number_moved';
  end if;

  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_invoice.id, 'issued', 'ausgestellt', v_invoice.version + 1,
    jsonb_build_object('invoiceNumber', v_number, 'issueDate', v_issue_date,
      'grossCents', v_invoice.gross_cents),
    p_actor_id, p_attempt_key
  );
  update public.invoices invoice set
    status = 'ausgestellt',
    invoice_number = v_number,
    issue_date = v_issue_date,
    issued_at = now(),
    issued_by = p_actor_id,
    issue_snapshot = p_snapshot,
    logo_storage_path = p_snapshot #>> '{files,logo,path}',
    stationery_first_storage_path = p_snapshot #>> '{files,stationery_first,path}',
    stationery_following_storage_path = p_snapshot #>> '{files,stationery_following,path}',
    version = invoice.version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where invoice.id = v_invoice.id and invoice.organization_id = p_organization_id
    and invoice.version = p_expected_version;

  if p_original_document_id is not null then
    perform public.register_invoice_original(p_actor_id, p_organization_id, v_invoice.id, p_original_document_id,
      p_original_storage_path, p_original_file_name, p_original_size_bytes, p_original_content_hash);
  end if;
  return jsonb_build_object('invoiceNumber', v_number, 'issueDate', v_issue_date,
    'grossCents', v_invoice.gross_cents, 'version', v_invoice.version + 1,
    'originalDocumentId', p_original_document_id);
end;
$$;
revoke all on function public.issue_invoice(uuid, uuid, uuid, integer, uuid, jsonb, text, date, uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.issue_invoice(uuid, uuid, uuid, integer, uuid, jsonb, text, date, uuid, text, text, bigint, text)
  to service_role;

-- As in 20270310090000_cancel_and_correct_issued_invoices.sql, except that the
-- history entry comes first and names the Stornorechnung and the correction
-- by the ids they are then inserted under, as guard_issued_invoice requires.
-- The answer it records is the number and day checked under the series' row
-- lock, which issue_invoice then gives the Stornorechnung or refuses.
create or replace function public.cancel_invoice(
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
  v_number text;
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
  v_number := app_private.format_invoice_number(v_settings, v_year, v_sequence);
  if v_issue_date is distinct from p_expected_issue_date or v_number is distinct from p_expected_number then
    raise exception 'invoice_number_moved';
  end if;

  v_storno_id := gen_random_uuid();
  v_correction_id := case when p_correct then gen_random_uuid() end;
  v_answer := jsonb_build_object(
    'stornoId', v_storno_id,
    'stornoNumber', v_number,
    'issueDate', v_issue_date,
    'correctionId', v_correction_id
  );
  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_original.id, 'cancelled', 'storniert', v_original.version, v_answer,
    p_actor_id, p_attempt_key
  );

  insert into public.invoices (
    id, organization_id, client_id, recipient_client_id, job_id, project_id, service_case_id,
    service_start, service_end, payment_due_days, order_reference, buyer_reference,
    line_net_cents, tax_cents, gross_cents, cancels_invoice_id, cancellation_reason, created_by, updated_by
  ) values (
    v_storno_id, p_organization_id, v_original.client_id, v_original.recipient_client_id, v_original.job_id,
    v_original.project_id, v_original.service_case_id, v_original.service_start, v_original.service_end,
    0, v_original.order_reference, v_original.buyer_reference,
    -v_original.line_net_cents, -v_original.tax_cents, -v_original.gross_cents,
    v_original.id, v_reason, p_actor_id, p_actor_id
  );
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

  if p_correct then
    if coalesce(v_original.job_id, v_original.project_id, v_original.service_case_id) is not null then
      v_parties := app_private.current_work_billing_parties(p_organization_id,
        coalesce(v_original.job_id, v_original.project_id, v_original.service_case_id));
    end if;
    insert into public.invoices (
      id, organization_id, client_id, recipient_client_id, job_id, project_id, service_case_id,
      service_start, service_end, payment_due_days, discount_days, discount_basis_points,
      order_reference, buyer_reference, opening_text, closing_text,
      line_net_cents, tax_cents, gross_cents, corrects_invoice_id, created_by, updated_by
    ) values (
      v_correction_id, p_organization_id, v_original.client_id,
      case when v_parties.client_id = v_original.client_id then v_parties.recipient_client_id
        else v_original.client_id end,
      v_original.job_id, v_original.project_id, v_original.service_case_id, v_original.service_start,
      v_original.service_end, v_original.payment_due_days, v_original.discount_days, v_original.discount_basis_points,
      v_original.order_reference, v_original.buyer_reference, v_original.opening_text, v_original.closing_text,
      v_original.line_net_cents, v_original.tax_cents, v_original.gross_cents, v_original.id,
      p_actor_id, p_actor_id
    );
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

  update public.invoices invoice set status = 'storniert'
  where invoice.id = v_original.id and invoice.organization_id = p_organization_id;
  return v_answer || jsonb_build_object('originalDocumentId', v_issued -> 'originalDocumentId');
end;
$$;
revoke all on function public.cancel_invoice(uuid, uuid, uuid, uuid, text, boolean, text, date, uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.cancel_invoice(uuid, uuid, uuid, uuid, text, boolean, text, date, uuid, text, text, bigint, text)
  to service_role;
