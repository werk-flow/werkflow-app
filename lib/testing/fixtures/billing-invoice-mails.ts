// The debit notice, invoice mail and receipt, the pre-notification rule and the
// daily comparison (werk-flow/werkflow-planning#492) over an in-memory
// database, R2 and Resend. The ledger functions answer as the database does;
// supabase/tests/werkflow_billing_mails.sql proves those. Each mail and each
// alarm goes out once, a replayed signal or a second run sends nothing more,
// every SEPA debit has a notice at least 2 days ahead or an alarm says it has
// not, and no address or mail text reaches a log line.
import assert from 'node:assert/strict';
import { mock, setSystemTime } from 'bun:test';
import * as nextServer from 'next/server';
import Stripe from 'stripe';

import type { StripeGateway } from '@/lib/werkflow-billing/stripe';

// testing.md: no wall clock in a unit test. A day far from a DST change.
setSystemTime(new Date('2026-11-20T09:00:00Z'));

type Row = Record<string, unknown>;
/** The next read of a sent debit notice fails, as a lost database connection would. */
let failNoticeRead = false;
/** The next claim of an alarm's row fails, as a lost database connection would. */
let failAlarmClaim = false;
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
  let kind: unknown = null;
  const sorts: { column: string; ascending: boolean }[] = [];
  let window: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  const rows = () => {
    const found = (tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
    const compare = (a: Row, b: Row) => {
      for (const { column, ascending } of sorts) {
        const order = String(a[column] ?? '').localeCompare(String(b[column] ?? ''));
        if (order !== 0) return ascending ? order : -order;
      }
      return 0;
    };
    found.sort(compare);
    return { data: found.slice(window[0], window[1] + 1), error: null };
  };
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      if (column === 'kind') kind = value;
      filters.push((row) => row[column] === value);
      return builder;
    },
    order: (column: string, options?: { ascending: boolean }) => {
      sorts.push({ column, ascending: options?.ascending !== false });
      return builder;
    },
    // Awaited as it is (the failed mails), or read on with `.maybeSingle`. PostgREST answers
    // at most its row cap (supabase/config.toml `max_rows`) without an error.
    limit: (count: number) => {
      window = [0, Math.min(count, 1000) - 1];
      return Object.assign(Promise.resolve().then(rows), { maybeSingle: builder.maybeSingle });
    },
    is: (column: string, value: null) => {
      filters.push((row) => (row[column] ?? null) === value);
      return builder;
    },
    // Awaited as it is, or narrowed by `.is` and bounded by `.limit` first.
    in: (column: string, values: readonly unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      const limit = async (count: number) => ({ data: rows().data.slice(0, count), error: null });
      return Object.assign(Promise.resolve(rows()), {
        limit,
        is: (other: string, value: null) => {
          filters.push((row) => (row[other] ?? null) === value);
          return { limit };
        },
      });
    },
    range: async (from: number, to: number) => {
      window = [from, to];
      return rows();
    },
    maybeSingle: async () => {
      if (failNoticeRead && kind === 'debit_notice') {
        failNoticeRead = false;
        return { data: null, error: { code: '08006', message: 'connection lost' } };
      }
      return { data: rows().data[0] ?? null, error: null };
    },
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
        if (failAlarmClaim && String(args.p_kind).startsWith('alarm.')) {
          failAlarmClaim = false;
          return { data: null, error: { code: '08006', message: 'connection lost' } };
        }
        let row = mails().find(
          (mail) => mail.kind === args.p_kind && mail.stripe_object_id === args.p_stripe_object_id,
        );
        if (!row) {
          row = {
            id: crypto.randomUUID(),
            kind: args.p_kind,
            organization_id: args.p_organization_id,
            stripe_object_id: args.p_stripe_object_id,
            state: 'pending',
          };
          mails().push(row);
        }
        if (row.state !== 'sent') row.updated_at = new Date().toISOString();
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
      if (name === 'expire_werkflow_billing_mail') {
        const row = mails().find(
          (mail) =>
            mail.id === args.p_mail_id &&
            mail.organization_id === args.p_organization_id &&
            mail.kind === 'debit_notice' &&
            mail.state === 'failed',
        );
        if (row) Object.assign(row, { state: 'expired', failure_code: null });
        return { data: Boolean(row), error: null };
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
/** Each accepted mail, with the ledger row its idempotency key names. */
const sent: { mailId: string; to: string; subject: string; text: string; attachments: unknown }[] = [];
const resendKeys = new Map<string, string>();
/** Resend refuses every mail whose subject contains this, as an exhausted quota would. */
let refuseSubject: string | null = null;
/** Resend accepts the next mail, but its answer is lost on the way back. */
let loseNextAnswer = false;
/** Resend accepts this many more new mails, then refuses each as an exhausted quota would; null is no limit. */
let quotaLeft: number | null = null;
globalThis.fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    const key = new Headers(init?.headers).get('idempotency-key') ?? '';
    const known = resendKeys.get(key);
    if (known) return Response.json({ id: known });
    const body: unknown = JSON.parse(String(init?.body));
    assert.ok(typeof body === 'object' && body !== null);
    const refused = refuseSubject !== null && String(Reflect.get(body, 'subject')).includes(refuseSubject);
    const overQuota = quotaLeft === 0;
    if (quotaLeft !== null && !overQuota) quotaLeft -= 1;
    const status = refused || overQuota ? 429 : (resendAnswers.shift() ?? 200);
    if (status !== 200) return Response.json({ name: 'daily_quota_exceeded' }, { status });
    const to: unknown = Reflect.get(body, 'to');
    sent.push({
      mailId: key.split('/')[1] ?? '',
      to: Array.isArray(to) ? String(to[0]) : '',
      subject: String(Reflect.get(body, 'subject')),
      text: String(Reflect.get(body, 'text')),
      attachments: Reflect.get(body, 'attachments'),
    });
    resendKeys.set(key, `resend-${sent.length}`);
    if (loseNextAnswer) {
      loseNextAnswer = false;
      throw new TypeError('fetch failed');
    }
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
const ORGANIZATION = '49200000-0000-4000-8000-000000000010';
const ALARM = 'alarm@example.com';
const SEPA = { kind: 'sepa_debit', ibanLastFour: '3000', mandateReference: 'MUSTERMANDAT0001' } as const;
/** The account and mandate a customer switched to. */
const SEPA_NEW = { kind: 'sepa_debit', ibanLastFour: '4000', mandateReference: 'MUSTERMANDAT0002' } as const;
type DebitMethod = Awaited<ReturnType<StripeGateway['readUpcomingDebit']>>['method'];
const upcoming = (subscriptionId: string, days: number, method: DebitMethod) => ({
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
  in_test_readfail: invoiceDebit('in_test_readfail', dayIn(5)),
  in_test_lost: invoiceDebit('in_test_lost', dayIn(5)),
  // Debited yesterday and paid; its invoice mail first goes out through the paid backstop.
  in_test_backstop: { ...invoiceDebit('in_test_backstop', dayIn(-1)), status: 'paid', amountPaidCents: 4900 },
  // The renewal noticed 7 days ahead, and one whose amount changed after its notice.
  in_test_renewal: {
    ...invoiceDebit('in_test_renewal', dayIn(7), 'sub_test_renew'),
    renewsAt: NOW + 7 * DAY,
  },
  in_test_changed: {
    ...invoiceDebit('in_test_changed', dayIn(7), 'sub_test_renew'),
    renewsAt: NOW + 7 * DAY,
  },
  // The renewal of a customer who switched mandate and account a day before it.
  in_test_switch: {
    ...invoiceDebit('in_test_switch', dayIn(7), 'sub_test_switch'),
    renewsAt: NOW + 7 * DAY,
    method: SEPA_NEW,
  },
  // Debited today; its late-notice alarm is refused.
  in_test_alarmrefused: invoiceDebit('in_test_alarmrefused', dayIn(0)),
  // Debited today; its alarm's row cannot be recorded at first.
  in_test_claimfail: invoiceDebit('in_test_claimfail', dayIn(0)),
  // Debited today, with one mail left in the day's quota.
  in_test_lastslot: invoiceDebit('in_test_lastslot', dayIn(0)),
};
for (const id of Object.keys(invoiceDebits)) {
  tables.werkflow_invoices?.push({
    id: `row_${id}`,
    stripe_invoice_id: id,
    number: `MUSTER-${id.slice(8)}`,
    issue_date: dayIn(0),
    gross_cents: id === 'in_test_changed' ? 9900 : 4900,
    due_cents: id === 'in_test_changed' ? 9900 : 4900,
    file_key: `werkflow-billing/invoices/${id}/${'a'.repeat(64)}.pdf`,
    stripe_customer_id: 'cus_test_0001',
  });
}
// A refund's Storno shares its original's Stripe invoice id: the mail and the comparison read the original only.
tables.werkflow_invoices?.unshift({
  id: 'row_in_test_first_storno',
  stripe_invoice_id: 'in_test_first',
  stripe_credit_note_id: 'cn_test_first',
  number: 'MUSTER-first-ST',
  issue_date: dayIn(0),
  gross_cents: -4900,
  due_cents: 0,
  file_key: `werkflow-billing/invoices/in_test_first/${'b'.repeat(64)}.pdf`,
  stripe_customer_id: 'cus_test_0001',
});
const objects = {
  customers: {
    cus_test_0001: {
      id: 'cus_test_0001',
      organizationId: ORGANIZATION,
      email: CUSTOMER,
      name: 'Haustechnik Sonnenberg GmbH',
    },
  },
  upcomingDebits: {
    sub_test_renew: upcoming('sub_test_renew', 7, SEPA),
    sub_test_short: upcoming('sub_test_short', 1, SEPA),
    sub_test_next: upcoming('sub_test_next', 7, SEPA),
    sub_test_switch: upcoming('sub_test_switch', 7, SEPA),
    sub_test_noaddress: upcoming('sub_test_noaddress', 1, SEPA),
    sub_test_claimfail: upcoming('sub_test_claimfail', 1, SEPA),
    sub_test_lastslot: upcoming('sub_test_lastslot', 1, SEPA),
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
assert.equal(await deliver('invoice.upcoming', renewal('sub_test_switch')), null);

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
// A debit the same day as its only notice raises the alarm.
assert.equal(await deliver('invoice.finalized', { id: 'in_test_sameday' }), null);
assert.equal(alarms(LATE).length, 2);
assert.ok(alarms(LATE).at(-1)?.text.includes('in_test_sameday'));
// Without Stripe's debit date the mail waits and Stripe delivers again.
assert.equal(await deliver('invoice.finalized', { id: 'in_test_pending' }), 'werkflow_debit_date_pending');
// A failed read of the debit notice sends no invoice mail, so the next delivery checks and sends.
failNoticeRead = true;
assert.equal(await deliver('invoice.finalized', { id: 'in_test_readfail' }), 'billing_mail_read_failed');
assert.equal(sent.filter((mail) => mail.subject.endsWith('MUSTER-readfail')).length, 0);
assert.equal(await deliver('invoice.finalized', { id: 'in_test_readfail' }), null);
assert.equal(sent.filter((mail) => mail.subject.endsWith('MUSTER-readfail')).length, 1);
// Resend accepted the invoice mail but the answer was lost; the retry after the
// payment renders the same mail, so Resend delivers it once.
loseNextAnswer = true;
assert.equal(await deliver('invoice.finalized', { id: 'in_test_lost' }), 'email_provider_unreachable');
invoiceDebits.in_test_lost = { ...invoiceDebits.in_test_lost, status: 'paid', amountPaidCents: 4900 };
assert.equal(await deliver('invoice.paid', { id: 'in_test_lost' }), null);
assert.equal(
  sent.filter((mail) => mail.subject === 'Deine WerkFlow-Rechnung MUSTER-lost').length,
  1,
  'a second copy went out',
);
// An invoice mail first sent after its debit, by the paid backstop, is late.
assert.equal(await deliver('invoice.paid', { id: 'in_test_backstop' }), null);
assert.equal(alarms(LATE).length, 3);
assert.ok(alarms(LATE).at(-1)?.text.includes('in_test_backstop'));
// A refused send stays failed and the signal fails, so Stripe delivers again.
resendAnswers.push(429);
assert.equal(await deliver('invoice.finalized', { id: 'in_test_quota' }), 'email_daily_quota_exceeded');

// Six days later a replayed upcoming signal finds its notice sent and raises nothing.
setSystemTime(new Date((NOW + 6 * DAY) * 1000));
assert.equal(await deliver('invoice.upcoming', renewal('sub_test_renew')), null);
assert.equal(alarms(LATE).length, 3);
// A customer who switches mandate and account before the renewal gets a new
// notice naming them; one day ahead, it raises the alarm.
objects.upcomingDebits.sub_test_switch = upcoming('sub_test_switch', 7, SEPA_NEW);
assert.equal(await deliver('invoice.upcoming', renewal('sub_test_switch')), null);
assert.equal(
  sent.filter((mail) => mail.subject.startsWith('Ankündigung') && mail.text.includes('MUSTERMANDAT0002'))
    .length,
  1,
  'a changed mandate got no notice of its own',
);
assert.equal(alarms(LATE).length, 4);
// At the renewal its invoice counts the notice of 7 days ago; an invoice of
// another amount does not, nor one whose mandate the old notice did not name.
setSystemTime(new Date((NOW + 7 * DAY + 3600) * 1000));
assert.equal(await deliver('invoice.finalized', { id: 'in_test_renewal' }), null);
assert.equal(await deliver('invoice.finalized', { id: 'in_test_changed' }), null);
assert.equal(alarms(LATE).length, 5);
assert.ok(alarms(LATE).at(-1)?.text.includes('in_test_changed'));
assert.equal(await deliver('invoice.finalized', { id: 'in_test_switch' }), null);
assert.equal(alarms(LATE).length, 6);
assert.ok(alarms(LATE).at(-1)?.text.includes('in_test_switch'));
setSystemTime(new Date(NOW * 1000));

// The rule: every SEPA debit had a notice at least 2 days ahead, or an alarm for it went out.
const sentAt = (kind: string, id: string) =>
  mails().find((mail) => mail.kind === kind && mail.stripe_object_id === id && mail.state === 'sent')
    ?.sent_at;
// The invoices of the alarm cases below are checked there, or after the comparison resends their alarms.
for (const debit of Object.values(invoiceDebits)) {
  if (
    !debit.expectedDebitDate ||
    ['in_test_quota', 'in_test_alarmrefused', 'in_test_claimfail', 'in_test_lastslot'].includes(debit.id)
  )
    continue;
  const gross = tables.werkflow_invoices?.find((row) => row.stripe_invoice_id === debit.id)?.gross_cents;
  const method: DebitMethod = debit.method;
  const sepa = method?.kind === 'sepa_debit' ? method : null;
  // A notice counts for this renewal and amount only if its mail named this debit's mandate and account.
  const notice = mails().find(
    (row) =>
      sepa &&
      row.kind === 'debit_notice' &&
      row.state === 'sent' &&
      String(row.stripe_object_id).startsWith(
        `${debit.subscriptionId}_${debit.renewsAt}_${String(gross)}_`,
      ) &&
      sent.some(
        (mail) =>
          mail.mailId === row.id &&
          mail.text.includes(String(sepa.mandateReference)) &&
          mail.text.includes(String(sepa.ibanLastFour)),
      ),
  );
  const noticeAt = notice?.sent_at ?? sentAt('invoice', debit.id);
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

// An alarm that cannot go out never holds back the customer's mail: the mail
// goes, the signal fails with the alarm's code, and the alarm row stays failed.
const failedAlarm = (id: string) =>
  mails().find(
    (mail) => mail.kind === 'alarm.debit_notice_late' && String(mail.stripe_object_id).includes(id),
  );
delete process.env.WERKFLOW_ALARM_EMAIL;
assert.equal(
  await deliver('invoice.upcoming', renewal('sub_test_noaddress')),
  'billing_alarm_address_missing',
);
process.env.WERKFLOW_ALARM_EMAIL = ALARM;
assert.equal(
  sent.filter(
    (mail) =>
      mail.to === CUSTOMER &&
      mail.subject === `Ankündigung: Lastschrift für WerkFlow am ${dayIn(1).split('-').reverse().join('.')}`,
  ).length,
  2,
  'the notice without an alarm address did not go',
);
assert.deepEqual(
  [failedAlarm('sub_test_noaddress')?.state, failedAlarm('sub_test_noaddress')?.failure_code],
  ['failed', 'billing_alarm_address_missing'],
);
refuseSubject = LATE;
assert.equal(
  await deliver('invoice.finalized', { id: 'in_test_alarmrefused' }),
  'email_daily_quota_exceeded',
);
refuseSubject = null;
assert.ok(sentAt('invoice', 'in_test_alarmrefused'), 'a refused alarm held back the invoice mail');
assert.equal(failedAlarm('in_test_alarmrefused')?.state, 'failed');

// The debit notice and the invoice mail, each with its late alarm.
const lateCases = (id: string) =>
  [
    ['invoice.upcoming', renewal(`sub_test_${id}`), `sub_test_${id}_`],
    ['invoice.finalized', { id: `in_test_${id}` }, `in_test_${id}`],
  ] as const;
/** The customer mails sent under a ledger row whose Stripe object starts with `prefix`. */
const customerMails = (prefix: string) =>
  sent.filter(
    (mail) =>
      mail.to === CUSTOMER &&
      mails().some((row) => row.id === mail.mailId && String(row.stripe_object_id).startsWith(prefix)),
  );
// An alarm whose row cannot be recorded sends nothing, not even the customer
// mail, so Stripe's next delivery sends both, once each.
for (const [type, object, prefix] of lateCases('claimfail')) {
  failAlarmClaim = true;
  assert.equal(await deliver(type, object), 'billing_mail_claim_failed');
  assert.equal(customerMails(prefix).length, 0, `${prefix}: a mail went before its alarm's row was recorded`);
  assert.equal(await deliver(type, object), null);
  assert.equal(customerMails(prefix).length, 1, `${prefix}: the customer mail did not go once`);
  assert.equal(
    alarms(LATE).filter((mail) => mail.text.includes(prefix)).length,
    1,
    `${prefix}: the alarm was lost after a failed claim`,
  );
}
// With one mail left in the quota, the customer mail gets it and the alarm stays failed.
for (const [type, object, prefix] of lateCases('lastslot')) {
  quotaLeft = 1;
  assert.equal(await deliver(type, object), 'email_daily_quota_exceeded');
  quotaLeft = null;
  assert.equal(customerMails(prefix).length, 1, `${prefix}: the alarm took the customer's last slot`);
  assert.deepEqual(
    [failedAlarm(prefix)?.state, failedAlarm(prefix)?.failure_code],
    ['failed', 'email_daily_quota_exceeded'],
  );
}

// The daily comparison. A run 30 hours ago means one was missed; a refused alarm and a
// receipt whose invoice Stripe no longer answers are still failed.
tables.werkflow_billing_reconciliations?.push({
  id: '49200000-0000-4000-8000-000000000001',
  ran_at: new Date((NOW - 30 * 3600) * 1000).toISOString(),
});
// A debit notice for a renewal that has passed is not sent for the next one.
mails().push(
  {
    id: crypto.randomUUID(),
    kind: 'debit_notice',
    organization_id: ORGANIZATION,
    stripe_object_id: `sub_test_next_${NOW - 23 * DAY}_4900_${'0'.repeat(16)}`,
    state: 'failed',
    failure_code: 'email_daily_quota_exceeded',
  },
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
const notices = () => sent.filter((mail) => mail.subject.startsWith('Ankündigung')).length;
const noticesBefore = notices();
const run = await reconcileWerkflowBilling(stripe);
assert.deepEqual([run.complete, run.invoicesCompared, run.mailsResent], [true, 3, 8]);
assert.equal(notices(), noticesBefore, 'a passed renewal got the next renewal notice');
assert.ok(
  alarms('Abrechnungsmail weiter nicht zugestellt').some((mail) => mail.text.includes('sub_test_next_')),
);
// After its alarm, the passed notice leaves the failed rows for good.
assert.equal(
  mails().find((mail) => String(mail.stripe_object_id).startsWith('sub_test_next_'))?.state,
  'expired',
  'a debit notice whose renewal has passed stayed failed',
);
assert.ok(sentAt('invoice', 'in_test_quota'), 'the refused invoice mail was not resent');
assert.ok(alarms('Zahlung fehlgeschlagen')[0]?.text.includes('vom täglichen Abgleich'));
// Both alarms that could not go out before go now, naming their first failure.
for (const [id, code] of [
  ['sub_test_noaddress', 'billing_alarm_address_missing'],
  ['in_test_alarmrefused', 'email_daily_quota_exceeded'],
  ['sub_test_lastslot_', 'email_daily_quota_exceeded'],
  ['in_test_lastslot', 'email_daily_quota_exceeded'],
]) {
  assert.ok(
    alarms(LATE).some(
      (mail) => mail.text.includes(String(id)) && mail.text.includes(`Erster Fehler: ${String(code)}`),
    ),
    `the alarm for ${String(id)} was not resent`,
  );
}
assert.equal(alarms('Täglicher Abgleich ausgefallen').length, 1);
assert.ok(
  alarms('Abrechnungsmail weiter nicht zugestellt').some((mail) => mail.text.includes('in_test_gone')),
);
const undelivered = alarms('Rechnung nicht zugestellt').map((mail) => mail.text);
assert.equal(undelivered.length, 2, 'the comparison missed a file or a mail, or alarmed a young invoice');
assert.ok(undelivered.some((text) => text.includes('in_test_unissued') && text.includes('Original: fehlt')));
assert.ok(
  undelivered.some(
    (text) =>
      text.includes('in_test_pending') &&
      text.includes('Rechnungsmail: fehlt') &&
      text.includes('Grund: werkflow_debit_date_pending'),
  ),
);
assert.ok(alarms('Stripe-Signale bleiben aus')[0]?.text.includes('evt_test_lost'));
assert.equal(tables.werkflow_billing_reconciliations?.length, 2, 'the run was not recorded');

// A second run the same day alarms nobody again.
const beforeSecond = sent.length;
assert.equal((await reconcileWerkflowBilling(stripe)).complete, true);
assert.equal(sent.length, beforeSecond, 'a second run sent a mail or an alarm again');

// An undelivered-mail alarm that fails again is not chained, but the run is incomplete and the route answers 500.
mails().push({
  id: crypto.randomUUID(),
  kind: 'alarm.mail_undelivered',
  stripe_object_id: 'receipt_in_test_lost',
  state: 'failed',
  failure_code: 'email_daily_quota_exceeded',
});
refuseSubject = 'Abrechnungsmail weiter nicht zugestellt';
assert.equal((await reconcileWerkflowBilling(stripe)).complete, false);
refuseSubject = null;

// A failed backlog longer than one run: 1,000 notices whose renewals passed months ago fill the
// first run, which ends them and reports the backlog; the rest, and the alarm behind them, go in the next run.
const backlogNotice = (index: number) =>
  `sub_test_backlog${String(index)}_${NOW - 60 * DAY}_4900_${'0'.repeat(16)}`;
for (let index = 0; index < 1000; index += 1) {
  mails().push({
    id: crypto.randomUUID(),
    kind: 'debit_notice',
    organization_id: ORGANIZATION,
    stripe_object_id: backlogNotice(index),
    state: 'failed',
    failure_code: 'email_daily_quota_exceeded',
    updated_at: new Date((NOW - 60 * DAY) * 1000).toISOString(),
  });
}
mails().push({
  id: crypto.randomUUID(),
  kind: 'alarm.debit_failed',
  stripe_object_id: 'in_test_backlog',
  state: 'failed',
  failure_code: 'email_daily_quota_exceeded',
  updated_at: new Date().toISOString(),
});
const backlogAlarm = () => mails().find((mail) => mail.stripe_object_id === 'in_test_backlog');
assert.equal((await reconcileWerkflowBilling(stripe)).complete, false, 'a backlog left the run complete');
assert.equal(backlogAlarm()?.state, 'failed', 'the run resent more than its batch');
assert.equal((await reconcileWerkflowBilling(stripe)).complete, true);
assert.equal(backlogAlarm()?.state, 'sent', 'the failed backlog held back the retry');
for (let index = 0; index < 1000; index += 1) {
  const notice = mails().find((mail) => mail.stripe_object_id === backlogNotice(index));
  assert.equal(notice?.state, 'expired', `the passed notice ${String(index)} stayed failed`);
}

// The route runs nothing without the cron secret, a wrong one, or a Stripe key.
const call = (authorization?: string) =>
  GET(
    new Request('https://app.example.test/api/werkflow-billing-reconciliation', {
      headers: authorization ? { authorization } : {},
    }),
  );
const runs = tables.werkflow_billing_reconciliations?.length;
// Neither secret comes from the environment the tests run in.
delete process.env.CRON_SECRET;
delete process.env.STRIPE_SECRET_KEY;
assert.equal((await call()).status, 503);
process.env.CRON_SECRET = 'synthetic-cron-secret-0123456789abcdef';
assert.equal((await call('Bearer wrong')).status, 404);
assert.equal((await call(`Bearer ${process.env.CRON_SECRET}`)).status, 503);
assert.equal(tables.werkflow_billing_reconciliations?.length, runs, 'a refused call ran the comparison');

const logText = logged.join('\n');
for (const leak of ['sonnenberg', CUSTOMER, ALARM, 'MUSTERMANDAT0001', 're_test_synthetic']) {
  assert.ok(!logText.includes(leak), `a log line carried ${leak}`);
}
