// The Stripe sandbox check of the subscription (werk-flow/werkflow-planning#248).
// Run by hand on the agent server, never in a test run:
//
//   STRIPE_SANDBOX_KEY_FILE=<path> bun scripts/stripe-sandbox.ts
//
// It reads the sandbox key from that file only, refuses any key that is not
// a test key, and never prints the key or a response body: only ids and
// states. The database is an in-memory stand-in that follows the SQL
// functions supabase/tests/werkflow_subscriptions.sql proves (read times
// aside). For three made-up customers it:
// - opens the Checkout through WerkFlow's own openCheckout: a second start
//   answers the same session, and a start near its expiry expires it at
//   Stripe before it opens the next;
// - creates the subscription through the API with Stripe's test IBANs (a
//   debit that succeeds, one that fails) and test card, and waits until the
//   first payment has succeeded or failed;
// - replays each resulting subscription event, twice, to the real webhook
//   route behind a local endpoint, signed with a secret it generates; then
//   re-reads the subscription from Stripe and checks that the recorded status
//   and cancellation reason are Stripe's, that a failed debit leaves a state
//   that holds (no lockout), and that a replay changes nothing;
// - for the successful debit and the card, starts a second subscription of
//   the same customer and checks that its signal refunds and cancels it at
//   once and keeps the first, recorded as Stripe holds it.
// It confirms each SEPA mandate with a return URL, so Stripe sees no
// incomplete confirmation. It cancels its subscriptions and expires its
// Checkouts at the end.
import { mock } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Stripe from 'stripe';

const keyFile = process.env.STRIPE_SANDBOX_KEY_FILE;
if (!keyFile) throw new Error('Set STRIPE_SANDBOX_KEY_FILE to the sandbox key file.');
const key = readFileSync(keyFile, 'utf8').trim();
if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
  throw new Error('Refused: the file holds no Stripe test key.');
}
delete process.env.VERCEL_ENV;
process.env.STRIPE_SECRET_KEY = key;
process.env.STRIPE_WEBHOOK_SECRET = `whsec_${randomBytes(24).toString('hex')}`;

