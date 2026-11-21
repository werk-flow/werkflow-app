import 'server-only';

import Stripe from 'stripe';

import { billingFailure } from '@/lib/werkflow-billing/failure';
import { failedPaymentMethodType } from '@/lib/werkflow-billing/payment-method';
import { type StripeInvoiceForIssue, stripeInvoiceForIssue } from '@/lib/werkflow-billing/stripe-invoice';
import {
  subscriptionCalls,
  type StripeSubscriptionGateway,
} from '@/lib/werkflow-billing/stripe-subscriptions';

// The one gateway every call of WerkFlow's own billing to Stripe goes through
// (werk-flow/werkflow-planning#250, epic #245). Live Stripe is PROD: a live key
// works only where VERCEL_ENV is `production`, a test key only elsewhere, so a
// key in the wrong environment fails closed. A missing or refused key is a
// typed failure of the caller that asked, never an import-time crash of an
// unrelated page. Tests never reach Stripe: they use createFakeStripeGateway
// (lib/testing/fixtures/fake-stripe-gateway.ts). A later child adds each call
// it needs as a method of StripeGateway, on the client below and on the fake.

/**
 * The API version of every request and every signal this code reads. Typed as
 * the SDK's own version, so an SDK upgrade fails the type check until a person
 * reads Stripe's changes and moves both, and the webhook endpoint in Stripe's
 * dashboard, together.
 */
const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-10-28.endive';

/** How old a signed signal may be; Stripe's default, which bounds a replay of a captured request. */
const SIGNAL_TOLERANCE_SECONDS = 300;

type StripeConfigurationFailure =
  | 'stripe_secret_key_missing'
  | 'stripe_secret_key_unrecognized'
  | 'stripe_live_key_outside_production'
  | 'stripe_test_key_in_production'
  | 'stripe_webhook_secret_missing';

export type StripeGateway = {
  /**
   * The event when `signature` (the `Stripe-Signature` header) signs exactly
   * `rawBody` with the webhook secret within the tolerance; null for a forged,
   * stale or malformed signal. Nothing of the body is trusted before this.
   */
  verifySignal(rawBody: string, signature: string): Promise<Stripe.Event | null>;
  /**
   * A finalized invoice read back from Stripe by id, with its customer, every
   * line, its payment method and SEPA mandate (stripe-invoice.ts); no charge
   * is needed. Throws a stable code when Stripe's answer cannot be issued yet
   * or at all.
   */
  readInvoiceForIssue(invoiceId: string): Promise<StripeInvoiceForIssue>;
  /** An organization's customer, Checkout and subscription (werk-flow/werkflow-planning#248). */
  subscriptions: StripeSubscriptionGateway;
  /** Each read below answers Stripe's current object, or throws `stripe_read_failed`. */
  readInvoice(invoiceId: string): Promise<StripeBillingInvoice>;
  /** Null for a deleted customer. */
  readCustomer(customerId: string): Promise<StripeBillingCustomer | null>;
  readMandate(mandateId: string): Promise<StripeBillingMandate>;
  readDispute(disputeId: string): Promise<StripeBillingDispute>;
  /** The renewal Stripe will collect next for a subscription, from its preview (werk-flow/werkflow-planning#492). */
  readUpcomingDebit(subscriptionId: string): Promise<StripeUpcomingDebit>;
  /** How a finalized invoice is collected, and when the SEPA debit lands once Stripe created it. */
  readInvoiceDebit(invoiceId: string): Promise<StripeInvoiceDebit>;
  /** The invoices created since `since` (seconds) that Stripe finalized; throws `stripe_list_overflow` above the cap. */
  listFinalizedInvoices(since: number): Promise<Array<{ id: string; finalizedAt: number }>>;
  /** The ids of the events of `types` Stripe created between `since` and `until` (seconds); same cap. */
  listEventIds(since: number, until: number, types: readonly Stripe.Event.Type[]): Promise<string[]>;
};

/** How Stripe collects an invoice or a renewal. */
type StripeDebitMethod =
  | { kind: 'sepa_debit'; ibanLastFour: string | null; mandateReference: string | null }
  | { kind: 'card'; lastFour: string | null };

type StripeUpcomingDebit = {
  subscriptionId: string;
  customerId: string;
  amountCents: number;
  /** The renewal moment in seconds: the end of the current period. */
  renewsAt: number;
  method: StripeDebitMethod | null;
};

