// The refund mail cases; lib/werkflow-billing/refund-mail.test.ts runs them in their own process.
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import Stripe from 'stripe';

import {
  CARD_INVOICE_ANSWERS,
  creditNoteAnswers,
  MADE_UP_SELLER,
  ORGANIZATION_ID,
  stripeCreditNote,
} from '@/lib/testing/fixtures/stripe-invoices';
import type { StripeBillingCustomer } from '@/lib/werkflow-billing/stripe';

mock.module('server-only', () => ({}));

// The credit note signal runs for real: the Storno is issued and checked, then
// mailed through A6a's ledger and transport. Its database, R2 and Resend are
// in memory. `issue_werkflow_storno` and the two ledger functions answer as
// their SQL does; supabase/tests/werkflow_invoices.sql and
// werkflow_billing_mails.sql prove those.

type InvoiceRow = Record<string, unknown> & { id: string };
type MailRow = {
  id: string;
  kind: string;
  organizationId: string | null;
  state: 'pending' | 'sent' | 'failed';
};

const invoices: InvoiceRow[] = [];
const mails = new Map<string, MailRow & { failureCode: string | null }>();
const stored = new Map<string, Uint8Array>();
const issueCalls: string[] = [];

function invoiceQuery(filters: ReadonlyArray<readonly [string, unknown]>) {
  const rows = () => invoices.filter((row) => filters.every(([column, value]) => row[column] === value));
  return {
    eq: (column: string, value: unknown) => invoiceQuery([...filters, [column, value]]),
    is: (column: string, value: unknown) => invoiceQuery([...filters, [column, value]]),
    limit: () => invoiceQuery(filters),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (result: { data: InvoiceRow[]; error: null }) => void) =>
      resolve({ data: rows(), error: null }),
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('not a record');
  return Object.fromEntries(Object.entries(value));
}

/** As issue_werkflow_storno: the Storno and any replacement once per credit note, with the cancelled row's customer. */
function issueStorno(args: Record<string, unknown>): string {
  const creditNoteId = String(args.p_stripe_credit_note_id);
  issueCalls.push(creditNoteId);
  if (invoices.some((row) => row.stripe_credit_note_id === creditNoteId && row.type_code === '384')) {
    return 'already_issued';
  }
  const cancelled = invoices.find((row) => row.id === args.p_cancels_invoice_id);
  if (!cancelled || cancelled.organization_id !== args.p_organization_id) throw new Error('cancelled row');
  const issued = (document: Record<string, unknown>, typeCode: '380' | '384') => {
    invoices.push({
      ...document,
      id: crypto.randomUUID(),
      organization_id: cancelled.organization_id,
      stripe_invoice_id: cancelled.stripe_invoice_id,
      stripe_customer_id: cancelled.stripe_customer_id,
      stripe_credit_note_id: creditNoteId,
      type_code: typeCode,
      storno_of_invoice_id: typeCode === '384' ? cancelled.id : null,
    });
  };
  issued(recordOf(args.p_storno), '384');
  if (args.p_replacement) issued(recordOf(args.p_replacement), '380');
  return 'issued';
}

function claimMail(args: Record<string, unknown>): string | null {
  const kind = String(args.p_kind);
  const organizationId = typeof args.p_organization_id === 'string' ? args.p_organization_id : null;
  expect(kind.startsWith('alarm.')).toBe(organizationId === null);
  const key = `${kind}|${String(args.p_stripe_object_id)}`;
  const row = mails.get(key) ?? {
    id: `00000000-0000-4000-8000-${String(mails.size + 1).padStart(12, '0')}`,
    kind,
    organizationId,
    state: 'pending',
    failureCode: null,
  };
  mails.set(key, row);
  return row.state === 'sent' ? null : row.id;
}

function settleMail(args: Record<string, unknown>): boolean {
  const row = [...mails.values()].find((candidate) => candidate.id === args.p_mail_id);
  if (!row || row.state === 'sent') return false;
  expect(row.organizationId).toBe(typeof args.p_organization_id === 'string' ? args.p_organization_id : null);
  row.state = args.p_outcome === 'sent' ? 'sent' : 'failed';
  row.failureCode = typeof args.p_failure_code === 'string' ? args.p_failure_code : null;
  return true;
}

mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe('werkflow_invoices');
      return { select: () => invoiceQuery([]) };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'issue_werkflow_storno') return { data: issueStorno(args), error: null };
      if (name === 'claim_werkflow_billing_mail') return { data: claimMail(args), error: null };
      if (name === 'settle_werkflow_billing_mail') return { data: settleMail(args), error: null };
      throw new Error(`unexpected function ${name}`);
    },
  }),
}));
mock.module('@/lib/storage/r2', () => ({
  putWerkflowBillingObject: async ({ path, body }: { path: string; body: Uint8Array }) => {
    stored.set(path, body);
    return { created: true };
  },
  readWerkflowBillingObject: async (path: string) => {
    const body = stored.get(path);
    if (!body) throw new Error('storage_object_missing');
    return body;
  },
}));