// --- The database stand-in: the signal ledger and the subscription rows. ---
type Row = Record<string, unknown>;
const ledger = new Map<string, { settled: boolean; attempts: number }>();
const rows = new Map<string, Row>();
const recordCalls: Row[] = [];
/** Each row's duplicate_subscription_ids, as `organization subscription`. */
const duplicates = new Set<string>();
const holds = (status: unknown, reason: unknown) =>
  ['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(String(status)) ||
  (status === 'canceled' && reason === 'payment_failed');
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const after = (time: unknown, minutes = 0) =>
  typeof time === 'string' && Date.parse(time) > Date.now() + minutes * 60_000;
type Answer = { data: unknown; error: { message: string } | null };
function answer(name: string, args: Row): Answer {
  const id = String(args.p_stripe_event_id);
  const row = rows.get(String(args.p_organization_id));
  if (name === 'consume_rate_limit') return { data: true, error: null };
  if (name === 'claim_werkflow_billing_signal') {
    const entry = ledger.get(id) ?? { settled: false, attempts: 0 };
    ledger.set(id, entry);
    if (entry.settled) return { data: { result: 'settled', attempt: entry.attempts }, error: null };
    entry.attempts += 1;
    return { data: { result: 'claimed', attempt: entry.attempts }, error: null };
  }
  if (name === 'settle_werkflow_billing_signal') {
    const entry = ledger.get(id);
    if (entry && args.p_outcome !== 'failed') entry.settled = true;
    return { data: true, error: null };
  }
  if (name === 'begin_werkflow_checkout') {
    const held: Row = row ?? {
      stripe_customer_id: args.p_stripe_customer_id,
      stripe_subscription_id: null,
      holds_subscription: false,
      checkout_attempt: 0,
    };
    rows.set(String(args.p_organization_id), held);
    const reply = (result: string, session: Row = {}): Answer => ({
      data: {
        result,
        stripe_customer_id: held.stripe_customer_id,
        attempt: held.checkout_attempt,
        ...session,
      },
      error: null,
    });
    if (held.holds_subscription) return reply('subscribed');
    if (after(held.checkout_expires_at, 15) && held.checkout_session_id !== args.p_closed_session_id) {
      return reply('open', { session_id: held.checkout_session_id, session_url: held.checkout_url });
    }
    if (after(held.checkout_claimed_until)) return reply('busy');
    held.checkout_attempt = Number(held.checkout_attempt) + 1;
    held.checkout_claimed_until = later(2);
    return reply('claimed', { session_id: held.checkout_session_id ?? null, session_url: null });
  }
  if (name === 'finish_werkflow_checkout') {
    if (!row || row.checkout_attempt !== args.p_attempt || !after(row.checkout_claimed_until)) {
      return { data: false, error: null };
    }
    if (typeof args.p_session_id === 'string') {
      Object.assign(row, {
        checkout_session_id: args.p_session_id,
        checkout_url: args.p_session_url,
        checkout_expires_at: args.p_expires_at,
      });
    }
    row.checkout_claimed_until = null;
    return { data: true, error: null };
  }
  if (name === 'record_werkflow_subscription_state') {
    if (!row) return { data: null, error: { message: 'subscription_row_missing' } };
    if (row.stripe_customer_id !== args.p_stripe_customer_id) {
      return { data: null, error: { message: 'subscription_customer_mismatch' } };
    }
    const incomingHolds = holds(args.p_status, args.p_cancellation_reason);
    if (row.stripe_subscription_id !== null && row.stripe_subscription_id !== args.p_stripe_subscription_id) {
      if (!incomingHolds) return { data: 'ignored', error: null };
      const duplicate = `${String(args.p_organization_id)} ${String(args.p_stripe_subscription_id)}`;
      if (duplicates.has(duplicate)) return { data: 'duplicate', error: null };
      if (row.holds_subscription) {
        if (args.p_refuse_as_duplicate !== true) {
          return { data: null, error: { message: 'subscription_conflict' } };
        }
        duplicates.add(duplicate);
        return { data: 'duplicate', error: null };
      }
    }
    recordCalls.push(args);
    Object.assign(row, {
      stripe_subscription_id: args.p_stripe_subscription_id,
      status: args.p_status,
      cancellation_reason: args.p_cancellation_reason ?? null,
      holds_subscription: incomingHolds,
    });
    return { data: 'recorded', error: null };
  }
  throw new Error(`unexpected database function ${name}`);
}
/** readOrganizationSubscription's read of one row. */
function rowQuery() {
  let organizationId = '';
  const query = {
    select: () => query,
    eq: (_column: string, value: string) => {
      organizationId = value;
      return query;
    },
    maybeSingle: async () => {
      const row = rows.get(organizationId);
      return { data: row ? { organization_id: organizationId, ...row } : null, error: null };
    },
  };
  return query;
}
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: (name: string, args: Row) => {
      const result = Promise.resolve(answer(name, args));
      return Object.assign(result, { single: () => result });
    },
    from: () => rowQuery(),
  }),
}));
process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.test';
process.env.EMAIL_OTP_HASH_SECRET = randomBytes(32).toString('hex');

const { POST } = await import('../app/api/stripe/webhook/route');
const { resolveStripeGateway } = await import('@/lib/werkflow-billing/stripe');
const { openCheckout } = await import('@/lib/subscription/checkout');
const resolved = resolveStripeGateway();
if (!resolved.ok) throw new Error(`The gateway refused the sandbox configuration: ${resolved.code}`);
const gateway = resolved.gateway.subscriptions;
const client = new Stripe(key);

const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => POST(request) });
const endpoint = `http://127.0.0.1:${server.port}/api/stripe/webhook`;
const say = (line: string) => console.log(`[stripe-sandbox] ${line}`);
/** The call in progress, named in a failure. */
let step = 'start';

/** The sandbox's check price; created once, found by its lookup key afterwards. */
async function checkPrice(): Promise<string> {
  const lookupKey = 'werkflow_sandbox_check_monthly';
  const found = await client.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const product = await client.products.create({ name: 'WerkFlow Sandbox-Prüfung' });
  const price = await client.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: 100,
    recurring: { interval: 'month' },
    lookup_key: lookupKey,
  });
  return price.id;
}

