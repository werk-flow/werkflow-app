import { NextResponse } from 'next/server';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { getCurrentClockState, getActiveJobIdsForOrg } from '@/lib/time-tracking/actions';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const inputSchema = z.object({ organizationId: uuidSchema, kind: z.enum(['clock', 'active-jobs']) });

/** Background reads must not occupy the browser's queue for user mutations. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = new URL(request.url).searchParams;
    const input = inputSchema.safeParse(Object.fromEntries(query));
    if (!input.success || ['organizationId', 'kind'].some(key => query.getAll(key).length !== 1)) {
      return NextResponse.json({ success: false, error: 'invalid_input' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const result = await withReadRequest(request, async () => {
      const auth = await authenticateAndAuthorize();
      if (!auth.success) return auth;
      if (auth.context.orgId !== input.data.organizationId) return { success: false as const, error: 'organization_changed' };
      // Each existing reader retains its own current membership and subject checks.
      return input.data.kind === 'clock'
        ? getCurrentClockState(input.data.organizationId)
        : getActiveJobIdsForOrg(input.data.organizationId);
    }, { priority: 'background' });
    const status = result.success ? 200 : result.error === 'not_authenticated' ? 401
      : ['organization_changed', 'no_active_org', 'not_a_member'].includes(result.error) ? 403 : 500;
    return NextResponse.json(result, { status, headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ success: false, error: 'unexpected_error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
