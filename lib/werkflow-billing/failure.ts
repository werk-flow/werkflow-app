import type Stripe from 'stripe';

import { logError } from '@/lib/logging';

// The one failure of WerkFlow's own billing code. Its stable `code` is what
// receive.ts keeps with the signal, the alarm names and lib/logging.ts may
// log; the message is fixed text, never personal data or a provider body. A
// code names no person, amount or value.

export function billingFailure(code: string): Error {
  return Object.assign(new Error('A WerkFlow billing step failed.'), { code });
}

/** A failed read of `werkflow_invoices`: logged under `scope`, thrown as `werkflow_invoice_record_failed`. */
export function werkflowInvoiceReadFailed(scope: string, error: unknown): never {
  logError(`${scope}: werkflow_invoices read failed`, error);
  throw billingFailure('werkflow_invoice_record_failed');
}

/** The stable code of a thrown billing failure, or null for any other error. */
export function billingFailureCode(error: unknown): string | null {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  return typeof code === 'string' ? code : null;
}

/** The id of a signal's object; a handler trusts nothing else of the event body. */
export function signalObjectId(event: Stripe.Event): string {
  const object: unknown = event.data.object;
  const id: unknown = typeof object === 'object' && object !== null ? Reflect.get(object, 'id') : undefined;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_]{1,255}$/.test(id))
    throw billingFailure('signal_object_id_invalid');
  return id;
}
