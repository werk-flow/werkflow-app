import { checkoutSignals } from '@/lib/werkflow-billing/signals/checkout';
import { creditNoteSignals } from '@/lib/werkflow-billing/signals/credit-note';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import { invoiceFinalizedSignals } from '@/lib/werkflow-billing/signals/invoice-finalized';
import { invoicePaidSignals } from '@/lib/werkflow-billing/signals/invoice-paid';
import { mandateSignals } from '@/lib/werkflow-billing/signals/mandate';
import { paymentFailedSignals } from '@/lib/werkflow-billing/signals/payment-failed';
import { subscriptionSignals } from '@/lib/werkflow-billing/signals/subscription';

// The dispatch table: each event type belongs to exactly one family, and each
// family names its own types in its file. A type no family takes is recorded
// and ignored.
const SIGNAL_FAMILIES: readonly SignalFamily[] = [
  invoiceFinalizedSignals,
  invoicePaidSignals,
  paymentFailedSignals,
  creditNoteSignals,
  mandateSignals,
  checkoutSignals,
  subscriptionSignals,
];

const familyByEventType = new Map<string, SignalFamily>();
for (const family of SIGNAL_FAMILIES) {
  for (const eventType of family.eventTypes) {
    if (familyByEventType.has(eventType)) throw new Error(`Two signal families take ${eventType}.`);
    familyByEventType.set(eventType, family);
  }
}

/** The family that handles `eventType`, or undefined when WerkFlow ignores it. */
export function signalFamilyFor(eventType: string): SignalFamily | undefined {
  return familyByEventType.get(eventType);
}
