import { createHash } from 'node:crypto';

import { canonicalize } from '@/lib/format/canonical-json';
import type { TimeActivitySelection, TimeTransitionAction } from './types';

export type TimeTransitionHashInput = {
  organizationId: string;
  action: TimeTransitionAction;
  expectedSessionId: string | null;
  expectedVersion: number | null;
  selection: TimeActivitySelection | null;
  acknowledgeLong: boolean;
};

export function hashTimeTransitionRequest(input: TimeTransitionHashInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        organizationId: input.organizationId,
        action: input.action,
        expectedSessionId: input.expectedSessionId,
        expectedVersion: input.expectedVersion,
        selection: canonicalize(input.selection),
        acknowledgeLong: input.acknowledgeLong,
      }),
    )
    .digest('hex');
}
