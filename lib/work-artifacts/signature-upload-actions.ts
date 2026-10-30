'use server';

import { createDocumentUploadTicket } from '@/lib/documents/upload-actions';
import { uploadFileSchema } from '@/lib/documents/action-schemas';
import type { DocumentUploadTicketResult } from '@/lib/documents/types';
import { loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// The signature upload of an Arbeitsnachweis. It lives apart from actions.ts,
// which the work-evidence fixtures load without the document actions.

function signatureReservationFailure(error: { message?: string }): string {
  const known = ['work_artifact_not_found', 'work_artifact_is_voided', 'work_artifact_not_authorized'];
  if (error.message && known.includes(error.message)) return error.message;
  logError('createWorkArtifactSignatureUploadTicket: reservation failed', error);
  return 'work_artifact_action_failed';
}

const signatureUploadTicketSchema = z.object({ artifactId: uuidSchema }).and(uploadFileSchema);

/**
 * The upload ticket of a customer signature. The server reserves the issued
 * document id for the artifact, so only this upload can later be discarded
 * as an unused signature.
 */
export async function createWorkArtifactSignatureUploadTicket(
  rawInput: z.input<typeof signatureUploadTicketSchema>,
): Promise<DocumentUploadTicketResult> {
  const parsed = signatureUploadTicketSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { artifactId, ...file } = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { data: artifact, error: artifactError } = await loggedRead(
    'createWorkArtifactSignatureUploadTicket: work_artifacts read failed',
    admin
      .from('work_artifacts')
      .select('job_id, project_id')
      .eq('organization_id', auth.context.orgId)
      .eq('id', artifactId)
      .maybeSingle(),
  );
  if (artifactError) return { success: false, error: 'load_failed' };
  const target = artifact?.job_id
    ? { kind: 'job' as const, jobId: artifact.job_id }
    : artifact?.project_id
      ? { kind: 'project' as const, projectId: artifact.project_id }
      : null;
  if (!target) return { success: false, error: 'work_artifact_not_found' };
  const ticket = await createDocumentUploadTicket({ ...target, ...file });
  if (!ticket.success) return ticket;
  const { error } = await admin.rpc('reserve_work_artifact_signature_upload', {
    p_actor_id: auth.context.userId,
    p_organization_id: auth.context.orgId,
    p_artifact_id: artifactId,
    p_document_id: ticket.ticket.documentId,
  });
  if (error) return { success: false, error: signatureReservationFailure(error) };
  return ticket;
}
