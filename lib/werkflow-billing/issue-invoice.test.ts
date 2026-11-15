import { describe, expect, mock, test } from 'bun:test';

import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
import {
  CARD_INVOICE_ANSWERS,
  MADE_UP_SELLER,
  ORGANIZATION_ID,
  SEPA_INVOICE_ANSWERS,
  STRIPE_INVOICE,
} from '@/lib/testing/fixtures/stripe-invoices';
import type { WerkflowSeller } from '@/lib/werkflow-billing/seller';

mock.module('server-only', () => ({}));
// SaxonJS loads through axios, which fails in Bun once ESLint set
// Error.prepareStackTrace in the same run (lib/invoicing/check-en16931.test.ts).
const prepareStackTrace = Error.prepareStackTrace;
Reflect.set(Error, 'prepareStackTrace', undefined);
const { issueWerkflowInvoice } = await import('./issue-invoice').finally(() => {
  Reflect.set(Error, 'prepareStackTrace', prepareStackTrace);
});
const { createFakeStripeGateway } = await import('@/lib/testing/fixtures/fake-stripe-gateway');
type IssueDependencies = import('./issue-invoice').IssueDependencies;
type IssuedInvoiceRecord = import('./issue-invoice').IssuedInvoiceRecord;

// A finalized Stripe invoice, read through the real gateway from in-memory
// Stripe answers, becomes one checked original, or nothing and a stable code.

function world(answers: Readonly<Record<string, unknown>>, seller: WerkflowSeller = MADE_UP_SELLER) {
  const requests: Array<{ method: string; path: string; query: string }> = [];
  const stored = new Map<string, Uint8Array>();
  const records: IssuedInvoiceRecord[] = [];
  const stripe = createFakeStripeGateway('whsec_synthetic0000', answers, requests);
  const dependencies: IssueDependencies = {
    readInvoice: (id) => stripe.readInvoiceForIssue(id),
    seller: () => seller,
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

describe('a finalized Stripe invoice becomes WerkFlow original', () => {
  test("a SEPA invoice is issued once with Stripe's number and amounts, its mandate and creditor ID in the checked XML", async () => {
    const { issue, requests, stored, records } = world(SEPA_INVOICE_ANSWERS);
    expect(await issue()).toBe('issued');
    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual(
      Object.keys(SEPA_INVOICE_ANSWERS),
    );
    expect(requests[0]?.query).toContain('expand[0]=customer');
    expect(requests[0]?.query).toContain('expand[1]=payments');

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

  const refusals: Array<{
    case: string;
    answers: Record<string, unknown>;
    seller?: WerkflowSeller;
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
      case: 'a seller the EN 16931 rules cannot identify',
      answers: SEPA_INVOICE_ANSWERS,
      seller: { ...MADE_UP_SELLER, seller: { ...MADE_UP_SELLER.seller, vatId: null } },
      code: 'werkflow_invoice_rules_failed',
    },
    {
      case: 'a customer without WerkFlow organization',
      answers: withInvoice(SEPA_INVOICE_ANSWERS, { customer: { id: 'cus_test_0001', metadata: {} } }),
      code: 'werkflow_invoice_organization_unknown',
    },
    {
      case: 'an amount due without a charge yet',
      answers: withInvoice(SEPA_INVOICE_ANSWERS, { payments: { object: 'list', data: [], has_more: false } }),
      code: 'werkflow_invoice_payment_pending',
    },
    {
      case: 'a draft without a number',
      answers: withInvoice(SEPA_INVOICE_ANSWERS, { status: 'draft', number: null }),
      code: 'werkflow_invoice_not_finalized',
    },
  ];
  for (const refusal of refusals) {
    test(`${refusal.case} issues nothing and fails with ${refusal.code}`, async () => {
      const { issue, stored, records } = world(refusal.answers, refusal.seller);
      await expect(issue()).rejects.toMatchObject({ code: refusal.code });
      expect(stored.size).toBe(0);
      expect(records).toHaveLength(0);
    });
  }
});
