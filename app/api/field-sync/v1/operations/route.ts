import { NextResponse } from 'next/server';

import { AuthUnavailableError } from '@/lib/auth/identity-errors';
import { identifyFieldSyncCaller } from '@/lib/field-sync/caller';
import { fieldSyncBatchSchema, runFieldSyncOperations } from '@/lib/field-sync/operations';
import type { FieldSyncVerdict } from '@/lib/field-sync/outcomes';
import { logError } from '@/lib/logging';
import { resolveActiveContextForUser } from '@/lib/org/action-context';

// POST /api/field-sync/v1/operations: a batch of operations a phone recorded,
// possibly without signal (decision record 0010). The body is
// `{ operations: [envelope, ...] }`; the answer is `{ results: [...] }`, one
// `{ operationId, outcome, code }` per operation in the sent order. A request
// that fails as a whole answers `{ outcome, code }` with its HTTP status.

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

function refuse(status: number, verdict: FieldSyncVerdict): NextResponse {
  return NextResponse.json(verdict, { status, headers: PRIVATE_HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const caller = await identifyFieldSyncCaller(request);
    if (!caller.success) {
      return caller.error === 'forbidden_origin'
        ? refuse(403, { outcome: 'rejected', code: 'forbidden' })
        : refuse(401, { outcome: 'retry', code: 'unauthenticated' });
    }
    const body: unknown = await request.json().catch(() => null);
    const batch = fieldSyncBatchSchema.safeParse(body);
    if (!batch.success) return refuse(400, { outcome: 'rejected', code: 'invalid' });
    const context = await resolveActiveContextForUser(caller.userId);
    // A user without a current membership may act in no organization: a revoked one included.
    if (!context.success) return refuse(403, { outcome: 'rejected', code: 'forbidden' });
    const results = await runFieldSyncOperations(context.context, batch.data.operations);
    return NextResponse.json({ results }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (!(error instanceof AuthUnavailableError)) logError('field-sync operations: request failed', error);
    return refuse(503, { outcome: 'retry', code: 'unavailable' });
  }
}
