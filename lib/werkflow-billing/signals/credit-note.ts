import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';

// A Stripe credit note, the refund's Storno. Contract (family.ts): the input is the verified event;
// the handler re-reads its object from Stripe by id, is idempotent, and throws
// on failure so Stripe delivers again. Until werk-flow/werkflow-planning#491
// fills it, it only returns, which marks the signal handled.
export const creditNoteSignals: SignalFamily = {
  eventTypes: ['credit_note.created'],
  handle: async () => {},
};
