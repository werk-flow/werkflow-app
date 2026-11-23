import { NextResponse } from 'next/server';

import { logError } from '@/lib/logging';
import { resendWebhookSecret, verifyResendSignature } from '@/lib/werkflow-billing/resend-signature';
import { receiveResendSignal, type ResendSignalReceipt } from '@/lib/werkflow-billing/resend-signals';

// Resend's delivery signals for every ledger that mails through it
// (werk-flow/werkflow-planning#496, agreed with E2c on werk-flow/werkflow-planning#17).
// No session: the caller is Resend, proven by the Svix signature over the raw
// body with RESEND_WEBHOOK_SECRET, checked before anything of the body is
// parsed or stored. A missing, forged or stale signature answers 401 and
// touches nothing; without a usable secret nothing runs and it answers 503.
// A verified signal is handled once per Svix id
// (lib/werkflow-billing/resend-signals.ts); any answer but 2xx makes Resend
// deliver it again. proxy.ts does not run on /api/.

const STATUS_BY_RECEIPT: Record<ResendSignalReceipt, number> = {
  settled: 200,
  malformed: 400,
  failed: 500,
  unavailable: 503,
};

function answer(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const key = resendWebhookSecret();
  if (!key) {
    logError('resend webhook: secret missing', 'resend_webhook_secret_missing');
    return answer(503);
  }
  const body = await request.text();
  const svixId = verifyResendSignature(key, request.headers, body);
  if (!svixId) return answer(401);
  return answer(STATUS_BY_RECEIPT[await receiveResendSignal(svixId, body)]);
}
