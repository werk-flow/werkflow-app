// The debit notice, invoice mail and receipt, the pre-notification rule and the
// daily comparison (werk-flow/werkflow-planning#492) over an in-memory
// database, R2 and Resend. The ledger functions answer as the database does;
// supabase/tests/werkflow_billing_mails.sql proves those. Each mail and each
// alarm goes out once, a replayed signal or a second run sends nothing more,
// every SEPA debit has a notice at least 2 days ahead or an alarm says it has
// not, and no address or mail text reaches a log line.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import * as nextServer from 'next/server';
import Stripe from 'stripe';

import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  werkflow_billing_mails: [],
  werkflow_invoices: [],
  werkflow_billing_signals: [{ stripe_event_id: 'evt_test_recorded' }],
  werkflow_billing_reconciliations: [],
};
const mails = () => tables.werkflow_billing_mails ?? [];
const logged: string[] = [];
console.error = (...parts: unknown[]) => {
  logged.push(parts.map((part) => JSON.stringify(part)).join(' '));
};

/** The query chains the code under test builds, over `tables`. */
function query(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let newestFirst = false;
  let window: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  const rows = () => {
    const found = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    if (newestFirst) found.sort((a, b) => String(b.ran_at).localeCompare(String(a.ran_at)));
    return { data: found.slice(window[0], window[1] + 1), error: null };
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    },
    order: (_column: string, options?: { ascending: boolean }) => {
      newestFirst = options?.ascending === false;
      return builder;
    },
    limit: (count: number) => {
      window = [0, count - 1];
      return builder;
    },
    // Awaited as it is, or bounded by `.limit` first.
    in: (column: string, values: readonly unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return Object.assign(Promise.resolve(rows()), {
        limit: async (count: number) => ({ data: rows().data.slice(0, count), error: null }),
      });
    },
    range: async (from: number, to: number) => {
      window = [from, to];
      return rows();
    },
    maybeSingle: async () => ({ data: rows().data[0] ?? null, error: null }),
    insert: async (row: Row) => {
      tables[table]?.push({ id: crypto.randomUUID(), ran_at: new Date().toISOString(), ...row });
      return { error: null };
    },
  };
  return builder;
}

mock.module('server-only', () => ({}));
mock.module('next/server', () => ({ ...nextServer, connection: async () => {} }));
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: query,
    rpc: async (name: string, args: Row) => {
      if (name === 'claim_werkflow_billing_mail') {
        let row = mails().find(
          (mail) => mail.kind === args.p_kind && mail.stripe_object_id === args.p_stripe_object_id,
        );
        if (!row) {
          row = {
            id: crypto.randomUUID(),
            kind: args.p_kind,
            stripe_object_id: args.p_stripe_object_id,
            state: 'pending',
          };
          mails().push(row);
        }
        return { data: row.state === 'sent' ? null : row.id, error: null };
      }
      if (name === 'settle_werkflow_billing_mail') {
        const row = mails().find((mail) => mail.id === args.p_mail_id);
        assert.ok(row && row.state !== 'sent');
        row.state = args.p_outcome;
        row.failure_code = args.p_failure_code ?? null;
        row.sent_at = args.p_outcome === 'sent' ? new Date().toISOString() : null;
        return { data: true, error: null };
      }
      throw new Error(`unexpected function ${name}`);
    },
  }),
}));
const PDF = new TextEncoder().encode('%PDF-1.7 Musterrechnung');
mock.module('@/lib/storage/r2', () => ({
  // The originals are issued already (werkflow_invoices below): the issue step stores nothing.
  putWerkflowBillingObject: async () => assert.fail('an issued invoice was stored again'),
  readWerkflowBillingObject: async (path: string) => {
    if (!path.startsWith('werkflow-billing/invoices/')) throw new Error('storage_object_missing');
    return PDF;
  },
}));

// A fake Resend: answers each request with the next queued status, then 200; a known key answers its first id.
const resendAnswers: number[] = [];
const sent: { to: string; subject: string; text: string; attachments: unknown }[] = [];
const resendKeys = new Map<string, string>();
globalThis.fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    const key = new Headers(init?.headers).get('idempotency-key') ?? '';
    const known = resendKeys.get(key);
    if (known) return Response.json({ id: known });
    const status = resendAnswers.shift() ?? 200;
    if (status !== 200) return Response.json({ name: 'daily_quota_exceeded' }, { status });
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(typeof body === 'object' && body !== null);
    const to: unknown = Reflect.get(body, 'to');
    sent.push({
      to: Array.isArray(to) ? String(to[0]) : '',
      subject: String(Reflect.get(body, 'subject')),
      text: String(Reflect.get(body, 'text')),
      attachments: Reflect.get(body, 'attachments'),
    });
    resendKeys.set(key, `resend-${sent.length}`);
    return Response.json({ id: `resend-${sent.length}` });
  },
  { preconnect: fetch.preconnect },
);