type StripeInvoiceDebit = {
  id: string;
  subscriptionId: string | null;
  /** The renewal this invoice collects, as `renewsAt` of its preview named it: the end of the period before. */
  renewsAt: number;
  status: Stripe.Invoice.Status | null;
  amountPaidCents: number;
  /** Seconds; null until paid. */
  paidAt: number | null;
  method: StripeDebitMethod | null;
  /** The SEPA charge's `expected_debit_date` (YYYY-MM-DD); null until Stripe created the charge. */
  expectedDebitDate: string | null;
};

type StripeBillingInvoice = {
  id: string;
  customerId: string | null;
  number: string | null;
  /** Stripe's current state: a failure signal for a paid or voided invoice is stale. */
  status: Stripe.Invoice.Status | null;
  /** What is still open, after any partial payment. */
  amountRemainingCents: number;
  /** Stripe's page where the customer can pay the invoice another way. */
  payUrl: string | null;
  /** The payment method type of the newest payment attempt, such as `card` or `sepa_debit`; null when unknown. */
  paymentMethodType: string | null;
};

export type StripeBillingCustomer = {
  id: string;
  /** The `werkflow_organization_id` metadata WerkFlow's server set; unchecked here. */
  organizationId: string | null;
  email: string | null;
  name: string | null;
};

type StripeBillingMandate = {
  id: string;
  status: Stripe.Mandate.Status;
  customerId: string | null;
  ibanLastFour: string | null;
};

type StripeBillingDispute = {
  id: string;
  customerId: string | null;
  chargeId: string;
  amountCents: number;
  reason: string;
};

type StripeGatewayResult =
  | { ok: true; gateway: StripeGateway }
  | { ok: false; code: StripeConfigurationFailure };

type StripeEnvironment = Readonly<Record<string, string | undefined>>;

const LIVE_KEY_PREFIXES = ['sk_live_', 'rk_live_'];
const TEST_KEY_PREFIXES = ['sk_test_', 'rk_test_'];

function keyFailure(key: string, production: boolean): StripeConfigurationFailure | null {
  const live = LIVE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  const test = TEST_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
  if (!live && !test) return 'stripe_secret_key_unrecognized';
  if (live && !production) return 'stripe_live_key_outside_production';
  if (test && production) return 'stripe_test_key_in_production';
  return null;
}

/** Verifies a signal with Stripe's own check. */
function signalVerifier(webhooks: Stripe['webhooks'], webhookSecret: string): StripeGateway['verifySignal'] {
  return async (rawBody, signature) => {
    try {
      return await webhooks.constructEventAsync(rawBody, signature, webhookSecret, SIGNAL_TOLERANCE_SECONDS);
    } catch {
      // A forged, stale or unparsable signal; its content is never logged.
      return null;
    }
  };
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

/** Runs one read; Stripe's error, which can quote request data, never leaves it. */
async function read<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    throw billingFailure('stripe_read_failed');
  }
}

/** The reads a signal handler makes instead of trusting the event body. */
function billingReads(
  client: Stripe,
): Pick<StripeGateway, 'readInvoice' | 'readCustomer' | 'readMandate' | 'readDispute'> {
  return {
    readInvoice: (invoiceId) =>
      read(async () => {
        const invoice = await client.invoices.retrieve(invoiceId);
        const payments = await client.invoicePayments.list({
          invoice: invoiceId,
          // The newest attempt still open is the failed one; a paid part payment may be newer.
          status: 'open',
          limit: 1,
          expand: ['data.payment.payment_intent.payment_method'],
        });
        return {
          id: invoice.id ?? invoiceId,
          customerId: idOf(invoice.customer),
          number: invoice.number,
          status: invoice.status,
          amountRemainingCents: invoice.amount_remaining,
          payUrl: invoice.hosted_invoice_url ?? null,
          paymentMethodType: failedPaymentMethodType(payments.data[0]?.payment.payment_intent),
        };
      }),
    readCustomer: (customerId) =>
      read(async () => {
        const customer = await client.customers.retrieve(customerId);
        if (customer.deleted) return null;
        return {
          id: customer.id,
          organizationId: customer.metadata.werkflow_organization_id ?? null,
          email: customer.email,
          name: customer.name ?? null,
        };
      }),
    readMandate: (mandateId) =>
      read(async () => {
        const mandate = await client.mandates.retrieve(mandateId, { expand: ['payment_method'] });
        const method = typeof mandate.payment_method === 'object' ? mandate.payment_method : null;
        return {
          id: mandate.id,
          status: mandate.status,
          customerId: idOf(method?.customer),
          ibanLastFour: method?.sepa_debit?.last4 ?? null,
        };
      }),
    readDispute: (disputeId) =>
      read(async () => {
        const dispute = await client.disputes.retrieve(disputeId, { expand: ['charge'] });
        const charge = typeof dispute.charge === 'object' ? dispute.charge : null;
        return {
          id: dispute.id,
          customerId: idOf(charge?.customer),
          chargeId: typeof dispute.charge === 'string' ? dispute.charge : dispute.charge.id,
          amountCents: dispute.amount,
          reason: dispute.reason,
        };
      }),
  };
}

