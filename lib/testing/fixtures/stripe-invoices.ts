// Made-up Stripe objects of a finalized WerkFlow subscription invoice, shaped
// as Stripe's API returns them, and the made-up seller pre-production holds.
// Made-up seller, customer, ids, mandate and card only.

import type { WerkflowSeller } from '@/lib/werkflow-billing/seller';

export const ORGANIZATION_ID = '24900000-0000-4000-8000-000000000010';

/** 2026-11-15 10:00 Berlin; the period runs to 2026-12-15 10:00. */
const FINALIZED_AT = 1_794_733_200;
const PERIOD_END = 1_797_325_200;

export const STRIPE_INVOICE = {
  id: 'in_test_0001',
  object: 'invoice',
  status: 'open',
  number: 'MUSTER-0001',
  currency: 'eur',
  customer: {
    id: 'cus_test_0001',
    object: 'customer',
    metadata: { werkflow_organization_id: ORGANIZATION_ID },
    invoice_settings: { default_payment_method: null },
  },
  default_payment_method: null,
  parent: null,
  customer_name: 'Haustechnik Sonnenberg GmbH',
  customer_email: 'rechnung@sonnenberg.example',
  customer_address: {
    line1: 'Sonnenweg 1',
    line2: null,
    postal_code: '01234',
    city: 'Sonnenstadt',
    country: 'DE',
  },
  customer_tax_ids: [{ type: 'eu_vat', value: 'DE987654321' }],
  status_transitions: { finalized_at: FINALIZED_AT },
  subtotal: 49900,
  total: 49900,
  total_taxes: [],
  amount_paid: 0,
  amount_remaining: 49900,
  payments: {
    object: 'list',
    has_more: false,
    data: [
      {
        id: 'inpay_test_0001',
        object: 'invoice_payment',
        is_default: true,
        payment: { type: 'payment_intent', payment_intent: 'pi_test_0001' },
      },
    ],
  },
};

export const STRIPE_INVOICE_LINES = {
  object: 'list',
  url: '/v1/invoices/in_test_0001/lines',
  has_more: false,
  data: [
    {
      id: 'il_test_0001',
      object: 'line_item',
      description: 'WerkFlow Monatsabo',
      amount: 49900,
      quantity: 1,
      period: { start: FINALIZED_AT, end: PERIOD_END },
    },
  ],
};

/** A SEPA payment method; its mandate hangs on the SetupIntent that created it. */
export const SEPA_PAYMENT_METHOD = {
  id: 'pm_test_sepa_0001',
  object: 'payment_method',
  type: 'sepa_debit',
  sepa_debit: { last4: '3000', country: 'DE' },
};

/** A renewal's payment intent at finalization: its debit started, no charge yet. */
const paymentIntent = (paymentMethod: object) => ({
  id: 'pi_test_0001',
  object: 'payment_intent',
  status: 'processing',
  payment_method: paymentMethod,
  latest_charge: null,
});

/** Stripe's answers for a SEPA direct-debit invoice, keyed as the fake gateway reads them. */
export const SEPA_INVOICE_ANSWERS = {
  'GET /v1/invoices/in_test_0001': STRIPE_INVOICE,
  'GET /v1/invoices/in_test_0001/lines': STRIPE_INVOICE_LINES,
  'GET /v1/payment_intents/pi_test_0001': paymentIntent(SEPA_PAYMENT_METHOD),
  'GET /v1/setup_intents': {
    object: 'list',
    url: '/v1/setup_intents',
    has_more: false,
    data: [
      {
        id: 'seti_test_0001',
        object: 'setup_intent',
        status: 'succeeded',
        payment_method: SEPA_PAYMENT_METHOD.id,
        mandate: {
          id: 'mandate_test_0001',
          object: 'mandate',
          payment_method: SEPA_PAYMENT_METHOD.id,
          payment_method_details: {
            type: 'sepa_debit',
            sepa_debit: { reference: 'MUSTERMANDAT0001', url: 'https://example.test' },
          },
        },
      },
    ],
  },
};

/** Stripe's answers for an invoice a card already paid. */
export const CARD_INVOICE_ANSWERS = {
  'GET /v1/invoices/in_test_0001': {
    ...STRIPE_INVOICE,
    status: 'paid',
    amount_paid: 49900,
    amount_remaining: 0,
  },
  'GET /v1/invoices/in_test_0001/lines': STRIPE_INVOICE_LINES,
  'GET /v1/payment_intents/pi_test_0001': {
    ...paymentIntent({
      id: 'pm_test_card_0001',
      object: 'payment_method',
      type: 'card',
      card: { last4: '4242', brand: 'visa' },
    }),
    status: 'succeeded',
  },
};

export const MADE_UP_SELLER: WerkflowSeller = {
  seller: {
    name: 'Musterfirma Software, Erika Musterfrau',
    address: { lines: ['Musterstraße 1'], postalCode: '01234', city: 'Musterstadt', countryCode: 'DE' },
    vatId: null,
    taxNumber: '12/345/67890',
    legalRegistrationId: null,
    identifier: { id: 'DE98ZZZ09999999999', scheme: null },
    email: 'rechnung@musterfirma.example',
  },
  creditorId: 'DE98ZZZ09999999999',
};
