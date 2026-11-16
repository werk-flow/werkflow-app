// The payment and mandate signal handlers over an in-memory mail ledger and a
// fake Resend (werk-flow/werkflow-planning#251). The ledger answers as the
// database functions do; supabase/tests/werkflow_billing_mails.sql proves
// those. Each wired alarm fires; a handler run again for the same Stripe
// object sends no second mail or alarm; a Resend refusal leaves the mail
// `failed`, the handler throws so Stripe delivers again, and that delivery
// sends it once. No address or mail text reaches a log line.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import Stripe from 'stripe';

type MailRow = {
  id: string;
  kind: string;
  organizationId: string | null;
  recipient: string;
  state: 'pending' | 'sent' | 'failed';
  attempts: number;
  failureCode: string | null;
};

const rows = new Map<string, MailRow>();
let settleFailsFor: string | null = null;
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'claim_werkflow_billing_mail') {
        const key = `${String(args.p_kind)}|${String(args.p_stripe_object_id)}`;
        const organizationId = typeof args.p_organization_id === 'string' ? args.p_organization_id : null;
        assert.equal(String(args.p_kind).startsWith('alarm.'), organizationId === null, 'organization rule');
        const row = rows.get(key) ?? {
          id: `00000000-0000-4000-8000-${String(rows.size + 1).padStart(12, '0')}`,
          kind: String(args.p_kind),
          organizationId,
          recipient: String(args.p_recipient),
          state: 'pending',
          attempts: 0,
          failureCode: null,
        };
        rows.set(key, row);
        if (row.state !== 'sent') row.attempts += 1;
        return { data: row.state === 'sent' ? null : row.id, error: null };
      }
      if (name === 'settle_werkflow_billing_mail') {
        const row = [...rows.values()].find((candidate) => candidate.id === args.p_mail_id);
        if (row && row.kind === settleFailsFor) {
          settleFailsFor = null;
          return { data: null, error: { code: '08006', message: 'connection lost' } };
        }
        if (!row || row.state === 'sent') return { data: false, error: null };
        assert.equal(row.organizationId, args.p_organization_id ?? null);
        row.state = args.p_outcome === 'sent' ? 'sent' : 'failed';
        row.failureCode = typeof args.p_failure_code === 'string' ? args.p_failure_code : null;
        return { data: true, error: null };
      }
      throw new Error(`unexpected function ${name}`);
    },
  }),
}));

// A fake Resend: answers each request with the next queued status, then 200.
const resendAnswers: number[] = [];
const resendBodies: { to: string; subject: string; text: string; key: string | null }[] = [];
let resendIds = 0;
const resendKeys = new Map<string, { payload: string; id: string }>();
globalThis.fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    const key = new Headers(init?.headers).get('idempotency-key');
    const payload = String(init?.body);
    // Resend's contract: a known key with the same payload answers its first id; another payload is refused.
    const earlier = key ? resendKeys.get(key) : undefined;
    if (earlier) {
      return earlier.payload === payload
        ? Response.json({ id: earlier.id })
        : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 });
    }
    const status = resendAnswers.shift() ?? 200;
    if (status !== 200) {
      return Response.json(
        { name: status === 429 ? 'daily_quota_exceeded' : 'validation_error' },
        { status },
      );
    }
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(typeof body === 'object' && body !== null);
    const to: unknown = Reflect.get(body, 'to');
    resendBodies.push({
      to: Array.isArray(to) ? String(to[0]) : '',
      subject: String(Reflect.get(body, 'subject')),
      text: String(Reflect.get(body, 'text')),
      key,
    });
    resendIds += 1;
    if (key) resendKeys.set(key, { payload, id: `resend-${resendIds}` });
    return Response.json({ id: `resend-${resendIds}` });
  },
  { preconnect: fetch.preconnect },
);

process.env.VERCEL_ENV = 'preview';
process.env.RESEND_API_KEY = 're_test_synthetic';
process.env.FROM_EMAIL = 'WerkFlow <rechnung@example.com>';
process.env.WERKFLOW_ALARM_EMAIL = 'alarm@example.com';
process.env.WERKFLOW_BILLING_REPLY_TO = 'abrechnung@example.com';

