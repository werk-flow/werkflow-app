import { checkoutSignals } from '@/lib/werkflow-billing/signals/checkout';
import { creditNoteSignals } from '@/lib/werkflow-billing/signals/credit-note';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import { invoiceFinalizedSignals } from '@/lib/werkflow-billing/signals/invoice-finalized';
import { invoicePaidSignals } from '@/lib/werkflow-billing/signals/invoice-paid';
import { invoiceUpcomingSignals } from '@/lib/werkflow-billing/signals/invoice-upcoming';
import { mandateSignals } from '@/lib/werkflow-billing/signals/mandate';
import { paymentFailedSignals } from '@/lib/werkflow-billing/signals/payment-failed';
import { refundSignals } from '@/lib/werkflow-billing/signals/refund';
import { subscriptionSignals } from '@/lib/werkflow-billing/signals/subscription';

// The dispatch table: each event type belongs to exactly one family, and each
// family names its own types in its file. A type no family takes is recorded
// and ignored.
const SIGNAL_FAMILIES: readonly SignalFamily[] = [
  invoiceFinalizedSignals,
  invoicePaidSignals,
  invoiceUpcomingSignals,
  paymentFailedSignals,
  creditNoteSignals,
  mandateSignals,
  checkoutSignals,
  subscriptionSignals,
  refundSignals,
];

const familyByEventType = new Map<string, SignalFamily>();
for (const family of SIGNAL_FAMILIES) {
  for (const eventType of family.eventTypes) {
    if (familyByEventType.has(eventType)) throw new Error(`Two signal families take ${eventType}.`);
    familyByEventType.set(eventType, family);
  }
}

/** Every event type a family handles: the daily comparison asks Stripe for these. */
export const HANDLED_EVENT_TYPES = SIGNAL_FAMILIES.flatMap((family) => family.eventTypes);

/** The family that handles `eventType`, or undefined when WerkFlow ignores it. */
export function signalFamilyFor(eventType: string): SignalFamily | undefined {
  return familyByEventType.get(eventType);
}
