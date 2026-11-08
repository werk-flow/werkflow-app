import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import type { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { DocumentRow } from './types';
import { documentWriteFailure } from './write-support';

/**
 * Files (`Festschreiben`) an ordinary document as the actor: from then on it
 * keeps its bytes and is never trashed or deleted (public.file_document and
 * the trigger documents_retention_guard). The caller has established the
 * actor, the organization and the manager role. The `fileDocument` action
 * files a library document with it; a server that generates an original, such
 * as an invoice, calls it right after the original's registration.
 */
export async function fileDocumentOriginal(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  { actorId, organizationId, documentId }: { actorId: string; organizationId: string; documentId: string },
): Promise<ActionResult<{ document: DocumentRow }>> {
  const { data, error } = await admin.rpc('file_document', {
    p_actor_id: actorId,
    p_organization_id: organizationId,
    p_document_id: documentId,
  });
  if (error || !data) {
    return documentWriteFailure(
      'Failed to file document',
      error,
      ['not_authorized', 'document_not_found', 'protected_document_boundary', 'document_filed'],
      'update_failed',
    );
  }
  return { success: true, document: data };
}
