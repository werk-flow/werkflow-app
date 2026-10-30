import 'server-only';
import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import type { Tables } from '@/lib/supabase/database.types';

// The entries reviewEntries (review-actions.ts) decides on. The action then
// verifies the caller's membership in their one organization and the
// time_approval responsibility for each person before it writes.

type ReviewEntry = Pick<
  Tables<'time_entries'>,
  'id' | 'organization_id' | 'user_id' | 'status' | 'timestamp'
>;

/** Every requested entry, all pending and of one organization; otherwise the refusal. */
export async function readPendingEntriesForReview(
  admin: AdminClient,
  ids: readonly string[],
): Promise<{ success: true; entries: ReviewEntry[]; organizationId: string } | ActionFailure> {
  const { data: entries, error: entriesError } = await readInBatches(ids, (batch) =>
    // tenant-scope: by-id-then-verified — every entry must share one organization, whose membership and time_approval responsibility are verified before the write.
    admin
      .from('time_entries')
      .select('id, organization_id, user_id, status, timestamp')
      .in('id', [...batch]),
  );
  if (entriesError) {
    logReadFailure('reviewEntries: entries failed', entriesError);
    return { success: false, error: 'fetch_failed' };
  }
  if (entries.length !== ids.length) return { success: false, error: 'entry_not_found' };
  if (entries.some((entry) => entry.status !== 'pending')) {
    return { success: false, error: 'entry_not_pending' };
  }
  const organizationId = entries[0]?.organization_id;
  if (!organizationId || entries.some((entry) => entry.organization_id !== organizationId)) {
    return { success: false, error: 'invalid_input' };
  }
  return { success: true, entries, organizationId };
}
