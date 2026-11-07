import 'server-only';
import type { ActionFailure } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import type { Tables } from '@/lib/supabase/database.types';

// The entries reviewEntries (review-actions.ts) decides on, read only inside
// the caller's verified organization. The action then verifies the
// time_approval responsibility for each person, and only then their review
// state, before it writes.

type ReviewEntry = Pick<Tables<'time_entries'>, 'id' | 'user_id' | 'status' | 'timestamp'>;

/**
 * Every requested entry of the organization; otherwise the refusal. An entry of
 * another organization is never read, so it is refused like an unknown id.
 */
export async function readEntriesForReview(
  admin: AdminClient,
  organizationId: string,
  ids: readonly string[],
): Promise<{ success: true; entries: ReviewEntry[] } | ActionFailure> {
  const { data: entries, error: entriesError } = await readInBatches(ids, (batch) =>
    admin
      .from('time_entries')
      .select('id, user_id, status, timestamp')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (entriesError) {
    logReadFailure('reviewEntries: entries failed', entriesError);
    return { success: false, error: 'fetch_failed' };
  }
  if (entries.length !== ids.length) return { success: false, error: 'entry_not_found' };
  return { success: true, entries };
}
