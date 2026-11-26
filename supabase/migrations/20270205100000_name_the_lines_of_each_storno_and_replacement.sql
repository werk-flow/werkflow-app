-- A refund's Storno and replacement say what they were for on the billing page
-- (werk-flow/werkflow-planning#554, epic #245), as an original does since
-- 20270111100003. The Storno names the lines and service period of the
-- document it cancels, read from that row. The replacement names its own:
-- Stripe's lines and one per refund, over the original's service period. Only
-- the caller holds them, so `p_replacement` carries `line_names`,
-- `service_start` and `service_end`, as `issue_werkflow_invoice` takes them
-- for an original. A call of the previous build leaves them out and records
-- the replacement with no lines and no period, as before.
--
-- The signature, guards and grants stay as 20261221100006 set them.
--
-- Prevention: Tier 1 (the function copies the Storno's from the cancelled row;
-- the table's checks), Tier 2 supabase/tests/werkflow_invoices.sql.

-- Each document is {number, issue_date, net_cents, tax_cents, gross_cents,
-- paid_cents, file_key, file_sha256, file_size_bytes, rules_release}; the
-- replacement adds payment_means, line_names (a list of texts), service_start
-- and service_end.
create or replace function public.issue_werkflow_storno(
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
  if p_replacement is not null and not coalesce(
    (p_replacement ->> 'gross_cents')::bigint > 0
    and (p_replacement ->> 'gross_cents')::bigint < v_cancelled.gross_cents
    and (p_replacement ->> 'paid_cents')::bigint = (p_replacement ->> 'gross_cents')::bigint,
    false
  ) then
    raise exception 'werkflow_storno_amount_mismatch' using errcode = '22023';
  end if;
  if coalesce(jsonb_typeof(p_replacement -> 'line_names'), 'array') <> 'array' then
    raise exception 'werkflow_storno_lines_invalid' using errcode = '22023';
  end if;

  insert into public.werkflow_invoices (
    organization_id, stripe_invoice_id, stripe_customer_id, stripe_event_id, stripe_credit_note_id,
    number, type_code, storno_of_invoice_id, issue_date, buyer, payment_means,
    net_cents, tax_cents, gross_cents, paid_cents, due_cents,
    file_key, file_sha256, file_size_bytes, rules_release, line_names, service_start, service_end
  ) values (
    v_cancelled.organization_id, v_cancelled.stripe_invoice_id, v_cancelled.stripe_customer_id,
    p_stripe_event_id, p_stripe_credit_note_id,
    p_storno ->> 'number', '384', v_cancelled.id, (p_storno ->> 'issue_date')::date, v_cancelled.buyer, 'none',
    -v_cancelled.net_cents, -v_cancelled.tax_cents, -v_cancelled.gross_cents, 0, -v_cancelled.gross_cents,
    p_storno ->> 'file_key', p_storno ->> 'file_sha256', (p_storno ->> 'file_size_bytes')::integer,
    p_storno ->> 'rules_release', v_cancelled.line_names, v_cancelled.service_start, v_cancelled.service_end
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
      file_key, file_sha256, file_size_bytes, rules_release, line_names, service_start, service_end
    ) values (
      v_cancelled.organization_id, v_cancelled.stripe_invoice_id, v_cancelled.stripe_customer_id,
      p_stripe_event_id, p_stripe_credit_note_id,
      p_replacement ->> 'number', '380', (p_replacement ->> 'issue_date')::date, v_cancelled.buyer,
      p_replacement ->> 'payment_means',
      (p_replacement ->> 'net_cents')::bigint, (p_replacement ->> 'tax_cents')::bigint,
      (p_replacement ->> 'gross_cents')::bigint, (p_replacement ->> 'paid_cents')::bigint,
      (p_replacement ->> 'gross_cents')::bigint - (p_replacement ->> 'paid_cents')::bigint,
      p_replacement ->> 'file_key', p_replacement ->> 'file_sha256',
      (p_replacement ->> 'file_size_bytes')::integer, p_replacement ->> 'rules_release',
      array(
        select line.name
        from jsonb_array_elements_text(p_replacement -> 'line_names') with ordinality as line (name, position)
        order by line.position
      ),
      (p_replacement ->> 'service_start')::date, (p_replacement ->> 'service_end')::date
    );
  end if;

  return 'issued';
end;
$$;
