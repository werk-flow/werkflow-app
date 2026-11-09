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
  /**
   * The device clock of an offline-captured transition, as an ISO instant.
   * An online transition omits it, so its hash stays the one it always was;
   * the send time is never part of the hash (decision record 0010).
   */
  capturedAt?: string;
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
        ...(input.capturedAt === undefined ? {} : { capturedAt: input.capturedAt }),
      }),
    )
    .digest('hex');
}
