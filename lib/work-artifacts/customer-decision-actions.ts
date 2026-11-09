'use server';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isJsonRecord, toJson } from '@/lib/supabase/json';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { z } from '@/lib/zod';
import { mapArtifactError } from './errors';
import { revalidateWorkEvidenceViews } from './revalidate';
import { WORK_ARTIFACT_LEGAL_NOTICE, WORK_ARTIFACT_STATUSES, type WorkArtifactMutationResult } from './types';
import { workArtifactCustomerDecisionSchema } from './validation';

const statusSchema = z.enum(WORK_ARTIFACT_STATUSES);

/**
 * Records the customer's decision on the current revision and, when the
 * customer signed, the signature in one database call. The function takes the
 * organization and the actor from the session, refuses an artifact outside
 * the caller's organization or assigned work, an internal revision and a
 * revision that already holds a decision or a signature
 * (`work_artifact_customer_decision_recorded`).
 */
export async function recordWorkArtifactCustomerDecision(
  rawInput: z.input<typeof workArtifactCustomerDecisionSchema>,
): Promise<WorkArtifactMutationResult> {
  const parsed = workArtifactCustomerDecisionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const input = parsed.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  // The server writes the wording the customer saw and how the decision was taken.
  const customerContext = {
    signerName: input.signer.name,
    ...(input.signer.role ? { signerRole: input.signer.role } : {}),
    signerRelationship: input.signer.relationship,
    captureMethod: input.signature ? 'Unterschrift auf dem Gerät' : 'Persönlich vor Ort',
    wordingSnapshot: WORK_ARTIFACT_LEGAL_NOTICE,
  };
  const { data, error } = await createSupabaseAdminClient().rpc(
    'record_work_artifact_customer_decision',
    rpcArgs('record_work_artifact_customer_decision', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_artifact_id: input.artifactId,
      p_revision_id: input.revisionId,
      p_expected_version: input.expectedVersion,
      p_decision_action_id: input.decisionActionId,
      p_decision: input.decision,
      p_reason: input.reason ?? null,
      p_customer_context: toJson(customerContext),
      p_signature_action_id: input.signature?.actionId ?? null,
      p_signature_document_id: input.signature?.documentId ?? null,
    }),
  );
  const status = isJsonRecord(data) ? statusSchema.safeParse(data.status) : null;
  if (error || !isJsonRecord(data) || !status?.success) {
    return { success: false, error: mapArtifactError(error) };
  }
  revalidateWorkEvidenceViews();
  return {
    success: true,
    artifactId: input.artifactId,
    version: Number(data.version),
    status: status.data,
    data,
  };
}
