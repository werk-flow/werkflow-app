import { randomUUID } from 'node:crypto';
import type { TestUser, TestWorld } from '../world';
import { createAdminClient } from './shared';

// WerkFlow's own subscription and invoices of a world's organization, for the
// billing page's audits and captures (werk-flow/werkflow-planning#252). They
// are written through the functions Stripe's signals call; no test reaches
// Stripe. The ids and numbers are made up, of Stripe's test form.

/** Made-up Stripe ids of the test form, one set per organization, so worlds sharing a database never collide. */
function stripeIdsOf(organizationId: string) {
  const key = organizationId.replaceAll('-', '');
  return {
    customer: `cus_test_${key}`,
    subscription: `sub_test_${key}`,
    invoice: (index: number) => `in_test_${key}_${index}`,
    event: (index: number) => `evt_test_${key}_${index}`,
    number: (index: number) => `MUSTER-${key.slice(0, 8)}-${String(index + 10).padStart(4, '0')}`,
  };
}

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
  const ids = stripeIdsOf(world.orgId);
  for (const index of [0, 1]) {
    const issueDate = monthsFrom(today, -index);
    const hash = String(index + 1).repeat(64);
    const stripeInvoiceId = ids.invoice(index + 1);
    const { error } = await admin.rpc('issue_werkflow_invoice', {
      p_organization_id: world.orgId,
      p_stripe_invoice_id: stripeInvoiceId,
      p_stripe_customer_id: ids.customer,
      p_stripe_event_id: ids.event(index + 1),
      p_number: ids.number(index + 1),
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

/** An organization a seed bills, with the Admin who paid its Checkout. */
type BilledOrganization = { orgId: string; admin: Pick<TestUser, 'id'> };

function ownOrganization(world: TestWorld): BilledOrganization {
  return { orgId: world.orgId, admin: world.users.admin };
}

/** Links a paid Checkout to the organization and returns its Stripe customer. */
async function beginSubscription(organization: BilledOrganization): Promise<string> {
  const admin = createAdminClient();
  const begun = await admin.rpc('begin_werkflow_checkout', {
    p_organization_id: organization.orgId,
    p_user_id: organization.admin.id,
    p_linked: true,
    p_stripe_customer_id: stripeIdsOf(organization.orgId).customer,
  });
  if (begun.error) throw new Error(`subscription seed failed: ${begun.error.message}`);
  const { data: row, error: readError } = await admin
    .from('werkflow_subscriptions')
    .select('stripe_customer_id')
    .eq('organization_id', organization.orgId)
    .single();
  if (readError) throw new Error(`subscription read failed: ${readError.message}`);
  return row.stripe_customer_id;
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
  await recordRunningSubscription(ownOrganization(world), cancelAtPeriodEnd, today);
  await issueInvoices(world, today);
}

/**
 * Gives the world's outsider organization a running subscription without an
 * invoice: no other set seeds there, so its deletion meets no retained record.
 */
export async function seedOutsiderSubscription(world: TestWorld): Promise<void> {
  await recordRunningSubscription(world.outsider, false, new Date().toISOString().slice(0, 10));
}

async function recordRunningSubscription(
  organization: BilledOrganization,
  cancelAtPeriodEnd: boolean,
  today: string,
): Promise<void> {
  const { error } = await createAdminClient().rpc('record_werkflow_subscription_state', {
    p_organization_id: organization.orgId,
    p_stripe_customer_id: await beginSubscription(organization),
    p_stripe_subscription_id: stripeIdsOf(organization.orgId).subscription,
    p_status: 'active',
    p_cancel_at_period_end: cancelAtPeriodEnd,
    p_current_period_end: `${monthsFrom(today, 1)}T09:00:00.000Z`,
    p_read_at: new Date().toISOString(),
  });
  if (error) throw new Error(`subscription state seed failed: ${error.message}`);
}

/** Gives the world's organization a subscription Stripe ended because its first debit failed, without an invoice. */
export async function seedSubscriptionEndedAfterFailedDebit(world: TestWorld): Promise<void> {
  const { error } = await createAdminClient().rpc('record_werkflow_subscription_state', {
    p_organization_id: world.orgId,
    p_stripe_customer_id: await beginSubscription(ownOrganization(world)),
    p_stripe_subscription_id: stripeIdsOf(world.orgId).subscription,
    p_status: 'canceled',
    p_cancel_at_period_end: false,
    p_cancellation_reason: 'payment_failed',
    p_read_at: new Date().toISOString(),
  });
  if (error) throw new Error(`subscription state seed failed: ${error.message}`);
}

/**
 * Reserves a new organization's id for the user, as an unpaid Checkout's
 * start does (werk-flow/werkflow-planning#248); returns the reserved id.
 */
export async function seedOpenReservation(userId: string): Promise<string> {
  const organizationId = randomUUID();
  const { error } = await createAdminClient().rpc('begin_werkflow_checkout', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_linked: false,
    p_stripe_customer_id: stripeIdsOf(organizationId).customer,
  });
  if (error) throw new Error(`reservation seed failed: ${error.message}`);
  return organizationId;
}

/**
 * Records a paid Checkout of a reservation, as Stripe's signals would
 * (werk-flow/werkflow-planning#248): the user reserved a new organization's
 * id and its subscription is active. The user then names the organization on
 * /onboarding/create-organization, as the first one of a new account or as
 * an Admin's further one (werk-flow/werkflow-planning#495).
 */
export async function seedPaidReservation(userId: string): Promise<void> {
  const organizationId = await seedOpenReservation(userId);
  const ids = stripeIdsOf(organizationId);
  const { error: recordError } = await createAdminClient().rpc('record_werkflow_subscription_state', {
    p_organization_id: organizationId,
    p_stripe_customer_id: ids.customer,
    p_stripe_subscription_id: ids.subscription,
    p_status: 'active',
    p_cancel_at_period_end: false,
    p_read_at: new Date().toISOString(),
  });
  if (recordError) throw new Error(`reservation subscription seed failed: ${recordError.message}`);
}
