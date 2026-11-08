import 'server-only';

import { logError } from '@/lib/logging';
import { discardStorageObjects } from '@/lib/storage/r2';
import type { AdminClient } from '@/lib/supabase/admin';

/**
 * Removes an object one attempt wrote after its registration failed, unless a
 * document or an archived version references it: a lost answer can hide a
 * registration that committed. The read is current only when no other attempt
 * writes the key, as with a key of its own per attempt. A failed read keeps
 * the object, since only a completed read proves that nothing references it.
 */
export async function discardUnreferencedObject(
  admin: AdminClient,
  organizationId: string,
  storagePath: string,
  failureLabel: string,
): Promise<void> {
  const [current, archived] = await Promise.all([
    admin
      .from('documents')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('storage_path', storagePath)
      .limit(1),
    admin
      .from('document_versions')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('storage_path', storagePath)
      .limit(1),
  ]);
  const error = current.error ?? archived.error;
  if (error) {
    logError(failureLabel, error);
    return;
  }
  if ((current.data?.length ?? 0) + (archived.data?.length ?? 0) === 0) {
    await discardStorageObjects({ organizationId, paths: [storagePath] });
  }
}
