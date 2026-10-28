// Who may edit or review the work block shown in the entry details dialog.

import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';
import type { OrgRole } from '@/lib/roles';
import { canApproveEntries } from '@/lib/time-tracking/helpers';
import { isEntryInClosedPeriod, type ClosedTimePeriod } from '@/lib/time-tracking/closed-period-dates';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { EntryDetailsSnapshot } from './use-entry-details-session';

export function getEntryDetailsPermissions({
  snapshot,
  currentUserRole,
  currentUserId,
  entryUserRole,
  closedPeriods,
  approvalHolder,
}: {
  snapshot: EntryDetailsSnapshot;
  currentUserRole: OrgRole;
  currentUserId: string | undefined;
  entryUserRole: OrgRole | undefined;
  closedPeriods: readonly ClosedTimePeriod[];
  /** The caller's own time_approval holder; null offers no approval. */
  approvalHolder: EffectiveResponsibilityHolder | null;
}): {
  canEdit: boolean;
  canApprove: boolean;
  pendingEntries: TimeEntry[];
  hasPendingEntry: boolean;
  /** The block lies in a closed period: the server refuses every edit and review of it. */
  inClosedPeriod: boolean;
} {
  const { hasCanonicalSegment, sessionEntriesForReview, entryUserId } = snapshot;
  const effectiveEntryUserRole = snapshot.employeeRole ?? entryUserRole;
  const isOwnEntry = currentUserId && entryUserId === currentUserId;
  const inClosedPeriod = sessionEntriesForReview.some((entry) => isEntryInClosedPeriod(entry, closedPeriods));

  const canEdit = (() => {
    if (hasCanonicalSegment || inClosedPeriod) return false;
    if (currentUserRole === 'admin') return true;
    if (currentUserRole === 'buero') {
      // Büro changes their own time through a Zeitkorrektur, as the server requires.
      if (isOwnEntry) return false;
      if (effectiveEntryUserRole && effectiveEntryUserRole !== 'employee') {
        return false;
      }
      return true;
    }
    return false;
  })();
  const pendingEntries = sessionEntriesForReview.filter((entry) => entry.status === 'pending');
  const hasPendingEntry = pendingEntries.length > 0;
  // The server's own predicate: no self-approval, and a Büro source approves employees only.
  const canApprove =
    !hasCanonicalSegment &&
    !inClosedPeriod &&
    hasPendingEntry &&
    entryUserId !== undefined &&
    effectiveEntryUserRole !== undefined &&
    canApproveEntries(approvalHolder, entryUserId, effectiveEntryUserRole);

  return { canEdit, canApprove, pendingEntries, hasPendingEntry, inClosedPeriod };
}