type Case = {
  label: string;
  method: 'sepa_debit' | 'card';
  iban?: string;
  /** The first payment's final PaymentIntent state. */
  payment: 'succeeded' | 'requires_payment_method';
  expect: (status: string, reason: unknown) => boolean;
  /** A second subscription of this customer is started and must be refunded and cancelled. */
  duplicate: boolean;
};
const CASES: Case[] = [
  {
    label: 'SEPA, debit succeeds',
    method: 'sepa_debit',
    iban: 'DE89370400440532013000',
    payment: 'succeeded',
    expect: (status) => status === 'active',
    duplicate: true,
  },
  {
    label: 'SEPA, debit fails',
    method: 'sepa_debit',
    iban: 'DE62370400440532013001',
    payment: 'requires_payment_method',
    // No lockout: past due, or a cancellation for the failed payment, which
    // still holds. Stripe may also keep it active until a retry.
    expect: (status, reason) =>
      status === 'active' || status === 'past_due' || (status === 'canceled' && reason === 'payment_failed'),
    duplicate: false,
  },
  {
    label: 'card',
    method: 'card',
    payment: 'succeeded',
    expect: (status) => status === 'active',
    duplicate: true,
  },
];

async function paymentMethodFor(customer: string, testCase: Case): Promise<string> {
  step = `${testCase.method} payment method`;
  if (testCase.method === 'card')
    return (await client.paymentMethods.attach('pm_card_visa', { customer })).id;
  const method = await client.paymentMethods.create({
    type: 'sepa_debit',
    sepa_debit: { iban: testCase.iban ?? '' },
    billing_details: { name: 'Haustechnik Sonnenberg GmbH', email: 'rechnung@example.com' },
  });
  step = 'SEPA mandate';
  await client.setupIntents.create({
    customer,
    payment_method: method.id,
    // Stripe's API takes no payment_method_types any more; a return URL keeps every confirmation complete.
    automatic_payment_methods: { enabled: true },
    return_url: 'https://app.example.test/upgrade',
    confirm: true,
    mandate_data: {
      customer_acceptance: {
        type: 'online',
        online: { ip_address: '127.0.0.1', user_agent: 'werkflow-sandbox-check' },
      },
    },
  });
  return method.id;
}

/** Signs an event with the local secret and delivers it to the local endpoint; answers the status. */
async function deliver(event: Stripe.Event): Promise<number> {
  const payload = JSON.stringify(event);
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'stripe-signature': signature },
    body: payload,
  });
  return response.status;
}

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

async function eventsOf(customer: string, since: number): Promise<Stripe.Event[]> {
  const page = await client.events.list({ created: { gte: since }, limit: 100 });
  return page.data
    .filter((event) => SUBSCRIPTION_EVENTS.has(event.type))
    .filter((event) => {
      const object: unknown = event.data.object;
      return typeof object === 'object' && object !== null && Reflect.get(object, 'customer') === customer;
    })
    .reverse();
}

/** Stripe's or any other error, by type, code, parameter name and request id only: a message can quote request data. */
function describe(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return [error.type, error.statusCode, error.code, error.param && `param ${error.param}`, error.requestId]
      .filter(Boolean)
      .join(' ');
  }
  return error instanceof Error ? error.name : 'unknown error';
}

/** The state of the PaymentIntent that pays the subscription's latest invoice. */
async function firstPaymentState(subscriptionId: string): Promise<{ intent: string | null; status: string }> {
  const subscription = await client.subscriptions.retrieve(subscriptionId);
  const invoice = subscription.latest_invoice;
  const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id;
  if (!invoiceId) return { intent: null, status: 'no invoice' };
  const payments = await client.invoicePayments.list({ invoice: invoiceId, limit: 1 });
  const intent = payments.data[0]?.payment.payment_intent;
  const intentId = typeof intent === 'string' ? intent : intent?.id;
  if (!intentId) return { intent: null, status: 'no payment' };
  return { intent: intentId, status: (await client.paymentIntents.retrieve(intentId)).status };
}

/**
 * Whether the organization's recorded subscription is the one Stripe holds
 * now, with Stripe's status and cancellation reason; answers the line to print.
 */