/** The default payment's PaymentIntent id of an invoice, if a payment exists yet. */
function paymentIntentIdOf(invoice: Stripe.Invoice): string | null {
  const payments = invoice.payments?.data ?? [];
  const payment = payments.find((entry) => entry.is_default) ?? payments[0];
  const intent = payment?.payment.payment_intent;
  return typeof intent === 'string' ? intent : (intent?.id ?? null);
}

/** The object of a field Stripe expanded; null for an id or nothing. */
function expanded<T extends object>(value: string | T | null | undefined): T | null {
  return typeof value === 'object' ? value : null;
}

/**
 * The payment method Stripe debits for the invoice, read without waiting for
 * a charge: the one its payment intent names, else the invoice's, the
 * subscription's or the customer's default, in Stripe's own order. A SEPA
 * renewal is finalized in the same second as its debit starts, and signals of
 * one second come in no reliable order.
 */
async function paymentMethodOf(
  client: Stripe,
  invoice: Stripe.Invoice,
): Promise<Stripe.PaymentMethod | null> {
  const intentId = paymentIntentIdOf(invoice);
  const intent = intentId
    ? await client.paymentIntents.retrieve(intentId, { expand: ['payment_method'] })
    : null;
  const customer = expanded(invoice.customer);
  return (
    expanded(intent?.payment_method) ??
    expanded(invoice.default_payment_method) ??
    expanded(expanded(invoice.parent?.subscription_details?.subscription)?.default_payment_method) ??
    (customer?.deleted ? null : expanded(customer?.invoice_settings.default_payment_method))
  );
}

/** The reference of the SEPA mandate a payment method was set up with (its SetupIntent's mandate). */
async function mandateReferenceOf(client: Stripe, paymentMethodId: string): Promise<string | null> {
  const setups = await client.setupIntents.list({
    payment_method: paymentMethodId,
    limit: 10,
    expand: ['data.mandate'],
  });
  const references = setups.data.map(
    (setup) => expanded(setup.mandate)?.payment_method_details.sepa_debit?.reference,
  );
  return references.find((reference) => reference !== undefined) ?? null;
}

async function debitMethodOf(
  client: Stripe,
  method: Stripe.PaymentMethod | null,
): Promise<StripeDebitMethod | null> {
  if (method?.type === 'card') return { kind: 'card', lastFour: method.card?.last4 ?? null };
  if (method?.type !== 'sepa_debit') return null;
  return {
    kind: 'sepa_debit',
    ibanLastFour: method.sepa_debit?.last4 ?? null,
    mandateReference: await mandateReferenceOf(client, method.id),
  };
}

// The daily comparison's lists from Stripe; more than this in a few days is not WerkFlow's volume.
const LIST_CAP = 1000;

async function capped<T>(items: Promise<T[]>): Promise<T[]> {
  const all = await items;
  if (all.length > LIST_CAP) throw billingFailure('stripe_list_overflow');
  return all;
}

