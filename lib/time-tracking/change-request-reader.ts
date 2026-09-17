import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';

type RequestRow = Database['public']['Tables']['entry_change_requests']['Row'];
type ReadResult = { requests: RequestRow[]; entryOwnerById: Map<string, string>; error: { message: string } | null };

/** Read only the caller's permitted organizations; batching never widens that filter. */
export async function readPendingChangeRequestData(
  client: SupabaseClient<Database>,
  entryIds: readonly string[],
  organizationIds: readonly string[],
): Promise<ReadResult> {
  const empty = { requests: [], entryOwnerById: new Map<string, string>() };
  if (entryIds.length === 0 || organizationIds.length === 0) return { ...empty, error: null };
  const requests = await readInBatches(entryIds, ids => readCompleteRows((from, to) => client
    .from('entry_change_requests')
    .select('*')
    .in('entry_id', [...ids])
    .in('organization_id', [...organizationIds])
    .eq('status', 'pending')
    .order('id')
    .range(from, to), LIST_ROW_CAP));
  if (requests.error) return { ...empty, error: requests.error };
  if (requests.data.length === 0) return { ...empty, error: null };
  const entries = await readInBatches(requests.data.map(request => request.entry_id), ids => client
    .from('time_entries')
    .select('id,user_id')
    .in('organization_id', [...organizationIds])
    .in('id', [...ids]));
  if (entries.error) return { ...empty, error: entries.error };
  return { requests: requests.data, entryOwnerById: new Map(entries.data.map(entry => [entry.id, entry.user_id])), error: null };
}