async function recordedAsStripe(
  organizationId: string,
  subscriptionId: string,
): Promise<{ same: boolean; status: string; reason: string | null; line: string }> {
  const stripe = await client.subscriptions.retrieve(subscriptionId);
  const reason = stripe.cancellation_details?.reason ?? null;
  const row = rows.get(organizationId);
  const recordedReason = row?.cancellation_reason ?? null;
  const same =
    row?.stripe_subscription_id === subscriptionId &&
    row.status === stripe.status &&
    recordedReason === reason;
  const named = (status: unknown, why: unknown) => `${String(status)}${why ? ` (${String(why)})` : ''}`;
  return {
    same,
    status: stripe.status,
    reason,
    line: `recorded ${named(row?.status, recordedReason)}, Stripe ${named(stripe.status, reason)}`,
  };
}

/** Waits until a condition holds, checking every five seconds, up to the limit. */
async function waitFor(seconds: number, done: () => Promise<boolean>): Promise<boolean> {
  for (let waited = 0; waited < seconds; waited += 5) {
    if (await done()) return true;
    await Bun.sleep(5000);
  }
  return done();
}

/**
 * WerkFlow's Checkout guard against the real Checkout API: a second start
 * answers the open session, and a start near its expiry expires it before it
 * opens the next. Answers the customer and whether the guard held.
 */
async function checkCheckoutGuard(
  organizationId: string,
  label: string,
): Promise<{ customer: string; ok: boolean }> {
  step = 'Checkout';
  const request = {
    organizationId,
    userId: randomUUID(),
    email: 'rechnung@example.com',
    name: 'Haustechnik Sonnenberg GmbH',
    linked: true,
  };
  const first = await openCheckout(request);
  const again = await openCheckout(request);
  const row = rows.get(organizationId);
  const firstSession = String(row?.checkout_session_id);
  if (row) row.checkout_expires_at = later(10);
  const next = await openCheckout(request);
  const nextSession = String(rows.get(organizationId)?.checkout_session_id);
  const states = await Promise.all(
    [firstSession, nextSession].map(async (id) => (await client.checkout.sessions.retrieve(id)).status),
  );
  const ok =
    first.ok &&
    again.ok &&
    next.ok &&
    again.url === first.url &&
    next.url !== first.url &&
    states[0] === 'expired' &&
    states[1] === 'open';
  say(
    `${label}: Checkout ${firstSession} opened, second start ${again.ok && first.ok && again.url === first.url ? 'shared it' : 'DID NOT SHARE IT'}, near expiry ${states[0]}, then ${nextSession} ${states[1]}: ${ok ? 'ok' : 'FAILED'}`,
  );
  return { customer: String(row?.stripe_customer_id), ok };
}

/** Delivers a subscription's created event once Stripe lists it; answers the event and the endpoint's status. */
async function deliverCreated(customer: string, subscriptionId: string, since: number) {
  let created: Stripe.Event | undefined;
  await waitFor(60, async () => {
    created = (await eventsOf(customer, since)).find(
      (event) =>
        event.type === 'customer.subscription.created' &&
        Reflect.get(event.data.object, 'id') === subscriptionId,
    );
    return created !== undefined;
  });
  if (!created) throw new Error('the created event never appeared');
  return { event: created, status: await deliver(created) };
}

/**
 * A second subscription of a customer whose first one holds: its signal
 * refunds and cancels it at once, the first stays recorded, and a redelivery
 * settles. Answers whether that held.
 */
async function checkDuplicate(
  label: string,
  customer: string,
  organizationId: string,
  priceId: string,
  paymentMethod: string,
  since: number,
  subscriptions: string[],
): Promise<boolean> {
  step = 'second subscription';
  const kept = rows.get(organizationId)?.stripe_subscription_id;
  const second = await client.subscriptions.create({
    customer,
    items: [{ price: priceId }],
    default_payment_method: paymentMethod,
    metadata: { werkflow_organization_id: organizationId },
  });
  subscriptions.push(second.id);
  const { event, status: first } = await deliverCreated(customer, second.id, since);
  const redelivery = await deliver(event);
  const current = await client.subscriptions.retrieve(second.id);
  const payment = await firstPaymentState(second.id);
  const refunds = payment.intent
    ? (await client.refunds.list({ payment_intent: payment.intent, limit: 10 })).data
    : [];
  const keptState = await recordedAsStripe(organizationId, String(kept));
  const ok =
    first === 500 &&
    redelivery === 200 &&
    current.status === 'canceled' &&
    refunds.length > 0 &&
    keptState.same;
  say(
    `${label}: second subscription ${second.id} answered ${first}, redelivery ${redelivery}; Stripe ${current.status}, payment ${payment.status}, refund ${refunds.map((refund) => refund.status).join(',') || 'none'}; kept ${String(kept)} ${keptState.line}: ${ok ? 'ok' : 'FAILED'}`,
  );
  return ok;
}

