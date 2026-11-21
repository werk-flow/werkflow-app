import 'server-only';

import { billingMailSignals } from '@/lib/werkflow-billing/mail-bounces';

// The ledgers that send mail through Resend and take its delivery signals
// (werk-flow/werkflow-planning#496, agreed with E2c on werk-flow/werkflow-planning#17).
// app/api/resend/webhook/route.ts asks each owner in turn whether it sent the
// signal's message; the first that did handles it, and the signal's record
// names that ledger. Each owner reads only its own rows. A new owner adds its
// handler in its own file, a line here and its ledger name to the check on
// resend_webhook_events.ledger.

/** A verified Resend delivery signal: what an owner may read of it. */
export type ResendSignal = { type: string; messageId: string };

export type ResendSignalOwner = {
  ledger: 'werkflow_billing_mails';
  /**
   * False when this ledger never sent the message. Otherwise applies the
   * signal and answers true only after its change committed; throws when it
   * could not, so Resend delivers again. Runs again for a signal whose earlier
   * delivery failed, and may overlap a second delivery of the same signal: it
   * must change nothing the second time.
   */
  handle(signal: ResendSignal): Promise<boolean>;
};

export const RESEND_SIGNAL_OWNERS: readonly ResendSignalOwner[] = [billingMailSignals];
