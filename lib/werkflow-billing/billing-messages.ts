import type { SharedFailureCode } from '@/lib/action-result';

// The billing page's failure codes and their German sentences (werk-flow/werkflow-planning#252).

export type WerkflowBillingFailureCode =
  | SharedFailureCode
  | 'stripe_unavailable'
  | 'subscription_not_cancellable'
  | 'subscription_not_resumable'
  | 'invoice_not_found'
  | 'invoice_download_failed';

export const WERKFLOW_BILLING_MESSAGES: Readonly<Partial<Record<WerkflowBillingFailureCode, string>>> = {
  not_authorized: 'Nur der Admin deiner Organisation verwaltet das Abo.',
  stripe_unavailable: 'Der Zahlungsdienst ist gerade nicht erreichbar. Versuche es in einem Moment erneut.',
  subscription_not_cancellable:
    'Das Abo lässt sich gerade nicht kündigen. Lade die Seite neu, um den aktuellen Stand zu sehen.',
  subscription_not_resumable:
    'Die Kündigung lässt sich nicht mehr zurücknehmen. Lade die Seite neu, um den aktuellen Stand zu sehen.',
  invoice_not_found: 'Diese Rechnung gibt es nicht mehr. Lade die Seite neu.',
  invoice_download_failed: 'Die Rechnung konnte nicht geöffnet werden. Versuche es erneut.',
};