/** The reads of the debit notice, the invoice and receipt mails, and the daily comparison. */
function debitReads(
  client: Stripe,
): Pick<StripeGateway, 'readUpcomingDebit' | 'readInvoiceDebit' | 'listFinalizedInvoices' | 'listEventIds'> {
  return {
    readUpcomingDebit: (subscriptionId) =>
      read(async () => {
        const subscription = await client.subscriptions.retrieve(subscriptionId, {
          expand: ['default_payment_method', 'customer.invoice_settings.default_payment_method'],
        });
        const preview = await client.invoices.createPreview({ subscription: subscriptionId });
        const customer = expanded(subscription.customer);
        const method =
          expanded(subscription.default_payment_method) ??
          (customer?.deleted ? null : expanded(customer?.invoice_settings.default_payment_method));
        return {
          subscriptionId,
          customerId: idOf(subscription.customer) ?? '',
          amountCents: preview.amount_due,
          renewsAt: preview.period_end,
          method: await debitMethodOf(client, method),
        };
      }),
    readInvoiceDebit: (invoiceId) =>
      read(async () => {
        const invoice = await client.invoices.retrieve(invoiceId, {
          expand: [
            'customer.invoice_settings.default_payment_method',
            'payments',
            'default_payment_method',
            'parent.subscription_details.subscription.default_payment_method',
          ],
        });
        const intentId = paymentIntentIdOf(invoice);
        const intent = intentId
          ? await client.paymentIntents.retrieve(intentId, { expand: ['latest_charge'] })
          : null;
        return {
          id: invoice.id ?? invoiceId,
          subscriptionId: idOf(invoice.parent?.subscription_details?.subscription),
          renewsAt: invoice.period_end,
          status: invoice.status,
          amountPaidCents: invoice.amount_paid,
          paidAt: invoice.status_transitions.paid_at ?? null,
          method: await debitMethodOf(client, await paymentMethodOf(client, invoice)),
          expectedDebitDate:
            expanded(intent?.latest_charge)?.payment_method_details?.sepa_debit?.expected_debit_date ?? null,
        };
      }),
    listFinalizedInvoices: async (since) => {
      const invoices = await capped(
        read(() =>
          client.invoices
            .list({ created: { gte: since }, limit: 100 })
            .autoPagingToArray({ limit: LIST_CAP + 1 }),
        ),
      );
      return invoices.flatMap((invoice) => {
        const finalizedAt = invoice.status_transitions.finalized_at;
        return invoice.id && finalizedAt ? [{ id: invoice.id, finalizedAt }] : [];
      });
    },
    listEventIds: async (since, until, types) => {
      const events = await capped(
        read(() =>
          client.events
            .list({ created: { gte: since, lte: until }, types: [...types], limit: 100 })
            .autoPagingToArray({ limit: LIST_CAP + 1 }),
        ),
      );
      return events.map((event) => event.id);
    },
  };
}

function invoiceReader(client: Stripe): StripeGateway['readInvoiceForIssue'] {
  return async (invoiceId) => {
    const invoice = await client.invoices.retrieve(invoiceId, {
      expand: [
        'customer.invoice_settings.default_payment_method',
        'payments',
        'default_payment_method',
        'parent.subscription_details.subscription.default_payment_method',
      ],
    });
    const lines = await client.invoices
      .listLineItems(invoiceId, { limit: 100 })
      .autoPagingToArray({ limit: 1000 });
    const paymentMethod = await paymentMethodOf(client, invoice);
    return stripeInvoiceForIssue({
      invoice,
      lines,
      paymentMethod,
      mandateReference:
        paymentMethod?.type === 'sepa_debit' ? await mandateReferenceOf(client, paymentMethod.id) : null,
    });
  };
}

/**
 * The gateway for this deployment, or the code of the configuration that
 * refuses it. Reads `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and
 * `VERCEL_ENV` (docs/technical/environments.md, "Credentials").
 */
export function resolveStripeGateway(
  environment: StripeEnvironment = process.env,
  /** Tests answer Stripe's requests in memory (lib/testing/fixtures/fake-stripe-gateway.ts). */
  httpClient?: Stripe.StripeConfig['httpClient'],
): StripeGatewayResult {
  const key = environment.STRIPE_SECRET_KEY?.trim();
  if (!key) return { ok: false, code: 'stripe_secret_key_missing' };
  const failure = keyFailure(key, environment.VERCEL_ENV === 'production');
  if (failure) return { ok: false, code: failure };
  const webhookSecret = environment.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) return { ok: false, code: 'stripe_webhook_secret_missing' };

  const client = new Stripe(key, { apiVersion: STRIPE_API_VERSION, ...(httpClient ? { httpClient } : {}) });
  return {
    ok: true,
    gateway: {
      verifySignal: signalVerifier(client.webhooks, webhookSecret),
      ...billingReads(client),
      ...debitReads(client),
      readInvoiceForIssue: invoiceReader(client),
      subscriptions: subscriptionCalls(client),
    },
  };
}
