import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import { issueOriginalOfSignal } from '@/lib/werkflow-billing/signals/issue-original';

// A paid Stripe invoice. Contract (family.ts): the handler re-reads its object
// from Stripe by id, is idempotent, and throws on failure so Stripe delivers
// again. First it runs the idempotent issue step (issue-original.ts) as a
// backstop: an invoice whose `invoice.finalized` could not issue it yet gets
// its original here, and an issued invoice reads nothing from Stripe. A6b
// (werk-flow/werkflow-planning#492) adds the receipt mail in this file, after
// this call, so a receipt always has its original.
export const invoicePaidSignals: SignalFamily = {
  eventTypes: ['invoice.paid'],
  handle: async (event, stripe) => {
    await issueOriginalOfSignal(event, stripe);
  },
};
