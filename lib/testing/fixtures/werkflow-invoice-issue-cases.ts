// The issue cases; lib/werkflow-billing/issue-invoice.test.ts runs them in their own process.
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import Stripe from 'stripe';

import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
import {
  CARD_INVOICE_ANSWERS,
  MADE_UP_SELLER,
  ORGANIZATION_ID,
  SEPA_INVOICE_ANSWERS,
  SEPA_PAYMENT_METHOD,
  STRIPE_INVOICE,
  STRIPE_INVOICE_LINES,
} from '@/lib/testing/fixtures/stripe-invoices';

mock.module('server-only', () => ({}));

// The signal handlers' database and R2, in memory: the issued rows and the stored originals.
const issuedRows: Array<{ p_stripe_invoice_id: string; p_stripe_event_id: string }> = [];
const billingObjects = new Map<string, Uint8Array>();
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, stripeInvoiceId: string) => ({
          maybeSingle: async () => ({
            data: issuedRows.some((row) => row.p_stripe_invoice_id === stripeInvoiceId)
              ? { id: 'row' }
              : null,
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (_name: string, row: { p_stripe_invoice_id: string; p_stripe_event_id: string }) => {
      if (issuedRows.some((existing) => existing.p_stripe_invoice_id === row.p_stripe_invoice_id)) {
        return { data: 'already_issued', error: null };
      }
      issuedRows.push(row);
      return { data: 'issued', error: null };
    },
  }),
}));
mock.module('@/lib/storage/r2', () => ({
  putWerkflowBillingObject: async ({ path, body }: { path: string; body: Uint8Array }) => {
    billingObjects.set(path, body);
    return { created: true };
  },
}));
const { seller } = MADE_UP_SELLER;
Object.assign(process.env, {
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
const { issueWerkflowInvoice } = await import('@/lib/werkflow-billing/issue-invoice').finally(() => {
  Reflect.set(Error, 'prepareStackTrace', prepareStackTrace);
});
const { createFakeStripeGateway } = await import('@/lib/testing/fixtures/fake-stripe-gateway');
const { signalFamilyFor } = await import('@/lib/werkflow-billing/signals/dispatch');
type IssueDependencies = import('@/lib/werkflow-billing/issue-invoice').IssueDependencies;
type IssuedInvoiceRecord = Parameters<IssueDependencies['record']>[0];

// A finalized Stripe invoice, read through the real gateway from in-memory
// Stripe answers, becomes one checked original, or nothing and a stable code.

function world(answers: Readonly<Record<string, unknown>>) {
  const requests: Array<{ method: string; path: string; query: string }> = [];
  const stored = new Map<string, Uint8Array>();
  const records: IssuedInvoiceRecord[] = [];
  const stripe = createFakeStripeGateway('whsec_synthetic0000', { answers, requests });
  const dependencies: IssueDependencies = {
    readInvoice: (id) => stripe.readInvoiceForIssue(id),
    seller: () => MADE_UP_SELLER,
    storeOriginal: async (key, pdf) => {
      const existing = stored.get(key);
      if (existing) return { created: false, sizeBytes: existing.byteLength };
      stored.set(key, pdf);
      return { created: true };
    },
    isIssued: async (id) => records.some((row) => row.p_stripe_invoice_id === id),
    record: async (row) => {
      if (records.some((existing) => existing.p_stripe_invoice_id === row.p_stripe_invoice_id))
        return 'already_issued';
      records.push(row);
      return 'issued';
    },
  };
  const issue = () =>
    issueWerkflowInvoice({ stripeInvoiceId: 'in_test_0001', stripeEventId: 'evt_test_0001' }, dependencies);
  return { issue, requests, stored, records };
}

const withInvoice = (answers: Record<string, unknown>, change: Record<string, unknown>) => ({
  ...answers,
  'GET /v1/invoices/in_test_0001': { ...STRIPE_INVOICE, ...change },
});

const NO_PAYMENTS = { object: 'list', data: [], has_more: false };

const refusals: Array<{
  case: string;
  answers: Record<string, unknown>;
  code: string;
}> = [
  {
    case: "a total that is not Stripe's line sum (a discount)",
    answers: withInvoice(SEPA_INVOICE_ANSWERS, { total: 44900, amount_remaining: 44900 }),
    code: 'werkflow_invoice_amount_mismatch',
  },
  {
    case: 'a paid amount above the total',
    answers: withInvoice(CARD_INVOICE_ANSWERS, { amount_paid: 50000, amount_remaining: 0, status: 'paid' }),
    code: 'werkflow_invoice_amount_mismatch',
  },
  {
    case: 'a buyer address without a country, which the EN 16931 rules refuse',
    answers: withInvoice(SEPA_INVOICE_ANSWERS, {
      customer_address: { ...STRIPE_INVOICE.customer_address, country: null },
    }),
    code: 'werkflow_invoice_rules_failed',
  },
  {
    case: 'a customer without WerkFlow organization',
    answers: withInvoice(SEPA_INVOICE_ANSWERS, { customer: { id: 'cus_test_0001', metadata: {} } }),
    code: 'werkflow_invoice_organization_unknown',
  },
  {
    case: 'an amount due without a payment intent or a default payment method',
    answers: withInvoice(SEPA_INVOICE_ANSWERS, { payments: NO_PAYMENTS }),
    code: 'werkflow_invoice_payment_pending',
  },
  {
    case: 'a SEPA payment method without a mandate',
    answers: {
      ...SEPA_INVOICE_ANSWERS,
      'GET /v1/setup_intents': { object: 'list', data: [], has_more: false },
    },
    code: 'werkflow_invoice_unreadable',
  },
  {
    case: 'a draft without a number',
    answers: withInvoice(SEPA_INVOICE_ANSWERS, { status: 'draft', number: null }),
    code: 'werkflow_invoice_not_finalized',
  },
];
describe('a finalized Stripe invoice becomes WerkFlow original', () => {
  test("a SEPA invoice finalized as its debit starts, before any charge, is issued once with Stripe's number and amounts, its mandate and creditor ID in the checked XML", async () => {
    const { issue, requests, stored, records } = world(SEPA_INVOICE_ANSWERS);
    expect(await issue()).toBe('issued');
    // The payment method comes from the payment intent, the mandate from its SetupIntent: no charge is read.
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual(
      Object.keys(SEPA_INVOICE_ANSWERS),
    );
    expect(requests[0]?.query).toContain('expand[0]=customer.invoice_settings.default_payment_method');
    expect(requests[0]?.query).toContain('expand[1]=payments');
    expect(requests[2]?.query).toContain('expand[0]=payment_method');
    expect(requests[3]?.query).toContain(`payment_method=${SEPA_PAYMENT_METHOD.id}`);

    expect(records).toHaveLength(1);
    const [row] = records;
    expect(row).toMatchObject({
      p_organization_id: ORGANIZATION_ID,
      p_stripe_customer_id: 'cus_test_0001',
      p_stripe_event_id: 'evt_test_0001',
      p_number: 'MUSTER-0001',
      p_issue_date: '2026-11-15',
      p_payment_means: 'direct-debit',
      p_gross_cents: 49900,
      p_paid_cents: 0,
      p_due_cents: 49900,
    });
    const pdf = stored.get(row?.p_file_key ?? '');
    if (!pdf) throw new Error('no original stored under the recorded key');
    expect(row?.p_file_key).toBe(`werkflow-billing/invoices/in_test_0001/${row?.p_file_sha256}.pdf`);
    expect(row?.p_file_size_bytes).toBe(pdf.byteLength);
    const xml = await readEmbeddedInvoiceXml(pdf);
    expect(xml).toContain('<ram:ID>MUSTER-0001</ram:ID>');
    // A seller with a Steuernummer only is identified by its creditor ID (BT-29, BR-CO-26).
    expect(xml).toMatch(/<ram:SellerTradeParty>\s*<ram:ID>DE98ZZZ09999999999<\/ram:ID>/);
    expect(xml).toContain('<ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>');
    expect(xml).toContain('<ram:DirectDebitMandateID>MUSTERMANDAT0001</ram:DirectDebitMandateID>');
    expect(xml).toContain('<ram:CategoryCode>E</ram:CategoryCode>');
    expect(xml).toMatch(/<ram:EndDateTime>\s*<udt:DateTimeString format="102">20261214</);
  });

  test('a replayed signal issues nothing twice and reads nothing from Stripe again', async () => {
    const { issue, requests, stored, records } = world(SEPA_INVOICE_ANSWERS);
    await issue();
    const reads = requests.length;
    expect(await issue()).toBe('already_issued');
    expect(requests).toHaveLength(reads);
    expect(records).toHaveLength(1);
    expect(stored.size).toBe(1);
  });

  test('a card charge that paid the invoice is named with its last four digits, paid in full', async () => {
    const { issue, stored, records } = world(CARD_INVOICE_ANSWERS);
    await issue();
    expect(records[0]).toMatchObject({ p_payment_means: 'card', p_paid_cents: 49900, p_due_cents: 0 });
    const xml = await readEmbeddedInvoiceXml([...stored.values()][0] ?? new Uint8Array());
    expect(xml).toContain('<ram:TotalPrepaidAmount>499.00</ram:TotalPrepaidAmount>');
    expect(xml).toMatch(/<ram:ApplicableTradeSettlementFinancialCard>\s*<ram:ID>4242</);
  });
});

describe('the payment method before the debit exists', () => {
  test("an invoice without a payment intent yet is debited from the subscription's default payment method", async () => {
    const { issue, requests, records } = world({
      ...SEPA_INVOICE_ANSWERS,
      'GET /v1/invoices/in_test_0001': {
        ...STRIPE_INVOICE,
        payments: NO_PAYMENTS,
        parent: {
          type: 'subscription_details',
          subscription_details: {
            subscription: {
              id: 'sub_test_0001',
              object: 'subscription',
              default_payment_method: SEPA_PAYMENT_METHOD,
            },
          },
        },
      },
    });
    expect(await issue()).toBe('issued');
    expect(records[0]).toMatchObject({ p_payment_means: 'direct-debit', p_due_cents: 49900 });
    expect(requests.some((request) => request.path.startsWith('/v1/payment_intents'))).toBe(false);
  });
});

describe('a settled or credited Stripe invoice', () => {
  test('a SEPA invoice already paid when read keeps its debit: code 59, mandate reference and creditor ID', async () => {
    const { issue, stored, records } = world(
      withInvoice(SEPA_INVOICE_ANSWERS, { status: 'paid', amount_paid: 49900, amount_remaining: 0 }),
    );
    await issue();
    expect(records[0]).toMatchObject({
      p_payment_means: 'direct-debit',
      p_paid_cents: 49900,
      p_due_cents: 0,
    });
    const xml = await readEmbeddedInvoiceXml([...stored.values()][0] ?? new Uint8Array());
    expect(xml).toContain('<ram:CreditorReferenceID>DE98ZZZ09999999999</ram:CreditorReferenceID>');
    expect(xml).toMatch(/<ram:TypeCode>59<\/ram:TypeCode>/);
    expect(xml).toContain('<ram:DirectDebitMandateID>MUSTERMANDAT0001</ram:DirectDebitMandateID>');
  });

  test('a proration credit is a negative quantity at a positive price, and the invoice issues', async () => {
    const [debit] = STRIPE_INVOICE_LINES.data;
    if (!debit) throw new Error('fixture without lines');
    const { issue, stored } = world({
      ...SEPA_INVOICE_ANSWERS,
      'GET /v1/invoices/in_test_0001': { ...STRIPE_INVOICE, subtotal: 49900, total: 49900 },
      'GET /v1/invoices/in_test_0001/lines': {
        ...STRIPE_INVOICE_LINES,
        data: [
          { ...debit, id: 'il_test_0002', description: 'Unbenutzte Zeit', amount: -10000 },
          { ...debit, amount: 59900 },
        ],
      },
    });
    expect(await issue()).toBe('issued');
    const xml = await readEmbeddedInvoiceXml([...stored.values()][0] ?? new Uint8Array());
    expect(xml).toMatch(
      /<ram:ChargeAmount>100.00<\/ram:ChargeAmount>[\s\S]*?<ram:BilledQuantity unitCode="C62">-1</,
    );
  });
});

describe('a Stripe invoice WerkFlow cannot issue', () => {
  for (const refusal of refusals) {
    test(`${refusal.case} issues nothing and fails with ${refusal.code}`, async () => {
      const { issue, stored, records } = world(refusal.answers);
      await expect(issue()).rejects.toMatchObject({ code: refusal.code });
      expect(stored.size).toBe(0);
      expect(records).toHaveLength(0);
    });
  }
});

const signalOf = (id: string, type: 'invoice.finalized' | 'invoice.paid') =>
  Stripe.webhooks.constructEventWithoutVerification(
    JSON.stringify({ id, object: 'event', type, created: 1, data: { object: { id: 'in_test_0001' } } }),
  );

async function handle(event: Stripe.Event, answers: Readonly<Record<string, unknown>>) {
  const requests: Array<{ method: string; path: string; query: string }> = [];
  await signalFamilyFor(event.type)?.handle(
    event,
    createFakeStripeGateway('whsec_synthetic0000', { answers, requests }),
  );
  return requests;
}

describe('invoice.paid backstops the issue of the original', () => {
  beforeEach(() => {
    issuedRows.length = 0;
    billingObjects.clear();
  });

  test('an invoice that invoice.finalized could not issue yet is issued by its invoice.paid', async () => {
    const finalized = handle(
      signalOf('evt_test_finalized', 'invoice.finalized'),
      withInvoice(SEPA_INVOICE_ANSWERS, { payments: NO_PAYMENTS }),
    );
    await expect(finalized).rejects.toMatchObject({ code: 'werkflow_invoice_payment_pending' });
    expect(issuedRows).toHaveLength(0);

    await handle(
      signalOf('evt_test_paid', 'invoice.paid'),
      withInvoice(SEPA_INVOICE_ANSWERS, { status: 'paid', amount_paid: 49900, amount_remaining: 0 }),
    );
    expect(issuedRows).toEqual([
      expect.objectContaining({ p_stripe_invoice_id: 'in_test_0001', p_stripe_event_id: 'evt_test_paid' }),
    ]);
    expect(billingObjects.size).toBe(1);
  });

  test('invoice.paid of an issued invoice reads nothing from Stripe and issues nothing', async () => {
    await handle(signalOf('evt_test_finalized', 'invoice.finalized'), SEPA_INVOICE_ANSWERS);
    expect(issuedRows).toHaveLength(1);
    const requests = await handle(signalOf('evt_test_paid', 'invoice.paid'), SEPA_INVOICE_ANSWERS);
    expect(requests).toHaveLength(0);
    expect(issuedRows).toEqual([expect.objectContaining({ p_stripe_event_id: 'evt_test_finalized' })]);
    expect(billingObjects.size).toBe(1);
  });
});
