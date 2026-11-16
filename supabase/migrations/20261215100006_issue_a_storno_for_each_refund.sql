-- A refund of a WerkFlow invoice becomes a Stornorechnung naming the original
-- (werk-flow/werkflow-planning#491, epic #245). A Stripe credit note on a paid
-- invoice cancels the document that stands for that Stripe invoice: first its
-- original, after an earlier partial refund the replacement that refund
-- issued. lib/werkflow-billing/issue-storno.ts checks both documents like an
-- original (EN 16931, PDF/A-3, read-back), stores them under
-- `werkflow-billing/`, and records them here in one call:
--
-- - the Storno (384), with the credit note's number, the cancelled document's
--   amounts negated and `storno_of_invoice_id` naming it;
-- - for a partial refund, a replacement invoice (380) for the part that stays,
--   carrying the same credit note id.
--
-- Rows of one Stripe invoice now share its id, so the id is unique for the
-- original alone. A document is cancelled at most once, and a credit note
-- issues one Storno and at most one replacement. Rows stay immutable
-- (20261215100001's trigger) and keep the Admin-only read.
--
-- Prevention: Tier 1 (unique indexes, checks, the function's guards), Tier 2
-- supabase/tests/werkflow_invoices.sql.

alter table public.werkflow_invoices add column stripe_credit_note_id text;

-- @destructive: after release 55088f06: werkflow_invoices is not on PROD yet, so no released build writes a row this refuses
alter table public.werkflow_invoices
  add constraint werkflow_invoices_stripe_credit_note_id_check
  check (stripe_credit_note_id ~ '^cn_[A-Za-z0-9_]{1,250}$') not valid;
-- Every row but an original names the credit note that issued it.
-- @destructive: after release 55088f06: werkflow_invoices is not on PROD yet, so no released build writes a row this refuses
alter table public.werkflow_invoices
  add constraint werkflow_invoices_storno_names_credit_note
  check (type_code = '380' or stripe_credit_note_id is not null) not valid;

-- @destructive: after release 55088f06: werkflow_invoices is not on PROD yet, so no released build writes a row this refuses
create unique index werkflow_invoices_original_idx
  on public.werkflow_invoices (stripe_invoice_id) where stripe_credit_note_id is null;
-- @destructive: after release 55088f06: werkflow_invoices is not on PROD yet, so no released build writes a row this refuses
create unique index werkflow_invoices_credit_note_idx
  on public.werkflow_invoices (stripe_credit_note_id, type_code) where stripe_credit_note_id is not null;
-- @destructive: after release 55088f06: werkflow_invoices is not on PROD yet, so no released build writes a row this refuses
create unique index werkflow_invoices_cancelled_once_idx
  on public.werkflow_invoices (storno_of_invoice_id) where storno_of_invoice_id is not null;

-- @destructive: after release 55088f06: werkflow_invoices is not on PROD yet; the original keeps its uniqueness in werkflow_invoices_original_idx
alter table public.werkflow_invoices drop constraint werkflow_invoices_stripe_invoice_id_key;
-- @destructive: after release 55088f06: werkflow_invoices is not on PROD yet; werkflow_invoices_cancelled_once_idx covers the same lookups
drop index public.werkflow_invoices_storno_of_idx;

-- A4's issue, unchanged but for the conflict target: the original's own index.
create or replace function public.issue_werkflow_invoice(
  p_organization_id uuid,
  p_stripe_invoice_id text,
  p_stripe_customer_id text,
  p_stripe_event_id text,
  p_number text,
  p_issue_date date,
  p_buyer jsonb,
  p_payment_means text,
  p_net_cents bigint,
  p_tax_cents bigint,
  p_gross_cents bigint,
  p_paid_cents bigint,
  p_due_cents bigint,
  p_file_key text,
  p_file_sha256 text,
  p_file_size_bytes integer,
  p_rules_release text
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not exists (select 1 from public.organizations organization where organization.id = p_organization_id) then
    raise exception 'werkflow_invoice_organization_unknown' using errcode = 'P0002';
  end if;

  insert into public.werkflow_invoices (
    organization_id, stripe_invoice_id, stripe_customer_id, stripe_event_id, number, issue_date,
    buyer, payment_means, net_cents, tax_cents, gross_cents, paid_cents, due_cents,
    file_key, file_sha256, file_size_bytes, rules_release
  ) values (
    p_organization_id, p_stripe_invoice_id, p_stripe_customer_id, p_stripe_event_id, p_number, p_issue_date,
    p_buyer, p_payment_means, p_net_cents, p_tax_cents, p_gross_cents, p_paid_cents, p_due_cents,
    p_file_key, p_file_sha256, p_file_size_bytes, p_rules_release
  )
  on conflict (stripe_invoice_id) where stripe_credit_note_id is null do nothing;

  return case when found then 'issued' else 'already_issued' end;
end;
$$;

-- Records the Storno of one credit note and, for a partial refund, its
-- replacement, together. 'issued' when this call wrote them, 'already_issued'
-- when the credit note has its Storno already (a replayed or concurrent
-- delivery). The cancelled row must belong to the organization the Stripe
-- customer names; the Stripe ids and buyer come from that row, never from the
-- caller. The Storno's amounts must be the cancelled document's, negated, and
-- a replacement must lie between nothing and it.
-- Each document is {number, issue_date, net_cents, tax_cents, gross_cents,
-- paid_cents, file_key, file_sha256, file_size_bytes, rules_release}; the
-- replacement adds payment_means.
create function public.issue_werkflow_storno(
  p_organization_id uuid,
  p_cancels_invoice_id uuid,
  p_stripe_credit_note_id text,
  p_stripe_event_id text,
  p_storno jsonb,
  p_replacement jsonb
)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cancelled public.werkflow_invoices;
  v_storno_id uuid;
begin
  if exists (
    select 1 from public.werkflow_invoices invoice
    where invoice.stripe_credit_note_id = p_stripe_credit_note_id and invoice.type_code = '384'
  ) then
    return 'already_issued';
  end if;

  select * into v_cancelled from public.werkflow_invoices invoice where invoice.id = p_cancels_invoice_id;
  if not found or v_cancelled.type_code <> '380' or v_cancelled.organization_id <> p_organization_id then
    raise exception 'werkflow_storno_target_invalid' using errcode = 'P0002';
  end if;
  if (p_storno ->> 'net_cents')::bigint is distinct from -v_cancelled.net_cents
    or (p_storno ->> 'tax_cents')::bigint is distinct from -v_cancelled.tax_cents
    or (p_storno ->> 'gross_cents')::bigint is distinct from -v_cancelled.gross_cents
    or (p_storno ->> 'paid_cents')::bigint is distinct from 0 then
    raise exception 'werkflow_storno_amount_mismatch' using errcode = '22023';
  end if;
  if p_replacement is not null and not (
    (p_replacement ->> 'gross_cents')::bigint > 0
    and (p_replacement ->> 'gross_cents')::bigint < v_cancelled.gross_cents
  ) then
    raise exception 'werkflow_storno_amount_mismatch' using errcode = '22023';
  end if;

  insert into public.werkflow_invoices (
    organization_id, stripe_invoice_id, stripe_customer_id, stripe_event_id, stripe_credit_note_id,
    number, type_code, storno_of_invoice_id, issue_date, buyer, payment_means,
    net_cents, tax_cents, gross_cents, paid_cents, due_cents,
    file_key, file_sha256, file_size_bytes, rules_release
  ) values (
    v_cancelled.organization_id, v_cancelled.stripe_invoice_id, v_cancelled.stripe_customer_id,
    p_stripe_event_id, p_stripe_credit_note_id,
    p_storno ->> 'number', '384', v_cancelled.id, (p_storno ->> 'issue_date')::date, v_cancelled.buyer, 'none',
    -v_cancelled.net_cents, -v_cancelled.tax_cents, -v_cancelled.gross_cents, 0, -v_cancelled.gross_cents,
    p_storno ->> 'file_key', p_storno ->> 'file_sha256', (p_storno ->> 'file_size_bytes')::integer,
    p_storno ->> 'rules_release'
  )
  on conflict do nothing
  returning id into v_storno_id;

  if v_storno_id is null then
    -- A concurrent delivery of the same credit note won; anything else is a document already cancelled.
    if exists (
      select 1 from public.werkflow_invoices invoice
      where invoice.stripe_credit_note_id = p_stripe_credit_note_id and invoice.type_code = '384'
    ) then
      return 'already_issued';
    end if;
    raise exception 'werkflow_storno_conflict' using errcode = '23505';
  end if;

  if p_replacement is not null then
    insert into public.werkflow_invoices (
      organization_id, stripe_invoice_id, stripe_customer_id, stripe_event_id, stripe_credit_note_id,
      number, type_code, issue_date, buyer, payment_means,
      net_cents, tax_cents, gross_cents, paid_cents, due_cents,
      file_key, file_sha256, file_size_bytes, rules_release
    ) values (
      v_cancelled.organization_id, v_cancelled.stripe_invoice_id, v_cancelled.stripe_customer_id,
      p_stripe_event_id, p_stripe_credit_note_id,
      p_replacement ->> 'number', '380', (p_replacement ->> 'issue_date')::date, v_cancelled.buyer,
      p_replacement ->> 'payment_means',
      (p_replacement ->> 'net_cents')::bigint, (p_replacement ->> 'tax_cents')::bigint,
      (p_replacement ->> 'gross_cents')::bigint, (p_replacement ->> 'paid_cents')::bigint,
      (p_replacement ->> 'gross_cents')::bigint - (p_replacement ->> 'paid_cents')::bigint,
      p_replacement ->> 'file_key', p_replacement ->> 'file_sha256',
      (p_replacement ->> 'file_size_bytes')::integer, p_replacement ->> 'rules_release'
    );
  end if;

  return 'issued';
end;
$$;

revoke all on function public.issue_werkflow_storno(uuid, uuid, text, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.issue_werkflow_storno(uuid, uuid, text, text, jsonb, jsonb) to service_role;
