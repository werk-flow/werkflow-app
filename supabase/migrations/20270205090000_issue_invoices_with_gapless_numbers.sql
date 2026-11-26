-- „Ausstellen“ gives a checked draft the next gapless number of the
-- organization's series, freezes it for good and files its original
-- (werk-flow/werkflow-planning#457, E2c R4).
--
-- 1. invoice_settings: one row per organization with the number series
--    (prefix, year in the number with a yearly restart, minimum digits, next
--    number) and the default Zahlungsziel and Skonto of a new draft. The
--    series is fixed from the first issue on.
-- 2. invoices: the Rechnungsdatum, who issued it, the snapshot the server
--    checked (seller profile, letterhead files, Rechnungsempfänger) and the
--    filed original. A guard refuses every later change and delete of an
--    issued invoice and its lines, whoever writes, but a deleted work's or
--    person's set null and the original's registration.
-- 3. issue_invoice: in one transaction it checks the draft is complete,
--    takes the next number under the series' row lock, only when it is the
--    number and day the server checked, stores the snapshot, sets
--    Ausgestellt with the Rechnungsdatum, writes history, and registers and
--    files the original the server rendered under that number and day. A
--    refusal rolls back everything, so no number is used.
-- 4. register_invoice_original: registers the rendered PDF as a document in
--    the ten-year class, linked to the customer, once per invoice, and files
--    it through file_document in the same transaction. issue_invoice calls
--    it; „Beleg erstellen“ calls it for an original still pending.
--    No link is added to a registered original afterwards
--    (guard_invoice_original_links), so no work link opens it to that work's
--    employees.
-- 5. save_invoice_settings, get_invoice_settings; create_invoice takes the
--    default terms; get_invoice answers the issue facts.
--
-- The server actions in lib/invoices/ establish identity, role and
-- organization, check the draft with the EN 16931 rules and the renderer
-- under the number and day it will take first, and render the original; each
-- function checks the actor again under the access lock.
--
-- Expand-only: a new table, new nullable columns, a widened event check, new
-- functions and triggers; create_invoice and get_invoice keep their signatures.
--
-- Prevention: Tier 1 (the guards, the issue checks, no client grant), Tier 2
-- supabase/tests/invoice_issue.sql and invoice_issue_concurrency.sql.

-- 1. The series and the default terms.
create table public.invoice_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  number_prefix text not null default 'RE-',
  -- With the year the number reads <prefix><year>-<n> and n restarts at 1 each year.
  number_with_year boolean not null default true,
  number_min_digits integer not null default 3,
  next_number integer not null default 1,
  -- The year next_number counts in; null until the first save or issue.
  number_year integer,
  -- The first issue fixes prefix, year and digits; only issuing moves the number then.
  first_issued_at timestamptz,
  payment_due_days integer not null default 14,
  discount_days integer,
  discount_basis_points integer,
  version integer not null default 1,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint invoice_settings_prefix_check check (number_prefix ~ '^[A-Za-z0-9._/-]{0,20}$'),
  constraint invoice_settings_digits_check check (number_min_digits between 1 and 10),
  constraint invoice_settings_next_number_check check (next_number between 1 and 999999999),
  constraint invoice_settings_year_check check (number_year between 2000 and 2999),
  constraint invoice_settings_payment_due_check check (payment_due_days between 0 and 365),
  constraint invoice_settings_discount_check check (
    (discount_days is null) = (discount_basis_points is null)
    and discount_days between 1 and payment_due_days
    and discount_basis_points between 1 and 9999
  ),
  constraint invoice_settings_version_check check (version >= 1)
);
create index invoice_settings_updated_by_idx on public.invoice_settings (updated_by);

alter table public.invoice_settings enable row level security;
revoke all on table public.invoice_settings from public, anon, authenticated, service_role;
grant select, insert, update on table public.invoice_settings to service_role;

