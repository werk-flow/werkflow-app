import { NextResponse } from 'next/server';

import type { ActionResult } from '@/lib/action-result';
import {
  BACKGROUND_READS,
  isBackgroundReadKind,
  SELF_SERVICE_READS,
  type BackgroundReadInput,
  type BackgroundReadKind,
  type BackgroundReadResult,
} from '@/lib/data/background-reads';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { z } from '@/lib/zod';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };

function invalidInput(): NextResponse {
  return NextResponse.json(
    { success: false, error: 'invalid_input' },
    { status: 400, headers: PRIVATE_HEADERS },
  );
}

/** The JSON input of a request, or null when it is not valid JSON. */
function parseInput(raw: string | null): { value: unknown } | null {
  if (raw === null) return { value: {} };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return null;
  }
}

type ReadInputs = { [Kind in BackgroundReadKind]: BackgroundReadInput<Kind> };
type ReadResults = { [Kind in BackgroundReadKind]: BackgroundReadResult<Kind> };

/** The registry seen per kind, so one kind's parsed input reaches that kind's reader. */
const READERS: {
  [Kind in BackgroundReadKind]: {
    input: z.ZodType<ReadInputs[Kind]>;
    read: (input: ReadInputs[Kind]) => Promise<ReadResults[Kind]>;
  };
} = BACKGROUND_READS;

/** A kind's parsed input with its reader bound to it, or null when the input does not parse. */
function bindRead<Kind extends BackgroundReadKind>(
  kind: Kind,
  value: unknown,
): { input: ReadInputs[Kind]; read: () => Promise<ActionResult> } | null {
  const definition = READERS[kind];
  const input = definition.input.safeParse(value);
  if (!input.success) return null;
  return { input: input.data, read: () => definition.read(input.data) };
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
    if (
      kind === null ||
      query.getAll('kind').length !== 1 ||
      query.getAll('input').length > 1 ||
      !isBackgroundReadKind(kind)
    ) {
      return invalidInput();
    }
    const rawInput = parseInput(query.get('input'));
    if (rawInput === null) return invalidInput();
    const bound = bindRead(kind, rawInput.value);
    if (bound === null) return invalidInput();
    const { input, read } = bound;
    const result = await withReadRequest(
      request,
      async () => {
        if (SELF_SERVICE_READS.has(kind)) {
          if (!(await getAuthenticatedUser())) return { success: false as const, error: 'not_authenticated' };
          return read();
        }
        const auth = await authenticateAndAuthorize();
        if (!auth.success) return auth;
        const requestedOrganization = 'organizationId' in input ? input.organizationId : undefined;
        if (requestedOrganization !== undefined && auth.context.orgId !== requestedOrganization) {
          return { success: false as const, error: 'organization_changed' };
        }
        return read();
      },
      { priority: 'background' },
    );
    const status = result.success
      ? 200
      : result.error === 'not_authenticated'
        ? 401
        : ['organization_changed', 'no_active_org', 'not_a_member', 'not_authorized'].includes(
              result.error ?? '',
            )
          ? 403
          : 500;
    return NextResponse.json(result, { status, headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json(
      { success: false, error: 'unexpected_error' },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
