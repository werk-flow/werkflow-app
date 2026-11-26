import { signalObjectId } from '@/lib/werkflow-billing/failure';
import { sendReceiptMail } from '@/lib/werkflow-billing/invoice-mails';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import { issueOriginalOfSignal } from '@/lib/werkflow-billing/signals/issue-original';

// A paid Stripe invoice. Contract (family.ts): the handler re-reads its object
// from Stripe by id, is idempotent, and throws on failure so Stripe delivers
// again. First it runs the idempotent issue step (issue-original.ts) as a
// backstop: an invoice whose `invoice.finalized` could not issue it yet gets
// its original and invoice mail here, and an issued invoice reads nothing
// from Stripe. Then the receipt goes out once (werk-flow/werkflow-planning#492),
// so a receipt always follows its original.
export const invoicePaidSignals: SignalFamily = {
  eventTypes: ['invoice.paid'],
  handle: async (event, stripe) => {
    await issueOriginalOfSignal(event, stripe);
    await sendReceiptMail(signalObjectId(event), stripe);
  },
};