Object.assign(process.env, {
  VERCEL_ENV: 'preview',
  RESEND_API_KEY: 're_test_synthetic',
  FROM_EMAIL: 'WerkFlow <rechnung@example.com>',
  WERKFLOW_ALARM_EMAIL: 'alarm@example.com',
  WERKFLOW_BILLING_REPLY_TO: 'abrechnung@example.com',
  WERKFLOW_SELLER_NAME: 'Musterfirma Software',
  WERKFLOW_SELLER_STREET: 'Musterweg 1',
  WERKFLOW_SELLER_POSTAL_CODE: '01234',
  WERKFLOW_SELLER_CITY: 'Musterstadt',
  WERKFLOW_SELLER_TAX_NUMBER: '12/345/67890',
  WERKFLOW_SELLER_EMAIL: 'hallo@musterfirma.example',
  WERKFLOW_SELLER_CREDITOR_ID: 'DE98ZZZ09999999999',
});

const { createFakeStripeGateway } = await import('./fake-stripe-gateway');
const { signalFamilyFor } = await import('@/lib/werkflow-billing/signals/dispatch');
const { reconcileWerkflowBilling } = await import('@/lib/werkflow-billing/reconciliation');
const { formatBerlinLocalDate } = await import('@/lib/date-time/berlin');
const { GET } = await import('../../../app/api/werkflow-billing-reconciliation/route');

const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);
const dayIn = (days: number) => formatBerlinLocalDate(new Date((NOW + days * DAY) * 1000));
const CUSTOMER = 'rechnung@sonnenberg.example';
const ALARM = 'alarm@example.com';
const SEPA = { kind: 'sepa_debit', ibanLastFour: '3000', mandateReference: 'MUSTERMANDAT0001' } as const;
const upcoming = (
  subscriptionId: string,
  days: number,
  method: typeof SEPA | { kind: 'card'; lastFour: string },
) => ({
  subscriptionId,
  customerId: 'cus_test_0001',
  amountCents: 4900,
  renewsAt: NOW + days * DAY,
  method,
});
const invoiceDebit = (
  id: string,
  expectedDebitDate: string | null,
  subscriptionId = `sub_${id}`,
): Awaited<ReturnType<StripeGateway['readInvoiceDebit']>> => ({
  id,
  subscriptionId,
  renewsAt: NOW,
  status: 'open',
  amountPaidCents: 0,
  paidAt: null,
  method: SEPA,
  expectedDebitDate,
});
const invoiceDebits = {
  in_test_first: invoiceDebit('in_test_first', dayIn(3)),
  in_test_sameday: invoiceDebit('in_test_sameday', dayIn(0)),
  in_test_pending: invoiceDebit('in_test_pending', null),
  in_test_quota: invoiceDebit('in_test_quota', dayIn(5)),
  in_test_renewal: {
    ...invoiceDebit('in_test_renewal', dayIn(0), 'sub_test_renew'),
    renewsAt: NOW + 7 * DAY,
  },
};
for (const id of Object.keys(invoiceDebits)) {
  tables.werkflow_invoices?.push({
    id: `row_${id}`,
    stripe_invoice_id: id,
    number: `MUSTER-${id.slice(8)}`,
    issue_date: dayIn(0),
    gross_cents: 4900,
    due_cents: 4900,
    file_key: `werkflow-billing/invoices/${id}/${'a'.repeat(64)}.pdf`,
    stripe_customer_id: 'cus_test_0001',
  });
}
const objects = {
  customers: {
    cus_test_0001: {
      id: 'cus_test_0001',
      organizationId: crypto.randomUUID(),
      email: CUSTOMER,
      name: 'Haustechnik Sonnenberg GmbH',
    },
  },
  upcomingDebits: {
    sub_test_renew: upcoming('sub_test_renew', 7, SEPA),
    sub_test_short: upcoming('sub_test_short', 1, SEPA),
    sub_test_card: upcoming('sub_test_card', 7, { kind: 'card', lastFour: '4242' }),
  },
  invoiceDebits,
  finalizedInvoices: [
    ...['in_test_first', 'in_test_pending', 'in_test_unissued'].map((id) => ({
      id,
      finalizedAt: NOW - 2 * DAY,
    })),
    { id: 'in_test_young', finalizedAt: NOW - 60 },
  ],
  eventIds: ['evt_test_recorded', 'evt_test_lost'],
};
const SECRET = 'whsec_test_invoice_mails';
const stripe = createFakeStripeGateway(SECRET, { objects });

