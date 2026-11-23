import type Stripe from 'stripe';

// The failures of WerkFlow's own billing code. Each carries a stable `code`
// that receive.ts keeps with the signal and lib/logging.ts may log; the
// message is fixed text, never personal data or a provider body.

export function billingFailure(code: string): Error {
  return Object.assign(new Error('A WerkFlow billing step failed.'), { code });
}

/** The id of a signal's object; a handler trusts nothing else of the event body. */
export function signalObjectId(event: Stripe.Event): string {
  const object: unknown = event.data.object;
  const id: unknown = typeof object === 'object' && object !== null ? Reflect.get(object, 'id') : undefined;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_]{1,255}$/.test(id))
    throw billingFailure('signal_object_id_invalid');
  return id;
}

// The stable codes a WerkFlow invoice fails with. The signal endpoint keeps the
// code with the failed signal and Stripe delivers it again; the alarm reads it
// (A6a, werk-flow/werkflow-planning#251). A code names no person, amount or value.
type WerkflowInvoiceFailureCode =
  | 'werkflow_seller_configuration_missing'
  | 'werkflow_invoice_unreadable'
  | 'werkflow_invoice_not_finalized'
  | 'werkflow_invoice_organization_unknown'
  | 'werkflow_invoice_payment_pending'
  | 'werkflow_invoice_amount_mismatch'
  | 'werkflow_invoice_rules_failed'
  | 'werkflow_invoice_readback_mismatch'
  | 'werkflow_invoice_storage_conflict'
  | 'werkflow_invoice_record_failed';

export class WerkflowInvoiceFailure extends Error {
  constructor(readonly code: WerkflowInvoiceFailureCode) {
    super(code);
    this.name = 'WerkflowInvoiceFailure';
  }
}