const { createFakeStripeGateway } = await import('./fake-stripe-gateway');
const { signalFamilyFor } = await import('@/lib/werkflow-billing/signals/dispatch');
const { raiseBillingAlarm } = await import('@/lib/werkflow-billing/mail-delivery');

const ORGANIZATION = '6f1d3c2a-8b4e-4f5a-9c7d-1e2f3a4b5c6d';
const customer = {
  id: 'cus_test_0001',
  organizationId: ORGANIZATION,
  email: 'rechnung@sonnenberg.example',
  name: 'Haustechnik Sonnenberg GmbH',
};
const invoice = (id: string, paymentMethodType: string) => ({
  id,
  customerId: 'cus_test_0001',
  number: `SK5GYCE1-${id.slice(-4)}`,
  status: 'open' as const,
  amountRemainingCents: 4900,
  payUrl: `https://invoice.stripe.com/i/${id}`,
  paymentMethodType,
});
const SECRET = 'whsec_test_billing_mail_signals';
const stripe = createFakeStripeGateway(SECRET, {
  objects: {
    customers: {
      cus_test_0001: customer,
      cus_test_orphan: { ...customer, id: 'cus_test_orphan', organizationId: null },
    },
    invoices: {
      in_test_0001: invoice('in_test_0001', 'sepa_debit'),
      in_test_0002: invoice('in_test_0002', 'card'),
      in_test_0003: invoice('in_test_0003', 'sepa_debit'),
      in_test_0004: invoice('in_test_0004', 'sepa_debit'),
      in_test_0005: { ...invoice('in_test_0005', 'sepa_debit'), customerId: 'cus_test_orphan' },
      in_test_0007: { ...invoice('in_test_0007', 'sepa_debit'), status: 'paid' },
      in_test_0008: { ...invoice('in_test_0008', 'sepa_debit'), amountRemainingCents: 1900 },
      in_test_0009: invoice('in_test_0009', 'paypal'),
      in_test_0010: invoice('in_test_0010', 'sepa_debit'),
    },
    mandates: {
      mandate_test_0001: {
        id: 'mandate_test_0001',
        status: 'inactive',
        customerId: 'cus_test_0001',
        ibanLastFour: '3000',
      },
      mandate_test_0002: {
        id: 'mandate_test_0002',
        status: 'active',
        customerId: 'cus_test_0001',
        ibanLastFour: '3000',
      },
    },
    disputes: {
      dp_test_0001: {
        id: 'dp_test_0001',
        customerId: 'cus_test_0001',
        chargeId: 'py_test_0001',
        amountCents: 4900,
        reason: 'debit_not_authorized',
      },
    },
  },
});

let eventCount = 0;
/** A signed event, verified by the gateway as the endpoint would; the handlers read only its type and object id. */
async function event(type: Stripe.Event.Type, objectId: string): Promise<Stripe.Event> {
  eventCount += 1;
  const payload = JSON.stringify({
    id: `evt_test_${eventCount}`,
    object: 'event',
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { id: objectId } },
  });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  const verified = await stripe.verifySignal(payload, signature);
  assert.ok(verified, 'the test event did not verify');
  return verified;
}
async function deliver(type: Stripe.Event.Type, objectId: string): Promise<string | null> {
  const family = signalFamilyFor(type);
  assert.ok(family, `no family takes ${type}`);
  try {
    await family.handle(await event(type, objectId), stripe);
    return null;
  } catch (error) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
    return typeof code === 'string' ? code : 'uncoded';
  }
}
const sentTo = (recipient: string) => resendBodies.filter((body) => body.to === recipient);
const mailRow = (kind: string, objectId: string) => rows.get(`${kind}|${objectId}`);

