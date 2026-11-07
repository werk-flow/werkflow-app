import { addLocalMonthsClamped, getBusinessTodayIso } from '@/lib/date-time/berlin';

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

type DocumentDateRange = { earliest: string; latest: string };

/**
 * The document dates a manager may save: from 1900 to one year after today on
 * the Berlin calendar. A paused partial year in the picker (20 for 2020) falls
 * outside, so it never starts or ends a retention period.
 * update_document_retention holds the same range.
 */
export function documentDateRange(today: string = getBusinessTodayIso()): DocumentDateRange {
  return { earliest: '1900-01-01', latest: addLocalMonthsClamped(today, 12) };
}

export function isDocumentDateInRange(documentDate: string, range: DocumentDateRange): boolean {
  return documentDate >= range.earliest && documentDate <= range.latest;
}
