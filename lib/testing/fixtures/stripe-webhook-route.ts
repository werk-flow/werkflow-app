// The real Stripe webhook route over an in-memory signal ledger
// (werk-flow/werkflow-planning#250). The ledger answers as the database
// functions do; supabase/tests/werkflow_billing_signals.sql proves those.
// A missing, forged or stale signature is refused before any record; a
// replayed event changes nothing; a throwing handler answers 5xx and the next
// delivery succeeds; an attempt that outlived its claim settles nothing; a
// live key outside production runs nothing. Logs carry no signature, secret
// or event content.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';

// A fixed instant: signing and Stripe's verification both read the clock.
const NOW = new Date('2026-03-02T08:00:00Z');
const NOW_SECONDS = NOW.getTime() / 1000;
setSystemTime(NOW);

type LedgerRow = {
  eventType: string;
  state: 'pending' | 'handled' | 'ignored';
  attempts: number;
  claimed: boolean;
  lastFailureCode: string | null;
};

const ledger = new Map<string, LedgerRow>();
const rpcCalls: string[] = [];
let databaseDown = false;
// Makes the ledger answer outside its contract, to prove the answers are parsed.
let malformedAnswer: 'claim' | 'settle' | null = null;
let paidHandlerRuns = 0;
let paidHandlerFails = false;
// Runs inside the paid handler: lets a test hand the event to a newer delivery mid-attempt.
let duringPaidHandler = (): void => {};
let finalizedHandlerRuns = 0;
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      const answer = Promise.resolve().then(() => ledgerAnswer(name, args));
      return Object.assign(answer, { single: () => answer });
    },
  }),
}));

// Answers as the two database functions do (supabase/tests/werkflow_billing_signals.sql).
function ledgerAnswer(name: string, args: Record<string, unknown>) {
  rpcCalls.push(name);
  if (databaseDown) return { data: null, error: { code: '08006', message: 'connection lost' } };
  const id = String(args.p_stripe_event_id);
  const row = ledger.get(id);
  if (name === 'claim_werkflow_billing_signal') {
    if (malformedAnswer === 'claim') return { data: { result: 'claimed', attempt: null }, error: null };
    if (!row) {
      const eventType = String(args.p_event_type);
      ledger.set(id, { eventType, state: 'pending', attempts: 1, claimed: true, lastFailureCode: null });
      return { data: { result: 'claimed', attempt: 1 }, error: null };
    }
    if (row.state !== 'pending') return { data: { result: 'settled', attempt: row.attempts }, error: null };
    if (row.claimed) return { data: { result: 'busy', attempt: row.attempts }, error: null };
    row.attempts += 1;
    row.claimed = true;
    return { data: { result: 'claimed', attempt: row.attempts }, error: null };
  }
  if (name === 'settle_werkflow_billing_signal') {
    if (malformedAnswer === 'settle') return { data: 'true', error: null };
    if (!row || row.state !== 'pending' || !row.claimed || row.attempts !== args.p_attempt) {
      return { data: false, error: null };
    }
    const outcome = args.p_outcome;
    assert.ok(outcome === 'handled' || outcome === 'ignored' || outcome === 'failed');
    row.claimed = false;
    if (outcome === 'failed') row.lastFailureCode = String(args.p_failure_code);
    else row.state = outcome;
    return { data: true, error: null };
  }
  throw new Error(`unexpected function ${name}`);
}

mock.module('@/lib/werkflow-billing/signals/invoice-paid', () => ({
  invoicePaidSignals: {
    eventTypes: ['invoice.paid'],
    handle: async () => {
      paidHandlerRuns += 1;
      duringPaidHandler();
      if (paidHandlerFails) {
        throw Object.assign(new Error('Haustechnik Sonnenberg GmbH, in_test_0001'), {
          code: 'invoice_mismatch',
        });
      }
    },
  },
}));
mock.module('@/lib/werkflow-billing/signals/invoice-finalized', () => ({
  invoiceFinalizedSignals: {
    eventTypes: ['invoice.finalized'],
    handle: async () => {
      finalizedHandlerRuns += 1;
    },
  },
}));

const { POST } = await import('../../../app/api/stripe/webhook/route');

const secret = `whsec_${randomBytes(24).toString('hex')}`;
process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic0000';
process.env.STRIPE_WEBHOOK_SECRET = secret;
delete process.env.VERCEL_ENV;

