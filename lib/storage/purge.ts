import 'server-only';

import { logError } from '@/lib/logging';
import { deleteStorageObjects } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The scheduled purge of deleted files (app/api/storage-purge/route.ts).
// Permanent deletion and organization deletion queue each object eight days
// ahead, past the backup window (werk-flow/werkflow-planning#286);
// claim_storage_purge returns only due paths no row references.

// One claim fits the single delete request of r2.ts.
const PURGE_BATCH_SIZE = 500;

export type StoragePurgeResult = { ok: boolean; purged: number; failed: number };

type ClaimedEntry = { id: string; organization_id: string; storage_path: string };

function byOrganization(entries: readonly ClaimedEntry[]): Map<string, ClaimedEntry[]> {
  const groups = new Map<string, ClaimedEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.organization_id);
    if (group) group.push(entry);
    else groups.set(entry.organization_id, [entry]);
  }
  return groups;
}

/**
 * Deletes the due objects claim by claim until no due entry is left
 * unclaimed. Each organization's objects go in one request inside its own
 * prefix. A failed deletion or completion keeps its entries queued for the
 * next run and makes the result fail; no path or provider message is logged.
 */
export async function purgeDueStorageObjects(): Promise<StoragePurgeResult> {
  const admin = createSupabaseAdminClient();
  let purged = 0;
  let failed = 0;
  for (;;) {
    const { data: claimed, error } = await admin.rpc('claim_storage_purge', { p_limit: PURGE_BATCH_SIZE });
    if (error) {
      logError('purgeDueStorageObjects: claim failed', error);
      return { ok: false, purged, failed };
    }
    if (claimed.length === 0) return { ok: failed === 0, purged, failed };

    const deleted: string[] = [];
    for (const [organizationId, entries] of byOrganization(claimed)) {
      try {
        await deleteStorageObjects({ organizationId, paths: entries.map((entry) => entry.storage_path) });
        deleted.push(...entries.map((entry) => entry.id));
      } catch (deleteError) {
        logError('purgeDueStorageObjects: object deletion failed', deleteError);
        failed += entries.length;
      }
    }
    if (deleted.length === 0) continue;
    const { error: completeError } = await admin.rpc('complete_storage_purge', { p_ids: deleted });
    if (completeError) {
      logError('purgeDueStorageObjects: completion failed', completeError);
      failed += deleted.length;
    } else {
      purged += deleted.length;
    }
  }
}
