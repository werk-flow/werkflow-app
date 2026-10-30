'use server';

import { loggedRead } from '@/lib/data/read-request-cache';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { resolveSelfServiceContextFor } from '@/lib/org/self-service-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSignedDownloadUrl } from '@/lib/storage/r2';
import type { LifecycleResult } from './lifecycle-results';
import { documentFileSchema } from './lifecycle-rows';

const signedDocumentFileSchema = documentFileSchema.extend({
  organization_id: z.string(),
  storage_path: z.string(),
});

export async function getPersonnelDocumentSignedUrl(
  documentIdInput: string,
): Promise<LifecycleResult<{ signedUrl: string }>> {
  const parsedDocumentId = uuidSchema.safeParse(documentIdInput);
  if (!parsedDocumentId.success) return { success: false, error: 'invalid_input' };
  const documentId = parsedDocumentId.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const admin = createSupabaseAdminClient();
  const { data: document, error: documentError } = await loggedRead(
    'getPersonnelDocumentSignedUrl: personnel_documents read failed',
    admin
      // tenant-scope: by-id-then-verified — the document's organization must be one of the caller's memberships, checked below before a URL is signed
      .from('personnel_documents')
      .select(
        'access_class, employee_record_id, documents!inner(id, organization_id, storage_path, display_name, current_version_number, deleted_at), personnel_document_releases(document_version_number, revoked_at)',
      )
      .eq('document_id', documentId)
      .maybeSingle(),
  );
  if (documentError) return { success: false, error: 'load_failed' };
  if (!document) return { success: false, error: 'document_not_found' };
  const parsedFile = signedDocumentFileSchema.safeParse(document.documents);
  if (!parsedFile.success || parsedFile.data.deleted_at)
    return { success: false, error: 'document_not_found' };
  const file = parsedFile.data;
  // A prestart employee may open their own released document; only an
  // operational membership carries the manager role.
  const caller = await resolveSelfServiceContextFor(file.organization_id);
  if (!caller.success) return { success: false, error: 'not_authorized' };
  const { role } = caller.context;
  const { data: employee, error: employeeError } = await loggedRead(
    'getPersonnelDocumentSignedUrl: employee_records read failed',
    admin
      .from('employee_records')
      .select('user_id')
      .eq('organization_id', file.organization_id)
      .eq('id', document.employee_record_id)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  const releases = document.personnel_document_releases;
  const ownReleased =
    employee?.user_id === caller.context.userId &&
    releases.some(
      (release) =>
        release.document_version_number === file.current_version_number && release.revoked_at === null,
    );
  const managerAllowed =
    role === 'admin' || (role === 'buero' && document.access_class === 'personnel_standard');
  if (!ownReleased && !managerAllowed) return { success: false, error: 'not_authorized' };
  try {
    const signedUrl = await createSignedDownloadUrl({
      organizationId: file.organization_id,
      path: file.storage_path,
      disposition: 'attachment',
      downloadFileName: file.display_name,
    });
    return { success: true, data: { signedUrl } };
  } catch (error) {
    logError('Failed to sign personnel document download', error);
    return { success: false, error: 'download_failed' };
  }
}