// A failed direct debit: one mail to the billing contact and the debit_failed alarm.
assert.equal(await deliver('invoice.payment_failed', 'in_test_0001'), null);
assert.deepEqual(
  resendBodies.map((body) => [body.to, body.subject]),
  [
    ['rechnung@sonnenberg.example', 'Die Lastschrift für WerkFlow hat nicht geklappt'],
    ['alarm@example.com', 'WerkFlow-Alarm: Zahlung fehlgeschlagen'],
  ],
);
assert.ok(resendBodies[0]?.text.includes('SK5GYCE1-0001'));
assert.ok(resendBodies[1]?.text.includes('Kundenmail: an den Rechnungskontakt'));
assert.ok(!resendBodies[1]?.text.includes('Sonnenberg'), 'an alarm carried the customer name');
assert.equal(mailRow('payment_failed', 'in_test_0001')?.organizationId, ORGANIZATION);

// The same failure delivered again (a replay or Stripe's next attempt) sends nothing more.
assert.equal(await deliver('invoice.payment_failed', 'in_test_0001'), null);
assert.equal(resendBodies.length, 2, 'a repeated signal sent a second mail or alarm');

// A declined card sends the card mail instead.
assert.equal(await deliver('invoice.payment_failed', 'in_test_0002'), null);
assert.equal(
  sentTo('rechnung@sonnenberg.example').at(-1)?.subject,
  'Deine Karte wurde für WerkFlow abgelehnt',
);
assert.equal(mailRow('card_problem', 'in_test_0002')?.state, 'sent');

// Resend refuses (quota): both rows stay failed with the reason, the handler throws
// so Stripe delivers again, and that delivery sends each mail once.
const before = resendBodies.length;
resendAnswers.push(429, 429);
assert.equal(await deliver('invoice.payment_failed', 'in_test_0003'), 'email_daily_quota_exceeded');
assert.equal(resendBodies.length, before, 'a refused send was reported as sent');
assert.deepEqual(
  [mailRow('payment_failed', 'in_test_0003')?.state, mailRow('payment_failed', 'in_test_0003')?.failureCode],
  ['failed', 'email_daily_quota_exceeded'],
);
assert.equal(mailRow('alarm.debit_failed', 'in_test_0003')?.state, 'failed');
assert.equal(await deliver('invoice.payment_failed', 'in_test_0003'), null);
assert.equal(await deliver('invoice.payment_failed', 'in_test_0003'), null);
assert.equal(resendBodies.length, before + 2, 'the retried mail and alarm were not sent exactly once');
assert.equal(mailRow('payment_failed', 'in_test_0003')?.state, 'sent');
const keys = resendBodies.slice(before).map((body) => body.key);
assert.ok(
  keys.every((key) => key?.startsWith('werkflow-billing-mail/')),
  'a send had no idempotency key',
);

// A mail Resend refuses for good raises the mail_failed alarm, stays failed and
// is sent again on Stripe's next delivery, once the cause is fixed.
resendAnswers.push(422);
assert.equal(await deliver('invoice.payment_failed', 'in_test_0004'), 'email_validation_error');
assert.equal(mailRow('payment_failed', 'in_test_0004')?.failureCode, 'email_validation_error');
assert.equal(mailRow('alarm.mail_failed', 'in_test_0004')?.state, 'sent');
assert.ok(
  sentTo('alarm@example.com').some((body) => body.subject === 'WerkFlow-Alarm: Abrechnungsmail abgelehnt'),
);
assert.equal(await deliver('invoice.payment_failed', 'in_test_0004'), null);
assert.equal(mailRow('payment_failed', 'in_test_0004')?.state, 'sent');

// A customer without WerkFlow's organization metadata gets no mail; the alarm still fires and says so.
assert.equal(await deliver('invoice.payment_failed', 'in_test_0005'), null);
assert.equal(mailRow('payment_failed', 'in_test_0005'), undefined);
assert.ok(
  sentTo('alarm@example.com').at(-1)?.text.includes('nicht gesendet (customer_without_organization)'),
);