async function main(): Promise<void> {
  const since = Math.floor(Date.now() / 1000) - 5;
  const priceId = await checkPrice();
  process.env.STRIPE_MONTHLY_PRICE_ID = priceId;
  say(`price ${priceId}`);
  const subscriptions: string[] = [];
  const checkouts: string[] = [];
  let failed = false;
  for (const testCase of CASES) {
    const organizationId = randomUUID();
    const guard = await checkCheckoutGuard(organizationId, testCase.label);
    if (!guard.ok) failed = true;
    const { customer } = guard;
    checkouts.push(String(rows.get(organizationId)?.checkout_session_id));
    const paymentMethod = await paymentMethodFor(customer, testCase);
    step = 'subscription';
    const subscription = await client.subscriptions.create({
      customer,
      items: [{ price: priceId }],
      default_payment_method: paymentMethod,
      metadata: { werkflow_organization_id: organizationId },
    });
    subscriptions.push(subscription.id);
    say(`${testCase.label}: subscription ${subscription.id} ${subscription.status}`);

    // Stripe settles a SEPA debit within about half a minute in the sandbox;
    // the subscription's state follows the payment's.
    step = 'first payment';
    let payment = await firstPaymentState(subscription.id);
    await waitFor(120, async () => {
      payment = await firstPaymentState(subscription.id);
      return payment.status === testCase.payment;
    });
    await waitFor(60, async () => {
      const current = await client.subscriptions.retrieve(subscription.id);
      return testCase.expect(current.status, current.cancellation_details?.reason);
    });
    // Stripe lists an event a few seconds after it happens. Each event is
    // delivered once and replayed once; an event Stripe lists later (its state
    // moved on meanwhile) is delivered too, until the record is Stripe's.
    const delivered = new Set<string>();
    let recorded = await recordedAsStripe(organizationId, subscription.id);
    await waitFor(60, async () => {
      for (const event of await eventsOf(customer, since)) {
        if (delivered.has(event.id)) continue;
        delivered.add(event.id);
        const first = await deliver(event);
        const recordedBefore = recordCalls.length;
        const replay = await deliver(event);
        const replayChanged = recordCalls.length !== recordedBefore;
        say(
          `${testCase.label}: ${event.id} ${event.type} answered ${first}, replay ${replay}${replayChanged ? ' CHANGED' : ''}`,
        );
        if (first !== 200 || replay !== 200 || replayChanged) failed = true;
      }
      // The final check: Stripe re-read after delivery, compared with the record.
      recorded = await recordedAsStripe(organizationId, subscription.id);
      return delivered.size > 0 && recorded.same;
    });
    const ok =
      payment.status === testCase.payment &&
      delivered.size > 0 &&
      recorded.same &&
      testCase.expect(recorded.status, recorded.reason);
    say(`${testCase.label}: payment ${payment.status}, ${recorded.line}: ${ok ? 'ok' : 'FAILED'}`);
    if (!ok) failed = true;
    if (
      testCase.duplicate &&
      !(await checkDuplicate(
        testCase.label,
        customer,
        organizationId,
        priceId,
        paymentMethod,
        since,
        subscriptions,
      ))
    ) {
      failed = true;
    }
  }

  const handledEvents = recordCalls.length;
  step = 'cleanup';
  for (const id of subscriptions) {
    const current = await client.subscriptions.retrieve(id);
    const status =
      current.status === 'canceled' ? current.status : (await client.subscriptions.cancel(id)).status;
    say(`cleanup: ${id} ${status}`);
  }
  for (const id of checkouts) await gateway.closeCheckout(id);
  say(`cleanup: ${checkouts.length} Checkouts expired`);
  await server.stop(true);
  say(`${handledEvents} subscription states recorded; each replay changed nothing`);
  if (failed) {
    say('FAILED');
    process.exit(1);
  }
  say('passed');
}

try {
  await main();
} catch (error) {
  say(`stopped at ${step}: ${describe(error)}`);
  await server.stop(true);
  process.exit(1);
}
