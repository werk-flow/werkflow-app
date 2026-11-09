import { NextResponse } from 'next/server';

import { AuthUnavailableError } from '@/lib/auth/identity-errors';
import { identifyFieldSyncCaller } from '@/lib/field-sync/caller';
import type { FieldSyncVerdict } from '@/lib/field-sync/outcomes';
import { readFieldSyncToday } from '@/lib/field-sync/today';
import { logError } from '@/lib/logging';
import { resolveActiveContextForUser } from '@/lib/org/action-context';
import { uuidSchema } from '@/lib/validation/uuid';

// GET /api/field-sync/v1/today: the caller's own job visits on the current
// Berlin day, which a phone keeps to read without signal (decision record
// 0010, "Device data"). The answer is the snapshot of
// lib/field-sync/today-snapshot.ts with its version as the ETag; a request
// whose `If-None-Match` names the current version gets `304`. The optional
// `organizationId` query value is a hint: one that differs from the caller's
// active organization is refused, never switched to. A request that fails
// answers `{ outcome, code }` with its HTTP status.

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

function refuse(status: number, verdict: FieldSyncVerdict): NextResponse {
  return NextResponse.json(verdict, { status, headers: PRIVATE_HEADERS });
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const caller = await identifyFieldSyncCaller(request);
    if (!caller.success) {
      return caller.error === 'forbidden_origin'
        ? refuse(403, { outcome: 'rejected', code: 'forbidden' })
        : refuse(401, { outcome: 'retry', code: 'unauthenticated' });
    }
    const hint = new URL(request.url).searchParams.get('organizationId');
    if (hint !== null && !uuidSchema.safeParse(hint).success)
      return refuse(400, { outcome: 'rejected', code: 'invalid' });
    const context = await resolveActiveContextForUser(caller.userId);
    // A user without a current membership reads no organization's day: a revoked one included.
    if (!context.success) return refuse(403, { outcome: 'rejected', code: 'forbidden' });
    if (hint !== null && hint !== context.context.orgId)
      return refuse(403, { outcome: 'rejected', code: 'organization_mismatch' });
    const read = await readFieldSyncToday({
      userId: context.context.userId,
      organizationId: context.context.orgId,
    });
    if (!read.success) return refuse(503, { outcome: 'retry', code: 'unavailable' });
    const etag = `"${read.today.version}"`;
    const headers = { ...PRIVATE_HEADERS, ETag: etag };
    if (request.headers.get('if-none-match') === etag)
      return new NextResponse(null, { status: 304, headers });
    return NextResponse.json(read.today, { headers });
  } catch (error) {
    if (!(error instanceof AuthUnavailableError)) logError('field-sync today: request failed', error);
    return refuse(503, { outcome: 'retry', code: 'unavailable' });
  }
}
