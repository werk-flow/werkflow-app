import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import { issueOriginalOfSignal } from '@/lib/werkflow-billing/signals/issue-original';

// A finalized Stripe invoice becomes WerkFlow's checked original
// (werk-flow/werkflow-planning#249, issue-original.ts). Contract (family.ts):
// the step reads the invoice back from Stripe, is idempotent, and throws a
// stable code on failure so Stripe delivers again.
export const invoiceFinalizedSignals: SignalFamily = {
  eventTypes: ['invoice.finalized'],
  handle: issueOriginalOfSignal,
};