-- Once an invoice is issued, the series' format stays and only issue_invoice
-- moves its number (it raises app.invoice_number_write for its one update).
-- The row stays while its organization exists.
create function app_private.guard_invoice_series()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.first_issued_at is null or not exists (
      select 1 from public.organizations organization where organization.id = old.organization_id
    ) then
      return old;
    end if;
    raise exception 'invoice_numbers_fixed';
  end if;
  if old.first_issued_at is not null and (
    (new.number_prefix, new.number_with_year, new.number_min_digits, new.first_issued_at)
      is distinct from (old.number_prefix, old.number_with_year, old.number_min_digits, old.first_issued_at)
    or ((new.next_number, new.number_year) is distinct from (old.next_number, old.number_year)
      and coalesce(current_setting('app.invoice_number_write', true), '') <> 'on')
  ) then
    raise exception 'invoice_numbers_fixed';
  end if;
  perform set_config('app.invoice_number_write', 'off', true);
  return new;
end;
$$;
revoke all on function app_private.guard_invoice_series() from public, anon, authenticated, service_role;
create trigger guard_invoice_series before update or delete on public.invoice_settings
  for each row execute function app_private.guard_invoice_series();

-- The sequence number the next invoice of p_year takes: with the year in the
-- number, a new year starts at 1.
create function app_private.next_invoice_sequence(p_settings public.invoice_settings, p_year integer)
returns integer
language sql
immutable
set search_path to ''
as $$
  select case
    when p_settings.number_with_year and p_settings.number_year < p_year then 1
    else p_settings.next_number
  end;
$$;

create function app_private.format_invoice_number(
  p_settings public.invoice_settings,
  p_year integer,
  p_sequence integer
)
returns text
language sql
immutable
set search_path to ''
as $$
  select p_settings.number_prefix
    || case when p_settings.number_with_year then p_year::text || '-' else '' end
    || lpad(p_sequence::text, greatest(p_settings.number_min_digits, length(p_sequence::text)), '0');
$$;
revoke all on function app_private.next_invoice_sequence(public.invoice_settings, integer)
  from public, anon, authenticated;
revoke all on function app_private.format_invoice_number(public.invoice_settings, integer, integer)
  from public, anon, authenticated;
grant execute on function app_private.next_invoice_sequence(public.invoice_settings, integer) to service_role;
grant execute on function app_private.format_invoice_number(public.invoice_settings, integer, integer)
  to service_role;

-- 2. The issue facts. The letterhead's storage paths are columns, so the
-- storage purge keeps every file an issued invoice's original is drawn from
-- (claim_storage_purge releases each path a *storage_path column references).
alter table public.invoices
  add column issue_date date,
  add column issued_at timestamptz,
  add column issued_by uuid references auth.users (id) on delete set null,
  add column issue_snapshot jsonb,
  add column logo_storage_path text,
  add column stationery_first_storage_path text,
  add column stationery_following_storage_path text,
  add column original_document_id uuid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet; this release writes only drafts, which the rule lets pass
alter table public.invoices add constraint invoices_issue_check check (
  (status = 'entwurf') = (invoice_number is null)
  and (status = 'entwurf') = (issue_date is null)
  and (status = 'entwurf') = (issued_at is null)
  and (status = 'entwurf') = (issue_snapshot is null)
  and (status = 'entwurf') <= (original_document_id is null)
) not valid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet; this release writes only drafts, which the rule lets pass
alter table public.invoices add constraint invoices_issue_snapshot_check check (
  issue_snapshot is null or (
    jsonb_typeof(issue_snapshot) = 'object'
    and logo_storage_path is not distinct from issue_snapshot #>> '{files,logo,path}'
    and stationery_first_storage_path is not distinct from issue_snapshot #>> '{files,stationery_first,path}'
    and stationery_following_storage_path is not distinct from
      issue_snapshot #>> '{files,stationery_following,path}'
  )
) not valid;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice table yet; this release writes only drafts, which the rule lets pass
alter table public.invoices add constraint invoices_original_fk foreign key (original_document_id, organization_id)
  references public.documents (id, organization_id);
-- The key's columns, so a deleted document finds its invoice without a scan (foreign_key_indexes.sql).
create index invoices_original_document_idx on public.invoices (original_document_id, organization_id)
  where original_document_id is not null;