const payloadOf = (id: string, type: string): string =>
  JSON.stringify({
    id,
    object: 'event',
    type,
    created: NOW_SECONDS - 5,
    livemode: false,
    data: { object: { id: 'in_test_0001', customer: 'cus_test_0001' } },
  });
const signed = async (payload: string, options: { secret?: string; timestamp?: number } = {}) =>
  Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: options.secret ?? secret,
    ...(options.timestamp ? { timestamp: options.timestamp } : {}),
  });
const deliver = async (payload: string, signature?: string): Promise<number> => {
  const response = await POST(
    new Request('https://app.example.test/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(signature ? { 'stripe-signature': signature } : {}),
      },
      body: payload,
    }),
  );
  assert.equal(await response.text(), '', 'a webhook answer carried a body');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.status;
};

// A missing, forged or stale signature, or a body altered after signing, is
// refused before anything is recorded.
const finalized = payloadOf('evt_test_finalized_1', 'invoice.finalized');
assert.equal(await deliver(finalized), 400, 'a missing signature was not refused');
assert.equal(await deliver(finalized, await signed(finalized, { secret: 'whsec_forged' })), 400, 'forged');
const stale = await signed(finalized, { timestamp: NOW_SECONDS - 600 });
assert.equal(await deliver(finalized, stale), 400, 'a stale signature was not refused');
const altered = finalized.replace('invoice.finalized', 'invoice.paid');
assert.equal(await deliver(altered, await signed(finalized)), 400, 'an altered body was not refused');
assert.equal(await deliver(finalized, 't=1,v1=00'), 400, 'a malformed signature was not refused');
assert.deepEqual(rpcCalls, [], 'a refused signal reached the ledger');
assert.equal(ledger.size, 0);

// A verified event runs its handler once and settles; a replay answers 200 and changes nothing.
assert.equal(await deliver(finalized, await signed(finalized)), 200);
assert.deepEqual(ledger.get('evt_test_finalized_1'), {
  eventType: 'invoice.finalized',
  state: 'handled',
  attempts: 1,
  claimed: false,
  lastFailureCode: null,
});
const settledRow = structuredClone(ledger.get('evt_test_finalized_1'));
rpcCalls.length = 0;
assert.equal(await deliver(finalized, await signed(finalized)), 200, 'a replayed event was not acknowledged');
assert.deepEqual(ledger.get('evt_test_finalized_1'), settledRow, 'a replayed event changed its record');
assert.deepEqual(rpcCalls, ['claim_werkflow_billing_signal'], 'a replayed event did more than look it up');
assert.equal(finalizedHandlerRuns, 1, 'a replayed event ran its handler again');

// A throwing handler answers 5xx and keeps the event open with its code; the next delivery succeeds.
const paid = payloadOf('evt_test_paid_1', 'invoice.paid');
paidHandlerFails = true;
assert.equal(await deliver(paid, await signed(paid)), 500, 'a throwing handler did not answer 5xx');
assert.deepEqual(ledger.get('evt_test_paid_1'), {
  eventType: 'invoice.paid',
  state: 'pending',
  attempts: 1,
  claimed: false,
  lastFailureCode: 'invoice_mismatch',
});
paidHandlerFails = false;
assert.equal(await deliver(paid, await signed(paid)), 200, 'the delivery after a failure did not succeed');
assert.equal(ledger.get('evt_test_paid_1')?.state, 'handled');
assert.equal(ledger.get('evt_test_paid_1')?.attempts, 2);
assert.equal(paidHandlerRuns, 2);

// Another delivery of an event while one holds its claim runs nothing and asks Stripe to retry.
const busy = payloadOf('evt_test_busy_1', 'invoice.paid');
ledger.set('evt_test_busy_1', {
  eventType: 'invoice.paid',
  state: 'pending',
  attempts: 1,
  claimed: true,
  lastFailureCode: null,
});
assert.equal(await deliver(busy, await signed(busy)), 409);
assert.equal(paidHandlerRuns, 2, 'a busy event ran its handler');

