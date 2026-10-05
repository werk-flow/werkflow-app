// Who may edit or review the work block shown in the entry details dialog.

import type { OrgRole } from '@/lib/members/actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
import type { EntryDetailsSnapshot } from './use-entry-details-session';

export function getEntryDetailsPermissions({
  snapshot,
  currentUserRole,
  currentUserId,
  entryUserRole,
}: {
  snapshot: EntryDetailsSnapshot;
  currentUserRole: OrgRole;
  currentUserId: string | undefined;
  entryUserRole: OrgRole | undefined;
}): {
  canEdit: boolean;
  canApprove: boolean;
  pendingEntries: TimeEntry[];
  hasPendingEntry: boolean;
} {
  const { hasCanonicalSegment, sessionEntriesForReview, entryUserId } = snapshot;
  const effectiveEntryUserRole = snapshot.employeeRole ?? entryUserRole;
  const isOwnEntry = currentUserId && entryUserId === currentUserId;

  const canEdit = (() => {
    if (hasCanonicalSegment) return false;
    if (currentUserRole === 'admin') return true;
    if (currentUserRole === 'buero') {
      if (isOwnEntry) return true;
      if (effectiveEntryUserRole && effectiveEntryUserRole !== 'employee') {
        return false;
      }
      return true;
    }
    return false;
  })();
  const pendingEntries = sessionEntriesForReview.filter((entry) => entry.status === 'pending');
  const hasPendingEntry = pendingEntries.length > 0;
  const canApprove =
    !hasCanonicalSegment &&
    hasPendingEntry &&
    (currentUserRole === 'admin' || (currentUserRole === 'buero' && !isOwnEntry && canEdit));

  return { canEdit, canApprove, pendingEntries, hasPendingEntry };
}
