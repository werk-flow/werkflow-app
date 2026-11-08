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
  // A version upload moves a key from `documents` to `document_versions`, never
  // back, so the current read must come first: a move that commits after it
  // lands in the archived read that follows.
  for (const table of ['documents', 'document_versions'] as const) {
    const reference = await admin
      .from(table)
      .select('id')
      .eq('organization_id', organizationId)
      .eq('storage_path', storagePath)
      .limit(1);
    if (reference.error) {
      logError(failureLabel, reference.error);
      return;
    }
    if ((reference.data?.length ?? 0) > 0) return;
  }
  await discardStorageObjects({ organizationId, paths: [storagePath] });
}
