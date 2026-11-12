'use server';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { WORK_TARGET_KINDS, type AttachRequestResult } from './types';

const attachToWorkArgumentsSchema = z.object({
  requestId: uuidSchema,
  work: z.object({ kind: z.enum(WORK_TARGET_KINDS), id: uuidSchema }),
  attemptKey: uuidSchema,
});

// The refusals of attach_client_request_to_work, each an action failure code.
const ATTACH_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'not_authorized',
  'request_not_found',
  'already_attached',
  'request_not_editable',
  'client_required',
  'work_not_found',
  'work_client_mismatch',
  'work_closed',
]);

/**
 * Attaches an open request to an open job, project or Servicefall of its
 * customer, once. One call writes the request's summary and details into the
 * work's history, links the request's documents to the work as a second link
 * to the same file, marks the request attached and records the request
 * history, or refuses and changes nothing. A retry under `attemptKey` answers
 * with the entry the first attach wrote; any other second attach is refused.
 */
export async function attachRequestToWork(
  rawRequestId: string,
  rawWork: { kind: string; id: string },
  rawAttemptKey: string,
): Promise<AttachRequestResult> {
  const parsedArguments = attachToWorkArgumentsSchema.safeParse({
    requestId: rawRequestId,
    work: rawWork,
    attemptKey: rawAttemptKey,
  });
  if (!parsedArguments.success) return { success: false, error: 'invalid_input' };
  const { requestId, work, attemptKey } = parsedArguments.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    const { orgId, userId, isManagerOrAbove } = auth.context;
    if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };

    // The function checks request, customer, work and its state under their
    // locks; the organization comes from the session, never from the client.
    const { data, error } = await createSupabaseAdminClient().rpc(
      'attach_client_request_to_work',
      rpcArgs('attach_client_request_to_work', {
        p_organization_id: orgId,
        p_actor_id: userId,
        p_request_id: requestId,
        p_job_id: work.kind === 'job' ? work.id : null,
        p_project_id: work.kind === 'project' ? work.id : null,
        p_service_case_id: work.kind === 'service_case' ? work.id : null,
        p_attempt_key: attemptKey,
      }),
    );
    if (error || !data) {
      if (error && ATTACH_REFUSALS.has(error.message)) return { success: false, error: error.message };
      logError('Error attaching request to work:', error);
      return { success: false, error: 'attach_failed' };
    }
    return { success: true, entryId: data.id };
  } catch (error) {
    logError('Unexpected error in attachRequestToWork:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
