import { NextResponse } from 'next/server';

import { BACKGROUND_READS, isBackgroundReadKind } from '@/lib/data/background-reads';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

function invalidInput(): NextResponse {
  return NextResponse.json({ success: false, error: 'invalid_input' }, { status: 400, headers: PRIVATE_HEADERS });
}

function parseInput(raw: string | null): unknown {
  if (raw === null) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Background page reads leave the browser's serialized Server Action queue so
 * a user mutation never waits behind a read the user did not ask for. The
 * registry is the closed list of readers; each keeps its own authorization.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = new URL(request.url).searchParams;
    const kind = query.get('kind');
    if (kind === null || query.getAll('kind').length !== 1 || query.getAll('input').length > 1 || !isBackgroundReadKind(kind)) {
      return invalidInput();
    }
    const definition = BACKGROUND_READS[kind];
    const input = definition.input.safeParse(parseInput(query.get('input')));
    if (!input.success) return invalidInput();
    const result = await withReadRequest(request, async () => {
      const auth = await authenticateAndAuthorize();
      if (!auth.success) return auth;
      const requestedOrganization = (input.data as { organizationId?: string }).organizationId;
      if (requestedOrganization !== undefined && auth.context.orgId !== requestedOrganization) {
        return { success: false as const, error: 'organization_changed' };
      }
      // The typed registry pairs each schema with its reader; the union collapses here.
      return (definition.read as (value: unknown) => Promise<{ success: boolean; error?: string }>)(input.data);
    }, { priority: 'background' });
    const status = result.success ? 200 : result.error === 'not_authenticated' ? 401
      : ['organization_changed', 'no_active_org', 'not_a_member', 'not_authorized'].includes(result.error ?? '') ? 403 : 500;
    return NextResponse.json(result, { status, headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ success: false, error: 'unexpected_error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
