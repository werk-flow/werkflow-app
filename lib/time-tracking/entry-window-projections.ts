import 'server-only';
import type { ActionResult } from '@/lib/action-result';
import type { AdminClient } from '@/lib/supabase/admin';
import { getProvisionalTimeCorrectionProjection } from '@/lib/time-corrections/actions';
import { getOwnEmployeeRecordId } from '@/lib/data/cached';
import { loadApprovedCorrectionProjection } from '@/lib/time-corrections/approved-projection';
import { loadPersonCorrections } from '@/lib/time-corrections/person-corrections';
import type { TimeCorrectionApplicationProjection } from '@/lib/time-corrections/types';
import { getCanonicalTimeEntries } from './canonical-entries';
import type { TimeEntry, TimeEntryStatus } from './types';

// The projections getTimeEntries (entry-read-actions.ts) reads beside the
// legacy rows. The caller authorizes the organization and the subject first.

/** The employee record a member holds in the organization; null without one. */
async function readMemberRecordId(
  admin: AdminClient,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error("The member's employee record could not be read.");
  return data?.id ?? null;
}

/**
 * The approved corrections of the window. One person's read keeps only the
 * facts of their effective employee record (`loadPersonCorrections`): the
 * caller's own from their membership, a member the office shows from the
 * record they hold now. The whole organization's read, for Admin and Büro,
 * keeps every fact.
 */
function readApprovedCorrections(
  admin: AdminClient,
  input: {
    organizationId: string;
    from: string;
    to: string;
    callerId: string;
    effectiveUserId: string | undefined;
  },
): Promise<TimeCorrectionApplicationProjection[]> {
  const { organizationId, from, to, callerId, effectiveUserId } = input;
  if (!effectiveUserId) return loadApprovedCorrectionProjection(admin, { organizationId, from, to });
  return loadPersonCorrections(admin, {
    organizationId,
    userId: effectiveUserId,
    employeeRecordId:
      effectiveUserId === callerId
        ? getOwnEmployeeRecordId(callerId, organizationId)
        : readMemberRecordId(admin, organizationId, effectiveUserId),
    from,
    to,
  });
}

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
    /** Where segments and approved corrections are read to: the window's end, or the next midnight that closes its last day. */
    readTo: string;
    status: TimeEntryStatus | undefined;
    /** The signed-in caller. */
    callerId: string;
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
  const { organizationId, from, to, status } = input;
  return Promise.all([
    status && status !== 'approved'
      ? Promise.resolve({ success: true as const, entries: [] })
      : getCanonicalTimeEntries({ organizationId, from, to: input.readTo, userId: input.effectiveUserId }),
    status && status !== 'approved'
      ? Promise.resolve([])
      : readApprovedCorrections(admin, {
          organizationId,
          from,
          to: input.readTo,
          callerId: input.callerId,
          effectiveUserId: input.effectiveUserId,
        }),
    status
      ? Promise.resolve({ entries: [], sources: [] })
      : getProvisionalTimeCorrectionProjection({ organizationId, from, to, userId: input.effectiveUserId }),
  ]);
}