let eventCount = 0;
async function deliver(type: Stripe.Event.Type, object: Row): Promise<string | null> {
  eventCount += 1;
  const payload = JSON.stringify({
    id: `evt_test_mail_${eventCount}`,
    object: 'event',
    type,
    created: NOW,
    data: { object },
  });
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: SECRET });
  const event = await stripe.verifySignal(payload, signature);
  assert.ok(event);
  try {
    await signalFamilyFor(type)?.handle(event, stripe);
    return null;
  } catch (error) {
    const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
    return typeof code === 'string' ? code : 'uncoded';
  }
}
const renewal = (subscription: string) => ({ parent: { subscription_details: { subscription } } });
const alarms = (title: string) => sent.filter((mail) => mail.to === ALARM && mail.subject.includes(title));
const LATE = 'Lastschrift zu kurzfristig angekündigt';

// A SEPA renewal 7 days ahead gets one debit notice with every detail; a replay sends nothing more.
assert.equal(await deliver('invoice.upcoming', renewal('sub_test_renew')), null);
assert.equal(await deliver('invoice.upcoming', renewal('sub_test_renew')), null);
assert.deepEqual(
  sent.map((mail) => [mail.to, mail.subject]),
  [[CUSTOMER, `Ankündigung: Lastschrift für WerkFlow am ${dayIn(7).split('-').reverse().join('.')}`]],
);
for (const part of ['49,00', '3000', 'MUSTERMANDAT0001', 'DE98ZZZ09999999999', 'hallo@musterfirma.example']) {
  assert.ok(sent[0]?.text.includes(part), `the debit notice lacks ${part}`);
}
// A notice 1 day ahead still goes out, and raises the alarm; a card renewal needs no notice.
assert.equal(await deliver('invoice.upcoming', renewal('sub_test_short')), null);
assert.equal(alarms(LATE).length, 1);
const beforeCard = sent.length;
assert.equal(await deliver('invoice.upcoming', renewal('sub_test_card')), null);
assert.equal(sent.length, beforeCard, 'a card renewal got a debit notice');
// Time passes: the renewal's notice went out 7 days before its debit.
const notice = mails().find(
  (mail) => mail.kind === 'debit_notice' && String(mail.stripe_object_id).startsWith('sub_test_renew_'),
);
assert.ok(notice);
notice.sent_at = new Date((NOW - 7 * DAY) * 1000).toISOString();

// The first invoice: its original issued, the mail goes once with the PDF and announces the debit.
assert.equal(await deliver('invoice.finalized', { id: 'in_test_first' }), null);
assert.equal(await deliver('invoice.finalized', { id: 'in_test_first' }), null);
const invoiceMails = sent.filter((mail) => mail.subject === 'Deine WerkFlow-Rechnung MUSTER-first');
assert.equal(invoiceMails.length, 1, 'the invoice mail did not go exactly once');
assert.ok(invoiceMails[0]?.text.includes(dayIn(3).split('-').reverse().join('.')));
assert.deepEqual(invoiceMails[0]?.attachments, [
  {
    filename: 'WerkFlow-Rechnung-MUSTER-first.pdf',
    content: Buffer.from(PDF).toString('base64'),
    content_type: 'application/pdf',
  },
]);
// A debit the same day as its only notice raises the alarm; a renewal noticed 7 days ahead does not.
assert.equal(await deliver('invoice.finalized', { id: 'in_test_sameday' }), null);
assert.equal(await deliver('invoice.finalized', { id: 'in_test_renewal' }), null);
assert.equal(alarms(LATE).length, 2);
assert.ok(alarms(LATE).at(-1)?.text.includes('in_test_sameday'));
// Without Stripe's debit date the mail waits and Stripe delivers again.
assert.equal(await deliver('invoice.finalized', { id: 'in_test_pending' }), 'werkflow_debit_date_pending');
// A refused send stays failed and the signal fails, so Stripe delivers again.
resendAnswers.push(429);
assert.equal(await deliver('invoice.finalized', { id: 'in_test_quota' }), 'email_daily_quota_exceeded');

// The rule: every SEPA debit had a notice at least 2 days ahead, or an alarm for it went out.
const sentAt = (kind: string, id: string) =>
  mails().find((mail) => mail.kind === kind && mail.stripe_object_id === id && mail.state === 'sent')
    ?.sent_at;
