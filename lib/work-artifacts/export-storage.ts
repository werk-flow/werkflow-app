import 'server-only';

import { logError } from '@/lib/logging';
import { discardStorageObjects } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';

/**
 * Removes a generated export object after its registration failed, unless a
 * document owns its path: a committed export of the same content writes the
 * same key. A failed read keeps the object, since only a completed read
 * proves that no document owns it.
 */
export async function discardUnreferencedExportObject(
  admin: AdminClient,
  organizationId: string,
  storagePath: string,
  failureLabel: string,
): Promise<void> {
  const reference = await admin
    .from('documents')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('storage_path', storagePath)
    .limit(1);
  if (reference.error) logError(failureLabel, reference.error);
  if (!reference.error && (reference.data?.length ?? 0) === 0) {
    await discardStorageObjects({ organizationId, paths: [storagePath] });
  }
}