// A fake Resend that keeps Resend's idempotency contract and answers each
// request with the next queued status, then 200.
type SentMail = {
  to: string;
  subject: string;
  text: string;
  attachments: { filename: string; content: string }[];
};
const resendAnswers: number[] = [];
const sent: SentMail[] = [];
const resendKeys = new Map<string, { payload: string; id: string }>();
globalThis.fetch = Object.assign(
  async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    expect(String(url)).toBe('https://api.resend.com/emails');
    const key = new Headers(init?.headers).get('idempotency-key') ?? '';
    const payload = String(init?.body);
    const earlier = resendKeys.get(key);
    if (earlier) {
      return earlier.payload === payload
        ? Response.json({ id: earlier.id })
        : Response.json({ name: 'invalid_idempotent_request' }, { status: 409 });
    }
    const status = resendAnswers.shift() ?? 200;
    if (status !== 200) return Response.json({ name: 'daily_quota_exceeded' }, { status });
    const body: unknown = JSON.parse(payload);
    const { to, subject, text, attachments = [] } = recordOf(body);
    sent.push({
      to: Array.isArray(to) ? String(to[0]) : '',
      subject: String(subject),
      text: String(text),
      attachments: Array.isArray(attachments)
        ? attachments.map((entry: unknown) => ({
            filename: String(recordOf(entry).filename),
            content: String(recordOf(entry).content),
          }))
        : [],
    });
    const id = `resend-${sent.length}`;
    resendKeys.set(key, { payload, id });
    return Response.json({ id });
  },
  { preconnect: fetch.preconnect },
);

const { seller } = MADE_UP_SELLER;
Object.assign(process.env, {
  VERCEL_ENV: 'preview',
  RESEND_API_KEY: 're_test_synthetic',
  FROM_EMAIL: 'WerkFlow <rechnung@example.com>',
  WERKFLOW_ALARM_EMAIL: 'alarm@example.com',
  WERKFLOW_BILLING_REPLY_TO: 'abrechnung@example.com',
  WERKFLOW_SELLER_NAME: seller.name,
  WERKFLOW_SELLER_STREET: seller.address.lines[0],
  WERKFLOW_SELLER_POSTAL_CODE: seller.address.postalCode,
  WERKFLOW_SELLER_CITY: seller.address.city,
  WERKFLOW_SELLER_TAX_NUMBER: seller.taxNumber,
  WERKFLOW_SELLER_EMAIL: seller.email,
  WERKFLOW_SELLER_CREDITOR_ID: MADE_UP_SELLER.creditorId,
});
// SaxonJS loads through axios, which fails in Bun once ESLint set
// Error.prepareStackTrace in the same run (lib/invoicing/check-en16931.test.ts).
const prepareStackTrace = Error.prepareStackTrace;
Reflect.set(Error, 'prepareStackTrace', undefined);
const { signalFamilyFor } = await import('@/lib/werkflow-billing/signals/dispatch').finally(() => {
  Reflect.set(Error, 'prepareStackTrace', prepareStackTrace);
});
const { createFakeStripeGateway } = await import('@/lib/testing/fixtures/fake-stripe-gateway');

const CUSTOMER_EMAIL = 'rechnung@sonnenberg.example';
const customer: StripeBillingCustomer = {
  id: 'cus_test_0001',
  organizationId: ORGANIZATION_ID,
  email: CUSTOMER_EMAIL,
  name: 'Haustechnik Sonnenberg GmbH',
};

const FULL_REFUND = stripeCreditNote(1, 49900);
const FIRST_PART = stripeCreditNote(1, 10000);
const SECOND_PART = stripeCreditNote(2, 5000);

const creditNoteSignal = (creditNoteId: string) =>
  Stripe.webhooks.constructEventWithoutVerification(
    JSON.stringify({
      id: `evt_test_${creditNoteId}`,
      object: 'event',
      type: 'credit_note.created',
      created: 1,
      data: { object: { id: creditNoteId } },
    }),
  );

async function refund(
  creditNoteId: string,
  answers: Readonly<Record<string, unknown>>,
  customers: Record<string, StripeBillingCustomer | null> = { [customer.id]: customer },
) {
  await signalFamilyFor('credit_note.created')?.handle(
    creditNoteSignal(creditNoteId),
    createFakeStripeGateway('whsec_synthetic0000', { answers, objects: { customers } }),
  );
}

/** The bytes of the issued document of `number`, as the mail must carry them. */
function issuedPdf(number: string): string {
  const row = invoices.find((entry) => entry.number === number);
  const pdf = stored.get(String(row?.file_key));
  if (!pdf) throw new Error(`no stored document ${number}`);
  return Buffer.from(pdf).toString('base64');
}

const customerMails = () => sent.filter((mail) => mail.to === CUSTOMER_EMAIL);