for (const debit of Object.values(invoiceDebits)) {
  if (!debit.expectedDebitDate || debit.id === 'in_test_quota') continue;
  const noticeAt =
    sentAt('debit_notice', `${debit.subscriptionId}_${debit.renewsAt}`) ?? sentAt('invoice', debit.id);
  assert.ok(noticeAt, `${debit.id} was debited without a notice`);
  const early =
    formatBerlinLocalDate(new Date(Date.parse(String(noticeAt)) + 2 * DAY * 1000)) <= debit.expectedDebitDate;
  assert.ok(
    early || alarms(LATE).some((mail) => mail.text.includes(debit.id)),
    `${debit.id}: late notice without an alarm`,
  );
}

// The receipt goes once on invoice.paid; the invoice mail is not sent again.
invoiceDebits.in_test_first = { ...invoiceDebits.in_test_first, status: 'paid', amountPaidCents: 4900 };
assert.equal(await deliver('invoice.paid', { id: 'in_test_first' }), null);
assert.equal(await deliver('invoice.paid', { id: 'in_test_first' }), null);
assert.equal(
  sent.filter((mail) => mail.subject === 'Zahlung erhalten: WerkFlow-Rechnung MUSTER-first').length,
  1,
);
assert.equal(sent.filter((mail) => mail.subject === 'Deine WerkFlow-Rechnung MUSTER-first').length, 1);

// The daily comparison. A run 30 hours ago means one was missed; a refused alarm and a
// receipt whose invoice Stripe no longer answers are still failed.
tables.werkflow_billing_reconciliations?.push({
  id: '49200000-0000-4000-8000-000000000001',
  ran_at: new Date((NOW - 30 * 3600) * 1000).toISOString(),
});
mails().push(
  {
    id: crypto.randomUUID(),
    kind: 'alarm.debit_failed',
    stripe_object_id: 'in_test_alarm',
    state: 'failed',
    failure_code: 'email_daily_quota_exceeded',
  },
  {
    id: crypto.randomUUID(),
    kind: 'receipt',
    stripe_object_id: 'in_test_gone',
    state: 'failed',
    failure_code: 'email_daily_quota_exceeded',
  },
);
const run = await reconcileWerkflowBilling(stripe);
assert.deepEqual([run.complete, run.invoicesCompared, run.mailsResent], [true, 3, 3]);
assert.ok(sentAt('invoice', 'in_test_quota'), 'the refused invoice mail was not resent');
assert.ok(alarms('Zahlung fehlgeschlagen')[0]?.text.includes('vom täglichen Abgleich'));
assert.equal(alarms('Täglicher Abgleich ausgefallen').length, 1);
assert.ok(alarms('Abrechnungsmail weiter nicht zugestellt')[0]?.text.includes('in_test_gone'));
const undelivered = alarms('Rechnung nicht zugestellt').map((mail) => mail.text);
assert.equal(undelivered.length, 2, 'the comparison missed a file or a mail, or alarmed a young invoice');
assert.ok(undelivered.some((text) => text.includes('in_test_unissued') && text.includes('Original: fehlt')));
assert.ok(
  undelivered.some((text) => text.includes('in_test_pending') && text.includes('Rechnungsmail: fehlt')),
);
assert.ok(alarms('Stripe-Signale bleiben aus')[0]?.text.includes('evt_test_lost'));
assert.equal(tables.werkflow_billing_reconciliations?.length, 2, 'the run was not recorded');

// A second run the same day alarms nobody again.
const beforeSecond = sent.length;
assert.equal((await reconcileWerkflowBilling(stripe)).complete, true);
assert.equal(sent.length, beforeSecond, 'a second run sent a mail or an alarm again');

// The route runs nothing without the cron secret, a wrong one, or a Stripe key.
const call = (authorization?: string) =>
  GET(
    new Request('https://app.example.test/api/werkflow-billing-reconciliation', {
      headers: authorization ? { authorization } : {},
    }),
  );
const runs = tables.werkflow_billing_reconciliations?.length;
assert.equal((await call()).status, 503);
process.env.CRON_SECRET = 'synthetic-cron-secret-0123456789abcdef';
assert.equal((await call('Bearer wrong')).status, 404);
assert.equal((await call(`Bearer ${process.env.CRON_SECRET}`)).status, 503);
assert.equal(tables.werkflow_billing_reconciliations?.length, runs, 'a refused call ran the comparison');

const logText = logged.join('\n');
for (const leak of ['sonnenberg', CUSTOMER, ALARM, 'MUSTERMANDAT0001', 're_test_synthetic']) {
  assert.ok(!logText.includes(leak), `a log line carried ${leak}`);
}