// A failure signal for an invoice paid meanwhile mails nobody; a partly paid one names what is still open.
const beforePaid = resendBodies.length;
assert.equal(await deliver('invoice.payment_failed', 'in_test_0007'), null);
assert.equal(resendBodies.length, beforePaid, 'a paid invoice was dunned');
assert.equal(await deliver('invoice.payment_failed', 'in_test_0008'), null);
assert.ok(
  sentTo('rechnung@sonnenberg.example').at(-1)?.text.includes('19,00'),
  'the open amount was not the remainder',
);

// An unknown payment method gets no guessed customer mail; the alarm says so.
assert.equal(await deliver('invoice.payment_failed', 'in_test_0009'), null);
assert.equal(mailRow('payment_failed', 'in_test_0009'), undefined);
assert.ok(sentTo('alarm@example.com').at(-1)?.text.includes('nicht gesendet (payment_method_unknown)'));

// Resend accepts the alarm but recording it fails: the retry carries changed
// facts ("schon gesendet"), so it must not reuse the key Resend would refuse.
settleFailsFor = 'alarm.debit_failed';
assert.equal(await deliver('invoice.payment_failed', 'in_test_0010'), 'billing_mail_settle_failed');
assert.equal(await deliver('invoice.payment_failed', 'in_test_0010'), null);
assert.equal(mailRow('alarm.debit_failed', 'in_test_0010')?.state, 'sent');
assert.equal(mailRow('payment_failed', 'in_test_0010')?.state, 'sent');
assert.equal(
  sentTo('alarm@example.com').filter((body) => body.text.includes('in_test_0010')).length,
  1,
  'an alarm accepted before a lost settlement was delivered twice',
);

// A returned debit raises debit_reversed and mails no customer.
const beforeDispute = sentTo('rechnung@sonnenberg.example').length;
assert.equal(await deliver('charge.dispute.created', 'dp_test_0001'), null);
assert.equal(sentTo('alarm@example.com').at(-1)?.subject, 'WerkFlow-Alarm: Zahlung zurückgeholt');
assert.equal(sentTo('rechnung@sonnenberg.example').length, beforeDispute);

// An inactive mandate mails the customer and raises mandate_inactive; an active one does nothing.
assert.equal(await deliver('mandate.updated', 'mandate_test_0001'), null);
assert.equal(
  sentTo('rechnung@sonnenberg.example').at(-1)?.subject,
  'Dein Lastschriftmandat für WerkFlow gilt nicht mehr',
);
assert.equal(sentTo('alarm@example.com').at(-1)?.subject, 'WerkFlow-Alarm: Lastschriftmandat ungültig');
const beforeActive = resendBodies.length;
assert.equal(await deliver('mandate.updated', 'mandate_test_0002'), null);
assert.equal(await deliver('mandate.updated', 'mandate_test_0001'), null);
assert.equal(resendBodies.length, beforeActive, 'an active or repeated mandate signal sent mail');

// A4's issue step raises invoice_check_failed through the same entry point, once per invoice.
await raiseBillingAlarm({
  kind: 'invoice_check_failed',
  stripeObjectId: 'in_test_0006',
  facts: [['Grund', 'check_unreachable']],
});
await raiseBillingAlarm({ kind: 'invoice_check_failed', stripeObjectId: 'in_test_0006' });
assert.equal(
  sentTo('alarm@example.com').filter((body) => body.subject.includes('Rechnungsprüfung')).length,
  1,
);

// A Stripe read that fails throws a code, so Stripe delivers again.
assert.equal(await deliver('invoice.payment_failed', 'in_test_missing'), 'stripe_read_failed');

// Without an alarm address the alarm cannot go out: the handler throws instead of losing it.
delete process.env.WERKFLOW_ALARM_EMAIL;
await assert.rejects(
  raiseBillingAlarm({ kind: 'debit_reversed', stripeObjectId: 'dp_test_0002' }),
  (error: unknown) =>
    error instanceof Error && Reflect.get(error, 'code') === 'billing_alarm_address_missing',
);

const logText = logged.join('\n');
for (const leak of ['sonnenberg', 'Sonnenberg', 'alarm@example.com', 'Lastschrift', 're_test_synthetic']) {
  assert.ok(!logText.includes(leak), `a log line carried ${leak}`);
}