create index invoices_issued_by_idx on public.invoices (issued_by);

-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice history yet; the widened rule keeps every type it allowed
alter table public.invoice_events drop constraint invoice_events_type_check;
-- @destructive: after release 55088f06f04b5edcc58f8853de54cb4f2251ae0f: that release has no invoice history yet; the widened rule keeps every type it allowed
alter table public.invoice_events add constraint invoice_events_type_check
  check (event_type in ('created', 'saved', 'deleted', 'issued', 'original_registered')) not valid;

-- An issued invoice keeps every value. A work or person reference clears only
-- when its target is gone, as its foreign key's set null does. The original is
-- set once, to what register_invoice_original leaves: a ten-year invoice
-- document of this invoice dated its Rechnungsdatum, filed with its filing
-- record, linked to its customer and to nothing else, with the registration's
-- history entry. The guard checks that document, not who writes, so no session
-- setting and no direct write names another. It is never deleted while its
-- organization exists. Security definer:
-- service_role cannot read auth.users, whose rows the person references name;
-- no role executes it.
create function app_private.guard_issued_invoice()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_free constant text[] := array[
    'job_id', 'project_id', 'service_case_id', 'created_by', 'updated_by', 'issued_by', 'original_document_id'
  ];
begin
  if tg_op = 'DELETE' then
    if old.status = 'entwurf' or not exists (
      select 1 from public.organizations organization where organization.id = old.organization_id
    ) then
      return old;
    end if;
    raise exception 'invoice_issued';
  end if;
  if old.status = 'entwurf' then
    -- A draft has no original; only the registration names one, on an issued invoice.
    if new.original_document_id is not null then
      raise exception 'invoice_issued';
    end if;
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
create trigger guard_issued_invoice before update or delete on public.invoices
  for each row execute function app_private.guard_issued_invoice();

-- The lines of an issued invoice never change. The share lock on the invoice
-- row waits for an issue in flight, so a line write never slips past it.
-- Organization teardown passes: the invoice row is gone by then.
create function app_private.guard_issued_invoice_lines()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_status text;
begin
  -- An update moves no line between invoices: new.invoice_id is checked too.
  for v_status in
    select invoice.status from public.invoices invoice
    where (tg_op <> 'INSERT' and invoice.id = old.invoice_id and invoice.organization_id = old.organization_id)
      or (tg_op <> 'DELETE' and invoice.id = new.invoice_id and invoice.organization_id = new.organization_id)
    for share
  loop
    if v_status <> 'entwurf' then
      raise exception 'invoice_issued';
    end if;
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function app_private.guard_issued_invoice_lines() from public, anon, authenticated, service_role;
create trigger guard_issued_invoice_lines before insert or update or delete on public.invoice_lines
  for each row execute function app_private.guard_issued_invoice_lines();

-- 3. Issues a draft from p_expected_version with the snapshot the server
-- checked (p_snapshot: organizationName, profile, files and buyer). The
-- number is the series' next under its row lock; the Rechnungsdatum is the
-- Berlin day once that lock is held. p_expected_number and p_expected_issue_date are the number and
-- Rechnungsdatum the server checked and rendered the invoice under; the head
-- of its original prints both, so the function issues only those and
-- otherwise refuses invoice_number_moved, and the server checks again. The
-- p_original_* arguments name the original the server rendered under that
-- number and day and stored: the issue registers and files it in its own
-- transaction (register_invoice_original), so an issue and its original
-- commit or roll back together. Without them, as when the storage was
-- unreachable, the invoice is issued with its original pending. A retry under
-- the same key answers the first issue and registers nothing, since its
-- original may have been rendered under another number. The answer names the
-- invoice's registered original, or null; the server discards another.
-- Refusals: invalid_input, not_authorized, those of lock_invoice_draft,
-- invoice_incomplete (no line or no Leistungsdatum), invoice_number_moved,
-- those of register_invoice_original, and a check violation.
create function public.issue_invoice(
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
  perform set_config('app.invoice_number_write', 'on', true);
  update public.invoice_settings settings set
    next_number = v_sequence + 1,
    number_year = v_year,
    first_issued_at = coalesce(settings.first_issued_at, now()),
    -- The first issue fixes the series: a settings form opened before it is stale.
    version = settings.version + case when settings.first_issued_at is null then 1 else 0 end
  where settings.organization_id = p_organization_id;

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

  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_invoice.id, 'issued', 'ausgestellt', v_invoice.version + 1,
    jsonb_build_object('invoiceNumber', v_number, 'issueDate', v_issue_date,
      'grossCents', v_invoice.gross_cents),
    p_actor_id, p_attempt_key
  );
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

