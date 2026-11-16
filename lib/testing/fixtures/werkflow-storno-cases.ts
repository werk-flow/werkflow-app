// The Storno cases; lib/werkflow-billing/issue-storno.test.ts runs them in their own process.
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import Stripe from 'stripe';

import { readEmbeddedInvoiceXml } from '@/lib/invoicing/embedded-xml';
import {
  CARD_INVOICE_ANSWERS,
  creditNoteAnswers,
  MADE_UP_SELLER,
  ORGANIZATION_ID,
  SEPA_INVOICE_ANSWERS,
  STRIPE_INVOICE,
  stripeCreditNote,
} from '@/lib/testing/fixtures/stripe-invoices';

mock.module('server-only', () => ({}));

// The signal handlers' database, R2 and alarm, in memory. The alarm ledger
// keeps one row per kind and object, as werkflow_billing_mails does.
type TableRow = Record<string, unknown>;
const table: TableRow[] = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const alarms = new Map<string, { kind: string; stripeObjectId: string; facts: unknown }>();
function query(filters: ReadonlyArray<readonly [string, unknown]>) {
  const rows = () => table.filter((row) => filters.every(([column, value]) => row[column] === value));
  return {
    eq: (column: string, value: unknown) => query([...filters, [column, value]]),
    is: (column: string, value: unknown) => query([...filters, [column, value]]),
    limit: () => query(filters),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (result: { data: TableRow[]; error: null }) => void) =>
      resolve({ data: rows(), error: null }),
  };
}
mock.module('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({
    from: () => ({ select: () => query([]) }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: 'issued', error: null };
    },
  }),
}));
mock.module('@/lib/storage/r2', () => ({
  putWerkflowBillingObject: async () => ({ created: true }),
}));
mock.module('@/lib/werkflow-billing/mail-delivery', () => ({
  deliverCustomerBillingMail: async () => {
    throw new Error('no customer mail in the Storno cases');
  },
  describeCustomerMail: () => '',
  raiseBillingAlarm: async (alarm: { kind: string; stripeObjectId: string; facts: unknown }) => {
    const key = `${alarm.kind}|${alarm.stripeObjectId}`;
    if (!alarms.has(key)) alarms.set(key, alarm);
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
const { issueWerkflowStorno } = await import('@/lib/werkflow-billing/issue-storno').finally(() => {
  Reflect.set(Error, 'prepareStackTrace', prepareStackTrace);
});
// The renderer, which can fail as its own read-back does (e-invoice.ts).
let renderFails = false;
const { renderEInvoicePdf } = await import('@/lib/document-rendering/e-invoice');
mock.module('@/lib/document-rendering/e-invoice', () => ({
  renderEInvoicePdf: (...input: Parameters<typeof renderEInvoicePdf>) =>
    renderFails ? Promise.reject(new Error('e_invoice_xml_mismatch')) : renderEInvoicePdf(...input),
}));
const { createFakeStripeGateway } = await import('@/lib/testing/fixtures/fake-stripe-gateway');
const { signalFamilyFor } = await import('@/lib/werkflow-billing/signals/dispatch');
type StornoDependencies = import('@/lib/werkflow-billing/issue-storno').StornoDependencies;
type StornoRecord = Parameters<StornoDependencies['record']>[0];
type WerkflowDocument = Awaited<ReturnType<StornoDependencies['documents']>>[number];

// A refund of a paid invoice, read through the real gateway from in-memory
// Stripe answers, becomes one checked Storno naming the cancelled document,
// with a replacement for the part that stays, or nothing and a stable code.

const ORIGINAL: WerkflowDocument = {
  id: 'doc-original',
  number: 'MUSTER-0001',
  issueDate: '2026-11-15',
  typeCode: '380',
  grossCents: 49900,
  stripeCreditNoteId: null,
};

const PAID_SEPA_ANSWERS = {
  ...SEPA_INVOICE_ANSWERS,
  'GET /v1/invoices/in_test_0001': {
    ...STRIPE_INVOICE,
    status: 'paid',
    amount_paid: 49900,
    amount_remaining: 0,
  },
};

function world(
  answers: Readonly<Record<string, unknown>>,
  documents: readonly WerkflowDocument[] = [ORIGINAL],
) {
  const requests: Array<{ method: string; path: string; query: string }> = [];
  const stored = new Map<string, Uint8Array>();
  const records: StornoRecord[] = [];
  const rows = [...documents];
  const stripe = createFakeStripeGateway('whsec_synthetic0000', { answers, requests });
  const dependencies: StornoDependencies = {
    readInvoice: (id) => stripe.readInvoiceForIssue(id),
    readRefund: (id) => stripe.readRefundForStorno(id),
    seller: () => MADE_UP_SELLER,
    storeOriginal: async (key, pdf) => {
      stored.set(key, pdf);
      return { created: true };
    },
    isIssued: async (id) => rows.some((row) => row.typeCode === '384' && row.stripeCreditNoteId === id),
    documents: async () => rows,
    alarmed: (_creditNoteId, step) => step(),
    // As issue_werkflow_storno records: the Storno and any replacement together, once per credit note.
    record: async (row) => {
      if (
        rows.some(
          (entry) => entry.typeCode === '384' && entry.stripeCreditNoteId === row.p_stripe_credit_note_id,
        )
      )
        return 'already_issued';
      records.push(row);
      const issued = [
        { ...row.p_storno, typeCode: '384' as const },
        ...(row.p_replacement ? [{ ...row.p_replacement, typeCode: '380' as const }] : []),
      ];
      for (const document of issued) {
        rows.push({
          id: `doc-${document.number}`,
          number: document.number,
          issueDate: document.issue_date,
          typeCode: document.typeCode,
          grossCents: document.gross_cents,
          stripeCreditNoteId: row.p_stripe_credit_note_id,
        });
      }
      return 'issued';
    },
  };
  const issue = (stripeCreditNoteId: string) =>
    issueWerkflowStorno({ stripeCreditNoteId, stripeEventId: 'evt_test_refund' }, dependencies);
  const xmlOf = async (fileKey: string | undefined) => {
    const pdf = stored.get(fileKey ?? '');
    if (!pdf) throw new Error('no document stored under the recorded key');
    return readEmbeddedInvoiceXml(pdf);
  };
  return { issue, requests, stored, records, xmlOf };
}

const FULL_REFUND = stripeCreditNote(1, 49900);
const FIRST_PART = stripeCreditNote(1, 10000);
const SECOND_PART = stripeCreditNote(2, 5000);

describe('a refund of a paid invoice becomes a Storno naming the original', () => {
  test('a full refund issues one Storno with the credit note number, the original negated and named, and no new invoice', async () => {
    const { issue, records, xmlOf } = world({
      ...CARD_INVOICE_ANSWERS,
      ...creditNoteAnswers(FULL_REFUND, [FULL_REFUND]),
    });
    expect(await issue('cn_test_0001')).toBe('issued');
    expect(records).toEqual([
      expect.objectContaining({
        p_cancels_invoice_id: 'doc-original',
        p_stripe_credit_note_id: 'cn_test_0001',
        p_stripe_event_id: 'evt_test_refund',
        p_replacement: null,
      }),
    ]);
    const [record] = records;
    expect(record?.p_storno).toMatchObject({
      number: 'MUSTER-0001-CN-01',
      issue_date: '2026-11-20',
      net_cents: -49900,
      gross_cents: -49900,
      paid_cents: 0,
    });
    expect(record?.p_storno.file_key).toBe(
      `werkflow-billing/invoices/in_test_0001/${record?.p_storno.file_sha256}.pdf`,
    );
    const xml = await xmlOf(record?.p_storno.file_key);
    expect(xml).toMatch(/<rsm:ExchangedDocument>\s*<ram:ID>MUSTER-0001-CN-01<\/ram:ID>\s*<ram:TypeCode>384</);
    expect(xml).toMatch(
      /<ram:InvoiceReferencedDocument>\s*<ram:IssuerAssignedID>MUSTER-0001<\/ram:IssuerAssignedID>[\s\S]*?20261115</,
    );
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">-1</ram:BilledQuantity>');
    expect(xml).toContain('<ram:GrandTotalAmount>-499.00</ram:GrandTotalAmount>');
  });

  test('a partial refund cancels the whole invoice and issues a paid replacement for the part that stays, numbered KR-01', async () => {
    const { issue, records, xmlOf } = world({
      ...PAID_SEPA_ANSWERS,
      ...creditNoteAnswers(FIRST_PART, [FIRST_PART]),
    });
    expect(await issue('cn_test_0001')).toBe('issued');
    const [record] = records;
    expect(record?.p_storno).toMatchObject({ number: 'MUSTER-0001-CN-01', gross_cents: -49900 });
    expect(record?.p_replacement).toMatchObject({
      number: 'MUSTER-0001-KR-01',
      issue_date: '2026-11-20',
      gross_cents: 39900,
      paid_cents: 39900,
      payment_means: 'direct-debit',
    });
    const xml = await xmlOf(record?.p_replacement?.file_key);
    expect(xml).toMatch(/<ram:ID>MUSTER-0001-KR-01<\/ram:ID>\s*<ram:TypeCode>380</);
    expect(xml).toContain('Erstattung MUSTER-0001-CN-01');
    expect(xml).toContain('ersetzt die Rechnung MUSTER-0001 vom 15.11.2026, storniert mit MUSTER-0001-CN-01');
    expect(xml).toContain('<ram:DirectDebitMandateID>MUSTERMANDAT0001</ram:DirectDebitMandateID>');
    expect(xml).toContain('<ram:DuePayableAmount>0.00</ram:DuePayableAmount>');
  });
});

describe('several refunds of one invoice, and a replayed one', () => {
  test("a second refund whose signal comes first issues the first refund's documents, then cancels its replacement", async () => {
    const { issue, records } = world({
      ...CARD_INVOICE_ANSWERS,
      ...creditNoteAnswers(SECOND_PART, [SECOND_PART, FIRST_PART]),
    });
    expect(await issue('cn_test_0002')).toBe('issued');
    expect(records.map((record) => [record.p_stripe_credit_note_id, record.p_cancels_invoice_id])).toEqual([
      ['cn_test_0001', 'doc-original'],
      ['cn_test_0002', 'doc-MUSTER-0001-KR-01'],
    ]);
    expect(records[1]?.p_storno).toMatchObject({ number: 'MUSTER-0001-CN-02', gross_cents: -39900 });
    expect(records[1]?.p_replacement).toMatchObject({ number: 'MUSTER-0001-KR-02', gross_cents: 34900 });
  });

  test('a replayed credit note issues nothing twice and reads nothing from Stripe again', async () => {
    const { issue, requests, records, stored } = world({
      ...CARD_INVOICE_ANSWERS,
      ...creditNoteAnswers(FIRST_PART, [FIRST_PART]),
    });
    await issue('cn_test_0001');
    const reads = requests.length;
    expect(await issue('cn_test_0001')).toBe('already_issued');
    expect(requests).toHaveLength(reads);
    expect(records).toHaveLength(1);
    expect(stored.size).toBe(2);
  });
});

const refusals: Array<{
  case: string;
  answers: Record<string, unknown>;
  documents?: WerkflowDocument[];
  code: string;
}> = [
  {
    case: 'a credit note on an open invoice',
    answers: { ...SEPA_INVOICE_ANSWERS, ...creditNoteAnswers(FIRST_PART, [FIRST_PART]) },
    code: 'werkflow_storno_unsupported',
  },
  {
    case: 'a credit note before the payment',
    answers: (() => {
      const early = stripeCreditNote(1, 10000, { type: 'pre_payment' });
      return { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(early, [early]) };
    })(),
    code: 'werkflow_storno_unsupported',
  },
  {
    // Stripe's subtotal includes an inclusive tax, so subtotal and total agree here.
    case: 'a credit note with inclusive tax',
    answers: (() => {
      const taxed = stripeCreditNote(1, 10000, {
        total_taxes: [{ amount: 1597, tax_behavior: 'inclusive' }],
        lines: { object: 'list', has_more: false, data: [{ amount: 10000, taxes: [{ amount: 1597 }] }] },
      });
      return { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(taxed, [taxed]) };
    })(),
    code: 'werkflow_storno_unsupported',
  },
  {
    case: 'a credit note with a taxed custom line',
    answers: (() => {
      const taxed = stripeCreditNote(1, 10000, {
        lines: { object: 'list', has_more: false, data: [{ amount: 10000, taxes: [{ amount: 1900 }] }] },
      });
      return { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(taxed, [taxed]) };
    })(),
    code: 'werkflow_storno_unsupported',
  },
  {
    case: 'a refund before the original was issued',
    answers: { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(FULL_REFUND, [FULL_REFUND]) },
    documents: [],
    code: 'werkflow_storno_original_missing',
  },
  {
    case: 'an original recorded with other amounts than Stripe now holds',
    answers: { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(FULL_REFUND, [FULL_REFUND]) },
    documents: [{ ...ORIGINAL, grossCents: 59900 }],
    code: 'werkflow_invoice_amount_mismatch',
  },
  {
    case: 'a Storno the EN 16931 rules refuse (a buyer without a country)',
    answers: {
      ...CARD_INVOICE_ANSWERS,
      'GET /v1/invoices/in_test_0001': {
        ...CARD_INVOICE_ANSWERS['GET /v1/invoices/in_test_0001'],
        customer_address: { ...STRIPE_INVOICE.customer_address, country: null },
      },
      ...creditNoteAnswers(FULL_REFUND, [FULL_REFUND]),
    },
    code: 'werkflow_invoice_rules_failed',
  },
  {
    case: 'a credit note Stripe does not answer',
    answers: CARD_INVOICE_ANSWERS,
    code: 'stripe_read_failed',
  },
  {
    case: 'an invoice Stripe does not answer',
    answers: creditNoteAnswers(FULL_REFUND, [FULL_REFUND]),
    code: 'stripe_read_failed',
  },
];
describe('a refund WerkFlow cannot issue', () => {
  for (const refusal of refusals) {
    test(`${refusal.case} issues nothing and fails with ${refusal.code}`, async () => {
      const { issue, stored, records } = world(refusal.answers, refusal.documents);
      await expect(issue('cn_test_0001')).rejects.toMatchObject({ code: refusal.code });
      expect(stored.size).toBe(0);
      expect(records).toHaveLength(0);
    });
  }
});

const signalOf = (id: string, type: 'invoice.finalized' | 'credit_note.created', objectId: string) =>
  Stripe.webhooks.constructEventWithoutVerification(
    JSON.stringify({ id, object: 'event', type, created: 1, data: { object: { id: objectId } } }),
  );

async function handle(event: Stripe.Event, answers: Readonly<Record<string, unknown>>) {
  await signalFamilyFor(event.type)?.handle(
    event,
    createFakeStripeGateway('whsec_synthetic0000', { answers }),
  );
}

function resetSignalWorld() {
  renderFails = false;
  table.length = 0;
  rpcCalls.length = 0;
  alarms.clear();
}

const ORIGINAL_ROW = {
  id: 'row-original',
  number: 'MUSTER-0001',
  issue_date: '2026-11-15',
  type_code: '380',
  gross_cents: 49900,
  stripe_invoice_id: 'in_test_0001',
  stripe_credit_note_id: null,
};

describe('the credit note signal and the check alarm', () => {
  beforeEach(resetSignalWorld);

  test('credit_note.created records the Storno and its replacement in one call, from the issued original', async () => {
    table.push(ORIGINAL_ROW);
    await handle(signalOf('evt_test_refund', 'credit_note.created', 'cn_test_0001'), {
      ...CARD_INVOICE_ANSWERS,
      ...creditNoteAnswers(FIRST_PART, [FIRST_PART]),
    });
    expect(rpcCalls.map((call) => call.name)).toEqual(['issue_werkflow_storno']);
    expect(rpcCalls[0]?.args).toMatchObject({
      p_organization_id: ORGANIZATION_ID,
      p_cancels_invoice_id: 'row-original',
      p_stripe_credit_note_id: 'cn_test_0001',
      p_stripe_event_id: 'evt_test_refund',
      p_replacement: { number: 'MUSTER-0001-KR-01', payment_means: 'card' },
    });
    expect(alarms.size).toBe(0);
  });

  test('a Storno whose rule check fails is not issued and raises the check alarm once per credit note and code', async () => {
    table.push(ORIGINAL_ROW);
    const answers =
      refusals.find((refusal) => refusal.code === 'werkflow_invoice_rules_failed')?.answers ?? {};
    const event = signalOf('evt_test_refund', 'credit_note.created', 'cn_test_0001');
    await expect(handle(event, answers)).rejects.toMatchObject({ code: 'werkflow_invoice_rules_failed' });
    await expect(handle(event, answers)).rejects.toMatchObject({ code: 'werkflow_invoice_rules_failed' });
    expect(rpcCalls).toHaveLength(0);
    expect([...alarms.values()]).toEqual([
      {
        kind: 'invoice_check_failed',
        stripeObjectId: 'cn_test_0001_werkflow_invoice_rules_failed',
        facts: [
          ['Beleg', 'Stornorechnung zu einer Stripe-Gutschrift'],
          ['Fehlercode', 'werkflow_invoice_rules_failed'],
        ],
      },
    ]);
  });

  test("an original whose amounts are not Stripe's raises the check alarm; one still waiting for its payment method raises none", async () => {
    const mismatch = {
      ...SEPA_INVOICE_ANSWERS,
      'GET /v1/invoices/in_test_0001': { ...STRIPE_INVOICE, total: 44900, amount_remaining: 44900 },
    };
    const finalized = signalOf('evt_test_finalized', 'invoice.finalized', 'in_test_0001');
    await expect(handle(finalized, mismatch)).rejects.toMatchObject({
      code: 'werkflow_invoice_amount_mismatch',
    });
    const pending = {
      ...SEPA_INVOICE_ANSWERS,
      'GET /v1/invoices/in_test_0001': {
        ...STRIPE_INVOICE,
        payments: { object: 'list', data: [], has_more: false },
      },
    };
    await expect(handle(finalized, pending)).rejects.toMatchObject({
      code: 'werkflow_invoice_payment_pending',
    });
    expect([...alarms.keys()]).toEqual([
      'invoice_check_failed|in_test_0001_werkflow_invoice_amount_mismatch',
    ]);
  });
});

describe('the check alarm names the document that failed', () => {
  beforeEach(resetSignalWorld);

  test('a refund issued on behalf of a later credit note alarms under its own credit note', async () => {
    table.push(ORIGINAL_ROW);
    const failing =
      refusals.find((refusal) => refusal.code === 'werkflow_invoice_rules_failed')?.answers ?? {};
    const answers = { ...failing, ...creditNoteAnswers(SECOND_PART, [SECOND_PART, FIRST_PART]) };
    const event = signalOf('evt_test_refund', 'credit_note.created', 'cn_test_0002');
    await expect(handle(event, answers)).rejects.toMatchObject({ code: 'werkflow_invoice_rules_failed' });
    expect([...alarms.keys()]).toEqual(['invoice_check_failed|cn_test_0001_werkflow_invoice_rules_failed']);
  });

  test('a document whose rendered XML does not read back is not issued and raises the check alarm', async () => {
    table.push(ORIGINAL_ROW);
    renderFails = true;
    const event = signalOf('evt_test_refund', 'credit_note.created', 'cn_test_0001');
    const answers = { ...CARD_INVOICE_ANSWERS, ...creditNoteAnswers(FULL_REFUND, [FULL_REFUND]) };
    await expect(handle(event, answers)).rejects.toMatchObject({ code: 'werkflow_invoice_render_failed' });
    expect(rpcCalls).toHaveLength(0);
    expect([...alarms.keys()]).toEqual(['invoice_check_failed|cn_test_0001_werkflow_invoice_render_failed']);
  });
});
