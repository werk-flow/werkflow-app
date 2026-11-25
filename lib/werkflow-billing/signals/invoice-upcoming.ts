import 'server-only';

import { sendDebitNotice } from '@/lib/werkflow-billing/invoice-mails';
import type { SignalFamily } from '@/lib/werkflow-billing/signals/family';
import { z } from '@/lib/zod';

// A subscription renews soon (werk-flow/werkflow-planning#492); Stripe sends
// it as many days ahead as its dashboard sets. Contract (family.ts): an
// upcoming invoice has no id of its own, so the handler takes only the
// subscription's id from the event and re-reads the renewal from Stripe, sends
// the debit notice of a SEPA renewal once (invoice-mails.ts), and throws on
// failure so Stripe delivers again.

const upcomingSchema = z.object({
  data: z.object({
    object: z.object({
      parent: z.object({
        subscription_details: z.object({ subscription: z.string().regex(/^sub_[A-Za-z0-9_]{1,250}$/) }),
      }),
    }),
  }),
});

export const invoiceUpcomingSignals: SignalFamily = {
  eventTypes: ['invoice.upcoming'],
  handle: async (event, stripe) => {
    const parsed = upcomingSchema.safeParse(event);
    // An upcoming invoice without a subscription renews nothing.
    if (!parsed.success) return;
    await sendDebitNotice(parsed.data.data.object.parent.subscription_details.subscription, stripe);
  },
};
