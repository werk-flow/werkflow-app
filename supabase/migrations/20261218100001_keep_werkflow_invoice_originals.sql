-- WerkFlow's own invoices to its customers (werk-flow/werkflow-planning#249,
-- epic #245). A finalized Stripe invoice becomes WerkFlow's checked ZUGFeRD
-- original with Stripe's number: lib/werkflow-billing/issue-invoice.ts maps
-- it, checks it against EN 16931, renders and reads back the PDF/A-3, stores
-- it in R2 under `werkflow-billing/`, and then records it here in one call.
--
-- An issued row is the original's record and never changes: no client writes,
-- and a trigger refuses every UPDATE, DELETE and TRUNCATE, even the owner's.
-- The row is inserted once, issued, so its insert is its whole history. A
-- refund becomes its own Storno row naming the original (A4b, #491).
--
-- The organization id carries no foreign key: WerkFlow keeps its books ten
-- years from the end of the invoice's year (§ 147 AO), also after the
-- customer's organization is deleted. The buyer is a snapshot of Stripe's
-- frozen invoice fields for the same reason.
--
-- The organization's Admin reads its rows (the billing page, A7 #252);
-- Büro, employees and other organizations read none.
--
-- Prevention: Tier 1 (grants, policy, checks, the immutability trigger), Tier 2
-- supabase/tests/werkflow_invoices.sql.

create table public.werkflow_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  stripe_invoice_id text not null unique check (stripe_invoice_id ~ '^in_[A-Za-z0-9_]{1,250}$'),
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9_]{1,250}$'),
  -- The signal that issued it.
  stripe_event_id text not null check (stripe_event_id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
  -- Stripe's number: one account-wide sequence, so unique here too.
  number text not null unique check (number ~ '^[A-Za-z0-9-]{1,64}$'),
  type_code text not null default '380' check (type_code in ('380', '384')),
  -- The original a Storno cancels.
  storno_of_invoice_id uuid references public.werkflow_invoices (id),
  issue_date date not null,
  buyer jsonb not null check (jsonb_typeof(buyer) = 'object'),
  payment_means text not null check (payment_means in ('direct-debit', 'card', 'none')),
  currency text not null default 'EUR' check (currency = 'EUR'),
  net_cents bigint not null,
  tax_cents bigint not null,
  gross_cents bigint not null,
  paid_cents bigint not null check (paid_cents >= 0),
  due_cents bigint not null,
  file_key text not null unique check (file_key ~ '^werkflow-billing/invoices/in_[A-Za-z0-9_]+/[0-9a-f]{64}\.pdf$'),
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size_bytes integer not null check (file_size_bytes > 0),
  rules_release text not null check (rules_release ~ '^[0-9][0-9.]{0,15}$'),
  -- Kept until the end of the tenth year after the invoice's year.
  retain_until date not null generated always as (
    make_date(extract(year from issue_date)::integer + 10, 12, 31)
  ) stored,
  issued_at timestamptz not null default now(),
  check (gross_cents = net_cents + tax_cents),
  check (due_cents = gross_cents - paid_cents),
  check ((type_code = '384') = (storno_of_invoice_id is not null)),
  check (position(file_sha256 in file_key) > 0)
);

create index werkflow_invoices_organization_idx
  on public.werkflow_invoices (organization_id, issue_date desc);
create index werkflow_invoices_storno_of_idx
  on public.werkflow_invoices (storno_of_invoice_id) where storno_of_invoice_id is not null;

create function app_private.refuse_werkflow_invoice_change()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  raise exception 'werkflow_invoice_immutable' using errcode = '55000';
end;
$$;
revoke all on function app_private.refuse_werkflow_invoice_change() from public, anon, authenticated;

create trigger werkflow_invoices_immutable
  before update or delete on public.werkflow_invoices
  for each row execute function app_private.refuse_werkflow_invoice_change();
create trigger werkflow_invoices_no_truncate
  before truncate on public.werkflow_invoices
  for each statement execute function app_private.refuse_werkflow_invoice_change();

alter table public.werkflow_invoices enable row level security;

create policy werkflow_invoices_admin_select on public.werkflow_invoices for select to authenticated
  using (organization_id in (select app_private.get_user_admin_org_ids((select auth.uid()))));

revoke all on table public.werkflow_invoices from public, anon, authenticated, service_role;
grant select on table public.werkflow_invoices to authenticated, service_role;

-- Records one issued original. 'issued' when this call wrote it,
-- 'already_issued' when the Stripe invoice has its row already (a replayed or
-- concurrent delivery); the stored row then stays as it is. Refuses an
-- organization that does not exist.
create function public.issue_werkflow_invoice(
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
  on conflict (stripe_invoice_id) do nothing;

  return case when found then 'issued' else 'already_issued' end;
end;
$$;

revoke all on function public.issue_werkflow_invoice(
  uuid, text, text, text, text, date, jsonb, text, bigint, bigint, bigint, bigint, bigint, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.issue_werkflow_invoice(
  uuid, text, text, text, text, date, jsonb, text, bigint, bigint, bigint, bigint, bigint, text, text, integer, text
) to service_role;