-- 4. Registers an issued invoice's rendered original as a document in the
-- ten-year class, dated the Rechnungsdatum, linked to the customer and never
-- to a work, and files it in the same transaction through file_document (the
-- function lib/documents/filing.ts calls), so no moment exists in which the
-- registered original could take a new version or another class. Once per
-- invoice: a later call answers the registered document (with its content
-- hash) and registers nothing, so the caller discards its own object.
-- Refusals: invalid_input, not_authorized, invoice_not_found,
-- invoice_not_issued.
create function public.register_invoice_original(
  p_actor_id uuid,
  p_organization_id uuid,
  p_invoice_id uuid,
  p_document_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint,
  p_content_hash text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_invoice public.invoices;
  v_registered public.documents;
begin
  if p_actor_id is null or p_organization_id is null or p_invoice_id is null or p_document_id is null
    or p_storage_path is null or p_file_name is null or p_size_bytes is null or p_size_bytes <= 0
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_storage_path not like p_organization_id::text || '/' || p_document_id::text || '/%'
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  select * into v_invoice from public.invoices invoice
  where invoice.id = p_invoice_id and invoice.organization_id = p_organization_id
  for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if v_invoice.status = 'entwurf' then raise exception 'invoice_not_issued'; end if;
  if v_invoice.original_document_id is not null then
    select * into v_registered from public.documents document
    where document.id = v_invoice.original_document_id and document.organization_id = p_organization_id;
    return jsonb_build_object('documentId', v_registered.id, 'replay', true,
      'contentHash', v_registered.metadata ->> 'contentHash');
  end if;

  insert into public.documents (
    id, organization_id, folder_id, storage_bucket, storage_path, original_file_name, display_name,
    category, mime_type, size_bytes, uploaded_by, document_date, retention_class, metadata
  ) values (
    p_document_id, p_organization_id, null, 'organization-documents', p_storage_path, p_file_name,
    p_file_name, 'invoice', 'application/pdf', p_size_bytes, p_actor_id, v_invoice.issue_date,
    'ten_years', jsonb_build_object('invoiceId', v_invoice.id, 'contentHash', p_content_hash)
  );
  insert into public.document_links (organization_id, document_id, client_id, created_by)
  values (p_organization_id, p_document_id, v_invoice.client_id, p_actor_id);
  insert into public.document_audit_events (
    organization_id, document_id, actor_id, event_type, event_payload
  ) values (
    p_organization_id, p_document_id, p_actor_id, 'uploaded',
    jsonb_build_object('source', 'invoice_issue', 'invoiceId', v_invoice.id, 'storagePath', p_storage_path,
      'contentHash', p_content_hash, 'clientId', v_invoice.client_id)
  );
  perform public.file_document(p_actor_id, p_organization_id, p_document_id);
  -- The history entry comes first: guard_issued_invoice names no original without it.
  insert into public.invoice_events (
    organization_id, invoice_id, event_type, status, version, payload, actor_id, attempt_key
  ) values (
    p_organization_id, v_invoice.id, 'original_registered', v_invoice.status, v_invoice.version,
    jsonb_build_object('documentId', p_document_id, 'contentHash', p_content_hash),
    p_actor_id, p_document_id
  );
  update public.invoices invoice set original_document_id = p_document_id
  where invoice.id = v_invoice.id and invoice.organization_id = p_organization_id;
  return jsonb_build_object('documentId', p_document_id, 'replay', false, 'contentHash', p_content_hash);
end;
$$;
revoke all on function public.register_invoice_original(uuid, uuid, uuid, uuid, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.register_invoice_original(uuid, uuid, uuid, uuid, text, text, bigint, text)
  to service_role;

-- An invoice's original keeps only the customer link its registration wrote:
-- a work link would let every employee assigned to that work read it. So no
-- link is added to a registered original and no link of it turns to another
-- target, whoever writes; a removal, and a deleted target's set null, stay.
-- The registration links before it names the original, in one transaction,
-- so the refusal never meets it. Security definer as the personnel-document
-- link guard: no role executes it.
create function app_private.guard_invoice_original_links()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' and new.document_id = old.document_id
    and (new.job_id is null or new.job_id is not distinct from old.job_id)
    and (new.project_id is null or new.project_id is not distinct from old.project_id)
    and (new.client_id is null or new.client_id is not distinct from old.client_id)
    and (new.employee_id is null or new.employee_id is not distinct from old.employee_id)
    and (new.request_id is null or new.request_id is not distinct from old.request_id)
    and (new.equipment_id is null or new.equipment_id is not distinct from old.equipment_id)
    and (new.service_case_id is null or new.service_case_id is not distinct from old.service_case_id)
    and (new.maintenance_coverage_id is null
      or new.maintenance_coverage_id is not distinct from old.maintenance_coverage_id)
  then
    return new;
  end if;
  if exists (
    select 1 from public.invoices invoice
    where invoice.original_document_id = new.document_id and invoice.organization_id = new.organization_id
  ) then
    raise exception 'document_is_invoice_original';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_invoice_original_links() from public, anon, authenticated, service_role;
create trigger guard_invoice_original_links before insert or update on public.document_links
  for each row execute function app_private.guard_invoice_original_links();

-- 5. The organization's invoice settings with the number the next invoice
-- issued today takes; an organization that saved none reads the defaults at
-- version 0.
create function public.get_invoice_settings(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $$
declare
  v_settings public.invoice_settings;
  v_version integer := 0;
  v_year integer := extract(year from (now() at time zone 'Europe/Berlin'))::integer;
begin
  select * into v_settings from public.invoice_settings settings
  where settings.organization_id = p_organization_id;
  if found then
    v_version := v_settings.version;
  else
    v_settings := jsonb_populate_record(null::public.invoice_settings, '{}');
    v_settings.number_prefix := 'RE-';
    v_settings.number_with_year := true;
    v_settings.number_min_digits := 3;
    v_settings.next_number := 1;
    v_settings.payment_due_days := 14;
  end if;
  return jsonb_build_object(
    'version', v_version,
    'numberPrefix', v_settings.number_prefix,
    'numberWithYear', v_settings.number_with_year,
    'numberMinDigits', v_settings.number_min_digits,
    'nextNumber', app_private.next_invoice_sequence(v_settings, v_year),
    'nextInvoiceNumber', app_private.format_invoice_number(
      v_settings, v_year, app_private.next_invoice_sequence(v_settings, v_year)),
    'numbersFixed', v_settings.first_issued_at is not null,
    'paymentDueDays', v_settings.payment_due_days,
    'discountDays', v_settings.discount_days,
    'discountBasisPoints', v_settings.discount_basis_points
  );
end;
$$;
revoke all on function public.get_invoice_settings(uuid) from public, anon, authenticated;
grant execute on function public.get_invoice_settings(uuid) to service_role;


-- Saves the settings from p_expected_version (0: none saved yet). p_settings
-- holds numberPrefix, numberWithYear, numberMinDigits, nextNumber,
-- paymentDueDays, discountDays and discountBasisPoints. Admin only. Once an
-- invoice is issued the series stays and only the default terms change (the
-- first issue moved the version, so a form opened before it is stale).
-- Returns the new version. Refusals: invalid_input, not_authorized,
-- stale_version, and a check violation.
create function public.save_invoice_settings(
  p_actor_id uuid,
  p_organization_id uuid,
  p_expected_version integer,
  p_settings jsonb
)
returns integer
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_settings public.invoice_settings;
  v_version integer;
  v_year integer := extract(year from (now() at time zone 'Europe/Berlin'))::integer;
begin
  if p_actor_id is null or p_organization_id is null or p_expected_version is null
    or jsonb_typeof(p_settings) is distinct from 'object'
  then
    raise exception 'invalid_input';
  end if;
  perform app_private.lock_office_actor(p_organization_id, p_actor_id);
  if not exists (
    select 1 from public.organization_members member
    where member.organization_id = p_organization_id and member.user_id = p_actor_id and member.role = 'admin'
  ) then
    raise exception 'not_authorized';
  end if;
  select * into v_settings from public.invoice_settings settings
  where settings.organization_id = p_organization_id
  for update;
  if not found then
    if p_expected_version <> 0 then raise exception 'stale_version'; end if;
    insert into public.invoice_settings (
      organization_id, number_prefix, number_with_year, number_min_digits, next_number, number_year,
      payment_due_days, discount_days, discount_basis_points, updated_by
    ) values (
      p_organization_id, p_settings ->> 'numberPrefix', (p_settings ->> 'numberWithYear')::boolean,
      (p_settings ->> 'numberMinDigits')::integer, (p_settings ->> 'nextNumber')::integer, v_year,
      (p_settings ->> 'paymentDueDays')::integer, (p_settings ->> 'discountDays')::integer,
      (p_settings ->> 'discountBasisPoints')::integer, p_actor_id
    )
    on conflict (organization_id) do nothing
    returning version into v_version;
    -- Another session saved or issued first.
    if v_version is null then raise exception 'stale_version'; end if;
    return v_version;
  end if;
  if v_settings.version <> p_expected_version then raise exception 'stale_version'; end if;

  update public.invoice_settings settings set
    number_prefix = case when settings.first_issued_at is null
      then p_settings ->> 'numberPrefix' else settings.number_prefix end,
    number_with_year = case when settings.first_issued_at is null
      then (p_settings ->> 'numberWithYear')::boolean else settings.number_with_year end,
    number_min_digits = case when settings.first_issued_at is null
      then (p_settings ->> 'numberMinDigits')::integer else settings.number_min_digits end,
    next_number = case when settings.first_issued_at is null
      then (p_settings ->> 'nextNumber')::integer else settings.next_number end,
    number_year = case when settings.first_issued_at is null then v_year else settings.number_year end,
    payment_due_days = (p_settings ->> 'paymentDueDays')::integer,
    discount_days = (p_settings ->> 'discountDays')::integer,
    discount_basis_points = (p_settings ->> 'discountBasisPoints')::integer,
    version = settings.version + 1,
    updated_by = p_actor_id,
    updated_at = now()
  where settings.organization_id = p_organization_id
  returning settings.version into v_version;
  return v_version;
end;
$$;
revoke all on function public.save_invoice_settings(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.save_invoice_settings(uuid, uuid, integer, jsonb) to service_role;

-- A new draft starts with the organization's default Zahlungsziel and Skonto.
-- Otherwise as in 20261219100000_keep_invoice_drafts_with_their_lines_and_totals.sql.
create or replace function public.create_invoice(
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
  v_settings public.invoice_settings;
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

  select * into v_settings from public.invoice_settings settings
  where settings.organization_id = p_organization_id;

  insert into public.invoices (
    organization_id, client_id, recipient_client_id, job_id, project_id, service_case_id,
    payment_due_days, discount_days, discount_basis_points, created_by, updated_by
  ) values (
    p_organization_id, p_client_id,
    case when v_parties.client_id = p_client_id then v_parties.recipient_client_id else p_client_id end,
    case when p_work_kind = 'job' then p_work_id end,
    case when p_work_kind = 'project' then p_work_id end,
    case when p_work_kind = 'service_case' then p_work_id end,
    coalesce(v_settings.payment_due_days, 14), v_settings.discount_days, v_settings.discount_basis_points,
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

-- The issue facts join the answer: Rechnungsdatum, the snapshot and the original's
-- filing. Otherwise as in 20261219100000_keep_invoice_drafts_with_their_lines_and_totals.sql.
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
