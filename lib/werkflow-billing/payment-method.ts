// Which payment method a Stripe payment attempt used (werk-flow/werkflow-planning#251).

/**
 * The payment method type of a payment attempt. A failed intent may have
 * dropped its `payment_method` and kept the declined one only in
 * `last_payment_error`, so that is read too; null when neither names one.
 */
export function failedPaymentMethodType(
  intent:
    | string
    | {
        payment_method: string | { type: string } | null;
        last_payment_error: { payment_method?: { type: string } } | null;
      }
    | null
    | undefined,
): string | null {
  if (!intent || typeof intent === 'string') return null;
  const method = typeof intent.payment_method === 'object' ? intent.payment_method : null;
  return method?.type ?? intent.last_payment_error?.payment_method?.type ?? null;
}