// An attempt that outlived its claim, while a newer delivery took the event,
// settles nothing: handled, it answers 409 so Stripe delivers again; failed,
// it answers 500. The newer attempt's claim stays, and it settles the event.
const overtaken = payloadOf('evt_test_overtaken_1', 'invoice.paid');
const newerDelivery = () => {
  const row = ledger.get('evt_test_overtaken_1');
  assert.ok(row);
  row.attempts += 1;
};
const heldByNewer = {
  eventType: 'invoice.paid',
  state: 'pending',
  attempts: 2,
  claimed: true,
  lastFailureCode: null,
};
duringPaidHandler = newerDelivery;
assert.equal(await deliver(overtaken, await signed(overtaken)), 409, 'a stale attempt settled its event');
assert.deepEqual(ledger.get('evt_test_overtaken_1'), heldByNewer, 'a stale attempt changed the newer claim');
paidHandlerFails = true;
ledger.delete('evt_test_overtaken_1');
assert.equal(await deliver(overtaken, await signed(overtaken)), 500);
assert.deepEqual(ledger.get('evt_test_overtaken_1'), heldByNewer, 'a stale failure released the newer claim');
paidHandlerFails = false;
duringPaidHandler = () => {};
const newer = ledgerAnswer('settle_werkflow_billing_signal', {
  p_stripe_event_id: 'evt_test_overtaken_1',
  p_attempt: 2,
  p_outcome: 'handled',
});
assert.equal(newer.data, true, 'the newer attempt could not settle its event');
assert.equal(ledger.get('evt_test_overtaken_1')?.state, 'handled');
assert.equal(paidHandlerRuns, 4);

// A type no family takes is recorded and ignored.
const unknown = payloadOf('evt_test_unknown_1', 'customer.created');
assert.equal(await deliver(unknown, await signed(unknown)), 200);
assert.equal(ledger.get('evt_test_unknown_1')?.state, 'ignored');

// A ledger outage answers 503 and runs no handler.
const outage = payloadOf('evt_test_outage_1', 'invoice.paid');
databaseDown = true;
assert.equal(await deliver(outage, await signed(outage)), 503);
databaseDown = false;
assert.equal(paidHandlerRuns, 4, 'a handler ran without a recorded claim');

// An answer outside the ledger's contract is an outage: a claim without its
// attempt runs no handler, and a settle that is no boolean settles nothing.
const oddClaim = payloadOf('evt_test_odd_claim_1', 'invoice.paid');
malformedAnswer = 'claim';
assert.equal(await deliver(oddClaim, await signed(oddClaim)), 503);
assert.equal(paidHandlerRuns, 4, 'a handler ran on a claim without its attempt');
const oddSettle = payloadOf('evt_test_odd_settle_1', 'invoice.paid');
malformedAnswer = 'settle';
assert.equal(await deliver(oddSettle, await signed(oddSettle)), 503);
assert.equal(paidHandlerRuns, 5);
// The same after a failed handler: the ledger did not record the failure.
const oddFailedSettle = payloadOf('evt_test_odd_settle_2', 'invoice.paid');
paidHandlerFails = true;
assert.equal(await deliver(oddFailedSettle, await signed(oddFailedSettle)), 503);
paidHandlerFails = false;
malformedAnswer = null;
assert.equal(paidHandlerRuns, 6);

// A live key outside production, a test key in production and a missing
// webhook secret run nothing.
rpcCalls.length = 0;
const configurations: Array<[string, string | undefined, string | undefined]> = [
  ['sk_live_synthetic0000', undefined, secret],
  ['sk_live_synthetic0000', 'preview', secret],
  ['sk_test_synthetic0000', 'production', secret],
  ['sk_test_synthetic0000', undefined, undefined],
];
for (const [key, vercelEnv, webhookSecret] of configurations) {
  process.env.STRIPE_SECRET_KEY = key;
  if (vercelEnv) process.env.VERCEL_ENV = vercelEnv;
  else delete process.env.VERCEL_ENV;
  if (webhookSecret) process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  else delete process.env.STRIPE_WEBHOOK_SECRET;
  const fresh = payloadOf('evt_test_refused_key', 'invoice.paid');
  assert.equal(
    await deliver(fresh, await signed(fresh)),
    503,
    `${key} in ${vercelEnv ?? 'a test'} was accepted`,
  );
}
assert.deepEqual(rpcCalls, [], 'a refused configuration reached the ledger');

// The logs name failures by code only.
const logText = logged.join('\n');
assert.ok(logText.includes('stale_attempt'), 'a stale attempt was not logged by its code');
for (const leak of [secret, 'Haustechnik Sonnenberg', 'in_test_0001', 'cus_test_0001', 'connection lost']) {
  assert.ok(!logText.includes(leak), `a log line carried ${leak}`);
}
assert.ok(logText.includes('stripe_live_key_outside_production'), 'a refused key was not logged by its code');
