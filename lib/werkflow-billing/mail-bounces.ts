import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { billingFailure } from '@/lib/werkflow-billing/failure';
import { raiseBillingAlarm } from '@/lib/werkflow-billing/mail-delivery';
import type { ResendSignal, ResendSignalOwner } from '@/lib/werkflow-billing/resend-signal-owners';
import { z } from '@/lib/zod';

// The bounce side of WerkFlow's billing mail ledger (werk-flow/werkflow-planning#496).
// Resend's bounce or complaint for a billing mail marks its row in
// werkflow_billing_mails, once, and raises the alarm `mail_bounced` for a
// customer mail, once per row. Run again for the same message, both steps
// change nothing, so a delivery that failed after the mark can come again. An
// alarm that bounces raises no alarm to the same address; the log names it.

const PROBLEM_BY_TYPE: Readonly<Record<string, 'bounced' | 'complained'>> = {
  'email.bounced': 'bounced',
  'email.complained': 'complained',
};

const PROBLEM_LABEL = { bounced: 'unzustellbar', complained: 'als Spam gemeldet' } as const;

const markedRowsSchema = z.array(
  z.object({
    kind: z.string(),
    organization_id: z.string().nullable(),
    stripe_object_id: z.string(),
    delivery_problem: z.enum(['bounced', 'complained']),
  }),
);

async function ownsMessage(messageId: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient()
    // tenant-scope: cross-organization-by-design — asks only whether WerkFlow sent the message id Resend signed; reads no row content.
    .from('werkflow_billing_mails')
    .select('id')
    .eq('provider_message_id', messageId)
    .limit(1);
  if (error) throw billingFailure('billing_mail_lookup_failed');
  return data.length > 0;
}

async function handleBillingMailSignal({ type, messageId }: ResendSignal): Promise<boolean> {
  const problem = PROBLEM_BY_TYPE[type];
  if (!problem) return ownsMessage(messageId);

  const { data, error } = await createSupabaseAdminClient().rpc('mark_werkflow_billing_mail_undelivered', {
    p_provider_message_id: messageId,
    p_problem: problem,
  });
  if (error) throw billingFailure('billing_mail_mark_failed');
  const rows = markedRowsSchema.safeParse(data);
  if (!rows.success) throw billingFailure('billing_mail_mark_invalid');

  for (const row of rows.data) {
    if (row.organization_id === null) {
      logError('billing mail signal: an alarm mail did not arrive', 'billing_alarm_undelivered');
      continue;
    }
    await raiseBillingAlarm({
      kind: 'mail_bounced',
      // One alarm per mail row: its kind and Stripe object are the row's key.
      stripeObjectId: `${row.kind}_${row.stripe_object_id}`,
      facts: [
        ['Organisation', row.organization_id],
        ['Mail', row.kind],
        ['Stripe-Bezug', row.stripe_object_id],
        ['Grund', PROBLEM_LABEL[row.delivery_problem]],
      ],
    });
  }
  return rows.data.length > 0;
}

export const billingMailSignals: ResendSignalOwner = {
  ledger: 'werkflow_billing_mails',
  handle: handleBillingMailSignal,
};
