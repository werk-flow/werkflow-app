import 'server-only';

import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { logError } from '@/lib/logging';

/**
 * The display name of each responsible employee record: the member's profile name, else the
 * record's own. Null when a read failed.
 */
export async function loadResponsibleNames(
  admin: AdminClient,
  orgId: string,
  responsibleIds: string[],
): Promise<Map<string, string> | null> {
  const recordsResult = await readInBatches(responsibleIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (recordsResult.error) {
    logError('Failed to resolve parking responsibles:', recordsResult.error);
    return null;
  }
  const userIds = (recordsResult.data ?? []).flatMap((record) => (record.user_id ? [record.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to resolve parking responsible profiles:', profilesResult.error);
    return null;
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
  return new Map(
    (recordsResult.data ?? []).map((record) => [
      record.id,
      (record.user_id ? profileNames.get(record.user_id) : null) ||
        [record.first_name, record.last_name].filter(Boolean).join(' ') ||
        'Unbenannt',
    ]),
  );
}
