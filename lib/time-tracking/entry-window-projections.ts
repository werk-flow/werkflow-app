import 'server-only';
import type { ActionResult } from '@/lib/action-result';
import type { AdminClient } from '@/lib/supabase/admin';
import { getProvisionalTimeCorrectionProjection } from '@/lib/time-corrections/actions';
import { loadApprovedCorrectionProjection } from '@/lib/time-corrections/approved-projection';
import { keepEffectiveFacts } from '@/lib/time-corrections/person-corrections';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { getCanonicalTimeEntries } from './canonical-entries';
import type { TimeEntry, TimeEntryStatus } from './types';

// The projections getTimeEntries (entry-read-actions.ts) reads beside the
// legacy rows. The caller authorizes the organization and the subject first.

/**
 * Canonical entries, approved corrections and pending corrections of the
 * window, started together. A status filter other than approved skips the
 * first two, and any status filter skips the pending corrections. The approved
 * corrections keep only the facts of each person's effective employee record,
 * the one the canonical read found for them (`keepEffectiveFacts`): the week,
 * the member status and the whole organization's day alike.
 */
export async function readWindowProjections(
  admin: AdminClient,
  input: {
    organizationId: string;
    from: string;
    to: string;
    /** Where segments and approved corrections are read to: the window's end, or the next midnight that closes its last day. */
    readTo: string;
    status: TimeEntryStatus | undefined;
    /** The one person whose time is read, an employee's own; undefined for the whole organization. */
    effectiveUserId: string | undefined;
  },
): Promise<
  [
    ActionResult<{ entries: TimeEntry[] }, 'load_failed'>,
    TimeCorrectionApplicationProjection[],
    Awaited<ReturnType<typeof getProvisionalTimeCorrectionProjection>>,
  ]
> {
  const { organizationId, from, to, status, effectiveUserId } = input;
  if (status && status !== 'approved') {
    return [{ success: true, entries: [] }, [], { entries: [], sources: [] }];
  }
  const [canonical, applications, provisional] = await Promise.all([
    getCanonicalTimeEntries({ organizationId, from, to: input.readTo, userId: effectiveUserId }),
    loadApprovedCorrectionProjection(admin, {
      organizationId,
      from,
      to: input.readTo,
      ...(effectiveUserId ? { userIds: [effectiveUserId] } : {}),
    }),
    status
      ? Promise.resolve({ entries: [], sources: [] })
      : getProvisionalTimeCorrectionProjection({ organizationId, from, to, userId: effectiveUserId }),
  ]);
  return [
    canonical,
    canonical.success ? keepEffectiveFacts(applications, canonical.recordByUser) : [],
    provisional,
  ];
}
