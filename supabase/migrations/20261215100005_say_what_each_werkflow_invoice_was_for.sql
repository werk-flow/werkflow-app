-- The billing page says what each of WerkFlow's invoices was for
-- (werk-flow/werkflow-planning#252, epic #245): the names of its lines and the
-- service period, as the original states them. An issued row never changes,
-- so the issue call records both with the rest of the row.
--
-- Prevention: Tier 1 (the checks), Tier 2 supabase/tests/werkflow_invoices.sql.

alter table public.werkflow_invoices
  add column line_names text[] not null default '{}',
  add column service_start date,
  add column service_end date;

-- @destructive: after release 55088f06: no earlier build writes the columns this checks, and their defaults pass it
alter table public.werkflow_invoices
  add constraint werkflow_invoices_service_period_check check (
    (service_start is null) = (service_end is null)
    and (service_start is null or service_start <= service_end)
  ) not valid;

-- @destructive: after release 55088f06: no earlier build writes the column this checks, and its default passes it
alter table public.werkflow_invoices
  add constraint werkflow_invoices_line_names_check check (
    cardinality(line_names) <= 1000
    and array_position(line_names, null) is null
  ) not valid;

-- @destructive: after release 55088f06: the replacement below keeps every argument of this one in place and defaults the three new ones, so that build's calls resolve to it
drop function public.issue_werkflow_invoice(
  uuid, text, text, text, text, date, jsonb, text, bigint, bigint, bigint, bigint, bigint, text, text, integer, text
);

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
  p_rules_release text,
  p_line_names text[] default '{}',
  p_service_start date default null,
  p_service_end date default null
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
    file_key, file_sha256, file_size_bytes, rules_release, line_names, service_start, service_end
  ) values (
    p_organization_id, p_stripe_invoice_id, p_stripe_customer_id, p_stripe_event_id, p_number, p_issue_date,
    p_buyer, p_payment_means, p_net_cents, p_tax_cents, p_gross_cents, p_paid_cents, p_due_cents,
    p_file_key, p_file_sha256, p_file_size_bytes, p_rules_release, coalesce(p_line_names, '{}'),
    p_service_start, p_service_end
  )
  on conflict (stripe_invoice_id) do nothing;

  return case when found then 'issued' else 'already_issued' end;
end;
$$;

revoke all on function public.issue_werkflow_invoice(
  uuid, text, text, text, text, date, jsonb, text, bigint, bigint, bigint, bigint, bigint, text, text, integer, text,
  text[], date, date
) from public, anon, authenticated;
grant execute on function public.issue_werkflow_invoice(
  uuid, text, text, text, text, date, jsonb, text, bigint, bigint, bigint, bigint, bigint, text, text, integer, text,
  text[], date, date
) to service_role;
