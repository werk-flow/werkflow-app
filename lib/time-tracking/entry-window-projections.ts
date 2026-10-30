import 'server-only';
import type { ActionResult } from '@/lib/action-result';
import type { AdminClient } from '@/lib/supabase/admin';
import { getProvisionalTimeCorrectionProjection } from '@/lib/time-corrections/actions';
import { loadApprovedCorrectionProjection } from '@/lib/time-corrections/approved-projection';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { getCanonicalTimeEntries } from './canonical-entries';
import type { TimeEntry, TimeEntryStatus } from './types';

// The projections getTimeEntries (entry-read-actions.ts) reads beside the
// legacy rows. The caller authorizes the organization and the subject first.

/**
 * Canonical entries, approved corrections and pending corrections of the
 * window, started together. A status filter other than approved skips the
 * first two, and any status filter skips the pending corrections.
 */
export function readWindowProjections(
  admin: AdminClient,
  input: {
    organizationId: string;
    from: string;
    to: string;
    status: TimeEntryStatus | undefined;
    subjectUserId: string | undefined;
    effectiveUserId: string | undefined;
  },
): Promise<
  [
    ActionResult<{ entries: TimeEntry[] }, 'load_failed'>,
    TimeCorrectionApplicationProjection[],
    Awaited<ReturnType<typeof getProvisionalTimeCorrectionProjection>>,
  ]
> {
  const { organizationId, from, to, status } = input;
  return Promise.all([
    status && status !== 'approved'
      ? Promise.resolve({ success: true as const, entries: [] })
      : getCanonicalTimeEntries({ organizationId, from, to, userId: input.subjectUserId }),
    status && status !== 'approved'
      ? Promise.resolve([])
      : loadApprovedCorrectionProjection(admin, {
          organizationId,
          from,
          to,
          ...(input.effectiveUserId ? { userIds: [input.effectiveUserId] } : {}),
        }),
    status
      ? Promise.resolve({ entries: [], sources: [] })
      : getProvisionalTimeCorrectionProjection({ organizationId, from, to, userId: input.subjectUserId }),
  ]);
}
