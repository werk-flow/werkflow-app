// The Stripe sandbox check of the subscription (werk-flow/werkflow-planning#248).
// Run by hand on the agent server, never in a test run:
//
//   STRIPE_SANDBOX_KEY_FILE=<path> bun scripts/stripe-sandbox.ts
//
// It reads the sandbox key from that file only, refuses any key that is not
// a test key, and never prints the key or a response body: only ids and
// states. For three made-up customers it creates the Stripe customer and the
// Checkout through WerkFlow's own gateway, then the subscription through the
// API with Stripe's test IBANs (a debit that succeeds, one that fails) and
// test card. It replays each resulting subscription event, twice, to the
// real webhook route behind a local endpoint, signed with a secret it
// generates; the database is an in-memory stand-in that records what
// record_werkflow_subscription_state receives (supabase/tests/werkflow_subscriptions.sql
// proves the function). It checks that each organization ends in Stripe's
// state, that a failed debit leaves the subscription past due, never ended,
// and that a replay changes nothing. It cancels its subscriptions at the end.
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

// --- The database stand-in: the signal ledger and the recorded states. ---
type Row = Record<string, unknown>;
const ledger = new Map<string, { settled: boolean; attempts: number }>();
const recorded = new Map<string, Row>();
const recordCalls: Row[] = [];
function answer(name: string, args: Row): { data: unknown; error: null } {
  const id = String(args.p_stripe_event_id);
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
  if (name === 'record_werkflow_subscription_state') {
    recordCalls.push(args);
    recorded.set(String(args.p_organization_id), args);
    return { data: 'recorded', error: null };
  }
  throw new Error(`unexpected database function ${name}`);
}
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: (name: string, args: Row) => {
      const result = Promise.resolve(answer(name, args));
      return Object.assign(result, { single: () => result });
    },
  }),
}));

const { POST } = await import('../app/api/stripe/webhook/route');
const { resolveStripeGateway } = await import('@/lib/werkflow-billing/stripe');
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
  expect: (status: string, reason: unknown) => boolean;
};
const CASES: Case[] = [
  {
    label: 'SEPA, debit succeeds',
    method: 'sepa_debit',
    iban: 'DE89370400440532013000',
    expect: (status) => status === 'active',
  },
  {
    label: 'SEPA, debit fails',
    method: 'sepa_debit',
    iban: 'DE62370400440532013001',
    // No lockout: past due, or a cancellation for the failed payment, which still holds.
    expect: (status, reason) =>
      status === 'past_due' || (status === 'canceled' && reason === 'payment_failed'),
  },
  { label: 'card', method: 'card', expect: (status) => status === 'active' },
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
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
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

async function main(): Promise<void> {
  const since = Math.floor(Date.now() / 1000) - 5;
  const priceId = await checkPrice();
  say(`price ${priceId}`);
  const subscriptions: string[] = [];
  let failed = false;
  for (const testCase of CASES) {
    const organizationId = randomUUID();
    const customer = await gateway.createCustomer({
      organizationId,
      email: 'rechnung@example.com',
      name: 'Haustechnik Sonnenberg GmbH',
    });
    recorded.delete(organizationId);
    const checkoutUrl = await gateway.createCheckoutSession({
      customerId: customer,
      organizationId,
      priceId,
      successUrl: 'https://app.example.test/upgrade/bestaetigt',
      cancelUrl: 'https://app.example.test/upgrade',
      attempt: await gateway.closeOpenCheckouts(customer),
    });
    say(`${testCase.label}: customer ${customer}, Checkout ${new URL(checkoutUrl).hostname} opened`);
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

    // Stripe settles a SEPA debit within about half a minute in the sandbox.
    let current = subscription;
    for (
      let waited = 0;
      waited < 120 && !testCase.expect(current.status, current.cancellation_details?.reason);
      waited += 5
    ) {
      await Bun.sleep(5000);
      current = await client.subscriptions.retrieve(subscription.id);
    }
    // Stripe lists an event a few seconds after it happens.
    let events = await eventsOf(customer, since);
    for (
      let waited = 0;
      waited < 60 && !events.some((event) => event.type === 'customer.subscription.created');
      waited += 5
    ) {
      await Bun.sleep(5000);
      events = await eventsOf(customer, since);
    }
    for (const event of events) {
      const first = await deliver(event);
      const recordedBefore = recordCalls.length;
      const replay = await deliver(event);
      const replayChanged = recordCalls.length !== recordedBefore;
      say(
        `${testCase.label}: ${event.id} ${event.type} answered ${first}, replay ${replay}${replayChanged ? ' CHANGED' : ''}`,
      );
      if (first !== 200 || replay !== 200 || replayChanged) failed = true;
    }
    const state = recorded.get(organizationId);
    const status = String(state?.p_status);
    const reason = state?.p_cancellation_reason ?? null;
    const ok = state?.p_stripe_subscription_id === subscription.id && testCase.expect(status, reason);
    say(
      `${testCase.label}: recorded ${status}${reason ? ` (${String(reason)})` : ''}, Stripe ${current.status}: ${ok ? 'ok' : 'FAILED'}`,
    );
    if (!ok) failed = true;
  }

  const handledEvents = recordCalls.length;
  step = 'cleanup';
  for (const id of subscriptions) {
    const current = await client.subscriptions.retrieve(id);
    const status =
      current.status === 'canceled' ? current.status : (await client.subscriptions.cancel(id)).status;
    say(`cleanup: ${id} ${status}`);
  }
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
