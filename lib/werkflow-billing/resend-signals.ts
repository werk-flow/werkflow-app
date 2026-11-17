import 'server-only';

import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { RESEND_SIGNAL_OWNERS } from '@/lib/werkflow-billing/resend-signal-owners';
import { z } from '@/lib/zod';

// Handles one verified Resend signal once per Svix id (werk-flow/werkflow-planning#496).
// A recorded Svix id is a replay: it answers success and dispatches nothing.
// Otherwise the ledger that sent the message handles it, and only after its
// change committed is the signal recorded, with the owning ledger, or none
// for a message no ledger knows. A handler that throws records nothing and
// answers 5xx, so Resend delivers again and the handler runs again.

/** What the endpoint answers: 200, 400, 500 or 503 (app/api/resend/webhook/route.ts). */
export type ResendSignalReceipt = 'settled' | 'malformed' | 'failed' | 'unavailable';

// Only the fields the record keeps leave the body; Resend signed them, and
// they still reach a database column.
const signalSchema = z.object({
  type: z.string().regex(/^[a-z0-9_.]{1,64}$/),
  created_at: z.iso.datetime({ offset: true }),
  data: z.object({ email_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/).optional() }).optional(),
});

function parseSignal(body: string): z.infer<typeof signalSchema> | null {
  try {
    const parsed = signalSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The ledger that sent the message and handled the signal, or null for none. */
async function dispatch(type: string, messageId: string): Promise<string | null> {
  for (const owner of RESEND_SIGNAL_OWNERS) {
    if (await owner.handle({ type, messageId })) return owner.ledger;
  }
  return null;
}

export async function receiveResendSignal(svixId: string, body: string): Promise<ResendSignalReceipt> {
  const signal = parseSignal(body);
  if (!signal) return 'malformed';
  const messageId = signal.data?.email_id ?? null;

  const admin = createSupabaseAdminClient();
  const { data: recorded, error: readError } = await admin
    .from('resend_webhook_events')
    .select('svix_id')
    .eq('svix_id', svixId)
    .maybeSingle();
  if (readError) {
    logError('receiveResendSignal: reading the signal record failed', readError);
    return 'unavailable';
  }
  if (recorded) return 'settled';

  let ledger: string | null = null;
  if (messageId) {
    try {
      ledger = await dispatch(signal.type, messageId);
    } catch (handlerError) {
      logError('receiveResendSignal: signal handler failed', handlerError);
      return 'failed';
    }
  }

  const { error: recordError } = await admin.rpc(
    'record_resend_webhook_event',
    rpcArgs('record_resend_webhook_event', {
      p_svix_id: svixId,
      p_event_type: signal.type,
      p_provider_message_id: messageId,
      p_occurred_at: signal.created_at,
      p_ledger: ledger,
    }),
  );
  if (recordError) {
    logError('receiveResendSignal: recording the signal failed', recordError);
    return 'unavailable';
  }
  return 'settled';
}
