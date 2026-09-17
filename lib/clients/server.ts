import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { toClient, type Client } from '@/lib/jobs/types';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';

/**
 * Every customer of one organization, name-ordered, for the pickers on detail
 * pages. The caller has already authorized the organization; the filter here is
 * the tenant boundary and must stay on every read.
 */
export async function readOrganizationClients(
  client: SupabaseClient<Database>,
  organizationId: string,
): Promise<Client[]> {
  // A single request stops at PostgREST's max_rows without an error (PF-25).
  const { data, error } = await readCompleteRows(
    (from, to) => client.from('clients').select('*').eq('organization_id', organizationId).order('name').order('id').range(from, to),
    LIST_ROW_CAP,
  );
  if (error) throw new Error(`Failed to load clients for organization ${organizationId}: ${error.message}`);
  return data.map(toClient);
}
