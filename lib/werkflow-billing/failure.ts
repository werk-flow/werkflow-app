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
