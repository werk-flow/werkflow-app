import 'server-only';

import { logError } from '@/lib/logging';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { getLocalDayEnd, getLocalDayStart } from './day-utils';

type OpenSessionOrg = { organizationId: string; organizationName: string };

/**
 * The organizations where a person's latest attendance entry of the day leaves
 * a session open. One person works in one organization at a time: clock-in
 * guards and the sign-out clock-out read this across organizations. Null
 * when the entry read fails: an unknown state is never "no open session".
 */
export async function getOpenSessionOrgsForUserOnDay(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string,
  referenceDate: Date,
): Promise<OpenSessionOrg[] | null> {
  const start = getLocalDayStart(referenceDate);
  const end = getLocalDayEnd(referenceDate);
  const effectiveEnd = new Date(Math.min(end.getTime(), Date.now())).toISOString();

  // tenant-scope: cross-organization-by-design — one person works in one organization at a time, so the open-session guard reads that person's entries in every organization and returns only organization names.
  const { data: rows, error } = await admin
    .from('time_entries')
    .select('organization_id, entry_type, timestamp, status')
    .eq('user_id', userId)
    .gte('timestamp', start.toISOString())
    .lte('timestamp', effectiveEnd)
    .neq('status', 'rejected')
    .neq('status', 'pending_delete')
    .order('timestamp', { ascending: false });

  if (error) {
    logError('Error fetching user entries for open-session check:', error);
    return null;
  }

  const seenOrgs = new Set<string>();
  const openOrgIds: string[] = [];

  for (const row of rows || []) {
    const orgId = row.organization_id as string;
    if (!orgId || seenOrgs.has(orgId)) continue;
    seenOrgs.add(orgId);

    if (row.entry_type !== 'clock_out') {
      openOrgIds.push(orgId);
    }
  }

  if (openOrgIds.length === 0) return [];

  const { data: orgs, error: orgErr } = await readInBatches(openOrgIds, (batch) =>
    admin
      .from('organizations')
      .select('id, name')
      .in('id', [...batch]),
  );

  if (orgErr) {
    logError('Error fetching org names for open-session check:', orgErr);
  }

  const nameById = new Map<string, string>();
  for (const o of orgs || []) {
    nameById.set(o.id, o.name);
  }

  return openOrgIds.map((id) => ({
    organizationId: id,
    organizationName: nameById.get(id) || 'Unbekannte Organisation',
  }));
}
