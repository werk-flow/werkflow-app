import type { TestWorld } from '../world';
import { createAdminClient } from './shared';

// WerkFlow's own subscription and invoices of a world's organization, for the
// billing page's audits and captures (werk-flow/werkflow-planning#252). They
// are written through the functions Stripe's signals call; no test reaches
// Stripe. The ids and numbers are made up, of Stripe's test form.

const CUSTOMER_ID = 'cus_test_billing_page';
const SUBSCRIPTION_ID = 'sub_test_billing_page';

/** The calendar day `months` months after `date` (negative for before), as `YYYY-MM-DD`. */
function monthsFrom(date: string, months: number, days = 0): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCMonth(day.getUTCMonth() + months);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Two monthly invoices, the newest issued today. */
async function issueInvoices(world: TestWorld, today: string): Promise<void> {
  const admin = createAdminClient();
  for (const index of [0, 1]) {
    const issueDate = monthsFrom(today, -index);
    const hash = String(index + 1).repeat(64);
    const stripeInvoiceId = `in_test_billing_page_${index + 1}`;
    const { error } = await admin.rpc('issue_werkflow_invoice', {
      p_organization_id: world.orgId,
      p_stripe_invoice_id: stripeInvoiceId,
      p_stripe_customer_id: CUSTOMER_ID,
      p_stripe_event_id: `evt_test_billing_page_${index + 1}`,
      p_number: `MUSTER-${String(index + 11).padStart(4, '0')}`,
      p_issue_date: issueDate,
      p_buyer: { name: world.orgName },
      p_payment_means: 'direct-debit',
      p_net_cents: 49900,
      p_tax_cents: 0,
      p_gross_cents: 49900,
      p_paid_cents: 49900,
      p_due_cents: 0,
      p_file_key: `werkflow-billing/invoices/${stripeInvoiceId}/${hash}.pdf`,
      p_file_sha256: hash,
      p_file_size_bytes: 1024,
      p_rules_release: '1.3.17',
      p_line_names: ['WerkFlow Monatsabo'],
      p_service_start: issueDate,
      // A month of service ends the day before the next one starts.
      p_service_end: monthsFrom(issueDate, 1, -1),
    });
    if (error) throw new Error(`werkflow invoice seed failed: ${error.message}`);
  }
}

/**
 * Gives the world's organization a running subscription with two invoices,
 * cancelled at the end of its period or not. Each call records a newer read,
 * so the last call's state wins.
 */
export async function seedWerkflowSubscription(
  world: TestWorld,
  { cancelAtPeriodEnd }: { cancelAtPeriodEnd: boolean },
): Promise<void> {
  // The server judges the period against its own clock, so the seed does too.
  const today = new Date().toISOString().slice(0, 10);
  const admin = createAdminClient();
  const begun = await admin.rpc('begin_werkflow_checkout', {
    p_organization_id: world.orgId,
    p_user_id: world.users.admin.id,
    p_linked: true,
    p_stripe_customer_id: CUSTOMER_ID,
  });
  if (begun.error) throw new Error(`subscription seed failed: ${begun.error.message}`);
  const { data: row, error: readError } = await admin
    .from('werkflow_subscriptions')
    .select('stripe_customer_id')
    .eq('organization_id', world.orgId)
    .single();
  if (readError) throw new Error(`subscription read failed: ${readError.message}`);
  const { error } = await admin.rpc('record_werkflow_subscription_state', {
    p_organization_id: world.orgId,
    p_stripe_customer_id: row.stripe_customer_id,
    p_stripe_subscription_id: SUBSCRIPTION_ID,
    p_status: 'active',
    p_cancel_at_period_end: cancelAtPeriodEnd,
    p_current_period_end: `${monthsFrom(today, 1)}T09:00:00.000Z`,
    p_read_at: new Date().toISOString(),
  });
  if (error) throw new Error(`subscription state seed failed: ${error.message}`);
  await issueInvoices(world, today);
}