beforeEach(() => {
  invoices.length = 0;
  mails.clear();
  stored.clear();
  issueCalls.length = 0;
  resendAnswers.length = 0;
  sent.length = 0;
  resendKeys.clear();
  invoices.push({
    id: '24970000-0000-4000-8000-000000000001',
    organization_id: ORGANIZATION_ID,
    number: 'MUSTER-0001',
    issue_date: '2026-11-15',
    type_code: '380',
    gross_cents: 49900,
    file_key: 'werkflow-billing/test/MUSTER-0001.pdf',
    stripe_invoice_id: 'in_test_0001',
    stripe_customer_id: customer.id,
    stripe_credit_note_id: null,
    storno_of_invoice_id: null,
  });
});

describe('a refund mails its Stornorechnung to the billing contact once', () => {
  test('a full refund sends one mail with the Stornorechnung attached and nothing more on a replay', async () => {
    const answers = { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(FULL_REFUND, [FULL_REFUND]) };
    await refund('cn_test_0001', answers);
    await refund('cn_test_0001', answers);

    expect(sent).toHaveLength(1);
    const [mail] = customerMails();
    expect(mail?.subject).toBe('Deine Stornorechnung MUSTER-0001-CN-01 von WerkFlow');
    expect(mail?.text).toContain('wir haben dir 499,00 € für deine WerkFlow-Rechnung MUSTER-0001 erstattet');
    expect(mail?.text).toContain('Du musst nichts tun.');
    expect(mail?.attachments).toEqual([
      { filename: 'WerkFlow-Stornorechnung-MUSTER-0001-CN-01.pdf', content: issuedPdf('MUSTER-0001-CN-01') },
    ]);
    expect(mails.get('refund|cn_test_0001')).toMatchObject({
      organizationId: ORGANIZATION_ID,
      state: 'sent',
    });
  });

  test('each partial refund sends one mail with its Stornorechnung and the new, paid invoice', async () => {
    await refund('cn_test_0001', { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(FIRST_PART, [FIRST_PART]) });
    await refund('cn_test_0002', {
      ...CARD_INVOICE_ANSWERS,
      ...creditNoteAnswers(SECOND_PART, [FIRST_PART, SECOND_PART]),
    });

    const [first, second] = customerMails();
    expect(sent).toHaveLength(2);
    expect(first?.text).toContain('wir haben dir 100,00 € für deine WerkFlow-Rechnung MUSTER-0001 erstattet');
    expect(first?.text).toContain('die neue Rechnung MUSTER-0001-KR-01 über 399,00 €');
    expect(first?.attachments).toEqual([
      { filename: 'WerkFlow-Stornorechnung-MUSTER-0001-CN-01.pdf', content: issuedPdf('MUSTER-0001-CN-01') },
      { filename: 'WerkFlow-Rechnung-MUSTER-0001-KR-01.pdf', content: issuedPdf('MUSTER-0001-KR-01') },
    ]);
    // The second refund cancels the first refund's replacement.
    expect(second?.text).toContain(
      'wir haben dir 50,00 € für deine WerkFlow-Rechnung MUSTER-0001-KR-01 erstattet',
    );
    expect(second?.attachments).toEqual([
      { filename: 'WerkFlow-Stornorechnung-MUSTER-0001-CN-02.pdf', content: issuedPdf('MUSTER-0001-CN-02') },
      { filename: 'WerkFlow-Rechnung-MUSTER-0001-KR-02.pdf', content: issuedPdf('MUSTER-0001-KR-02') },
    ]);
  });
});

describe('a refund mail that cannot go out', () => {
  test('a refused send stays failed, the signal throws, and the next delivery sends it once without a second Storno', async () => {
    const answers = { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(FIRST_PART, [FIRST_PART]) };
    resendAnswers.push(429);
    await expect(refund('cn_test_0001', answers)).rejects.toMatchObject({
      code: 'email_daily_quota_exceeded',
    });
    expect(sent).toHaveLength(0);
    expect(mails.get('refund|cn_test_0001')).toMatchObject({
      state: 'failed',
      failureCode: 'email_daily_quota_exceeded',
    });

    await refund('cn_test_0001', answers);
    await refund('cn_test_0001', answers);
    expect(customerMails()).toHaveLength(1);
    expect(customerMails()[0]?.attachments).toHaveLength(2);
    expect(mails.get('refund|cn_test_0001')?.state).toBe('sent');
    expect(issueCalls).toEqual(['cn_test_0001']);
    expect(invoices.filter((row) => row.stripe_credit_note_id === 'cn_test_0001')).toHaveLength(2);
  });

  test('a customer without an address in Stripe gets no mail, and one alarm tells a person', async () => {
    const answers = { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(FULL_REFUND, [FULL_REFUND]) };
    const withoutEmail = { [customer.id]: { ...customer, email: null } };
    await refund('cn_test_0001', answers, withoutEmail);
    await refund('cn_test_0001', answers, withoutEmail);

    expect(customerMails()).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('alarm@example.com');
    expect(sent[0]?.subject).toBe('WerkFlow-Alarm: Abrechnungsmail abgelehnt');
    expect(sent[0]?.text).toContain('nicht gesendet (customer_without_email)');
    expect(sent[0]?.text).not.toContain('Sonnenberg');
    expect(mails.get('alarm.mail_failed|cn_test_0001_customer_without_email')?.state).toBe('sent');
  });
});
