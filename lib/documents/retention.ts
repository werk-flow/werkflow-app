import { getBusinessTodayIso } from '@/lib/date-time/berlin';

// The one owner of the retention rule the server actions and the library
// apply (werk-flow/werkflow-planning#283). The trigger documents_retention_guard
// holds the same rule for every database write.

type RetentionState = { filedAt: string | null; retentionEndsOn: string | null };

/**
 * Why a document may not be deleted permanently: it is filed, or its
 * retention end is today or later on the Berlin calendar. Null when it may.
 */
export function earlyDeletionRefusal(
  state: RetentionState,
  today: string = getBusinessTodayIso(),
): 'document_filed' | 'retention_period_running' | null {
  if (state.filedAt) return 'document_filed';
  if (state.retentionEndsOn !== null && state.retentionEndsOn >= today) return 'retention_period_running';
  return null;
}
